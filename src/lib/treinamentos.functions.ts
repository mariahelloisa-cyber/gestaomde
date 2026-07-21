import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PLANOS = ["Bronze", "Prata", "Ouro", "Diamond", "Todos"] as const;
const planoArraySchema = z
  .array(z.enum(PLANOS))
  .min(1, "Selecione ao menos um plano")
  .transform((arr) => Array.from(new Set(arr)));

const tipoSchema = z.enum(["video", "pdf"]);

export const listTreinamentos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("treinamentos")
      .select("id, titulo, descricao, url_video, plano_destino, criado_em, tipo, capa_url")
      .order("criado_em", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string;
      titulo: string;
      descricao: string | null;
      url_video: string;
      plano_destino: string[];
      criado_em: string;
      tipo: "video" | "pdf";
      capa_url: string | null;
    }>;
  });

const createSchema = z.object({
  titulo: z.string().trim().min(1).max(200),
  descricao: z.string().trim().max(5000).optional(),
  url_video: z.string().trim().url().max(1000),
  plano_destino: planoArraySchema,
  tipo: tipoSchema.default("video"),
  capa_url: z.string().trim().url().max(1000).nullable().optional(),
});

export const createTreinamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: novo, error } = await supabase
      .from("treinamentos")
      .insert({
        titulo: data.titulo,
        descricao: data.descricao || null,
        url_video: data.url_video,
        plano_destino: data.plano_destino,
        tipo: data.tipo,
        capa_url: data.capa_url ?? null,
        criado_por: userId,
      })
      .select("id")
      .single();
    if (error || !novo) {
      if (error?.code === "42501" || /row-level security/i.test(error?.message ?? "")) {
        throw new Error("Apenas Admins podem cadastrar treinamentos.");
      }
      throw new Error(error?.message ?? "Falha ao criar treinamento");
    }
    return { id: novo.id };
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  patch: z.object({
    titulo: z.string().trim().min(1).max(200).optional(),
    descricao: z.string().trim().max(5000).nullable().optional(),
    url_video: z.string().trim().url().max(1000).optional(),
    plano_destino: planoArraySchema.optional(),
    tipo: tipoSchema.optional(),
    capa_url: z.string().trim().url().max(1000).nullable().optional(),
  }),
});

export const updateTreinamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const patch: {
      titulo?: string;
      descricao?: string | null;
      url_video?: string;
      plano_destino?: string[];
      tipo?: "video" | "pdf";
      capa_url?: string | null;
    } = {};
    if (data.patch.titulo !== undefined) patch.titulo = data.patch.titulo;
    if (data.patch.descricao !== undefined) patch.descricao = data.patch.descricao || null;
    if (data.patch.url_video !== undefined) patch.url_video = data.patch.url_video;
    if (data.patch.plano_destino !== undefined) patch.plano_destino = data.patch.plano_destino;
    if (data.patch.tipo !== undefined) patch.tipo = data.patch.tipo;
    if (data.patch.capa_url !== undefined) patch.capa_url = data.patch.capa_url;
    const { error } = await supabase.from("treinamentos").update(patch).eq("id", data.id);
    if (error) {
      if (error.code === "42501" || /row-level security/i.test(error.message)) {
        throw new Error("Apenas Admins podem editar treinamentos.");
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

const deleteSchema = z.object({ id: z.string().uuid() });

export const deleteTreinamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("treinamentos").delete().eq("id", data.id);
    if (error) {
      if (error.code === "42501" || /row-level security/i.test(error.message)) {
        throw new Error("Apenas Admins podem excluir treinamentos.");
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

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