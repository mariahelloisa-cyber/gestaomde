import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { citar, dataBr, rodapeDeDados } from "../formato";
import { consultar } from "../sessao";
import { campoDeData, erro, ok } from "./comuns";
import {
  AVISO_ESCRITA,
  type ContextoEscrita,
  dataExiste,
  type Desfecho,
  executarEscrita,
  inicioDaJanela,
  prazoParaTimestamp,
  recusaDoBanco,
  semAuditoria,
} from "./escrita";
import {
  CONTEUDO_MAXIMO,
  ondeNosMurais,
  resolverLembrete,
  resolverMural,
  resolverQuadro,
  trechoInicial,
} from "./murais";
import { erroDeCartao, posicaoNoFim } from "./murais-escrita";

/**
 * Lembretes com conteúdo longo (o uso principal: "cria um roteiro sobre X e
 * põe no mural Y").
 *
 * Lembrete é uma linha de `tarefas` com tipo='lembrete', sem responsável, então
 * não dispara e-mail nenhum (o cron de avisos só manda para responsáveis).
 * Data é opcional, como no app: sem data ele aparece no mural ("Sem data") e
 * não aparece na Agenda.
 *
 * CONTEÚDO: a coluna `descricao` é `text` sem limite no banco; o limite aqui é
 * CONTEUDO_MAXIMO (20 mil), o mesmo que o app valida (createSchema/updateSchema
 * em src/lib/data.functions.ts). Se um dos dois mudar, mude o outro — ver
 * DEPLOY.md 10.8.
 *
 * AUDITORIA: o texto do conteúdo NUNCA vai para mcp_audit_log, só o tamanho.
 */

const ESCOPOS_LEMBRETE = ["pessoal", "geral"] as const;

const textoEscopo = (escopo: string) =>
  escopo === "geral" ? "geral (toda a equipe vê na Agenda, se tiver data)" : "pessoal (só você vê)";

const textoData = (iso: string | null) =>
  iso ? dataBr(iso) : "sem data (aparece no mural, mas não na Agenda)";

// ================================================= criar_lembrete_no_mural

const DESC_CRIAR_LEMBRETE =
  "Cria um lembrete do usuário (por exemplo, um roteiro de vídeo, com o texto inteiro no " +
  "conteúdo) e já põe o cartão dele num quadro de um mural dele. O mural e o quadro precisam " +
  "existir: se não existirem, NADA é criado e o erro lista os que existem — pergunte ao usuário, " +
  "ou use criar_mural/criar_quadro se ele pedir. Escopo padrão 'pessoal' (só ele vê); use " +
  "'geral' (toda a equipe vê na Agenda) só se o usuário pedir explicitamente. Data é opcional. " +
  "Conteúdo até 20.000 caracteres. Se ele mesmo criou um lembrete com o mesmo título nos " +
  "últimos 2 minutos, devolve o existente em vez de duplicar." +
  AVISO_ESCRITA;

export function registrarCriarLembreteNoMural(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "criar_lembrete_no_mural",
    {
      title: "Criar lembrete no mural",
      description: DESC_CRIAR_LEMBRETE,
      inputSchema: z.object({
        titulo: z.string().min(1).max(500).describe("Título do lembrete (aparece no cartão)."),
        conteudo: z
          .string()
          .max(CONTEUDO_MAXIMO)
          .describe("O texto do lembrete, por exemplo o roteiro inteiro. Até 20.000 caracteres.")
          .optional(),
        mural: z.string().describe("Nome (mesmo parcial) ou id do mural."),
        quadro: z.string().describe("Nome (mesmo parcial) ou id do quadro, dentro desse mural."),
        data: campoDeData("Data do lembrete (AAAA-MM-DD), se o usuário der uma.").optional(),
        escopo: z
          .enum(ESCOPOS_LEMBRETE)
          .describe("Padrão 'pessoal'. 'geral' só se o usuário pedir explicitamente.")
          .optional(),
      }),
      outputSchema: z.object({
        resultado: z.enum(["criado", "duplicata", "fora_do_mural"]),
        lembrete_id: z.string(),
        item_id: z.string().optional(),
        quadro_id: z.string(),
        mural_id: z.string(),
        tamanho_conteudo: z.number().int(),
      }),
      annotations: {
        title: "Criar lembrete no mural",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (e) =>
      executarEscrita(ctx, "criar_lembrete_no_mural", () => criarLembreteNoMural(ctx, e)),
  );
}

interface EntradaCriarLembrete {
  titulo: string;
  conteudo?: string;
  mural: string;
  quadro: string;
  data?: string;
  escopo?: (typeof ESCOPOS_LEMBRETE)[number];
}

async function criarLembreteNoMural(
  ctx: ContextoEscrita,
  e: EntradaCriarLembrete,
): Promise<Desfecho> {
  const { supabase, meuId } = ctx;

  // --- 1. Valida e resolve TUDO antes de gravar ---
  const titulo = e.titulo.trim();
  if (!titulo) return semAuditoria(erro("O título do lembrete não pode ser vazio."));
  const conteudo = e.conteudo?.trim() || null;
  if (e.data && !dataExiste(e.data)) {
    return semAuditoria(erro(`A data ${e.data} não existe. Use AAAA-MM-DD.`));
  }
  const escopo = e.escopo ?? "pessoal";

  const m = await resolverMural(supabase, meuId, e.mural);
  if (!m.ok) return semAuditoria(m.resposta);
  const q = await resolverQuadro(supabase, meuId, e.quadro, m.mural);
  if (!q.ok) return semAuditoria(q.resposta);
  const quadro = q.quadro;

  const tamanho = conteudo?.length ?? 0;
  // Só o tamanho do conteúdo: o roteiro não vai para a auditoria.
  const argumentos = {
    titulo,
    conteudo_len: tamanho,
    data: e.data,
    escopo,
    mural_id: quadro.mural_id,
    quadro_id: quadro.id,
  };

  // --- 2. Duplicata: mesmo título, meu, nos últimos 2 minutos ---
  // Lembrete meu é sempre visível para mim (pessoal ou geral), então a consulta
  // basta — não precisa do marcador no KV que criar_tarefa usa.
  const dup = await consultar(() =>
    supabase
      .from("tarefas")
      .select("id, descricao")
      .eq("criado_por", meuId)
      .eq("tipo", "lembrete")
      .eq("titulo", titulo)
      .gte("data_criacao", inicioDaJanela())
      .order("data_criacao", { ascending: false })
      .limit(1),
  );
  if (!dup.ok) return semAuditoria(dup.resposta);
  const anterior = ((dup.dados ?? []) as Array<{ id: string; descricao: string | null }>)[0];
  if (anterior) {
    const onde = await ondeNosMurais(supabase, meuId, anterior.id);
    const lugares =
      onde.ok && onde.lugares.length > 0
        ? onde.lugares.map((x) => `${citar(x.mural, 60)} / ${citar(x.quadro, 60)}`).join("; ")
        : "nenhum mural";
    return {
      resposta: ok(
        `Não criei outro: você já criou o lembrete ${citar(titulo, 300)} há menos de 2 minutos ` +
          `(id ${anterior.id}, ${anterior.descricao?.length ?? 0} caracteres de conteúdo), que ` +
          `está em: ${lugares}. Para mudar o texto, use editar_lembrete; para pôr em outro ` +
          "quadro, colocar_tarefa_no_mural." +
          rodapeDeDados(),
        {
          resultado: "duplicata",
          lembrete_id: anterior.id,
          quadro_id: quadro.id,
          mural_id: quadro.mural_id,
          tamanho_conteudo: anterior.descricao?.length ?? 0,
        },
      ),
      auditoria: { resultado: "duplicata", tarefaId: anterior.id, ids: [quadro.id], argumentos },
    };
  }

  // --- 3. O lembrete. Mesmos valores fixos que o app usa para lembrete. ---
  const dataTs = e.data ? prazoParaTimestamp(e.data) : null;
  const ins = await consultar(() =>
    supabase
      .from("tarefas")
      .insert({
        titulo,
        descricao: conteudo,
        tipo: "lembrete",
        escopo,
        criado_por: meuId,
        status: "Pendente",
        prioridade: "Nenhuma",
        complexidade: "Média",
        data_vencimento: dataTs,
        cliente_id: null,
      })
      .select("id")
      .single(),
  );
  if (!ins.ok) return recusaDoBanco(ins, { argumentos });
  const lembreteId = (ins.dados as unknown as { id: string }).id;

  const cabecalho = [
    `Lembrete criado: ${citar(titulo, 300)}`,
    `id: ${lembreteId}`,
    `Data: ${textoData(dataTs)} · Escopo: ${textoEscopo(escopo)}`,
    `Conteúdo: ${tamanho} caracteres`,
  ];

  // --- 4. O cartão. Se falhar, o lembrete FICA (não apago) e a resposta diz. ---
  const fim = await posicaoNoFim(supabase, "mural_itens", {
    coluna: "quadro_id",
    valor: quadro.id,
  });
  const card = fim.ok
    ? await consultar(() =>
        supabase
          .from("mural_itens")
          .insert({
            quadro_id: quadro.id,
            tarefa_id: lembreteId,
            usuario_id: meuId,
            posicao: fim.posicao,
          })
          .select("id")
          .single(),
      )
    : { ok: false as const, resposta: fim.resposta, codigo: "posicao" };

  if (!card.ok) {
    const motivo = erroDeCartao(card, { tarefaId: lembreteId, argumentos });
    const explicacao = motivo.resposta.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join(" ");
    return {
      resposta: ok(
        [
          ...cabecalho,
          "",
          `ATENÇÃO: o lembrete FOI criado (id ${lembreteId}), mas ficou FORA do mural — o cartão ` +
            `no quadro ${citar(quadro.nome, 60)} do mural ${citar(quadro.mural_nome, 60)} não ` +
            `foi gravado. Motivo: ${explicacao} O lembrete não foi apagado. Para pôr no mural, ` +
            `use colocar_tarefa_no_mural com tarefa_id ${lembreteId}.`,
          rodapeDeDados(),
        ].join("\n"),
        {
          resultado: "fora_do_mural",
          lembrete_id: lembreteId,
          quadro_id: quadro.id,
          mural_id: quadro.mural_id,
          tamanho_conteudo: tamanho,
        },
      ),
      auditoria: {
        resultado: "parcial",
        tarefaId: lembreteId,
        ids: [quadro.mural_id, quadro.id],
        argumentos,
        detalhe: `lembrete criado, cartao falhou: ${card.codigo ?? "?"}`,
      },
    };
  }
  const itemId = (card.dados as unknown as { id: string }).id;

  return {
    resposta: ok(
      [
        ...cabecalho,
        `No mural: ${citar(quadro.mural_nome, 60)} / quadro ${citar(quadro.nome, 60)} (no fim).`,
        rodapeDeDados(),
      ].join("\n"),
      {
        resultado: "criado",
        lembrete_id: lembreteId,
        item_id: itemId,
        quadro_id: quadro.id,
        mural_id: quadro.mural_id,
        tamanho_conteudo: tamanho,
      },
    ),
    auditoria: {
      resultado: "ok",
      tarefaId: lembreteId,
      ids: [quadro.mural_id, quadro.id, itemId],
      argumentos,
    },
  };
}

// ========================================================= editar_lembrete

const DESC_EDITAR_LEMBRETE =
  "Altera UM lembrete do próprio usuário: título, conteúdo e/ou data. O conteúdo SUBSTITUI o " +
  "texto inteiro: para ajustar um trecho (por exemplo, o final de um roteiro), leia antes com " +
  "ver_lembrete e mande o texto completo já ajustado. A resposta traz o antes e o depois " +
  "(título completo; do conteúdo, tamanho e trecho inicial). Só lembretes que o usuário criou." +
  AVISO_ESCRITA;

export function registrarEditarLembrete(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "editar_lembrete",
    {
      title: "Editar lembrete",
      description: DESC_EDITAR_LEMBRETE,
      inputSchema: z.object({
        lembrete: z.string().describe("O id do lembrete (tarefa_id do cartão) ou o título."),
        titulo: z.string().min(1).max(500).describe("Novo título.").optional(),
        conteudo: z
          .string()
          .max(CONTEUDO_MAXIMO)
          .describe("Novo conteúdo COMPLETO (substitui o atual). Texto vazio apaga.")
          .optional(),
        data: campoDeData("Nova data (AAAA-MM-DD).").optional(),
        remover_data: z.boolean().describe("Se true, o lembrete fica sem data.").optional(),
      }),
      outputSchema: z.object({
        resultado: z.enum(["alterado", "sem_mudanca"]),
        lembrete_id: z.string(),
        campos: z.array(z.string()),
        tamanho_conteudo_antes: z.number().int(),
        tamanho_conteudo_depois: z.number().int(),
      }),
      annotations: {
        title: "Editar lembrete",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (e) => executarEscrita(ctx, "editar_lembrete", () => editarLembrete(ctx, e)),
  );
}

interface EntradaEditarLembrete {
  lembrete: string;
  titulo?: string;
  conteudo?: string;
  data?: string;
  remover_data?: boolean;
}

async function editarLembrete(ctx: ContextoEscrita, e: EntradaEditarLembrete): Promise<Desfecho> {
  const { supabase, meuId } = ctx;

  if (e.titulo === undefined && e.conteudo === undefined && !e.data && !e.remover_data) {
    return semAuditoria(erro("Diga ao menos um campo para alterar: título, conteúdo ou data."));
  }
  if (e.data && e.remover_data) return semAuditoria(erro("Use data OU remover_data, não os dois."));
  if (e.titulo !== undefined && !e.titulo.trim()) {
    return semAuditoria(erro("O título não pode ser vazio."));
  }
  if (e.data && !dataExiste(e.data)) {
    return semAuditoria(erro(`A data ${e.data} não existe. Use AAAA-MM-DD.`));
  }

  const r = await resolverLembrete(supabase, meuId, e.lembrete);
  if (!r.ok) return semAuditoria(r.resposta);
  const l = r.lembrete;

  const patch: Record<string, unknown> = {};
  const campos: string[] = [];
  const linhas: string[] = [];
  const antesLen = l.descricao?.length ?? 0;
  let depoisLen = antesLen;

  if (e.titulo !== undefined && e.titulo.trim() !== l.titulo) {
    patch.titulo = e.titulo.trim();
    campos.push("titulo");
    linhas.push(`- Título: ${citar(l.titulo, 500)} → ${citar(e.titulo.trim(), 500)}`);
  }

  if (e.conteudo !== undefined) {
    const novo = e.conteudo.trim() || null;
    if (novo !== (l.descricao?.trim() || null)) {
      patch.descricao = novo;
      campos.push("conteudo");
      depoisLen = novo?.length ?? 0;
      linhas.push(
        `- Conteúdo: ${antesLen} → ${depoisLen} caracteres`,
        `  Começava com: ${trechoInicial(l.descricao)}`,
        `  Agora começa com: ${trechoInicial(novo)}`,
      );
    }
  }

  if (e.data) {
    const nova = prazoParaTimestamp(e.data);
    const atual = l.data_vencimento ? new Date(l.data_vencimento).getTime() : null;
    if (atual !== new Date(nova).getTime()) {
      patch.data_vencimento = nova;
      campos.push("data");
      linhas.push(`- Data: ${textoData(l.data_vencimento)} → ${textoData(nova)}`);
    }
  }
  if (e.remover_data && l.data_vencimento) {
    patch.data_vencimento = null;
    campos.push("data");
    linhas.push(`- Data: ${textoData(l.data_vencimento)} → ${textoData(null)}`);
  }

  // Só tamanho do conteúdo, nunca o texto.
  const argumentos = {
    campos,
    titulo: patch.titulo as string | undefined,
    conteudo_len: campos.includes("conteudo") ? depoisLen : undefined,
    data: e.data ?? (e.remover_data ? "remover" : undefined),
  };

  if (campos.length === 0) {
    return {
      resposta: ok(`Nada mudou no lembrete ${citar(l.titulo, 300)}.` + rodapeDeDados(), {
        resultado: "sem_mudanca",
        lembrete_id: l.id,
        campos: [],
        tamanho_conteudo_antes: antesLen,
        tamanho_conteudo_depois: antesLen,
      }),
      auditoria: { resultado: "sem_mudanca", tarefaId: l.id, argumentos },
    };
  }

  // Os três filtros repetem o resolverLembrete de propósito: só lembrete, só meu.
  const up = await consultar(() =>
    supabase
      .from("tarefas")
      .update(patch)
      .eq("id", l.id)
      .eq("tipo", "lembrete")
      .eq("criado_por", meuId)
      .select("id"),
  );
  if (!up.ok) return recusaDoBanco(up, { tarefaId: l.id, argumentos });
  if (((up.dados ?? []) as unknown[]).length === 0) {
    return {
      resposta: erro("O CRM não permite essa alteração. Nada foi gravado."),
      auditoria: {
        resultado: "negado",
        tarefaId: l.id,
        argumentos,
        detalhe: "update afetou 0 linhas",
      },
    };
  }

  return {
    resposta: ok(
      [
        `Lembrete ${citar((patch.titulo as string) ?? l.titulo, 300)} (id ${l.id}) alterado:`,
        ...linhas,
        rodapeDeDados(),
      ].join("\n"),
      {
        resultado: "alterado",
        lembrete_id: l.id,
        campos,
        tamanho_conteudo_antes: antesLen,
        tamanho_conteudo_depois: depoisLen,
      },
    ),
    auditoria: { resultado: "ok", tarefaId: l.id, argumentos },
  };
}
