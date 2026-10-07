import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { citar, citarBloco, dataBr, estaAtrasada, rodapeDeDados, rotulo, texto } from "../formato";
import { consultar, type RespostaFerramenta } from "../sessao";
import { ANOTACOES_LEITURA, ehUuid, erro, escaparLike, ok } from "./comuns";
import { normalizar } from "./escrita";

/**
 * Murais: leitura, e o que a escrita de murais e lembretes compartilha
 * (cores, resolução de mural/quadro/lembrete por nome).
 *
 * Mural é PESSOAL: murais, quadros e cartões são só do dono, sem exceção para
 * Admin ou Supervisor — é o RLS (20261002120000_murais.sql). Toda consulta
 * aqui também filtra `usuario_id = eu` explicitamente, como o app faz em
 * src/lib/mural.functions.ts: o filtro deixa a intenção legível e a consulta
 * barata; quem garante é o banco.
 */

// ------------------------------------------------------------------- cores

/**
 * A paleta fixa do app (CORES_MURAL em src/lib/mural.functions.ts), por nome.
 *
 * Hex fora dela passaria no CHECK do banco, mas destoaria na tela — então a
 * entrada é o nome. A primeira é a padrão, como no diálogo do app.
 */
export const CORES = {
  roxo: "#7B68EE",
  azul: "#3B82F6",
  ciano: "#06B6D4",
  turquesa: "#14B8A6",
  verde: "#22C55E",
  lima: "#84CC16",
  amarelo: "#F59E0B",
  laranja: "#F97316",
  vermelho: "#EF4444",
  rosa: "#EC4899",
} as const;

export type NomeDeCor = keyof typeof CORES;
export const NOMES_DE_COR = Object.keys(CORES) as [NomeDeCor, ...NomeDeCor[]];
export const COR_PADRAO: NomeDeCor = "roxo";

/** Hex do banco -> nome da paleta, ou o próprio hex se vier de fora dela. */
export function nomeDaCor(hex: string | null | undefined): string {
  if (!hex) return "sem cor";
  const achada = (Object.entries(CORES) as Array<[string, string]>).find(
    ([, h]) => h.toLowerCase() === hex.toLowerCase(),
  );
  return achada ? achada[0] : hex;
}

// ----------------------------------------------------- resolução por nome

export interface MuralRef {
  id: string;
  nome: string;
}

export interface QuadroRef {
  id: string;
  nome: string;
  mural_id: string;
  mural_nome: string;
}

type Falha = { ok: false; resposta: RespostaFerramenta };

/**
 * Escolhe UM entre candidatos por nome.
 *
 * Diferente de responsáveis e projetos, nome exatamente igual (sem caixa e
 * sem espaço extra) vence o parcial: nome de quadro é curto ("Hoje" e "Hoje
 * cedo"), e sem isto o quadro "Hoje" ficaria inalcançável pelo nome.
 */
export function escolherPorNome<T extends { id: string; nome: string }>(
  candidatos: T[],
  busca: string,
): T[] {
  if (ehUuid(busca.trim())) return candidatos.filter((c) => c.id === busca.trim());
  const alvo = normalizar(busca);
  const exatos = candidatos.filter((c) => normalizar(c.nome) === alvo);
  if (exatos.length > 0) return exatos;
  return candidatos.filter((c) => normalizar(c.nome).includes(alvo));
}

/** Os murais da pessoa, em ordem. Pequeno por natureza: cabe numa consulta. */
async function meusMurais(
  supabase: SupabaseClient,
  meuId: string,
): Promise<{ ok: true; murais: MuralRef[] } | Falha> {
  const r = await consultar(() =>
    supabase
      .from("murais")
      .select("id, nome")
      .eq("usuario_id", meuId)
      .order("posicao")
      .order("criado_em")
      .limit(500),
  );
  if (!r.ok) return { ok: false, resposta: r.resposta };
  return { ok: true, murais: (r.dados ?? []) as MuralRef[] };
}

const listaDeMurais = (murais: MuralRef[]) =>
  murais.length === 0
    ? "Você ainda não tem nenhum mural."
    : `Seus murais: ${murais.map((m) => `${citar(m.nome, 60)} (id ${m.id})`).join("; ")}.`;

/**
 * Resolve UM mural da pessoa por nome ou id.
 *
 * Não achar NÃO cria nada: devolve a lista dos murais existentes, para o
 * modelo perguntar ao usuário ou usar criar_mural a pedido dele.
 */
export async function resolverMural(
  supabase: SupabaseClient,
  meuId: string,
  busca: string,
): Promise<{ ok: true; mural: MuralRef } | Falha> {
  const r = await meusMurais(supabase, meuId);
  if (!r.ok) return r;

  const achados = escolherPorNome(r.murais, busca);
  if (achados.length === 1) return { ok: true, mural: achados[0]! };

  if (achados.length === 0) {
    return {
      ok: false,
      resposta: erro(
        `Não encontrei mural seu chamado ${citar(busca, 60)}. ${listaDeMurais(r.murais)} ` +
          "Pergunte ao usuário qual usar. Não crie um mural sem ele pedir (criar_mural).",
      ),
    };
  }
  return {
    ok: false,
    resposta: erro(
      `Mais de um mural casa com ${citar(busca, 60)}: ` +
        `${achados.map((m) => `${citar(m.nome, 60)} (id ${m.id})`).join("; ")}. ` +
        "Pergunte ao usuário qual deles.",
    ),
  };
}

/**
 * Resolve UM quadro da pessoa. Com `mural`, procura só nele; sem, procura em
 * todos os murais dela — e se o nome existir em mais de um mural, pede o
 * mural. Não achar lista os quadros existentes e NÃO cria nada.
 */
export async function resolverQuadro(
  supabase: SupabaseClient,
  meuId: string,
  busca: string,
  mural?: MuralRef,
): Promise<{ ok: true; quadro: QuadroRef } | Falha> {
  const murais = await meusMurais(supabase, meuId);
  if (!murais.ok) return murais;
  const nomeDoMural = new Map(murais.murais.map((m) => [m.id, m.nome]));

  let q = supabase
    .from("mural_quadros")
    .select("id, nome, mural_id")
    .eq("usuario_id", meuId)
    .order("posicao")
    .order("criado_em")
    .limit(1000);
  if (mural) q = q.eq("mural_id", mural.id);

  const r = await consultar(() => q);
  if (!r.ok) return { ok: false, resposta: r.resposta };

  const quadros: QuadroRef[] = ((r.dados ?? []) as Array<Omit<QuadroRef, "mural_nome">>).map(
    (x) => ({ ...x, mural_nome: nomeDoMural.get(x.mural_id) ?? "(mural)" }),
  );
  const descrever = (x: QuadroRef) =>
    `${citar(x.nome, 60)} (mural ${citar(x.mural_nome, 60)}, id ${x.id})`;

  const achados = escolherPorNome(quadros, busca);
  if (achados.length === 1) return { ok: true, quadro: achados[0]! };

  if (achados.length === 0) {
    const onde = mural ? `no mural ${citar(mural.nome, 60)}` : "nos seus murais";
    const existentes =
      quadros.length === 0
        ? mural
          ? "Esse mural ainda não tem quadros."
          : "Você ainda não tem quadros."
        : `Quadros existentes: ${quadros.slice(0, 30).map(descrever).join("; ")}.`;
    return {
      ok: false,
      resposta: erro(
        `Não encontrei quadro chamado ${citar(busca, 60)} ${onde}. ${existentes} ` +
          "Pergunte ao usuário qual usar. Não crie um quadro sem ele pedir (criar_quadro).",
      ),
    };
  }
  return {
    ok: false,
    resposta: erro(
      `Mais de um quadro casa com ${citar(busca, 60)}: ${achados.map(descrever).join("; ")}. ` +
        "Pergunte ao usuário qual deles (ou informe o mural).",
    ),
  };
}

// ---------------------------------------------------------------- lembretes

/** Limite de conteúdo de lembrete (roteiro). A coluna é `text`, sem limite no banco. */
export const CONTEUDO_MAXIMO = 20000;

export interface LembreteMeu {
  id: string;
  titulo: string;
  descricao: string | null;
  data_vencimento: string | null;
  escopo: string;
  criado_em: string;
}

/**
 * Resolve UM lembrete DA PESSOA (tipo lembrete, criado por ela), por id ou
 * título. Lembrete geral de outra pessoa não entra: o RLS deixaria ver e até
 * alterar, mas aqui só se mexe nos próprios.
 */
export async function resolverLembrete(
  supabase: SupabaseClient,
  meuId: string,
  busca: string,
): Promise<{ ok: true; lembrete: LembreteMeu } | Falha> {
  const colunas = "id, titulo, descricao, data_vencimento, escopo, criado_em:data_criacao";
  const b = busca.trim();

  type Linha = LembreteMeu;
  let linhas: Linha[];

  if (ehUuid(b)) {
    const r = await consultar(() =>
      supabase
        .from("tarefas")
        .select(colunas)
        .eq("id", b)
        .eq("tipo", "lembrete")
        .eq("criado_por", meuId)
        .limit(1),
    );
    if (!r.ok) return { ok: false, resposta: r.resposta };
    linhas = (r.dados ?? []) as unknown as Linha[];
  } else {
    const r = await consultar(() =>
      supabase
        .from("tarefas")
        .select(colunas)
        .eq("tipo", "lembrete")
        .eq("criado_por", meuId)
        .ilike("titulo", `%${escaparLike(b)}%`)
        .order("data_criacao", { ascending: false })
        .limit(10),
    );
    if (!r.ok) return { ok: false, resposta: r.resposta };
    const todos = (r.dados ?? []) as unknown as Linha[];
    const exatos = todos.filter((l) => normalizar(l.titulo) === normalizar(b));
    linhas = exatos.length > 0 ? exatos : todos;
  }

  if (linhas.length === 1) return { ok: true, lembrete: linhas[0]! };
  if (linhas.length === 0) {
    return {
      ok: false,
      resposta: erro(
        `Não encontrei lembrete seu com ${ehUuid(b) ? "esse id" : `título parecido com ${citar(b, 80)}`}. ` +
          "Só os lembretes que você criou aparecem aqui. Use ver_mural para ver os cartões e seus ids.",
      ),
    };
  }
  return {
    ok: false,
    resposta: erro(
      `Mais de um lembrete seu casa com ${citar(b, 80)}: ` +
        `${linhas.map((l) => `${citar(l.titulo, 80)} (id ${l.id})`).join("; ")}. Pergunte ao usuário qual.`,
    ),
  };
}

/** Trecho inicial de um texto longo, numa linha só, para resposta e cartão. */
export function trechoInicial(valor: string | null | undefined, maximo = 160): string {
  return valor && valor.trim() ? citar(valor, maximo) : "(sem conteúdo)";
}

// ============================================================ listar_murais

const DESC_LISTAR_MURAIS =
  "Lista os murais do usuário conectado (o mural é pessoal: cada pessoa só vê os próprios), " +
  "na ordem do app, com cor, descrição e quantos quadros e cartões cada um tem. Devolve o id " +
  "de cada mural, que ver_mural aceita.";

export function registrarListarMurais(server: McpServer, supabase: SupabaseClient, meuId: string) {
  server.registerTool(
    "listar_murais",
    {
      title: "Listar murais",
      description: DESC_LISTAR_MURAIS,
      inputSchema: z.object({}),
      outputSchema: z.object({
        murais: z.array(
          z.object({
            id: z.string(),
            nome: z.string(),
            cor: z.string(),
            descricao: z.string().optional(),
            quadros: z.number().int(),
            cartoes: z.number().int(),
          }),
        ),
      }),
      annotations: { title: "Listar murais", ...ANOTACOES_LEITURA },
    },
    async () => listarMurais(supabase, meuId),
  );
}

async function listarMurais(supabase: SupabaseClient, meuId: string) {
  // As três consultas do listMurais do app: as contagens saem das linhas.
  const [murais, quadros, itens] = await Promise.all([
    consultar(() =>
      supabase
        .from("murais")
        .select("id, nome, cor, descricao")
        .eq("usuario_id", meuId)
        .order("posicao")
        .order("criado_em"),
    ),
    consultar(() => supabase.from("mural_quadros").select("mural_id").eq("usuario_id", meuId)),
    consultar(() => supabase.from("mural_itens").select("mural_id").eq("usuario_id", meuId)),
  ]);
  if (!murais.ok) return murais.resposta;
  if (!quadros.ok) return quadros.resposta;
  if (!itens.ok) return itens.resposta;

  const contar = (linhas: Array<{ mural_id: string }>) => {
    const m = new Map<string, number>();
    for (const l of linhas) m.set(l.mural_id, (m.get(l.mural_id) ?? 0) + 1);
    return m;
  };
  const porQuadros = contar((quadros.dados ?? []) as Array<{ mural_id: string }>);
  const porItens = contar((itens.dados ?? []) as Array<{ mural_id: string }>);

  const lista = (
    (murais.dados ?? []) as Array<{
      id: string;
      nome: string;
      cor: string;
      descricao: string | null;
    }>
  ).map((m) => ({
    id: m.id,
    nome: m.nome,
    cor: nomeDaCor(m.cor),
    descricao: texto(m.descricao),
    quadros: porQuadros.get(m.id) ?? 0,
    cartoes: porItens.get(m.id) ?? 0,
  }));

  if (lista.length === 0) {
    return ok("Você ainda não tem nenhum mural. Murais se criam com criar_mural, a pedido.", {
      murais: [],
    });
  }

  const linhas = lista.map(
    (m) =>
      `- Mural: ${citar(m.nome, 80)}\n  id: ${m.id}\n  Cor: ${m.cor} · Quadros: ${m.quadros} · ` +
      `Cartões: ${m.cartoes}${m.descricao ? ` · Descrição: ${citar(m.descricao, 200)}` : ""}`,
  );
  return ok([`Seus murais (${lista.length}):`, "", ...linhas, rodapeDeDados()].join("\n"), {
    murais: lista,
  });
}

// =============================================================== ver_mural

/** Acima disto, o ver_mural corta e avisa. */
const TETO_CARTOES = 300;

const DESC_VER_MURAL =
  "Mostra UM mural do usuário: os quadros na ordem do app e, em cada um, os cartões em ordem " +
  "(título, tipo tarefa/lembrete, status, prazo, tarefa_id e item_id). Como no app, não " +
  "mostra o cartão de tarefa em que o usuário deixou de ser responsável — só conta quantos " +
  "ficaram ocultos. Para ler o conteúdo de um lembrete (roteiro), use ver_lembrete com o " +
  "tarefa_id do cartão.";

const cartaoSaida = () =>
  z.object({
    item_id: z.string(),
    tarefa_id: z.string(),
    tipo: z.string(),
    titulo: z.string(),
    status: z.string().optional(),
    data_vencimento: z.string().optional(),
    atrasada: z.boolean(),
  });

export function registrarVerMural(server: McpServer, supabase: SupabaseClient, meuId: string) {
  server.registerTool(
    "ver_mural",
    {
      title: "Ver mural",
      description: DESC_VER_MURAL,
      inputSchema: z.object({
        mural: z.string().describe("Nome (mesmo parcial) ou id do mural."),
      }),
      outputSchema: z.object({
        mural: z.object({ id: z.string(), nome: z.string(), cor: z.string() }),
        quadros: z.array(
          z.object({
            id: z.string(),
            nome: z.string(),
            cor: z.string(),
            cartoes: z.array(cartaoSaida()),
          }),
        ),
        ocultos: z.number().int(),
        truncado: z.boolean(),
      }),
      annotations: { title: "Ver mural", ...ANOTACOES_LEITURA },
    },
    async ({ mural }) => verMural(supabase, meuId, mural),
  );
}

interface LinhaTarefaDoCartao {
  id: string;
  titulo: string;
  tipo: string;
  status: string;
  data_vencimento: string | null;
}

async function verMural(supabase: SupabaseClient, meuId: string, busca: string) {
  const agora = new Date();
  const m = await resolverMural(supabase, meuId, busca);
  if (!m.ok) return m.resposta;

  const [muralR, quadrosR, itensR] = await Promise.all([
    consultar(() =>
      supabase.from("murais").select("id, nome, cor").eq("id", m.mural.id).maybeSingle(),
    ),
    consultar(() =>
      supabase
        .from("mural_quadros")
        .select("id, nome, cor")
        .eq("usuario_id", meuId)
        .eq("mural_id", m.mural.id)
        .order("posicao")
        .order("criado_em"),
    ),
    consultar(() =>
      supabase
        .from("mural_itens")
        .select("id, quadro_id, tarefa_id")
        .eq("usuario_id", meuId)
        .eq("mural_id", m.mural.id)
        .order("posicao")
        .limit(TETO_CARTOES + 1),
    ),
  ]);
  if (!muralR.ok) return muralR.resposta;
  if (!quadrosR.ok) return quadrosR.resposta;
  if (!itensR.ok) return itensR.resposta;

  const mural = muralR.dados as unknown as { id: string; nome: string; cor: string } | null;
  if (!mural) return erro("Não encontrei esse mural.");

  const quadros = (quadrosR.dados ?? []) as Array<{ id: string; nome: string; cor: string }>;
  const todos = (itensR.dados ?? []) as Array<{ id: string; quadro_id: string; tarefa_id: string }>;
  const truncado = todos.length > TETO_CARTOES;
  const itens = todos.slice(0, TETO_CARTOES);

  // As tarefas dos cartões pelo RLS (sem descrição: um roteiro pode ter 20 mil
  // caracteres, e o mural só precisa do título), e onde eu sou responsável —
  // a mesma regra de visibilidade da tela do app (MuralView, ordemBase).
  //
  // Em lotes de 100 ids: cada uuid ocupa ~37 bytes na URL do `.in()`, e 300
  // num filtro só passariam de 11 KB de query string — o tipo de URL que a
  // etapa 3 já viu morrer (ver o comentário de listarTarefas).
  const ids = [...new Set(itens.map((i) => i.tarefa_id))];
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) lotes.push(ids.slice(i, i + 100));

  const respostas = await Promise.all(
    lotes.flatMap((lote) => [
      consultar(() =>
        supabase.from("tarefas").select("id, titulo, tipo, status, data_vencimento").in("id", lote),
      ),
      consultar(() =>
        supabase
          .from("tarefa_responsaveis")
          .select("tarefa_id")
          .eq("usuario_id", meuId)
          .in("tarefa_id", lote),
      ),
    ]),
  );
  const falha = respostas.find((r) => !r.ok);
  if (falha && !falha.ok) return falha.resposta;

  // Pares por lote: posição par = tarefas, ímpar = meus vínculos de responsável.
  const tarefaPorId = new Map<string, LinhaTarefaDoCartao>();
  const souResponsavel = new Set<string>();
  respostas.forEach((r, i) => {
    if (!r.ok) return;
    if (i % 2 === 0) {
      for (const t of (r.dados ?? []) as unknown as LinhaTarefaDoCartao[]) tarefaPorId.set(t.id, t);
    } else {
      for (const v of (r.dados ?? []) as unknown as Array<{ tarefa_id: string }>) {
        souResponsavel.add(v.tarefa_id);
      }
    }
  });

  let ocultos = 0;
  const porQuadro = new Map<string, Array<z.infer<ReturnType<typeof cartaoSaida>>>>(
    quadros.map((q) => [q.id, []]),
  );
  for (const i of itens) {
    const t = tarefaPorId.get(i.tarefa_id);
    const visivel = t && (t.tipo === "lembrete" || souResponsavel.has(t.id));
    const lista = porQuadro.get(i.quadro_id);
    if (!t || !visivel || !lista) {
      ocultos += 1;
      continue;
    }
    const ehLembrete = t.tipo === "lembrete";
    lista.push({
      item_id: i.id,
      tarefa_id: t.id,
      tipo: t.tipo,
      titulo: t.titulo,
      status: ehLembrete ? undefined : t.status,
      data_vencimento: texto(t.data_vencimento),
      atrasada: ehLembrete ? false : estaAtrasada(t.status, t.data_vencimento, agora),
    });
  }

  const saida = {
    mural: { id: mural.id, nome: mural.nome, cor: nomeDaCor(mural.cor) },
    quadros: quadros.map((q) => ({
      id: q.id,
      nome: q.nome,
      cor: nomeDaCor(q.cor),
      cartoes: porQuadro.get(q.id) ?? [],
    })),
    ocultos,
    truncado,
  };

  const linhas = [`Mural ${citar(mural.nome, 80)} (id ${mural.id}) · Cor: ${saida.mural.cor}`];
  if (saida.quadros.length === 0) linhas.push("", "Este mural ainda não tem quadros.");
  for (const q of saida.quadros) {
    linhas.push("", `Quadro ${citar(q.nome, 60)} (id ${q.id}) · ${q.cartoes.length} cartão(ões)`);
    for (const c of q.cartoes) {
      const detalhe =
        c.tipo === "lembrete"
          ? `Lembrete · Data: ${c.data_vencimento ? dataBr(c.data_vencimento) : "sem data"}`
          : `Tarefa · Status: ${c.status} · Prazo: ${dataBr(c.data_vencimento)}${c.atrasada ? " (ATRASADA)" : ""}`;
      linhas.push(`  - ${citar(c.titulo, 120)}\n    ${detalhe} · tarefa_id: ${c.tarefa_id}`);
    }
  }
  if (ocultos > 0) {
    linhas.push(
      "",
      `${ocultos} cartão(ões) oculto(s), como no app: você deixou de ser responsável pela ` +
        "tarefa, ou ela saiu do seu acesso.",
    );
  }
  if (truncado)
    linhas.push(`Atenção: o mural tem mais de ${TETO_CARTOES} cartões; mostrei os primeiros.`);
  linhas.push(rodapeDeDados());

  return ok(linhas.join("\n"), saida);
}

// ============================================================ ver_lembrete

const DESC_VER_LEMBRETE =
  "Mostra UM lembrete do usuário conectado por inteiro: título, data, escopo, em que murais e " +
  "quadros ele está e o CONTEÚDO completo (por exemplo, um roteiro). Aceita o id (o tarefa_id " +
  "do cartão em ver_mural) ou o título, mesmo parcial. Só lembretes criados pelo próprio usuário.";

export function registrarVerLembrete(server: McpServer, supabase: SupabaseClient, meuId: string) {
  server.registerTool(
    "ver_lembrete",
    {
      title: "Ver lembrete",
      description: DESC_VER_LEMBRETE,
      inputSchema: z.object({
        lembrete: z.string().describe("O id do lembrete (tarefa_id do cartão) ou o título."),
      }),
      outputSchema: z.object({
        id: z.string(),
        titulo: z.string(),
        escopo: z.string(),
        data_vencimento: z.string().optional(),
        conteudo: z.string().optional(),
        tamanho_conteudo: z.number().int(),
        murais: z.array(z.object({ mural: z.string(), quadro: z.string() })),
      }),
      annotations: { title: "Ver lembrete", ...ANOTACOES_LEITURA },
    },
    async ({ lembrete }) => verLembrete(supabase, meuId, lembrete),
  );
}

/** Onde o lembrete está nos murais da pessoa: "mural / quadro". */
export async function ondeNosMurais(
  supabase: SupabaseClient,
  meuId: string,
  tarefaId: string,
): Promise<{ ok: true; lugares: Array<{ mural: string; quadro: string }> } | Falha> {
  const r = await consultar(() =>
    supabase
      .from("mural_itens")
      .select("quadro_id, mural_id")
      .eq("usuario_id", meuId)
      .eq("tarefa_id", tarefaId),
  );
  if (!r.ok) return { ok: false, resposta: r.resposta };
  const itens = (r.dados ?? []) as Array<{ quadro_id: string; mural_id: string }>;
  if (itens.length === 0) return { ok: true, lugares: [] };

  const [murais, quadros] = await Promise.all([
    consultar(() =>
      supabase
        .from("murais")
        .select("id, nome")
        .in(
          "id",
          itens.map((i) => i.mural_id),
        ),
    ),
    consultar(() =>
      supabase
        .from("mural_quadros")
        .select("id, nome")
        .in(
          "id",
          itens.map((i) => i.quadro_id),
        ),
    ),
  ]);
  if (!murais.ok) return { ok: false, resposta: murais.resposta };
  if (!quadros.ok) return { ok: false, resposta: quadros.resposta };
  const nomeM = new Map(((murais.dados ?? []) as MuralRef[]).map((m) => [m.id, m.nome]));
  const nomeQ = new Map(((quadros.dados ?? []) as MuralRef[]).map((q) => [q.id, q.nome]));

  return {
    ok: true,
    lugares: itens.map((i) => ({
      mural: nomeM.get(i.mural_id) ?? "(mural)",
      quadro: nomeQ.get(i.quadro_id) ?? "(quadro)",
    })),
  };
}

async function verLembrete(supabase: SupabaseClient, meuId: string, busca: string) {
  const r = await resolverLembrete(supabase, meuId, busca);
  if (!r.ok) return r.resposta;
  const l = r.lembrete;

  const onde = await ondeNosMurais(supabase, meuId, l.id);
  if (!onde.ok) return onde.resposta;

  const conteudo = texto(l.descricao);
  const linhas = [
    `Lembrete ${l.id}`,
    `Título: ${citar(l.titulo, 500)}`,
    `Data: ${l.data_vencimento ? dataBr(l.data_vencimento) : "sem data"} · Escopo: ${
      l.escopo === "geral" ? "geral (toda a equipe vê na Agenda)" : "pessoal (só você vê)"
    }`,
    `Nos murais: ${
      onde.lugares.length > 0
        ? onde.lugares.map((x) => `${rotulo(x.mural, 60)} / ${rotulo(x.quadro, 60)}`).join("; ")
        : "nenhum"
    }`,
    "",
    `Conteúdo (texto do usuário, ${conteudo?.length ?? 0} caracteres):`,
    citarBloco(conteudo, CONTEUDO_MAXIMO),
    rodapeDeDados(),
  ];

  return ok(linhas.join("\n"), {
    id: l.id,
    titulo: l.titulo,
    escopo: l.escopo,
    data_vencimento: texto(l.data_vencimento),
    conteudo,
    tamanho_conteudo: conteudo?.length ?? 0,
    murais: onde.lugares,
  });
}
