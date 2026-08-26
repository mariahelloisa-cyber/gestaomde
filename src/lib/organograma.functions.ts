import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function normalizarLink(link: string | null): string | null {
  if (!link) return null;
  const v = link.trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

async function ensureAdminOuSupervisor(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("perfis_usuarios")
    .select("cargo")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.cargo !== "Admin" && data?.cargo !== "Supervisor") {
    throw new Error("Apenas Admins e Supervisores podem editar o organograma.");
  }
}

export const listOrganogramaNos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("organograma_nos")
      .select("id, nome, parent_id, link, criado_em")
      .order("criado_em", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const criarNoSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  parent_id: z.string().uuid().nullable(),
  link: z.string().trim().max(2000).nullable().optional(),
});

export const criarNoOrganograma = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => criarNoSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdminOuSupervisor(supabase, userId);
    const { data: novo, error } = await supabase
      .from("organograma_nos")
      .insert({
        nome: data.nome,
        parent_id: data.parent_id,
        link: normalizarLink(data.link ?? null),
        criado_por: userId,
      })
      .select("id")
      .single();
    if (error || !novo) throw new Error(error?.message ?? "Falha ao criar nó.");
    return { id: novo.id };
  });

const renomearNoSchema = z.object({
  id: z.string().uuid(),
  nome: z.string().trim().min(1).max(200),
  link: z.string().trim().max(2000).nullable(),
});

export const renomearNoOrganograma = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => renomearNoSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdminOuSupervisor(supabase, userId);
    const { error } = await supabase
      .from("organograma_nos")
      .update({ nome: data.nome, link: normalizarLink(data.link) })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const excluirNoSchema = z.object({ id: z.string().uuid() });

export const excluirNoOrganograma = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => excluirNoSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdminOuSupervisor(supabase, userId);
    const { error } = await supabase.from("organograma_nos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
