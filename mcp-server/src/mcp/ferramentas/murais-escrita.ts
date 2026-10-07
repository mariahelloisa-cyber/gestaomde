import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { citar, rodapeDeDados } from "../formato";
import { consultar, type RespostaFerramenta } from "../sessao";
import { ehUuid, erro, ok } from "./comuns";
import {
  AVISO_ESCRITA,
  type Auditoria,
  type ContextoEscrita,
  type Desfecho,
  executarEscrita,
  inicioDaJanela,
  normalizar,
  recusaDoBanco,
  semAuditoria,
} from "./escrita";
import {
  COR_PADRAO,
  CORES,
  type MuralRef,
  NOMES_DE_COR,
  nomeDaCor,
  type QuadroRef,
  resolverMural,
  resolverQuadro,
} from "./murais";

/**
 * Escrita de murais, quadros e cartões. Nada aqui notifica ninguém (mural é
 * pessoal), então `openWorldHint: false` em todas. Excluir mural e excluir
 * quadro ficam FORA — só pelo app, que mostra quantos lembretes vão junto.
 *
 * Nenhuma policy de murais, mural_quadros ou mural_itens é alterada: a regra
 * de dono é do RLS. O que este código acrescenta é o que o APP faz e o banco
 * não força: checar mural_tarefa_permitida também ao MOVER (a policy de UPDATE
 * de mural_itens não repete a checagem), e recusar tarefa finalizada.
 */

/** Concluída há este tanto de dias = finalizada (DIAS_PARA_FINALIZAR em src/lib/mock-data.ts). */
const DIAS_PARA_FINALIZAR = 7;

// ---------------------------------------------------------------- posições

/** Mesma regra do app (posicaoEntre em MuralView.tsx): ponto médio entre vizinhos. */
export function posicaoEntre(antes?: number, depois?: number): number {
  if (antes !== undefined && depois !== undefined) return (antes + depois) / 2;
  if (antes !== undefined) return antes + 1;
  if (depois !== undefined) return depois - 1;
  return 1;
}

/** Posição para entrar no FIM: a maior que existe + 1, como o app. */
export async function posicaoNoFim(
  supabase: SupabaseClient,
  tabela: "murais" | "mural_quadros" | "mural_itens",
  filtro: { coluna: string; valor: string },
): Promise<{ ok: true; posicao: number } | { ok: false; resposta: RespostaFerramenta }> {
  const r = await consultar(() =>
    supabase
      .from(tabela)
      .select("posicao")
      .eq(filtro.coluna, filtro.valor)
      .order("posicao", { ascending: false })
      .limit(1),
  );
  if (!r.ok) return { ok: false, resposta: r.resposta };
  const ultima = ((r.dados ?? []) as Array<{ posicao: number }>)[0]?.posicao;
  return { ok: true, posicao: (ultima ?? 0) + 1 };
}

// ------------------------------------------------------- erros de cartão

/**
 * Erro do banco ao pôr/mover cartão, em português.
 *
 *   23505  mural_itens_um_quadro_por_tarefa: a tarefa já tem cartão neste mural
 *   42501  WITH CHECK de "Dono adiciona itens": quadro não é seu, ou
 *          mural_tarefa_permitida devolveu false
 *   P0001  trigger mural_itens_preenche_mural: "Quadro não encontrado."
 */
export function erroDeCartao(
  falha: { resposta: RespostaFerramenta; codigo?: string },
  auditoria: Omit<Auditoria, "resultado" | "detalhe">,
): Desfecho {
  if (falha.codigo === "23505") {
    return {
      resposta: erro(
        "Essa tarefa já tem um cartão em outro quadro deste mural (uma tarefa fica num quadro " +
          "só por mural). Chame colocar_tarefa_no_mural de novo: ela move o cartão.",
      ),
      auditoria: { ...auditoria, resultado: "negado", detalhe: "unique um_quadro_por_tarefa" },
    };
  }
  if (falha.codigo === "42501") {
    return {
      resposta: erro(
        "O CRM recusou o cartão: só dá para pôr no seu mural tarefas em que você é responsável, " +
          "ou lembretes que você criou, e só em quadros seus.",
      ),
      auditoria: { ...auditoria, resultado: "negado", detalhe: "RLS de mural_itens (42501)" },
    };
  }
  if (falha.codigo === "P0001") {
    return {
      resposta: erro("Quadro não encontrado: ele pode ter sido excluído no app. Nada foi gravado."),
      auditoria: { ...auditoria, resultado: "erro", detalhe: "trigger: quadro nao encontrado" },
    };
  }
  return recusaDoBanco(falha, auditoria);
}

const anotacoes = (titulo: string, destrutiva: boolean, idempotente: boolean) => ({
  title: titulo,
  readOnlyHint: false,
  destructiveHint: destrutiva,
  idempotentHint: idempotente,
  openWorldHint: false,
});

const campoCor = (descricao: string) => z.enum(NOMES_DE_COR).describe(descricao);
const campoNome = (descricao: string) => z.string().min(1).max(80).describe(descricao);

// ============================================================= criar_mural

const DESC_CRIAR_MURAL =
  "Cria um mural novo do usuário conectado (o mural é pessoal: só ele vê), no fim da lista. " +
  "Se ele mesmo já criou um mural com o mesmo nome nos últimos 2 minutos, devolve o existente " +
  "em vez de duplicar." +
  AVISO_ESCRITA;

export function registrarCriarMural(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "criar_mural",
    {
      title: "Criar mural",
      description: DESC_CRIAR_MURAL,
      inputSchema: z.object({
        nome: campoNome("Nome do mural (até 80 caracteres)."),
        cor: campoCor(`Cor, da paleta do app. Padrão: ${COR_PADRAO}.`).optional(),
        descricao: z.string().max(280).describe("Descrição curta (até 280).").optional(),
      }),
      outputSchema: z.object({
        resultado: z.enum(["criado", "duplicata"]),
        mural_id: z.string(),
        nome: z.string(),
      }),
      annotations: anotacoes("Criar mural", false, false),
    },
    async (e) => executarEscrita(ctx, "criar_mural", () => criarMural(ctx, e)),
  );
}

async function criarMural(
  ctx: ContextoEscrita,
  e: { nome: string; cor?: keyof typeof CORES; descricao?: string },
): Promise<Desfecho> {
  const { supabase, meuId } = ctx;
  const nome = e.nome.trim();
  if (!nome) return semAuditoria(erro("O nome do mural não pode ser vazio."));
  const cor = e.cor ?? COR_PADRAO;
  const descricao = e.descricao?.trim() || null;
  const argumentos = { nome, cor, descricao_len: descricao?.length ?? 0 };

  const recentes = await consultar(() =>
    supabase
      .from("murais")
      .select("id, nome")
      .eq("usuario_id", meuId)
      .gte("criado_em", inicioDaJanela()),
  );
  if (!recentes.ok) return semAuditoria(recentes.resposta);
  const igual = ((recentes.dados ?? []) as MuralRef[]).find(
    (m) => normalizar(m.nome) === normalizar(nome),
  );
  if (igual) {
    return {
      resposta: ok(
        `Não criei outro: você já criou o mural ${citar(igual.nome, 80)} há menos de 2 minutos ` +
          `(id ${igual.id}).` +
          rodapeDeDados(),
        { resultado: "duplicata", mural_id: igual.id, nome: igual.nome },
      ),
      auditoria: { resultado: "duplicata", ids: [igual.id], argumentos },
    };
  }

  const fim = await posicaoNoFim(supabase, "murais", { coluna: "usuario_id", valor: meuId });
  if (!fim.ok) return semAuditoria(fim.resposta);

  const ins = await consultar(() =>
    supabase
      .from("murais")
      .insert({ nome, cor: CORES[cor], descricao, usuario_id: meuId, posicao: fim.posicao })
      .select("id")
      .single(),
  );
  if (!ins.ok) return recusaDoBanco(ins, { argumentos });
  const id = (ins.dados as unknown as { id: string }).id;

  return {
    resposta: ok(
      `Mural ${citar(nome, 80)} criado (id ${id}), cor ${cor}. Ainda não tem quadros: ` +
        "crie com criar_quadro, se o usuário pedir." +
        rodapeDeDados(),
      { resultado: "criado", mural_id: id, nome },
    ),
    auditoria: { resultado: "ok", ids: [id], argumentos },
  };
}

// ============================================================ editar_mural

const DESC_EDITAR_MURAL =
  "Altera nome, cor e/ou descrição de UM mural do usuário. Só os campos informados mudam; a " +
  "resposta traz o antes e o depois. Descrição vazia apaga a descrição." +
  AVISO_ESCRITA;

export function registrarEditarMural(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "editar_mural",
    {
      title: "Editar mural",
      description: DESC_EDITAR_MURAL,
      inputSchema: z.object({
        mural: z.string().describe("Nome (mesmo parcial) ou id do mural."),
        nome: campoNome("Novo nome.").optional(),
        cor: campoCor("Nova cor, da paleta do app.").optional(),
        descricao: z.string().max(280).describe("Nova descrição; vazio apaga.").optional(),
      }),
      outputSchema: z.object({
        resultado: z.enum(["alterado", "sem_mudanca"]),
        mural_id: z.string(),
        alteracoes: z.array(
          z.object({
            campo: z.string(),
            antes: z.string().optional(),
            depois: z.string().optional(),
          }),
        ),
      }),
      annotations: anotacoes("Editar mural", true, true),
    },
    async (e) => executarEscrita(ctx, "editar_mural", () => editarMural(ctx, e)),
  );
}

async function editarMural(
  ctx: ContextoEscrita,
  e: { mural: string; nome?: string; cor?: keyof typeof CORES; descricao?: string },
): Promise<Desfecho> {
  const { supabase, meuId } = ctx;
  if (e.nome === undefined && e.cor === undefined && e.descricao === undefined) {
    return semAuditoria(erro("Diga ao menos um campo para alterar: nome, cor ou descrição."));
  }
  if (e.nome !== undefined && !e.nome.trim()) {
    return semAuditoria(erro("O nome do mural não pode ser vazio."));
  }

  const m = await resolverMural(supabase, meuId, e.mural);
  if (!m.ok) return semAuditoria(m.resposta);

  const atual = await consultar(() =>
    supabase.from("murais").select("id, nome, cor, descricao").eq("id", m.mural.id).maybeSingle(),
  );
  if (!atual.ok) return semAuditoria(atual.resposta);
  const a = atual.dados as unknown as {
    id: string;
    nome: string;
    cor: string;
    descricao: string | null;
  } | null;
  if (!a) return semAuditoria(erro("Não encontrei esse mural."));

  const patch: Record<string, unknown> = {};
  const alteracoes: Array<{ campo: string; antes?: string; depois?: string }> = [];
  if (e.nome !== undefined && e.nome.trim() !== a.nome) {
    patch.nome = e.nome.trim();
    alteracoes.push({ campo: "nome", antes: a.nome, depois: e.nome.trim() });
  }
  if (e.cor !== undefined && CORES[e.cor].toLowerCase() !== a.cor.toLowerCase()) {
    patch.cor = CORES[e.cor];
    alteracoes.push({ campo: "cor", antes: nomeDaCor(a.cor), depois: e.cor });
  }
  if (e.descricao !== undefined) {
    const nova = e.descricao.trim() || null;
    if (nova !== (a.descricao?.trim() || null)) {
      patch.descricao = nova;
      alteracoes.push({
        campo: "descricao",
        antes: a.descricao ?? undefined,
        depois: nova ?? undefined,
      });
    }
  }

  const argumentos = {
    campos: alteracoes.map((x) => x.campo),
    nome: patch.nome as string | undefined,
    cor: e.cor,
  };

  if (alteracoes.length === 0) {
    return {
      resposta: ok(`Nada mudou no mural ${citar(a.nome, 80)}.` + rodapeDeDados(), {
        resultado: "sem_mudanca",
        mural_id: a.id,
        alteracoes: [],
      }),
      auditoria: { resultado: "sem_mudanca", ids: [a.id], argumentos },
    };
  }

  const up = await consultar(() =>
    supabase.from("murais").update(patch).eq("id", a.id).eq("usuario_id", meuId).select("id"),
  );
  if (!up.ok) return recusaDoBanco(up, { ids: [a.id], argumentos });
  if (((up.dados ?? []) as unknown[]).length === 0) {
    return {
      resposta: erro("O CRM não permite essa alteração. Nada foi gravado."),
      auditoria: {
        resultado: "negado",
        ids: [a.id],
        argumentos,
        detalhe: "update afetou 0 linhas",
      },
    };
  }

  const linhas = [`Mural ${citar((patch.nome as string) ?? a.nome, 80)} (id ${a.id}) alterado:`];
  for (const x of alteracoes) {
    if (x.campo === "cor") linhas.push(`- Cor: ${x.antes} → ${x.depois}`);
    else {
      const rotuloCampo = x.campo === "nome" ? "Nome" : "Descrição";
      linhas.push(
        `- ${rotuloCampo}: ${x.antes ? citar(x.antes, 280) : "vazia"} → ${x.depois ? citar(x.depois, 280) : "vazia"}`,
      );
    }
  }
  linhas.push(rodapeDeDados());

  return {
    resposta: ok(linhas.join("\n"), { resultado: "alterado", mural_id: a.id, alteracoes }),
    auditoria: { resultado: "ok", ids: [a.id], argumentos },
  };
}

// ============================================================ criar_quadro

const DESC_CRIAR_QUADRO =
  "Cria um quadro (coluna) num mural do usuário, no fim. O mural precisa existir: se não " +
  "existir, o erro lista os murais dele — pergunte qual usar, ou crie com criar_mural se ele " +
  "pedir. Se o mesmo quadro (mesmo nome, mesmo mural) foi criado nos últimos 2 minutos, " +
  "devolve o existente." +
  AVISO_ESCRITA;

export function registrarCriarQuadro(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "criar_quadro",
    {
      title: "Criar quadro",
      description: DESC_CRIAR_QUADRO,
      inputSchema: z.object({
        mural: z.string().describe("Nome (mesmo parcial) ou id do mural."),
        nome: campoNome("Nome do quadro (até 80 caracteres)."),
        cor: campoCor(`Cor, da paleta do app. Padrão: ${COR_PADRAO}.`).optional(),
      }),
      outputSchema: z.object({
        resultado: z.enum(["criado", "duplicata"]),
        quadro_id: z.string(),
        mural_id: z.string(),
        nome: z.string(),
      }),
      annotations: anotacoes("Criar quadro", false, false),
    },
    async (e) => executarEscrita(ctx, "criar_quadro", () => criarQuadro(ctx, e)),
  );
}

async function criarQuadro(
  ctx: ContextoEscrita,
  e: { mural: string; nome: string; cor?: keyof typeof CORES },
): Promise<Desfecho> {
  const { supabase, meuId } = ctx;
  const nome = e.nome.trim();
  if (!nome) return semAuditoria(erro("O nome do quadro não pode ser vazio."));
  const cor = e.cor ?? COR_PADRAO;

  const m = await resolverMural(supabase, meuId, e.mural);
  if (!m.ok) return semAuditoria(m.resposta);
  const argumentos = { mural_id: m.mural.id, nome, cor };

  const recentes = await consultar(() =>
    supabase
      .from("mural_quadros")
      .select("id, nome")
      .eq("usuario_id", meuId)
      .eq("mural_id", m.mural.id)
      .gte("criado_em", inicioDaJanela()),
  );
  if (!recentes.ok) return semAuditoria(recentes.resposta);
  const igual = ((recentes.dados ?? []) as MuralRef[]).find(
    (q) => normalizar(q.nome) === normalizar(nome),
  );
  if (igual) {
    return {
      resposta: ok(
        `Não criei outro: o quadro ${citar(igual.nome, 60)} já foi criado no mural ` +
          `${citar(m.mural.nome, 60)} há menos de 2 minutos (id ${igual.id}).` +
          rodapeDeDados(),
        { resultado: "duplicata", quadro_id: igual.id, mural_id: m.mural.id, nome: igual.nome },
      ),
      auditoria: { resultado: "duplicata", ids: [m.mural.id, igual.id], argumentos },
    };
  }

  const fim = await posicaoNoFim(supabase, "mural_quadros", {
    coluna: "mural_id",
    valor: m.mural.id,
  });
  if (!fim.ok) return semAuditoria(fim.resposta);

  const ins = await consultar(() =>
    supabase
      .from("mural_quadros")
      .insert({
        mural_id: m.mural.id,
        nome,
        cor: CORES[cor],
        usuario_id: meuId,
        posicao: fim.posicao,
      })
      .select("id")
      .single(),
  );
  if (!ins.ok) return recusaDoBanco(ins, { ids: [m.mural.id], argumentos });
  const id = (ins.dados as unknown as { id: string }).id;

  return {
    resposta: ok(
      `Quadro ${citar(nome, 60)} criado no fim do mural ${citar(m.mural.nome, 60)} (id ${id}), ` +
        `cor ${cor}.` +
        rodapeDeDados(),
      { resultado: "criado", quadro_id: id, mural_id: m.mural.id, nome },
    ),
    auditoria: { resultado: "ok", ids: [m.mural.id, id], argumentos },
  };
}

// =========================================================== editar_quadro

const DESC_EDITAR_QUADRO =
  "Altera UM quadro do usuário: renomeia, troca a cor e/ou muda a posição dele no mural " +
  "(posicao 1 = primeiro, à esquerda). Só os campos informados mudam; a resposta traz o antes " +
  "e o depois. O quadro pode ser indicado só pelo nome, se ele for único entre os murais do " +
  "usuário; se não, informe o mural." +
  AVISO_ESCRITA;

export function registrarEditarQuadro(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "editar_quadro",
    {
      title: "Editar quadro",
      description: DESC_EDITAR_QUADRO,
      inputSchema: z.object({
        quadro: z.string().describe("Nome (mesmo parcial) ou id do quadro."),
        mural: z.string().describe("Nome ou id do mural, se o nome do quadro repetir.").optional(),
        nome: campoNome("Novo nome.").optional(),
        cor: campoCor("Nova cor, da paleta do app.").optional(),
        posicao: z
          .number()
          .int()
          .min(1)
          .describe("Nova posição no mural: 1 = primeiro. Acima do total, vai para o fim.")
          .optional(),
      }),
      outputSchema: z.object({
        resultado: z.enum(["alterado", "sem_mudanca"]),
        quadro_id: z.string(),
        alteracoes: z.array(
          z.object({
            campo: z.string(),
            antes: z.string().optional(),
            depois: z.string().optional(),
          }),
        ),
      }),
      annotations: anotacoes("Editar quadro", true, true),
    },
    async (e) => executarEscrita(ctx, "editar_quadro", () => editarQuadro(ctx, e)),
  );
}

async function editarQuadro(
  ctx: ContextoEscrita,
  e: { quadro: string; mural?: string; nome?: string; cor?: keyof typeof CORES; posicao?: number },
): Promise<Desfecho> {
  const { supabase, meuId } = ctx;
  if (e.nome === undefined && e.cor === undefined && e.posicao === undefined) {
    return semAuditoria(erro("Diga ao menos um campo para alterar: nome, cor ou posição."));
  }
  if (e.nome !== undefined && !e.nome.trim()) {
    return semAuditoria(erro("O nome do quadro não pode ser vazio."));
  }

  let mural: MuralRef | undefined;
  if (e.mural) {
    const m = await resolverMural(supabase, meuId, e.mural);
    if (!m.ok) return semAuditoria(m.resposta);
    mural = m.mural;
  }
  const q = await resolverQuadro(supabase, meuId, e.quadro, mural);
  if (!q.ok) return semAuditoria(q.resposta);

  // Os quadros do mural, em ordem: dão o estado atual e os vizinhos da nova posição.
  const irmaosR = await consultar(() =>
    supabase
      .from("mural_quadros")
      .select("id, nome, cor, posicao")
      .eq("usuario_id", meuId)
      .eq("mural_id", q.quadro.mural_id)
      .order("posicao")
      .order("criado_em"),
  );
  if (!irmaosR.ok) return semAuditoria(irmaosR.resposta);
  const irmaos = (irmaosR.dados ?? []) as Array<{
    id: string;
    nome: string;
    cor: string;
    posicao: number;
  }>;
  const indiceAtual = irmaos.findIndex((x) => x.id === q.quadro.id);
  const atual = irmaos[indiceAtual];
  if (!atual) return semAuditoria(erro("Não encontrei esse quadro."));

  const patch: Record<string, unknown> = {};
  const alteracoes: Array<{ campo: string; antes?: string; depois?: string }> = [];

  if (e.nome !== undefined && e.nome.trim() !== atual.nome) {
    patch.nome = e.nome.trim();
    alteracoes.push({ campo: "nome", antes: atual.nome, depois: e.nome.trim() });
  }
  if (e.cor !== undefined && CORES[e.cor].toLowerCase() !== atual.cor.toLowerCase()) {
    patch.cor = CORES[e.cor];
    alteracoes.push({ campo: "cor", antes: nomeDaCor(atual.cor), depois: e.cor });
  }
  if (e.posicao !== undefined) {
    const outros = irmaos.filter((x) => x.id !== atual.id);
    const alvo = Math.min(e.posicao, irmaos.length) - 1; // índice 0-based
    if (alvo !== indiceAtual) {
      patch.posicao = posicaoEntre(outros[alvo - 1]?.posicao, outros[alvo]?.posicao);
      alteracoes.push({
        campo: "posicao",
        antes: String(indiceAtual + 1),
        depois: String(alvo + 1),
      });
    }
  }

  const argumentos = {
    mural_id: q.quadro.mural_id,
    campos: alteracoes.map((x) => x.campo),
    nome: patch.nome as string | undefined,
    cor: e.cor,
    posicao: e.posicao,
  };

  if (alteracoes.length === 0) {
    return {
      resposta: ok(`Nada mudou no quadro ${citar(atual.nome, 60)}.` + rodapeDeDados(), {
        resultado: "sem_mudanca",
        quadro_id: atual.id,
        alteracoes: [],
      }),
      auditoria: { resultado: "sem_mudanca", ids: [q.quadro.mural_id, atual.id], argumentos },
    };
  }

  const up = await consultar(() =>
    supabase
      .from("mural_quadros")
      .update(patch)
      .eq("id", atual.id)
      .eq("usuario_id", meuId)
      .select("id"),
  );
  if (!up.ok) return recusaDoBanco(up, { ids: [q.quadro.mural_id, atual.id], argumentos });
  if (((up.dados ?? []) as unknown[]).length === 0) {
    return {
      resposta: erro("O CRM não permite essa alteração. Nada foi gravado."),
      auditoria: {
        resultado: "negado",
        ids: [q.quadro.mural_id, atual.id],
        argumentos,
        detalhe: "update afetou 0 linhas",
      },
    };
  }

  const linhas = [
    `Quadro ${citar((patch.nome as string) ?? atual.nome, 60)} do mural ` +
      `${citar(q.quadro.mural_nome, 60)} alterado:`,
  ];
  for (const x of alteracoes) {
    if (x.campo === "nome") linhas.push(`- Nome: ${citar(x.antes, 80)} → ${citar(x.depois, 80)}`);
    else if (x.campo === "cor") linhas.push(`- Cor: ${x.antes} → ${x.depois}`);
    else linhas.push(`- Posição: ${x.antes}º → ${x.depois}º de ${irmaos.length}`);
  }
  linhas.push(rodapeDeDados());

  return {
    resposta: ok(linhas.join("\n"), { resultado: "alterado", quadro_id: atual.id, alteracoes }),
    auditoria: { resultado: "ok", ids: [q.quadro.mural_id, atual.id], argumentos },
  };
}

// ================================================= colocar_tarefa_no_mural

const DESC_COLOCAR =
  "Põe uma tarefa (em que o usuário é responsável) ou um lembrete dele num quadro de um mural " +
  "dele. Se a tarefa já está em outro quadro do MESMO mural, move o cartão (uma tarefa fica num " +
  "quadro só por mural); se já está no quadro pedido, nada muda. Não mexe na tarefa em si (nem " +
  "no status). Como no app, não aceita tarefa finalizada (concluída há 7 dias ou mais). " +
  "O quadro pode ser indicado só pelo nome, se ele for único entre os murais do usuário." +
  AVISO_ESCRITA;

export function registrarColocarTarefaNoMural(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "colocar_tarefa_no_mural",
    {
      title: "Colocar tarefa no mural",
      description: DESC_COLOCAR,
      inputSchema: z.object({
        tarefa_id: z
          .string()
          .describe("O id da tarefa ou do lembrete (de listar_tarefas ou ver_mural)."),
        quadro: z.string().describe("Nome (mesmo parcial) ou id do quadro de destino."),
        mural: z.string().describe("Nome ou id do mural, se o nome do quadro repetir.").optional(),
      }),
      outputSchema: z.object({
        resultado: z.enum(["colocado", "movido", "sem_mudanca"]),
        tarefa_id: z.string(),
        item_id: z.string(),
        quadro_id: z.string(),
        mural_id: z.string(),
      }),
      annotations: anotacoes("Colocar tarefa no mural", false, true),
    },
    async (e) =>
      executarEscrita(ctx, "colocar_tarefa_no_mural", () => colocarTarefaNoMural(ctx, e)),
  );
}

async function colocarTarefaNoMural(
  ctx: ContextoEscrita,
  e: { tarefa_id: string; quadro: string; mural?: string },
): Promise<Desfecho> {
  const { supabase, meuId } = ctx;
  if (!ehUuid(e.tarefa_id)) {
    return semAuditoria(
      erro("O tarefa_id precisa ser um uuid. Pegue com listar_tarefas ou ver_mural."),
    );
  }

  let mural: MuralRef | undefined;
  if (e.mural) {
    const m = await resolverMural(supabase, meuId, e.mural);
    if (!m.ok) return semAuditoria(m.resposta);
    mural = m.mural;
  }
  const qr = await resolverQuadro(supabase, meuId, e.quadro, mural);
  if (!qr.ok) return semAuditoria(qr.resposta);
  const quadro: QuadroRef = qr.quadro;

  const tr = await consultar(() =>
    supabase
      .from("tarefas")
      .select("id, titulo, tipo, status, concluido_em")
      .eq("id", e.tarefa_id)
      .maybeSingle(),
  );
  if (!tr.ok) return semAuditoria(tr.resposta);
  const t = tr.dados as unknown as {
    id: string;
    titulo: string;
    tipo: string;
    status: string;
    concluido_em: string | null;
  } | null;
  if (!t) {
    return semAuditoria(
      erro("Não encontrei essa tarefa. Ou o id está errado, ou ela não está no seu acesso."),
    );
  }

  const base = {
    tarefaId: t.id,
    ids: [quadro.mural_id, quadro.id],
    argumentos: { mural_id: quadro.mural_id, quadro_id: quadro.id, tipo: t.tipo },
  };

  // A mesma função que a policy de INSERT usa. Chamada aqui também para MOVER,
  // porque a policy de UPDATE não a repete — e o app não deixa mexer em
  // cartão de tarefa da qual a pessoa saiu (ele nem mostra o cartão).
  const perm = await consultar(() => supabase.rpc("mural_tarefa_permitida", { _tarefa_id: t.id }));
  if (!perm.ok) return semAuditoria(perm.resposta);
  if (perm.dados !== true) {
    return {
      resposta: erro(
        t.tipo === "lembrete"
          ? "Esse lembrete não é seu: só dá para pôr no seu mural lembretes que você criou."
          : "Você não é responsável por essa tarefa: só dá para pôr no seu mural tarefas em que " +
              "você é responsável. Se fizer sentido, o usuário pode pedir para ser adicionado " +
              "(definir_responsaveis).",
      ),
      auditoria: { ...base, resultado: "negado", detalhe: "mural_tarefa_permitida = false" },
    };
  }

  if (t.tipo === "tarefa" && t.status === "Concluído" && t.concluido_em) {
    const dias = (Date.now() - new Date(t.concluido_em).getTime()) / 86400000;
    if (dias >= DIAS_PARA_FINALIZAR) {
      return {
        resposta: erro(
          `Essa tarefa foi concluída há mais de ${DIAS_PARA_FINALIZAR} dias (finalizada), e o app ` +
            "não põe tarefa finalizada no mural. Nada foi gravado.",
        ),
        auditoria: { ...base, resultado: "negado", detalhe: "tarefa finalizada" },
      };
    }
  }

  // Já tem cartão neste mural?
  const exR = await consultar(() =>
    supabase
      .from("mural_itens")
      .select("id, quadro_id")
      .eq("usuario_id", meuId)
      .eq("mural_id", quadro.mural_id)
      .eq("tarefa_id", t.id)
      .maybeSingle(),
  );
  if (!exR.ok) return semAuditoria(exR.resposta);
  const existente = exR.dados as unknown as { id: string; quadro_id: string } | null;

  const saida = (resultado: string, itemId: string) => ({
    resultado,
    tarefa_id: t.id,
    item_id: itemId,
    quadro_id: quadro.id,
    mural_id: quadro.mural_id,
  });
  const onde = `no quadro ${citar(quadro.nome, 60)} do mural ${citar(quadro.mural_nome, 60)}`;

  if (existente && existente.quadro_id === quadro.id) {
    return {
      resposta: ok(
        `Nada mudou: ${citar(t.titulo, 120)} já está ${onde}.` + rodapeDeDados(),
        saida("sem_mudanca", existente.id),
      ),
      auditoria: { ...base, ids: [...base.ids, existente.id], resultado: "sem_mudanca" },
    };
  }

  const fim = await posicaoNoFim(supabase, "mural_itens", {
    coluna: "quadro_id",
    valor: quadro.id,
  });
  if (!fim.ok) return semAuditoria(fim.resposta);

  if (existente) {
    const deR = await consultar(() =>
      supabase.from("mural_quadros").select("nome").eq("id", existente.quadro_id).maybeSingle(),
    );
    const de = deR.ok ? (deR.dados as unknown as { nome: string } | null)?.nome : undefined;

    const up = await consultar(() =>
      supabase
        .from("mural_itens")
        .update({ quadro_id: quadro.id, posicao: fim.posicao })
        .eq("id", existente.id)
        .eq("usuario_id", meuId)
        .select("id"),
    );
    const auditoriaMover = {
      ...base,
      ids: [...base.ids, existente.id],
      argumentos: { ...base.argumentos, acao: "mover" },
    };
    if (!up.ok) return erroDeCartao(up, auditoriaMover);
    if (((up.dados ?? []) as unknown[]).length === 0) {
      return {
        resposta: erro("O CRM não permite mover esse cartão. Nada foi gravado."),
        auditoria: { ...auditoriaMover, resultado: "negado", detalhe: "update afetou 0 linhas" },
      };
    }
    return {
      resposta: ok(
        `Cartão ${citar(t.titulo, 120)} movido do quadro ${citar(de ?? "(anterior)", 60)} para o ` +
          `fim do quadro ${citar(quadro.nome, 60)} (mural ${citar(quadro.mural_nome, 60)}).` +
          rodapeDeDados(),
        saida("movido", existente.id),
      ),
      auditoria: { ...auditoriaMover, resultado: "ok" },
    };
  }

  const ins = await consultar(() =>
    supabase
      .from("mural_itens")
      .insert({ quadro_id: quadro.id, tarefa_id: t.id, usuario_id: meuId, posicao: fim.posicao })
      .select("id")
      .single(),
  );
  const auditoriaInserir = { ...base, argumentos: { ...base.argumentos, acao: "inserir" } };
  if (!ins.ok) return erroDeCartao(ins, auditoriaInserir);
  const itemId = (ins.dados as unknown as { id: string }).id;

  return {
    resposta: ok(
      `${t.tipo === "lembrete" ? "Lembrete" : "Tarefa"} ${citar(t.titulo, 120)} posto(a) no fim ` +
        `${onde}.` +
        rodapeDeDados(),
      saida("colocado", itemId),
    ),
    auditoria: { ...auditoriaInserir, ids: [...base.ids, itemId], resultado: "ok" },
  };
}

// =================================================== tirar_tarefa_do_mural

const DESC_TIRAR =
  "Tira o cartão de uma tarefa ou lembrete de um mural do usuário. Remove SÓ o cartão: a " +
  "tarefa (ou o lembrete) continua existindo, igual. Se a tarefa estiver em mais de um mural, " +
  "informe qual. Lembrete SEM DATA que só está neste mural não é tirado: ele sumiria de todas " +
  "as telas do app; a resposta sugere as alternativas." +
  AVISO_ESCRITA;

export function registrarTirarTarefaDoMural(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "tirar_tarefa_do_mural",
    {
      title: "Tirar tarefa do mural",
      description: DESC_TIRAR,
      inputSchema: z.object({
        tarefa_id: z.string().describe("O id da tarefa ou do lembrete (tarefa_id do cartão)."),
        mural: z
          .string()
          .describe("Nome ou id do mural. Obrigatório se a tarefa estiver em mais de um.")
          .optional(),
      }),
      outputSchema: z.object({
        resultado: z.enum(["retirado", "sem_mudanca"]),
        tarefa_id: z.string(),
        mural_id: z.string().optional(),
      }),
      annotations: anotacoes("Tirar tarefa do mural", true, true),
    },
    async (e) => executarEscrita(ctx, "tirar_tarefa_do_mural", () => tirarTarefaDoMural(ctx, e)),
  );
}

async function tirarTarefaDoMural(
  ctx: ContextoEscrita,
  e: { tarefa_id: string; mural?: string },
): Promise<Desfecho> {
  const { supabase, meuId } = ctx;
  if (!ehUuid(e.tarefa_id)) {
    return semAuditoria(erro("O tarefa_id precisa ser um uuid. Pegue com ver_mural."));
  }

  let mural: MuralRef | undefined;
  if (e.mural) {
    const m = await resolverMural(supabase, meuId, e.mural);
    if (!m.ok) return semAuditoria(m.resposta);
    mural = m.mural;
  }

  // TODOS os cartões dela nos meus murais, e não só os do mural pedido: a
  // guarda do lembrete sem data (abaixo) precisa saber se sobra algum.
  const r = await consultar(() =>
    supabase
      .from("mural_itens")
      .select("id, mural_id, quadro_id")
      .eq("usuario_id", meuId)
      .eq("tarefa_id", e.tarefa_id),
  );
  if (!r.ok) return semAuditoria(r.resposta);
  const todosOsCartoes = (r.dados ?? []) as Array<{
    id: string;
    mural_id: string;
    quadro_id: string;
  }>;
  const itens = mural ? todosOsCartoes.filter((i) => i.mural_id === mural.id) : todosOsCartoes;

  if (itens.length === 0) {
    return {
      resposta: ok(
        `Nada mudou: essa tarefa não tem cartão ${mural ? `no mural ${citar(mural.nome, 60)}` : "nos seus murais"}.` +
          rodapeDeDados(),
        { resultado: "sem_mudanca", tarefa_id: e.tarefa_id, mural_id: mural?.id },
      ),
      auditoria: {
        resultado: "sem_mudanca",
        tarefaId: e.tarefa_id,
        ids: mural ? [mural.id] : [],
        argumentos: { mural_id: mural?.id },
      },
    };
  }

  if (itens.length > 1) {
    const nomes = await consultar(() =>
      supabase
        .from("murais")
        .select("id, nome")
        .in(
          "id",
          itens.map((i) => i.mural_id),
        ),
    );
    const lista = nomes.ok
      ? ((nomes.dados ?? []) as MuralRef[])
          .map((m) => `${citar(m.nome, 60)} (id ${m.id})`)
          .join("; ")
      : `${itens.length} murais`;
    return semAuditoria(
      erro(`Essa tarefa está em mais de um mural: ${lista}. Pergunte ao usuário de qual tirar.`),
    );
  }

  const item = itens[0]!;
  const argumentos = { mural_id: item.mural_id, quadro_id: item.quadro_id };
  const ids = [item.mural_id, item.quadro_id, item.id];

  const [tarefaR, quadroR] = await Promise.all([
    consultar(() =>
      supabase
        .from("tarefas")
        .select("titulo, tipo, data_vencimento")
        .eq("id", e.tarefa_id)
        .maybeSingle(),
    ),
    consultar(() =>
      supabase.from("mural_quadros").select("nome").eq("id", item.quadro_id).maybeSingle(),
    ),
  ]);
  const tarefa = tarefaR.ok
    ? (tarefaR.dados as unknown as {
        titulo: string;
        tipo: string;
        data_vencimento: string | null;
      } | null)
    : null;
  const titulo = tarefa?.titulo;
  const nomeQuadro = quadroR.ok
    ? (quadroR.dados as unknown as { nome: string } | null)?.nome
    : undefined;

  // Lembrete SEM DATA no ÚLTIMO mural: tirar o cartão o deixaria invisível no
  // app — a Agenda só mostra o que tem data, o Kanban não mostra lembrete, e o
  // próprio app nem oferece "remover do quadro" para lembrete, só "excluir".
  // O lembrete continuaria no banco, mas ninguém mais o acharia pela tela.
  if (tarefa?.tipo === "lembrete" && !tarefa.data_vencimento && todosOsCartoes.length === 1) {
    return {
      resposta: erro(
        `Não tirei: ${citar(titulo, 120)} é um lembrete sem data e este é o único mural em que ` +
          "ele está. Sem o cartão, ele sumiria de todas as telas do app (a Agenda só mostra " +
          "lembrete com data). Alternativas: mover para outro quadro (colocar_tarefa_no_mural), " +
          "dar uma data a ele (editar_lembrete) antes de tirar, ou excluí-lo pelo app.",
      ),
      auditoria: {
        resultado: "negado",
        tarefaId: e.tarefa_id,
        ids,
        argumentos,
        detalhe: "lembrete sem data ficaria invisivel no app",
      },
    };
  }

  const del = await consultar(() =>
    supabase.from("mural_itens").delete().eq("id", item.id).eq("usuario_id", meuId).select("id"),
  );
  if (!del.ok) return recusaDoBanco(del, { tarefaId: e.tarefa_id, ids, argumentos });
  if (((del.dados ?? []) as unknown[]).length === 0) {
    return {
      resposta: erro("O CRM não permite tirar esse cartão. Nada foi alterado."),
      auditoria: {
        resultado: "negado",
        tarefaId: e.tarefa_id,
        ids,
        argumentos,
        detalhe: "delete afetou 0 linhas",
      },
    };
  }

  return {
    resposta: ok(
      `Cartão ${citar(titulo ?? "(tarefa)", 120)} tirado do quadro ${citar(nomeQuadro ?? "(quadro)", 60)}. ` +
        "A tarefa continua existindo; só o cartão saiu do mural." +
        rodapeDeDados(),
      { resultado: "retirado", tarefa_id: e.tarefa_id, mural_id: item.mural_id },
    ),
    auditoria: { resultado: "ok", tarefaId: e.tarefa_id, ids, argumentos },
  };
}
