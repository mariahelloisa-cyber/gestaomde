import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listIdeias = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [ideiasRes, profilesRes] = await Promise.all([
      supabase
        .from("ideias")
        .select("id, titulo, descricao, criado_por, status, pontos, avaliado_por, avaliado_em, criado_em")
        .order("criado_em", { ascending: false }),
      supabase.from("perfis_usuarios").select("id, nome"),
    ]);
    if (ideiasRes.error) throw new Error(ideiasRes.error.message);
    if (profilesRes.error) throw new Error(profilesRes.error.message);

    const nomeById = new Map((profilesRes.data ?? []).map((p) => [p.id, p.nome]));

    return (ideiasRes.data ?? []).map((i) => ({
      id: i.id,
      titulo: i.titulo,
      descricao: i.descricao,
      criado_por: i.criado_por,
      autor: nomeById.get(i.criado_por) ?? "—",
      status: i.status as "pendente" | "aceita" | "rejeitada",
      pontos: i.pontos,
      avaliado_por: i.avaliado_por,
      avaliador: i.avaliado_por ? (nomeById.get(i.avaliado_por) ?? null) : null,
      avaliado_em: i.avaliado_em,
      criado_em: i.criado_em,
    }));
  });

const createIdeiaSchema = z.object({
  titulo: z.string().trim().min(1).max(200),
  descricao: z.string().trim().max(3000).optional(),
});

export const createIdeia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createIdeiaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: nova, error } = await supabase
      .from("ideias")
      .insert({ titulo: data.titulo, descricao: data.descricao || null, criado_por: userId })
      .select("id")
      .single();
    if (error || !nova) throw new Error(error?.message ?? "Falha ao enviar ideia");
    return { id: nova.id };
  });

const avaliarIdeiaSchema = z.object({
  id: z.string().uuid(),
  decisao: z.enum(["aceita", "rejeitada"]),
  pontos: z.number().int().min(1).max(1000).optional(),
});

export const avaliarIdeia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => avaliarIdeiaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: me } = await supabase
      .from("perfis_usuarios")
      .select("cargo")
      .eq("id", userId)
      .maybeSingle();
    if ((me?.cargo as string) !== "Admin") {
      throw new Error("Apenas Admins podem avaliar ideias.");
    }
    if (data.decisao === "aceita" && !data.pontos) {
      throw new Error("Informe a pontuação para aceitar a ideia.");
    }

    const { error } = await supabase
      .from("ideias")
      .update({
        status: data.decisao,
        pontos: data.decisao === "aceita" ? data.pontos : null,
        avaliado_por: userId,
        avaliado_em: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const deleteIdeiaSchema = z.object({ id: z.string().uuid() });

/** Admin apaga qualquer ideia; o autor só apaga a própria enquanto pendente (garantido por RLS). */
export const deleteIdeia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deleteIdeiaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // RLS em DELETE não gera erro quando bloqueia: só filtra silenciosamente as
    // linhas que não batem com a policy. Por isso conferimos o retorno abaixo.
    const { data: apagadas, error } = await supabase
      .from("ideias")
      .delete()
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!apagadas || apagadas.length === 0) {
      throw new Error("Não foi possível excluir: a ideia já foi avaliada ou você não tem permissão.");
    }
    return { ok: true };
  });
