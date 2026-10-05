import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { consultar, type RespostaFerramenta } from "../sessao";

/**
 * O que as sete ferramentas de leitura compartilham.
 *
 * O ponto de isolar isto é que elas não possam divergir em limite, em anotação
 * ou na forma de resolver um nome. Divergência aí não aparece em teste —
 * aparece como "essa ferramenta se comporta diferente" meses depois.
 */

/**
 * As quatro anotações, sempre explícitas.
 *
 * No spec do MCP, `destructiveHint` e `openWorldHint` têm default TRUE e
 * `idempotentHint` default FALSE. Declarar só `readOnlyHint` deixa a
 * ferramenta anunciada como destrutiva por omissão — de onde vem o triângulo
 * de aviso no Inspector.
 */
export const ANOTACOES_LEITURA = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const LIMITE_PADRAO = 20;
export const LIMITE_MAXIMO = 100;

/**
 * Campos de paginação.
 *
 * É uma FUNÇÃO, e não um objeto compartilhado, de propósito: se a mesma
 * instância de schema zod aparecer duas vezes dentro de um mesmo
 * `z.object(...)`, o Zod 4 extrai para `$defs` e emite `$ref` — e `$ref` é um
 * dos itens que o Inspector acusa em "Schema portability". Instância nova por
 * ferramenta, nenhum `$ref`.
 */
export function camposDePaginacao() {
  return {
    limite: z
      .number()
      .int()
      .min(1)
      .max(LIMITE_MAXIMO)
      .default(LIMITE_PADRAO)
      .describe(`Quantos itens devolver. Padrão ${LIMITE_PADRAO}, máximo ${LIMITE_MAXIMO}.`),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("A partir de qual posição devolver. Use para ver a próxima página."),
  };
}

/** Data solta em AAAA-MM-DD. Função, pelo mesmo motivo de `camposDePaginacao`. */
export function campoDeData(descricao: string) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.")
    .describe(descricao);
}

/** Faixa do PostgREST para um limite/offset. */
export function faixa(offset: number, limite: number): [number, number] {
  return [offset, offset + limite - 1];
}

/** Resposta de erro, com texto para o modelo ler. */
export function erro(texto: string): RespostaFerramenta {
  return { content: [{ type: "text", text: texto }], isError: true };
}

/** Resposta de sucesso: texto para o modelo, dados para a máquina. */
export function ok(texto: string, dados: Record<string, unknown>): RespostaFerramenta {
  return { content: [{ type: "text", text: texto }], structuredContent: dados };
}

export const ehUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Escapa os curingas do LIKE.
 *
 * Sem isto, buscar "100%" viraria curinga e devolveria tudo, e "_" casaria com
 * qualquer caractere. Não é injeção — o supabase-js parametriza —, é resultado
 * errado.
 */
export function escaparLike(valor: string): string {
  return valor.replace(/[\%_]/g, (c) => `\${c}`);
}

export type Resolucao =
  | { ok: true; id: string; nome: string }
  | { ok: false; resposta: RespostaFerramenta };

/**
 * Resolve um id ou um nome parcial para UM registro, ou devolve um pedido de
 * desambiguação.
 *
 * Zero resultados e vários resultados são os dois um ERRO, nunca um palpite: a
 * alternativa é o modelo pegar o primeiro da lista e o usuário ver dado de
 * outro cliente ou de outra pessoa sem perceber. Mesma semântica que o
 * `tarefas-agent.server.ts` do app já usa.
 *
 * A busca passa pelo RLS como qualquer outra: nome que o usuário não pode ver
 * não aparece, e a resposta é "não encontrei".
 */
export async function resolverPorNome(
  supabase: SupabaseClient,
  opcoes: { tabela: string; colunaNome: string; busca: string; rotulo: string },
): Promise<Resolucao> {
  const { tabela, colunaNome, busca, rotulo } = opcoes;

  if (ehUuid(busca)) {
    const r = await consultar(() =>
      supabase.from(tabela).select(`id, ${colunaNome}`).eq("id", busca).maybeSingle(),
    );
    if (!r.ok) return { ok: false, resposta: r.resposta };
    const linha = r.dados as unknown as Record<string, unknown> | null;
    if (!linha) {
      return { ok: false, resposta: erro(`Não encontrei ${rotulo} com o id informado.`) };
    }
    return { ok: true, id: String(linha.id), nome: String(linha[colunaNome] ?? "") };
  }

  // Limite 6: o bastante para dizer "são muitos" sem trazer a tabela inteira.
  const r = await consultar(() =>
    supabase
      .from(tabela)
      .select(`id, ${colunaNome}`)
      .ilike(colunaNome, `%${escaparLike(busca)}%`)
      .limit(6),
  );
  if (!r.ok) return { ok: false, resposta: r.resposta };

  // `as unknown as` porque o type parser do supabase-js não consegue analisar um
  // `select` montado por template string: ele devolve ParserError no lugar do
  // tipo da linha. A forma real vem do próprio select, logo acima.
  const linhas = (r.dados ?? []) as unknown as Array<Record<string, unknown>>;

  if (linhas.length === 0) {
    return {
      ok: false,
      resposta: erro(
        `Não encontrei ${rotulo} com nome parecido com «${busca}». Confira o nome ou passe o id.`,
      ),
    };
  }

  if (linhas.length > 1) {
    const nomes = linhas.map((l) => `«${String(l[colunaNome])}» (id ${String(l.id)})`).join("; ");
    return {
      ok: false,
      resposta: erro(
        `Mais de um resultado para ${rotulo} «${busca}»: ${nomes}. ` +
          `Pergunte ao usuário qual deles antes de continuar.`,
      ),
    };
  }

  const unica = linhas[0]!;
  return { ok: true, id: String(unica.id), nome: String(unica[colunaNome] ?? "") };
}

/**
 * Mapa id -> nome.
 *
 * Resolvo rótulo em consulta separada em vez de embed do PostgREST
 * (`clientes(nome_empresa)`) porque embed depende de a FK existir no banco, e
 * `projetos` não está em nenhuma migration daqui — não tenho como afirmar que
 * a FK está lá. Uma consulta a mais por página, imune a isso.
 */
export async function mapaDeNomes(
  supabase: SupabaseClient,
  tabela: string,
  colunaNome: string,
  ids: Array<string | null | undefined>,
): Promise<{ ok: true; mapa: Map<string, string> } | { ok: false; resposta: RespostaFerramenta }> {
  const unicos = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (unicos.length === 0) return { ok: true, mapa: new Map() };

  const r = await consultar(() =>
    supabase.from(tabela).select(`id, ${colunaNome}`).in("id", unicos),
  );
  if (!r.ok) return { ok: false, resposta: r.resposta };

  const mapa = new Map<string, string>();
  for (const linha of (r.dados ?? []) as unknown as Array<Record<string, unknown>>) {
    mapa.set(String(linha.id), String(linha[colunaNome] ?? ""));
  }
  return { ok: true, mapa };
}

/**
 * Responsáveis das tarefas de UMA página, em uma consulta.
 *
 * Por que separado e não embed com filtro: filtrar por responsável usando
 * `tarefa_responsaveis!inner(...)` restringe também as linhas EMBUTIDAS, e a
 * tarefa apareceria com um único responsável — o do filtro — como se fosse o
 * único. Buscar à parte mostra todos, que é o que a pessoa espera ver.
 */
export async function responsaveisPorTarefa(
  supabase: SupabaseClient,
  tarefaIds: string[],
): Promise<
  | { ok: true; mapa: Map<string, Array<{ id: string; nome: string }>> }
  | { ok: false; resposta: RespostaFerramenta }
> {
  if (tarefaIds.length === 0) return { ok: true, mapa: new Map() };

  const r = await consultar(() =>
    supabase.from("tarefa_responsaveis").select("tarefa_id, usuario_id").in("tarefa_id", tarefaIds),
  );
  if (!r.ok) return { ok: false, resposta: r.resposta };

  const vinculos = (r.dados ?? []) as Array<{ tarefa_id: string; usuario_id: string }>;
  const nomes = await mapaDeNomes(
    supabase,
    "perfis_usuarios",
    "nome",
    vinculos.map((v) => v.usuario_id),
  );
  if (!nomes.ok) return { ok: false, resposta: nomes.resposta };

  const mapa = new Map<string, Array<{ id: string; nome: string }>>();
  for (const v of vinculos) {
    const lista = mapa.get(v.tarefa_id) ?? [];
    lista.push({ id: v.usuario_id, nome: nomes.mapa.get(v.usuario_id) ?? "(sem nome)" });
    mapa.set(v.tarefa_id, lista);
  }
  return { ok: true, mapa };
}
