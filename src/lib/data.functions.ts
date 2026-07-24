import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getEmailSettings, sendEmail, logEmail, msgConvite } from "./email.server";

const SITE_URL = "https://xn--gestomde-uza.tec.br";

/* ---------------- Helpers ---------------- */

function colorFromId(id: string): string {
  const palette = ["#7B68EE", "#3B82F6", "#22C55E", "#F97316", "#EF4444", "#F59E0B", "#06B6D4", "#EC4899"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function initialsFromName(nome: string): string {
  const parts = nome.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function toDateOnly(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

/** Vencimento vale até o fim do dia (23:59:59 no horário de Brasília, UTC-3), não a partir da meia-noite. */
function toTimestamp(yyyymmdd: string | undefined | null): string | null {
  if (!yyyymmdd) return null;
  return new Date(`${yyyymmdd}T23:59:59.000-03:00`).toISOString();
}

/** Tolera valores de status legados/inesperados que não existam mais no enum. */
function normalizeStatus(raw: string): "Pendente" | "Em Progresso" | "Em Análise" | "Concluído" {
  return raw === "Pendente" || raw === "Em Progresso" || raw === "Em Análise" || raw === "Concluído"
    ? raw
    : "Pendente";
}

/** Tolera valores de complexidade legados/inesperados que não existam mais no enum. */
function normalizeComplexidade(raw: string): "Fácil" | "Média" | "Difícil" {
  return raw === "Fácil" || raw === "Média" || raw === "Difícil" ? raw : "Média";
}

/* ---------------- Read: full dashboard data ---------------- */

export const getDashboardData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [profilesRes, clientesRes, tarefasRes, respRes, comentariosRes, checklistRes, planosRes, transRes, projetosRes] = await Promise.all([
      supabase.from("perfis_usuarios").select("id, nome, email, avatar_url, cargo, status, criado_em"),
      supabase.from("clientes").select("id, nome_empresa, plano, endereco, documento, email, contrato_url, status").order("nome_empresa"),
      supabase
        .from("tarefas")
        .select("id, cliente_id, projeto_id, titulo, status, prioridade, complexidade, data_vencimento, descricao, tipo, escopo, criado_por, concluido_em")
        .order("data_criacao", { ascending: false }),
      supabase.from("tarefa_responsaveis").select("tarefa_id, usuario_id, criado_em"),
      supabase.from("comentarios_tarefa").select("id, tarefa_id, usuario_id, conteudo, criado_em").order("criado_em"),
      supabase.from("tarefa_checklist_itens").select("id, tarefa_id, texto, concluido, criado_em").order("criado_em"),
      supabase.from("configuracoes_planos").select("id, nome_plano, valor_mensal, servicos_inclusos").order("valor_mensal"),
      supabase.from("financeiro_transacoes").select("id, cliente_id, tipo, descricao, valor, data_pagamento").order("data_pagamento", { ascending: false }),
      supabase.from("projetos").select("id, nome").order("nome"),
    ]);

    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (clientesRes.error) throw new Error(clientesRes.error.message);
    if (tarefasRes.error) throw new Error(tarefasRes.error.message);
    if (respRes.error) throw new Error(respRes.error.message);
    if (comentariosRes.error) throw new Error(comentariosRes.error.message);
    if (checklistRes.error) throw new Error(checklistRes.error.message);
    if (planosRes.error) throw new Error(planosRes.error.message);
    if (transRes.error) throw new Error(transRes.error.message);
    if (projetosRes.error) throw new Error(projetosRes.error.message);

    const profiles = (profilesRes.data ?? []).filter((p) => (p.cargo as string) !== "Cliente");
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    const membros = profiles.map((p) => ({
      id: p.id,
      nome: p.nome,
      iniciais: initialsFromName(p.nome),
      cor: colorFromId(p.id),
      email: p.email,
      avatar_url: p.avatar_url ?? null,
      cargo: p.cargo as "Admin" | "Supervisor" | "Membro",
      status: (p.status ?? "ativo") as "ativo" | "inativo",
      criado_em: p.criado_em,
    }));
    const memberByIniciais = new Map(membros.map((m) => [m.iniciais, m]));

    const respByTarefa = new Map<string, Array<{ usuario_id: string; criado_em: string }>>();
    for (const r of respRes.data ?? []) {
      const arr = respByTarefa.get(r.tarefa_id) ?? [];
      arr.push({ usuario_id: r.usuario_id, criado_em: r.criado_em });
      respByTarefa.set(r.tarefa_id, arr);
    }

    const comentariosByTarefa = new Map<string, Array<{ id: string; autor: { nome: string; iniciais: string; cor: string }; conteudo: string; criado_em: string }>>();
    for (const c of comentariosRes.data ?? []) {
      const profile = profileById.get(c.usuario_id);
      const nome = profile?.nome ?? "Usuário";
      const iniciais = initialsFromName(nome);
      const arr = comentariosByTarefa.get(c.tarefa_id) ?? [];
      arr.push({
        id: c.id,
        autor: { nome, iniciais, cor: colorFromId(c.usuario_id) },
        conteudo: c.conteudo,
        criado_em: c.criado_em,
      });
      comentariosByTarefa.set(c.tarefa_id, arr);
    }

    const checklistByTarefa = new Map<string, Array<{ id: string; texto: string; concluido: boolean }>>();
    for (const item of checklistRes.data ?? []) {
      const arr = checklistByTarefa.get(item.tarefa_id) ?? [];
      arr.push({ id: item.id, texto: item.texto, concluido: item.concluido });
      checklistByTarefa.set(item.tarefa_id, arr);
    }

    const clientes = (clientesRes.data ?? []).map((c) => ({
      id: c.id,
      nome_empresa: c.nome_empresa,
      plano: c.plano,
      cor: colorFromId(c.id),
      endereco: c.endereco ?? undefined,
      documento: c.documento ?? undefined,
      email: c.email ?? undefined,
      contrato_url: c.contrato_url ?? null,
      status: (c.status ?? "ativo") as "ativo" | "inativo",
    }));

    const activeClientIds = new Set(
      (clientesRes.data ?? [])
        .filter((c) => (c.status ?? "ativo") === "ativo")
        .map((c) => c.id)
    );

    // Membros comuns só enxergam tarefas em que estão designados como
    // responsáveis; Admins e Supervisores continuam vendo tudo. Lembretes têm
    // sua própria regra de visibilidade (geral/pessoal) aplicada no front-end,
    // então ficam de fora desse filtro.
    const meuCargo = (profileById.get(userId)?.cargo as string) ?? "Membro";
    const isAdminLike = meuCargo === "Admin" || meuCargo === "Supervisor";

    const tarefas = (tarefasRes.data ?? [])
      .filter((t) => {
        if (!t.cliente_id) return true;
        return activeClientIds.has(t.cliente_id);
      })
      .map((t) => {
        const resps = respByTarefa.get(t.id) ?? [];
        const responsaveis = resps
          .map((r) => {
            const profile = profileById.get(r.usuario_id);
            if (!profile) return null;
            return {
              id: profile.id,
              nome: profile.nome,
              iniciais: initialsFromName(profile.nome),
              atribuido_em: r.criado_em,
            };
          })
          .filter(
            (x): x is { id: string; nome: string; iniciais: string; atribuido_em: string } => x !== null,
          );
        const criadoPorProfile = t.criado_por ? profileById.get(t.criado_por) : undefined;
        return {
          id: t.id,
          cliente_id: t.cliente_id ?? "",
          projeto_id: t.projeto_id ?? null,
          titulo: t.titulo,
          status: normalizeStatus(t.status),
          prioridade: t.prioridade,
          complexidade: normalizeComplexidade(t.complexidade),
          responsaveis,
          data_vencimento: toDateOnly(t.data_vencimento),
          concluido_em: t.concluido_em ?? null,
          descricao: t.descricao ?? undefined,
          tipo: t.tipo,
          escopo: t.escopo,
          criado_por: criadoPorProfile ? initialsFromName(criadoPorProfile.nome) : undefined,
          comentarios: comentariosByTarefa.get(t.id) ?? [],
          checklist: checklistByTarefa.get(t.id) ?? [],
        };
      })
      .filter((t) => {
        if (isAdminLike) return true;
        if ((t.tipo ?? "tarefa") === "lembrete") return true;
        return t.responsaveis.some((r) => r.id === userId);
      });

    const meProfile = profileById.get(userId);
    const me = meProfile
      ? {
          id: meProfile.id,
          nome: meProfile.nome,
          email: meProfile.email,
          avatar_url: meProfile.avatar_url ?? null,
          iniciais: initialsFromName(meProfile.nome),
        }
      : { id: userId, nome: "Você", email: "", avatar_url: null as string | null, iniciais: "EU" };

    const planos = (planosRes.data ?? []).map((p) => ({
      id: p.id,
      nome_plano: p.nome_plano as "Bronze" | "Prata" | "Ouro" | "Diamond",
      valor_mensal: Number(p.valor_mensal),
      servicos_inclusos: Array.isArray(p.servicos_inclusos)
        ? (p.servicos_inclusos as string[])
        : [],
    }));

    const transacoes = (transRes.data ?? []).map((t) => ({
      id: t.id,
      cliente_id: t.cliente_id ?? null,
      tipo: t.tipo as "mensalidade_plano" | "servico_avulso",
      descricao: t.descricao,
      valor: Number(t.valor),
      data_pagamento: t.data_pagamento,
    }));

    const projetos = (projetosRes.data ?? []).map((p) => ({ id: p.id, nome: p.nome }));

    return { me, membros, clientes, tarefas, planos, transacoes, projetos };
  });

/* ---------------- Mutations ---------------- */

const createSchema = z.object({
  cliente_id: z.string().uuid().nullable().optional(),
  projeto_id: z.string().uuid().nullable().optional(),
  titulo: z.string().min(1).max(500),
  status: z.enum(["Pendente", "Em Progresso", "Em Análise", "Concluído"]).default("Pendente"),
  prioridade: z.enum(["Alta", "Média", "Baixa", "Nenhuma"]).default("Nenhuma"),
  complexidade: z.enum(["Fácil", "Média", "Difícil"]).default("Média"),
  data_vencimento: z.string().optional(),
  descricao: z.string().max(5000).optional(),
  tipo: z.enum(["tarefa", "lembrete"]).default("tarefa"),
  escopo: z.enum(["geral", "pessoal"]).default("geral"),
  responsavel_ids: z.array(z.string().uuid()).default([]),
});

export const createTarefa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (data.status === "Concluído") {
      const { data: me } = await supabase.from("perfis_usuarios").select("cargo").eq("id", userId).maybeSingle();
      if ((me?.cargo as string) !== "Admin") {
        throw new Error("Apenas Admins podem marcar tarefas como concluídas.");
      }
    }

    const isLembrete = data.tipo === "lembrete";
    const insertPayload = {
      cliente_id: isLembrete ? null : (data.cliente_id ?? null),
      projeto_id: isLembrete ? null : (data.projeto_id ?? null),
      titulo: data.titulo,
      status: data.status,
      prioridade: data.prioridade,
      complexidade: data.complexidade,
      data_vencimento: toTimestamp(data.data_vencimento),
      descricao: data.descricao ?? null,
      tipo: data.tipo,
      escopo: isLembrete ? data.escopo : ("geral" as const),
      criado_por: userId,
    };

    const { data: nova, error } = await supabase.from("tarefas").insert(insertPayload).select("id").single();
    if (error || !nova) throw new Error(error?.message ?? "Falha ao criar tarefa");

    if (!isLembrete && data.responsavel_ids.length > 0) {
      const rows = data.responsavel_ids.map((uid) => ({ tarefa_id: nova.id, usuario_id: uid }));
      const { error: respErr } = await supabase.from("tarefa_responsaveis").insert(rows);
      if (respErr) throw new Error(respErr.message);
    }

    return { id: nova.id };
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  patch: z.object({
    titulo: z.string().min(1).max(500).optional(),
    status: z.enum(["Pendente", "Em Progresso", "Em Análise", "Concluído"]).optional(),
    prioridade: z.enum(["Alta", "Média", "Baixa", "Nenhuma"]).optional(),
    complexidade: z.enum(["Fácil", "Média", "Difícil"]).optional(),
    data_vencimento: z.string().optional(),
    descricao: z.string().max(5000).optional(),
    projeto_id: z.string().uuid().nullable().optional(),
    responsavel_ids: z.array(z.string().uuid()).optional(),
  }),
});

export const updateTarefa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { id, patch } = data;

    if (patch.status === "Concluído") {
      const { data: me } = await supabase.from("perfis_usuarios").select("cargo").eq("id", userId).maybeSingle();
      if ((me?.cargo as string) !== "Admin") {
        throw new Error("Apenas Admins podem marcar tarefas como concluídas.");
      }
    }

    const dbPatch: Partial<{
      titulo: string;
      status: "Pendente" | "Em Progresso" | "Em Análise" | "Concluído";
      prioridade: "Alta" | "Média" | "Baixa" | "Nenhuma";
      complexidade: "Fácil" | "Média" | "Difícil";
      descricao: string | null;
      data_vencimento: string | null;
      projeto_id: string | null;
    }> = {};
    if (patch.titulo !== undefined) dbPatch.titulo = patch.titulo;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.prioridade !== undefined) dbPatch.prioridade = patch.prioridade;
    if (patch.complexidade !== undefined) dbPatch.complexidade = patch.complexidade;
    if (patch.descricao !== undefined) dbPatch.descricao = patch.descricao;
    if (patch.data_vencimento !== undefined) dbPatch.data_vencimento = toTimestamp(patch.data_vencimento);
    if (patch.projeto_id !== undefined) dbPatch.projeto_id = patch.projeto_id;

    if (Object.keys(dbPatch).length > 0) {
      const { error } = await supabase.from("tarefas").update(dbPatch).eq("id", id);
      if (error) throw new Error(error.message);
    }

    if (patch.responsavel_ids !== undefined) {
      // Diff em vez de apagar-tudo-e-reinserir: preserva o "atribuido_em" (criado_em)
      // de quem continua responsável — só quem realmente entra ganha timestamp novo.
      const { data: atuais, error: getErr } = await supabase
        .from("tarefa_responsaveis")
        .select("usuario_id")
        .eq("tarefa_id", id);
      if (getErr) throw new Error(getErr.message);

      const atuaisIds = new Set((atuais ?? []).map((r) => r.usuario_id));
      const novosIds = new Set(patch.responsavel_ids);
      const paraRemover = [...atuaisIds].filter((uid) => !novosIds.has(uid));
      const paraAdicionar = [...novosIds].filter((uid) => !atuaisIds.has(uid));

      if (paraRemover.length > 0) {
        const { error: delErr } = await supabase
          .from("tarefa_responsaveis")
          .delete()
          .eq("tarefa_id", id)
          .in("usuario_id", paraRemover);
        if (delErr) throw new Error(delErr.message);
      }

      if (paraAdicionar.length > 0) {
        const rows = paraAdicionar.map((uid) => ({ tarefa_id: id, usuario_id: uid }));
        const { error: insErr } = await supabase.from("tarefa_responsaveis").insert(rows);
        if (insErr) throw new Error(insErr.message);
      }
    }

    return { ok: true };
  });

const comentarioSchema = z.object({
  tarefa_id: z.string().uuid(),
  conteudo: z.string().min(1).max(5000),
});

export const addComentario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => comentarioSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("comentarios_tarefa").insert({
      tarefa_id: data.tarefa_id,
      usuario_id: userId,
      conteudo: data.conteudo,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const addChecklistItemSchema = z.object({
  tarefa_id: z.string().uuid(),
  texto: z.string().trim().min(1).max(500),
});

export const addChecklistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => addChecklistItemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: novo, error } = await supabase
      .from("tarefa_checklist_itens")
      .insert({ tarefa_id: data.tarefa_id, texto: data.texto })
      .select("id")
      .single();
    if (error || !novo) throw new Error(error?.message ?? "Falha ao adicionar item");
    return { id: novo.id };
  });

const toggleChecklistItemSchema = z.object({
  id: z.string().uuid(),
  concluido: z.boolean(),
});

export const toggleChecklistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => toggleChecklistItemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("tarefa_checklist_itens")
      .update({ concluido: data.concluido })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const deleteChecklistItemSchema = z.object({ id: z.string().uuid() });

export const deleteChecklistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deleteChecklistItemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("tarefa_checklist_itens").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const deleteSchema = z.object({ id: z.string().uuid() });

export const deleteTarefa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await supabase.from("tarefa_responsaveis").delete().eq("tarefa_id", data.id);
    await supabase.from("comentarios_tarefa").delete().eq("tarefa_id", data.id);
    const { error } = await supabase.from("tarefas").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Convites (invite-only) ---------------- */

const convitesSchema = z.object({
  emails: z.array(z.string().trim().toLowerCase().email()).min(1).max(20),
  cargo: z.enum(["Membro", "Admin", "Supervisor", "Cliente"]),
  cliente_id: z.string().uuid().nullable().optional(),
});

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("perfis_usuarios")
      .select("cargo, nome, email")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { cargo: (data?.cargo ?? "Membro") as "Admin" | "Supervisor" | "Membro", nome: data?.nome ?? "", email: data?.email ?? "" };
  });

/** Contexto do usuário logado para decidir se ele cai no portal do cliente ou no painel interno. */
export const getMyPortalContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("perfis_usuarios")
      .select("nome, email, cargo, cliente_id, clientes:cliente_id(nome_empresa, plano)")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const cli = data?.clientes as { nome_empresa: string; plano: string } | null;
    return {
      nome: data?.nome ?? "",
      email: data?.email ?? "",
      cargo: (data?.cargo ?? "Membro") as string,
      cliente_id: data?.cliente_id ?? null,
      cliente_nome: cli?.nome_empresa ?? null,
      plano: cli?.plano ?? null,
    };
  });

export const createInvites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => convitesSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const rows = data.emails.map((email) => ({
      email,
      cargo: data.cargo,
      convidado_por: userId,
      status: "pendente",
      cliente_id: data.cargo === "Cliente" ? (data.cliente_id ?? null) : null,
    }));

    const { error } = await supabase
      .from("convites")
      .upsert(rows, { onConflict: "email" });

    if (error) {
      if (error.code === "42501" || /row-level security/i.test(error.message)) {
        throw new Error("Apenas Admins podem enviar convites.");
      }
      throw new Error(error.message);
    }

    const { data: convidador } = await supabase
      .from("perfis_usuarios")
      .select("nome")
      .eq("id", userId)
      .maybeSingle();

    const settings = await getEmailSettings();
    let emailsEnviados = 0;
    for (const email of data.emails) {
      const { assunto, html, text } = msgConvite({
        cargo: data.cargo,
        convidadoPor: convidador?.nome ?? null,
        signupUrl: `${SITE_URL}/signup`,
      });
      const result = await sendEmail(email, assunto, html, text, settings);
      await logEmail({
        tarefa_id: null,
        usuario_id: null,
        destinatario: email,
        tipo: "convite",
        assunto,
        mensagem: text,
        result,
      });
      if (result.ok) emailsEnviados++;
    }

    return { ok: true, count: rows.length, emailsEnviados };
  });

const deleteInviteSchema = z.object({ id: z.string().uuid() });

/** Admin: cancela/exclui um convite pendente. */
export const deleteInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deleteInviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("convites").delete().eq("id", data.id);
    if (error) {
      if (error.code === "42501" || /row-level security/i.test(error.message)) {
        throw new Error("Apenas Admins podem excluir convites.");
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

const updateMemberRoleSchema = z.object({
  user_id: z.string().uuid(),
  cargo: z.enum(["Admin", "Supervisor", "Membro"]),
});

export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateMemberRoleSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: me } = await supabase
      .from("perfis_usuarios")
      .select("cargo")
      .eq("id", userId)
      .maybeSingle();
    if ((me?.cargo as string) !== "Admin") {
      throw new Error("Apenas Admins podem alterar cargos.");
    }
    if (data.user_id === userId) {
      throw new Error("Você não pode alterar seu próprio cargo.");
    }

    const { error } = await supabase
      .from("perfis_usuarios")
      .update({ cargo: data.cargo })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const setMemberStatusSchema = z.object({
  user_id: z.string().uuid(),
  status: z.enum(["ativo", "inativo"]),
});

/** Admin: ativa/inativa um membro. Inativo continua com histórico intacto, só perde acesso. */
export const setMemberStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => setMemberStatusSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: me } = await supabase
      .from("perfis_usuarios")
      .select("cargo")
      .eq("id", userId)
      .maybeSingle();
    if ((me?.cargo as string) !== "Admin") {
      throw new Error("Apenas Admins podem inativar ou reativar membros.");
    }
    if (data.user_id === userId) {
      throw new Error("Você não pode inativar sua própria conta.");
    }

    const { error } = await supabase
      .from("perfis_usuarios")
      .update({ status: data.status })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const deleteMemberSchema = z.object({ user_id: z.string().uuid() });

/** Admin: exclui a conta do membro por completo (auth.users cascateia perfil, tarefas atribuídas e comentários). */
export const deleteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deleteMemberSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: me } = await supabase
      .from("perfis_usuarios")
      .select("cargo")
      .eq("id", userId)
      .maybeSingle();
    if ((me?.cargo as string) !== "Admin") {
      throw new Error("Apenas Admins podem excluir membros.");
    }
    if (data.user_id === userId) {
      throw new Error("Você não pode excluir sua própria conta.");
    }

    const { data: alvo } = await supabase
      .from("perfis_usuarios")
      .select("cargo")
      .eq("id", data.user_id)
      .maybeSingle();
    if (alvo?.cargo === "Admin") {
      const { count } = await supabase
        .from("perfis_usuarios")
        .select("id", { count: "exact", head: true })
        .eq("cargo", "Admin");
      if ((count ?? 0) <= 1) {
        throw new Error("Não é possível excluir o único Admin restante.");
      }
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Clientes ---------------- */

const clienteSchema = z.object({
  nome_empresa: z.string().trim().min(1).max(200),
  plano: z.enum(["Bronze", "Prata", "Ouro", "Diamond"]).default("Bronze"),
  endereco: z.string().trim().max(500).optional(),
  documento: z.string().trim().max(32).optional(),
  email: z.string().trim().toLowerCase().email().max(255).optional().or(z.literal("")),
  contrato_url: z.string().trim().max(1000).optional(),
});

export const createCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => clienteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: novo, error } = await supabase
      .from("clientes")
      .insert({
        nome_empresa: data.nome_empresa,
        plano: data.plano,
        endereco: data.endereco || null,
        documento: data.documento || null,
        email: data.email ? data.email : null,
        contrato_url: data.contrato_url || null,
        criado_por: userId,
      })
      .select("id")
      .single();
    if (error || !novo) throw new Error(error?.message ?? "Falha ao cadastrar cliente");
    return { id: novo.id };
  });

/* ---------------- Status do cliente ---------------- */

const setStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["ativo", "inativo"]),
});

export const setClienteStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => setStatusSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("clientes")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Exclusão de cliente ---------------- */

const deleteClienteSchema = z.object({ id: z.string().uuid() });

export const deleteCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deleteClienteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("clientes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Atualização de cliente ---------------- */

const updateClienteSchema = z.object({
  id: z.string().uuid(),
  patch: z.object({
    nome_empresa: z.string().trim().min(1).max(200).optional(),
    plano: z.enum(["Bronze", "Prata", "Ouro", "Diamond"]).optional(),
    endereco: z.string().trim().max(500).nullable().optional(),
    documento: z.string().trim().max(32).nullable().optional(),
    email: z.string().trim().toLowerCase().email().max(255).nullable().optional().or(z.literal("")),
    contrato_url: z.string().trim().max(1000).nullable().optional(),
  }),
});

export const updateCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateClienteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const patch: {
      nome_empresa?: string;
      plano?: "Bronze" | "Prata" | "Ouro" | "Diamond";
      endereco?: string | null;
      documento?: string | null;
      email?: string | null;
      contrato_url?: string | null;
    } = {};
    const p = data.patch;
    if (p.nome_empresa !== undefined) patch.nome_empresa = p.nome_empresa;
    if (p.plano !== undefined) patch.plano = p.plano;
    if (p.endereco !== undefined) patch.endereco = p.endereco || null;
    if (p.documento !== undefined) patch.documento = p.documento || null;
    if (p.email !== undefined) patch.email = p.email ? p.email : null;
    if (p.contrato_url !== undefined) patch.contrato_url = p.contrato_url || null;
    const { error } = await supabase.from("clientes").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Planos ---------------- */

const updatePlanoSchema = z.object({
  id: z.string().uuid(),
  valor_mensal: z.number().min(0).max(1_000_000).optional(),
  servicos_inclusos: z.array(z.string().min(1).max(200)).max(50).optional(),
});

export const updatePlano = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updatePlanoSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const patch: {
      atualizado_em: string;
      valor_mensal?: number;
      servicos_inclusos?: string[];
    } = { atualizado_em: new Date().toISOString() };
    if (data.valor_mensal !== undefined) patch.valor_mensal = data.valor_mensal;
    if (data.servicos_inclusos !== undefined) patch.servicos_inclusos = data.servicos_inclusos;
    const { error } = await supabase.from("configuracoes_planos").update(patch).eq("id", data.id);
    if (error) {
      if (error.code === "42501" || /row-level security/i.test(error.message)) {
        throw new Error("Apenas Admins podem editar planos.");
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

/* ---------------- Financeiro ---------------- */

const avulsoSchema = z.object({
  cliente_id: z.string().uuid(),
  descricao: z.string().trim().min(1).max(300),
  valor: z.number().min(0).max(10_000_000),
  data_pagamento: z.string().optional(),
});

export const addServicoAvulso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => avulsoSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("financeiro_transacoes").insert({
      cliente_id: data.cliente_id,
      tipo: "servico_avulso",
      descricao: data.descricao,
      valor: data.valor,
      data_pagamento: data.data_pagamento
        ? new Date(data.data_pagamento).toISOString()
        : new Date().toISOString(),
      criado_por: userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const deleteTransSchema = z.object({ id: z.string().uuid() });

export const deleteTransacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deleteTransSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("financeiro_transacoes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });