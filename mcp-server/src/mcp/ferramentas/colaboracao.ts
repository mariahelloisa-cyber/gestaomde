import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { citar, dataHoraBr, rodapeDeDados } from "../formato";
import { consultar } from "../sessao";
import { ehUuid, erro, ok } from "./comuns";
import {
  AVISO_ESCRITA,
  carregarTarefa,
  type ContextoEscrita,
  type Desfecho,
  executarEscrita,
  inicioDaJanela,
  normalizar,
  recusaDoBanco,
  recusarSeLembrete,
  semAuditoria,
} from "./escrita";

/**
 * Comentário e checklist: as escritas que não notificam ninguém e não apagam
 * nada. Por isso `destructiveHint: false` e `openWorldHint: false` nas três.
 */

const ANOTACOES_COLABORACAO = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

// ========================================================= comentar_tarefa

const DESC_COMENTAR =
  "Publica um comentário em UMA tarefa, assinado pela conta conectada. Comentário não gera " +
  "notificação. Não dá para editar nem apagar comentário por aqui: confira o texto com o " +
  "usuário antes. Se o mesmo texto já foi comentado por você nesta tarefa nos últimos 2 " +
  "minutos, o existente é devolvido em vez de duplicado. Precisa do id da tarefa (pegue com " +
  "listar_tarefas)." +
  AVISO_ESCRITA;

export function registrarComentarTarefa(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "comentar_tarefa",
    {
      title: "Comentar tarefa",
      description: DESC_COMENTAR,
      inputSchema: z.object({
        tarefa_id: z.string().describe("O id (uuid) da tarefa, como devolvido por listar_tarefas."),
        texto: z.string().min(1).max(5000).describe("O texto do comentário."),
      }),
      outputSchema: z.object({
        resultado: z.enum(["publicado", "duplicata"]),
        tarefa_id: z.string(),
        comentario_id: z.string(),
        criado_em: z.string(),
      }),
      annotations: {
        title: "Comentar tarefa",
        ...ANOTACOES_COLABORACAO,
        idempotentHint: false,
      },
    },
    async (entrada) => executarEscrita(ctx, "comentar_tarefa", () => comentarTarefa(ctx, entrada)),
  );
}

async function comentarTarefa(
  ctx: ContextoEscrita,
  e: { tarefa_id: string; texto: string },
): Promise<Desfecho> {
  const { supabase, meuId } = ctx;
  const texto = e.texto.trim();
  if (!texto) return semAuditoria(erro("O comentário não pode ser vazio."));

  const c = await carregarTarefa(ctx, e.tarefa_id);
  if (!c.ok) return semAuditoria(c.resposta);
  const t = c.tarefa;

  const lembrete = recusarSeLembrete(t);
  if (lembrete) return lembrete;

  // Só o tamanho: o texto do comentário não vai para a auditoria.
  const argumentos = { conteudo_len: texto.length };

  const dup = await consultar(() =>
    supabase
      .from("comentarios_tarefa")
      .select("id, criado_em")
      .eq("tarefa_id", t.id)
      .eq("usuario_id", meuId)
      .eq("conteudo", texto)
      .gte("criado_em", inicioDaJanela())
      .order("criado_em", { ascending: false })
      .limit(1),
  );
  if (!dup.ok) return semAuditoria(dup.resposta);
  const anterior = ((dup.dados ?? []) as Array<{ id: string; criado_em: string }>)[0];

  if (anterior) {
    return {
      resposta: ok(
        `Não publiquei de novo: esse mesmo comentário já está na tarefa ${citar(t.titulo)}, ` +
          `publicado por você em ${dataHoraBr(anterior.criado_em)} (id ${anterior.id}).` +
          rodapeDeDados(),
        {
          resultado: "duplicata",
          tarefa_id: t.id,
          comentario_id: anterior.id,
          criado_em: anterior.criado_em,
        },
      ),
      auditoria: { resultado: "duplicata", tarefaId: t.id, ids: [anterior.id], argumentos },
    };
  }

  const ins = await consultar(() =>
    supabase
      .from("comentarios_tarefa")
      .insert({ tarefa_id: t.id, usuario_id: meuId, conteudo: texto })
      .select("id, criado_em")
      .single(),
  );
  if (!ins.ok) return recusaDoBanco(ins, { tarefaId: t.id, argumentos });
  // `as unknown as`: sem os tipos do banco, o supabase-js infere `null` para o
  // retorno de insert().select().single(). A forma real vem do select acima.
  const novo = ins.dados as unknown as { id: string; criado_em: string };

  return {
    resposta: ok(
      `Comentário publicado na tarefa ${citar(t.titulo)} (id ${t.id}), em ` +
        `${dataHoraBr(novo.criado_em)}. Comentário não gera notificação.` +
        rodapeDeDados(),
      {
        resultado: "publicado",
        tarefa_id: t.id,
        comentario_id: novo.id,
        criado_em: novo.criado_em,
      },
    ),
    auditoria: { resultado: "ok", tarefaId: t.id, ids: [novo.id], argumentos },
  };
}

// =============================================== adicionar_itens_checklist

const DESC_ADICIONAR_ITENS =
  "Acrescenta itens à checklist de UMA tarefa, todos de uma vez (até 20). Item com texto igual " +
  "a um que já está na checklist é pulado, então repetir a chamada não duplica nada. Precisa " +
  "do id da tarefa (pegue com listar_tarefas)." +
  AVISO_ESCRITA;

export function registrarAdicionarItensChecklist(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "adicionar_itens_checklist",
    {
      title: "Adicionar itens à checklist",
      description: DESC_ADICIONAR_ITENS,
      inputSchema: z.object({
        tarefa_id: z.string().describe("O id (uuid) da tarefa, como devolvido por listar_tarefas."),
        itens: z
          .array(z.string().min(1).max(500))
          .min(1)
          .max(20)
          .describe("Os textos dos itens, na ordem em que devem aparecer."),
      }),
      outputSchema: z.object({
        resultado: z.enum(["adicionados", "sem_mudanca"]),
        tarefa_id: z.string(),
        adicionados: z.array(z.object({ id: z.string(), texto: z.string() })),
        ignorados: z.array(z.string()),
      }),
      annotations: {
        title: "Adicionar itens à checklist",
        ...ANOTACOES_COLABORACAO,
        idempotentHint: true,
      },
    },
    async (entrada) =>
      executarEscrita(ctx, "adicionar_itens_checklist", () => adicionarItens(ctx, entrada)),
  );
}

async function adicionarItens(
  ctx: ContextoEscrita,
  e: { tarefa_id: string; itens: string[] },
): Promise<Desfecho> {
  const { supabase } = ctx;

  const c = await carregarTarefa(ctx, e.tarefa_id);
  if (!c.ok) return semAuditoria(c.resposta);
  const t = c.tarefa;

  const lembrete = recusarSeLembrete(t);
  if (lembrete) return lembrete;

  const atuais = await consultar(() =>
    supabase.from("tarefa_checklist_itens").select("texto").eq("tarefa_id", t.id),
  );
  if (!atuais.ok) return semAuditoria(atuais.resposta);
  const vistos = new Set(
    ((atuais.dados ?? []) as Array<{ texto: string }>).map((i) => normalizar(i.texto)),
  );

  const novos: string[] = [];
  const ignorados: string[] = [];
  for (const bruto of e.itens) {
    const texto = bruto.trim();
    if (!texto) continue;
    const chave = normalizar(texto);
    if (vistos.has(chave)) {
      ignorados.push(`${citar(texto, 80)} já está na checklist`);
      continue;
    }
    vistos.add(chave);
    novos.push(texto);
  }

  const argumentos = { itens: novos, pulados: ignorados.length };

  if (novos.length === 0) {
    return {
      resposta: ok(
        `Nada a acrescentar na checklist de ${citar(t.titulo)}: ${ignorados.join("; ") || "nenhum item válido"}.` +
          rodapeDeDados(),
        { resultado: "sem_mudanca", tarefa_id: t.id, adicionados: [], ignorados },
      ),
      auditoria: { resultado: "sem_mudanca", tarefaId: t.id, argumentos },
    };
  }

  // Todos num INSERT só: ou entram todos, ou nenhum.
  const ins = await consultar(() =>
    supabase
      .from("tarefa_checklist_itens")
      .insert(novos.map((texto) => ({ tarefa_id: t.id, texto })))
      .select("id, texto"),
  );
  if (!ins.ok) return recusaDoBanco(ins, { tarefaId: t.id, argumentos });
  const adicionados = (ins.dados ?? []) as Array<{ id: string; texto: string }>;

  const linhas = [
    `Checklist de ${citar(t.titulo)} (id ${t.id}): ${adicionados.length} item(ns) acrescentado(s).`,
    ...adicionados.map((i) => `  [ ] ${citar(i.texto, 200)}`),
  ];
  if (ignorados.length > 0) linhas.push(`Pulados: ${ignorados.join("; ")}.`);
  linhas.push(rodapeDeDados());

  return {
    resposta: ok(linhas.join("\n"), {
      resultado: "adicionados",
      tarefa_id: t.id,
      adicionados,
      ignorados,
    }),
    auditoria: { resultado: "ok", tarefaId: t.id, ids: adicionados.map((i) => i.id), argumentos },
  };
}

// =================================================== marcar_item_checklist

const DESC_MARCAR_ITEM =
  "Marca ou desmarca UM item da checklist de uma tarefa. Grava o valor pedido (concluido true " +
  "ou false), não inverte o atual, então repetir a chamada não muda nada. O item é indicado " +
  "pelo id (devolvido por ver_tarefa) ou por um trecho do texto; trecho que casa com mais de " +
  "um item devolve erro pedindo para escolher." +
  AVISO_ESCRITA;

export function registrarMarcarItemChecklist(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "marcar_item_checklist",
    {
      title: "Marcar item da checklist",
      description: DESC_MARCAR_ITEM,
      inputSchema: z.object({
        tarefa_id: z.string().describe("O id (uuid) da tarefa, como devolvido por listar_tarefas."),
        item: z
          .string()
          .min(1)
          .describe("O id do item (de ver_tarefa) ou um trecho do texto dele."),
        concluido: z.boolean().describe("true marca como feito; false desmarca."),
      }),
      outputSchema: z.object({
        resultado: z.enum(["marcado", "sem_mudanca"]),
        tarefa_id: z.string(),
        item_id: z.string(),
        texto: z.string(),
        concluido: z.boolean(),
      }),
      annotations: {
        title: "Marcar item da checklist",
        ...ANOTACOES_COLABORACAO,
        idempotentHint: true,
      },
    },
    async (entrada) =>
      executarEscrita(ctx, "marcar_item_checklist", () => marcarItem(ctx, entrada)),
  );
}

async function marcarItem(
  ctx: ContextoEscrita,
  e: { tarefa_id: string; item: string; concluido: boolean },
): Promise<Desfecho> {
  const { supabase } = ctx;

  const c = await carregarTarefa(ctx, e.tarefa_id);
  if (!c.ok) return semAuditoria(c.resposta);
  const t = c.tarefa;

  const lembrete = recusarSeLembrete(t);
  if (lembrete) return lembrete;

  const r = await consultar(() =>
    supabase
      .from("tarefa_checklist_itens")
      .select("id, texto, concluido")
      .eq("tarefa_id", t.id)
      .order("criado_em", { ascending: true }),
  );
  if (!r.ok) return semAuditoria(r.resposta);
  const itens = (r.dados ?? []) as Array<{ id: string; texto: string; concluido: boolean }>;

  // Procuro só dentro DESTA tarefa: um id de item de outra tarefa não serve,
  // mesmo que exista.
  const busca = e.item.trim();
  let achados: typeof itens;
  if (ehUuid(busca)) achados = itens.filter((i) => i.id === busca);
  else {
    const alvo = normalizar(busca);
    const exatos = itens.filter((i) => normalizar(i.texto) === alvo);
    achados = exatos.length > 0 ? exatos : itens.filter((i) => normalizar(i.texto).includes(alvo));
  }

  if (achados.length === 0) {
    return semAuditoria(
      erro(
        `Não achei item ${citar(busca, 80)} na checklist de ${citar(t.titulo)}. ` +
          "Use ver_tarefa para ver os itens e seus ids.",
      ),
    );
  }
  if (achados.length > 1) {
    const lista = achados.map((i) => `${citar(i.texto, 80)} (id ${i.id})`).join("; ");
    return semAuditoria(
      erro(`Mais de um item casa com ${citar(busca, 80)}: ${lista}. Pergunte ao usuário qual.`),
    );
  }

  const item = achados[0]!;
  const argumentos = { item_id: item.id, concluido: e.concluido };
  const saida = { tarefa_id: t.id, item_id: item.id, texto: item.texto, concluido: e.concluido };
  const estado = e.concluido ? "feito" : "não feito";

  if (item.concluido === e.concluido) {
    return {
      resposta: ok(
        `Nada mudou: o item ${citar(item.texto, 200)} já estava como ${estado}.` + rodapeDeDados(),
        { resultado: "sem_mudanca", ...saida },
      ),
      auditoria: { resultado: "sem_mudanca", tarefaId: t.id, ids: [item.id], argumentos },
    };
  }

  const up = await consultar(() =>
    supabase
      .from("tarefa_checklist_itens")
      .update({ concluido: e.concluido })
      .eq("id", item.id)
      .eq("tarefa_id", t.id)
      .select("id"),
  );
  if (!up.ok) return recusaDoBanco(up, { tarefaId: t.id, ids: [item.id], argumentos });
  if (((up.dados ?? []) as unknown[]).length === 0) {
    return {
      resposta: erro("O CRM não permite essa alteração para a sua conta. Nada foi gravado."),
      auditoria: {
        resultado: "negado",
        tarefaId: t.id,
        ids: [item.id],
        argumentos,
        detalhe: "update afetou 0 linhas",
      },
    };
  }

  return {
    resposta: ok(
      `Item ${citar(item.texto, 200)} marcado como ${estado} na tarefa ${citar(t.titulo)}.` +
        rodapeDeDados(),
      { resultado: "marcado", ...saida },
    ),
    auditoria: { resultado: "ok", tarefaId: t.id, ids: [item.id], argumentos },
  };
}
