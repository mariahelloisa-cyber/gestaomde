import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ---------------- Public: criar demanda externa ---------------- */

const anexoSchema = z.object({
  path: z.string().min(1).max(500),
  nome_arquivo: z.string().min(1).max(255),
});

const audioSchema = z.object({
  path: z.string().min(1).max(500),
  nome_arquivo: z.string().min(1).max(255),
  duracao_seg: z.number().int().min(0).max(600).optional(),
});

const videoSchema = z.object({
  path: z.string().min(1).max(500),
  nome_arquivo: z.string().min(1).max(255),
});

const createDemandaSchema = z.object({
  solicitante_nome: z.string().trim().min(1).max(200),
  solicitante_email: z.string().trim().toLowerCase().email().max(255).optional().or(z.literal("")),
  setor: z.string().trim().max(100).optional(),
  descricao: z.string().trim().min(1).max(5000),
  prazo_sugerido: z.string().optional(),
  anexos: z.array(anexoSchema).max(10).default([]),
  audio: audioSchema.nullable().optional(),
  video: videoSchema.nullable().optional(),
});

export const createDemandaExterna = createServerFn({ method: "POST" })
  .inputValidator((input) => createDemandaSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: nova, error } = await supabaseAdmin
      .from("demandas_externas")
      .insert({
        solicitante_nome: data.solicitante_nome,
        solicitante_email: data.solicitante_email || null,
        setor: data.setor || null,
        responsavel_id: null,
        descricao: data.descricao,
        prazo_sugerido: data.prazo_sugerido || null,
        anexos: data.anexos,
        audio: data.audio ?? null,
        video: data.video ?? null,
        status: "pendente",
      })
      .select("id")
      .single();
    if (error || !nova) throw new Error(error?.message ?? "Falha ao registrar demanda");

    return { id: nova.id };
  });

/* ---------------- Auth: listar demandas com URLs assinadas ---------------- */

export const listDemandas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Só demandas ainda pendentes: aceitas viram tarefa (e somem daqui, ficam só
    // na aba Tarefas) e recusadas são excluídas na hora — nunca aparecem aqui.
    const { data, error } = await supabase
      .from("demandas_externas")
      .select("id, solicitante_nome, solicitante_email, setor, responsavel_id, descricao, prazo_sugerido, anexos, audio, video, status, tarefa_id, criado_em")
      .eq("status", "pendente")
      .order("criado_em", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const enriched = await Promise.all(
      rows.map(async (d) => {
        const anexos = Array.isArray(d.anexos) ? (d.anexos as Array<{ path: string; nome_arquivo: string }>) : [];
        const anexosComUrl = await Promise.all(
          anexos.map(async (a) => {
            const { data: signed } = await supabaseAdmin.storage
              .from("demandas-anexos")
              .createSignedUrl(a.path, 60 * 60);
            return { ...a, url: signed?.signedUrl ?? null };
          }),
        );
        const audio = d.audio as { path: string; nome_arquivo: string; duracao_seg?: number } | null;
        let audioComUrl: (typeof audio & { url: string | null }) | null = null;
        if (audio) {
          const { data: signed } = await supabaseAdmin.storage
            .from("demandas-anexos")
            .createSignedUrl(audio.path, 60 * 60);
          audioComUrl = { ...audio, url: signed?.signedUrl ?? null };
        }
        const video = d.video as { path: string; nome_arquivo: string } | null;
        let videoComUrl: (typeof video & { url: string | null }) | null = null;
        if (video) {
          const { data: signed } = await supabaseAdmin.storage
            .from("demandas-anexos")
            .createSignedUrl(video.path, 60 * 60);
          videoComUrl = { ...video, url: signed?.signedUrl ?? null };
        }
        return { ...d, anexos: anexosComUrl, audio: audioComUrl, video: videoComUrl };
      }),
    );
    return enriched;
  });

/* ---------------- Auth: aceitar (clona em tarefa) ---------------- */

const aceitarSchema = z.object({
  id: z.string().uuid(),
  responsavel_id: z.string().uuid(),
});

export const aceitarDemanda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => aceitarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: dem, error: errDem } = await supabase
      .from("demandas_externas")
      .select("id, solicitante_nome, descricao, prazo_sugerido, responsavel_id, status, tarefa_id, audio, anexos, video")
      .eq("id", data.id)
      .single();
    if (errDem || !dem) throw new Error(errDem?.message ?? "Demanda não encontrada");
    if (dem.status === "recusada") throw new Error("Esta demanda foi recusada.");

    // Se já foi aceita e a tarefa ainda existe, devolve a tarefa atual (idempotente).
    if (dem.status === "aceita" && dem.tarefa_id) {
      const { data: existente } = await supabase
        .from("tarefas")
        .select("id")
        .eq("id", dem.tarefa_id)
        .maybeSingle();
      if (existente) return { tarefa_id: existente.id };
      // Caso contrário (tarefa foi excluída), seguimos para recriá-la abaixo.
    }

    const titulo = `Demanda externa — ${dem.solicitante_nome}`;
    const vencimento = dem.prazo_sugerido
      ? new Date(`${dem.prazo_sugerido}T23:59:59.000-03:00`).toISOString()
      : null;

    const { data: nova, error: errTar } = await supabase
      .from("tarefas")
      .insert({
        titulo,
        descricao: dem.descricao,
        status: "Pendente",
        prioridade: "Média",
        data_vencimento: vencimento,
        tipo: "tarefa",
        escopo: "geral",
        criado_por: userId,
        // Mesma referência de storage da demanda — áudio e anexos não são
        // duplicados, só passam a acompanhar a tarefa também.
        audio: dem.audio ?? null,
        anexos: dem.anexos ?? [],
        video: dem.video ?? null,
      })
      .select("id")
      .single();
    if (errTar || !nova) throw new Error(errTar?.message ?? "Falha ao criar tarefa");

    const { error: errResp } = await supabase
      .from("tarefa_responsaveis")
      .insert({ tarefa_id: nova.id, usuario_id: data.responsavel_id });
    if (errResp) throw new Error(errResp.message);

    const { error: errUpd } = await supabase
      .from("demandas_externas")
      .update({ status: "aceita", tarefa_id: nova.id, responsavel_id: data.responsavel_id, atualizado_em: new Date().toISOString() })
      .eq("id", data.id);
    if (errUpd) throw new Error(errUpd.message);

    return { tarefa_id: nova.id };
  });

/* ---------------- Auth: recusar (remove a demanda por completo) ---------------- */

const recusarSchema = z.object({
  id: z.string().uuid(),
});

export const recusarDemanda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => recusarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: dem } = await supabase
      .from("demandas_externas")
      .select("anexos, audio, video")
      .eq("id", data.id)
      .single();

    const anexos = Array.isArray(dem?.anexos) ? (dem.anexos as Array<{ path: string }>) : [];
    const audio = dem?.audio as { path: string } | null;
    const video = dem?.video as { path: string } | null;
    const paths = [
      ...anexos.map((a) => a.path),
      ...(audio ? [audio.path] : []),
      ...(video ? [video.path] : []),
    ];
    if (paths.length > 0) {
      await supabaseAdmin.storage.from("demandas-anexos").remove(paths);
    }

    const { error } = await supabase.from("demandas_externas").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Auth: transferir ---------------- */

const transferirSchema = z.object({
  id: z.string().uuid(),
  novo_responsavel_id: z.string().uuid(),
});

export const transferirDemanda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => transferirSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("demandas_externas")
      .update({
        responsavel_id: data.novo_responsavel_id,
        status: "pendente",
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });