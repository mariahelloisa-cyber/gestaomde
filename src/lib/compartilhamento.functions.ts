import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  colorFromId,
  initialsFromName,
  normalizeComplexidade,
  normalizeStatus,
  toDateOnly,
} from "./data.functions";

/* ---------------- Tipos compartilhados com o front ---------------- */

export type CompartilhamentoTipo = "tarefa" | "coluna";

export interface CompartilhamentoResumo {
  id: string;
  token: string;
  criado_em: string;
  expira_em: string | null;
  acessos: number;
  ultimo_acesso_em: string | null;
  criado_por_nome: string | null;
}

export interface CompartilhadoTarefa {
  id: string;
  /** Lembretes (inclusive os pessoais do Mural) também podem ser compartilhados. */
  tipo: "tarefa" | "lembrete";
  titulo: string;
  descricao?: string;
  status: "Pendente" | "Em Progresso" | "Em Análise" | "Concluído";
  prioridade: "Alta" | "Média" | "Baixa" | "Nenhuma";
  complexidade: "Fácil" | "Média" | "Difícil";
  data_vencimento: string;
  concluido_em: string | null;
  cliente: { nome_empresa: string; cor: string } | null;
  projeto: string | null;
  responsaveis: { id: string; nome: string; iniciais: string; cor: string }[];
  checklist: { id: string; texto: string; concluido: boolean }[];
  comentarios: {
    id: string;
    autor: { nome: string; iniciais: string; cor: string };
    conteudo: string;
    criado_em: string;
  }[];
  audio: { nome_arquivo: string; url: string | null } | null;
  video: { nome_arquivo: string; url: string | null } | null;
  anexos: { nome_arquivo: string; url: string | null }[];
}

export interface CompartilhadoPayload {
  tipo: CompartilhamentoTipo;
  /** Título do cabeçalho: nome da tarefa, ou rótulo da coluna ("Em Andamento"). */
  titulo: string;
  /** Linha de contexto: empresa e/ou responsável a que o bloco está restrito. */
  subtitulo: string | null;
  status: "Pendente" | "Em Progresso" | "Em Análise" | "Concluído" | null;
  tarefas: CompartilhadoTarefa[];
  expira_em: string | null;
}

/* ---------------- Criação / gestão (autenticado) ---------------- */

const alvoSchema = z
  .object({
    tipo: z.enum(["tarefa", "coluna"]),
    tarefaId: z.string().uuid().optional(),
    status: z.enum(["Pendente", "Em Progresso", "Em Análise", "Concluído"]).optional(),
    clienteId: z.string().uuid().nullish(),
    membroId: z.string().uuid().nullish(),
  })
  .refine((v) => (v.tipo === "tarefa" ? !!v.tarefaId : !!v.status), {
    message: "Informe a tarefa (tipo=tarefa) ou o status da coluna (tipo=coluna).",
  });

const criarSchema = z.object({
  tipo: z.enum(["tarefa", "coluna"]),
  tarefaId: z.string().uuid().optional(),
  status: z.enum(["Pendente", "Em Progresso", "Em Análise", "Concluído"]).optional(),
  clienteId: z.string().uuid().nullish(),
  membroId: z.string().uuid().nullish(),
  expiraEmDias: z.union([z.literal(7), z.literal(30), z.null()]).default(30),
});

type Alvo = z.infer<typeof alvoSchema>;

/** Qualquer usuário interno logado pode gerar um link — o link nunca mostra mais
 * do que quem o gerou já enxerga no app (ver o filtro de visibilidade abaixo). */
export const criarCompartilhamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => criarSchema.parse(input))
  .handler(async ({ data, context }): Promise<CompartilhamentoResumo> => {
    const { supabase, userId } = context;

    if (data.tipo === "tarefa") {
      if (!data.tarefaId) throw new Error("Informe a tarefa a compartilhar.");
      // O próprio RLS decide se esta pessoa pode ver (e portanto compartilhar) a tarefa.
      const { data: t, error } = await supabase
        .from("tarefas")
        .select("id")
        .eq("id", data.tarefaId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!t) throw new Error("Tarefa não encontrada ou sem permissão para compartilhar.");
    } else if (!data.status) {
      throw new Error("Informe o status da coluna a compartilhar.");
    }

    const expira_em =
      data.expiraEmDias === null
        ? null
        : new Date(Date.now() + data.expiraEmDias * 86400000).toISOString();

    const { data: novo, error } = await supabase
      .from("compartilhamentos")
      .insert({
        tipo: data.tipo,
        tarefa_id: data.tipo === "tarefa" ? data.tarefaId! : null,
        status: data.tipo === "coluna" ? data.status! : null,
        cliente_id: data.tipo === "coluna" ? (data.clienteId ?? null) : null,
        membro_id: data.tipo === "coluna" ? (data.membroId ?? null) : null,
        criado_por: userId,
        expira_em,
      })
      .select("id, token, criado_em, expira_em, acessos, ultimo_acesso_em")
      .single();
    if (error) throw new Error(error.message);

    const { data: perfil } = await supabase
      .from("perfis_usuarios")
      .select("nome")
      .eq("id", userId)
      .maybeSingle();

    return { ...novo, criado_por_nome: perfil?.nome ?? null };
  });

/** Links ativos (não revogados e não expirados) já emitidos para o mesmo alvo. */
export const listarCompartilhamentos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => alvoSchema.parse(input))
  .handler(async ({ data, context }): Promise<CompartilhamentoResumo[]> => {
    const alvo: Alvo = data;
    let query = context.supabase
      .from("compartilhamentos")
      .select("id, token, criado_em, expira_em, acessos, ultimo_acesso_em, criado_por")
      .is("revogado_em", null)
      .eq("tipo", alvo.tipo);

    if (alvo.tipo === "tarefa") {
      query = query.eq("tarefa_id", alvo.tarefaId!);
    } else {
      query = query.eq("status", alvo.status!);
      query = alvo.clienteId
        ? query.eq("cliente_id", alvo.clienteId)
        : query.is("cliente_id", null);
      query = alvo.membroId ? query.eq("membro_id", alvo.membroId) : query.is("membro_id", null);
    }

    const { data: rows, error } = await query.order("criado_em", { ascending: false });
    if (error) throw new Error(error.message);

    const agora = Date.now();
    const ativos = (rows ?? []).filter(
      (r) => !r.expira_em || new Date(r.expira_em).getTime() > agora,
    );
    if (ativos.length === 0) return [];

    const autores = [...new Set(ativos.map((a) => a.criado_por).filter((x): x is string => !!x))];
    const { data: perfis } = await context.supabase
      .from("perfis_usuarios")
      .select("id, nome")
      .in("id", autores);
    const nomePorId = new Map((perfis ?? []).map((p) => [p.id, p.nome]));

    return ativos.map(({ criado_por, ...r }) => ({
      ...r,
      criado_por_nome: criado_por ? (nomePorId.get(criado_por) ?? null) : null,
    }));
  });

/** Desliga o link imediatamente — quem já recebeu passa a ver "link inválido". */
export const revogarCompartilhamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("compartilhamentos")
      .update({ revogado_em: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Leitura pública (sem login) ---------------- */

const COLUNA_LABEL: Record<string, string> = {
  Pendente: "Pendentes",
  "Em Progresso": "Em Andamento",
  "Em Análise": "Em Análise",
  Concluído: "Concluídas",
};

/** Mesma janela de 7 dias do app: concluídas antigas saem do Kanban. */
function jaFinalizada(status: string, concluido_em: string | null): boolean {
  if (status !== "Concluído" || !concluido_em) return false;
  return (Date.now() - new Date(concluido_em).getTime()) / 86400000 >= 7;
}

const COLUNAS_TAREFA =
  "id, tipo, cliente_id, projeto_id, titulo, status, prioridade, complexidade, data_vencimento, descricao, concluido_em, audio, anexos, video";

/** Sem autenticação — validado só pelo token opaco. Somente leitura: devolve o
 * conteúdo da tarefa como ela aparece no app (descrição, checklist, comentários
 * e anexos), nunca contrato, financeiro ou e-mail de ninguém. */
export const getCompartilhamento = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<CompartilhadoPayload> => {
    const { data: link } = await supabaseAdmin
      .from("compartilhamentos")
      .select(
        "id, tipo, tarefa_id, status, cliente_id, membro_id, criado_por, expira_em, revogado_em, acessos",
      )
      .eq("token", data.token)
      .maybeSingle();

    if (!link || link.revogado_em) throw new Error("Link inválido ou revogado.");
    if (link.expira_em && new Date(link.expira_em).getTime() <= Date.now()) {
      throw new Error("Este link expirou.");
    }

    const [perfisRes, clientesRes, projetosRes] = await Promise.all([
      supabaseAdmin.from("perfis_usuarios").select("id, nome, cargo"),
      supabaseAdmin.from("clientes").select("id, nome_empresa, status"),
      supabaseAdmin.from("projetos").select("id, nome"),
    ]);
    const perfilPorId = new Map((perfisRes.data ?? []).map((p) => [p.id, p]));
    const clientePorId = new Map((clientesRes.data ?? []).map((c) => [c.id, c]));
    const projetoPorId = new Map((projetosRes.data ?? []).map((p) => [p.id, p.nome]));
    const clientesAtivos = new Set(
      (clientesRes.data ?? []).filter((c) => (c.status ?? "ativo") === "ativo").map((c) => c.id),
    );

    let brutas: Array<{
      id: string;
      tipo: "tarefa" | "lembrete";
      cliente_id: string | null;
      projeto_id: string | null;
      titulo: string;
      status: string;
      prioridade: "Alta" | "Média" | "Baixa" | "Nenhuma";
      complexidade: string;
      data_vencimento: string | null;
      descricao: string | null;
      concluido_em: string | null;
      audio: unknown;
      anexos: unknown;
      video: unknown;
    }> = [];

    if (link.tipo === "tarefa") {
      const { data: t, error } = await supabaseAdmin
        .from("tarefas")
        .select(COLUNAS_TAREFA)
        .eq("id", link.tarefa_id!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!t) throw new Error("Esta tarefa não existe mais.");
      brutas = [t];
    } else {
      let q = supabaseAdmin
        .from("tarefas")
        .select(COLUNAS_TAREFA)
        .eq("tipo", "tarefa")
        .eq("status", normalizeStatus(link.status!));
      if (link.cliente_id) q = q.eq("cliente_id", link.cliente_id);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      brutas = rows ?? [];
    }

    const ids = brutas.map((t) => t.id);
    const [respRes, checklistRes, comentariosRes] = await Promise.all([
      supabaseAdmin
        .from("tarefa_responsaveis")
        .select("tarefa_id, usuario_id")
        .in("tarefa_id", ids),
      supabaseAdmin
        .from("tarefa_checklist_itens")
        .select("id, tarefa_id, texto, concluido, criado_em")
        .in("tarefa_id", ids)
        .order("criado_em"),
      supabaseAdmin
        .from("comentarios_tarefa")
        .select("id, tarefa_id, usuario_id, conteudo, criado_em")
        .in("tarefa_id", ids)
        .order("criado_em"),
    ]);

    const respPorTarefa = new Map<string, CompartilhadoTarefa["responsaveis"]>();
    for (const r of respRes.data ?? []) {
      const p = perfilPorId.get(r.usuario_id);
      if (!p) continue;
      const arr = respPorTarefa.get(r.tarefa_id) ?? [];
      arr.push({
        id: p.id,
        nome: p.nome,
        iniciais: initialsFromName(p.nome),
        cor: colorFromId(p.id),
      });
      respPorTarefa.set(r.tarefa_id, arr);
    }

    const checklistPorTarefa = new Map<string, CompartilhadoTarefa["checklist"]>();
    for (const i of checklistRes.data ?? []) {
      const arr = checklistPorTarefa.get(i.tarefa_id) ?? [];
      arr.push({ id: i.id, texto: i.texto, concluido: i.concluido });
      checklistPorTarefa.set(i.tarefa_id, arr);
    }

    const comentariosPorTarefa = new Map<string, CompartilhadoTarefa["comentarios"]>();
    for (const c of comentariosRes.data ?? []) {
      const nome = perfilPorId.get(c.usuario_id)?.nome ?? "Usuário";
      const arr = comentariosPorTarefa.get(c.tarefa_id) ?? [];
      arr.push({
        id: c.id,
        autor: { nome, iniciais: initialsFromName(nome), cor: colorFromId(c.usuario_id) },
        conteudo: c.conteudo,
        criado_em: c.criado_em,
      });
      comentariosPorTarefa.set(c.tarefa_id, arr);
    }

    // Um link de coluna nunca mostra mais do que quem o gerou enxerga: Membro
    // comum só vê tarefas em que é responsável, e quem não é Admin não vê
    // tarefas de Admins — as mesmas regras do Kanban autenticado.
    const cargoAutor =
      (link.criado_por ? perfilPorId.get(link.criado_por)?.cargo : null) ?? "Membro";
    const adminIds = new Set(
      (perfisRes.data ?? []).filter((p) => p.cargo === "Admin").map((p) => p.id),
    );
    const visiveis = brutas.filter((t) => {
      if (t.cliente_id && !clientesAtivos.has(t.cliente_id)) return false;
      if (link.tipo === "tarefa") return true;
      if (jaFinalizada(t.status, t.concluido_em)) return false;
      const resps = respPorTarefa.get(t.id) ?? [];
      if (link.membro_id && !resps.some((r) => r.id === link.membro_id)) return false;
      if (cargoAutor === "Membro" && !resps.some((r) => r.id === link.criado_por)) return false;
      if (cargoAutor !== "Admin" && resps.some((r) => adminIds.has(r.id))) return false;
      return true;
    });

    // Áudio, vídeo e anexos vivem em bucket privado: cada carregamento da página
    // gera signed URLs novas (1h), então o link continua funcionando depois.
    const assinar = async (path: string) => {
      const { data: signed } = await supabaseAdmin.storage
        .from("demandas-anexos")
        .createSignedUrl(path, 60 * 60);
      return signed?.signedUrl ?? null;
    };

    const tarefas: CompartilhadoTarefa[] = await Promise.all(
      visiveis.map(async (t) => {
        const audioRaw = t.audio as { path: string; nome_arquivo: string } | null;
        const videoRaw = t.video as { path: string; nome_arquivo: string } | null;
        const anexosRaw = (t.anexos ?? []) as { path: string; nome_arquivo: string }[];
        const [audioUrl, videoUrl, anexos] = await Promise.all([
          audioRaw?.path ? assinar(audioRaw.path) : Promise.resolve(null),
          videoRaw?.path ? assinar(videoRaw.path) : Promise.resolve(null),
          Promise.all(
            anexosRaw.map(async (a) => ({
              nome_arquivo: a.nome_arquivo,
              url: await assinar(a.path),
            })),
          ),
        ]);
        return {
          id: t.id,
          tipo: t.tipo,
          titulo: t.titulo,
          descricao: t.descricao ?? undefined,
          status: normalizeStatus(t.status),
          prioridade: t.prioridade,
          complexidade: normalizeComplexidade(t.complexidade),
          data_vencimento: toDateOnly(t.data_vencimento),
          concluido_em: t.concluido_em ?? null,
          cliente: t.cliente_id
            ? {
                nome_empresa: clientePorId.get(t.cliente_id)?.nome_empresa ?? "Empresa",
                cor: colorFromId(t.cliente_id),
              }
            : null,
          projeto: t.projeto_id ? (projetoPorId.get(t.projeto_id) ?? null) : null,
          responsaveis: respPorTarefa.get(t.id) ?? [],
          checklist: checklistPorTarefa.get(t.id) ?? [],
          comentarios: comentariosPorTarefa.get(t.id) ?? [],
          audio: audioRaw ? { nome_arquivo: audioRaw.nome_arquivo, url: audioUrl } : null,
          video: videoRaw ? { nome_arquivo: videoRaw.nome_arquivo, url: videoUrl } : null,
          anexos,
        };
      }),
    );

    // Contador de acessos é informativo (mostrado a quem gerou o link); falha
    // aqui não pode derrubar a visualização.
    void supabaseAdmin
      .from("compartilhamentos")
      .update({ acessos: (link.acessos ?? 0) + 1, ultimo_acesso_em: new Date().toISOString() })
      .eq("id", link.id)
      .then(() => undefined);

    const clienteDoLink = link.cliente_id ? clientePorId.get(link.cliente_id) : null;
    const membroDoLink = link.membro_id ? perfilPorId.get(link.membro_id) : null;

    return {
      tipo: link.tipo as CompartilhamentoTipo,
      titulo:
        link.tipo === "tarefa"
          ? (tarefas[0]?.titulo ?? "Tarefa")
          : (COLUNA_LABEL[link.status!] ?? link.status!),
      subtitulo:
        link.tipo === "coluna"
          ? [clienteDoLink?.nome_empresa, membroDoLink?.nome].filter(Boolean).join(" · ") || null
          : null,
      status: link.tipo === "coluna" ? normalizeStatus(link.status!) : null,
      tarefas,
      expira_em: link.expira_em,
    };
  });
