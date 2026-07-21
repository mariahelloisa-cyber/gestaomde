import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listPastasLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [pastasRes, itensRes] = await Promise.all([
      supabase.from("pastas_links").select("id, nome, comentario, criado_em").order("criado_em", { ascending: false }),
      supabase.from("pastas_links_itens").select("id, pasta_id, url, criado_em").order("criado_em"),
    ]);
    if (pastasRes.error) throw new Error(pastasRes.error.message);
    if (itensRes.error) throw new Error(itensRes.error.message);

    const itensPorPasta = new Map<string, Array<{ id: string; url: string }>>();
    for (const i of itensRes.data ?? []) {
      const arr = itensPorPasta.get(i.pasta_id) ?? [];
      arr.push({ id: i.id, url: i.url });
      itensPorPasta.set(i.pasta_id, arr);
    }

    return (pastasRes.data ?? []).map((p) => ({
      id: p.id,
      nome: p.nome,
      comentario: p.comentario,
      criado_em: p.criado_em,
      links: itensPorPasta.get(p.id) ?? [],
    }));
  });

const createPastaSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  comentario: z.string().trim().max(2000).optional(),
});

export const createPastaLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createPastaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: nova, error } = await supabase
      .from("pastas_links")
      .insert({ nome: data.nome, comentario: data.comentario || null, criado_por: userId })
      .select("id")
      .single();
    if (error || !nova) throw new Error(error?.message ?? "Falha ao criar pasta");
    return { id: nova.id };
  });

const updatePastaSchema = z.object({
  id: z.string().uuid(),
  nome: z.string().trim().min(1).max(200).optional(),
  comentario: z.string().trim().max(2000).nullable().optional(),
});

export const updatePastaLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updatePastaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const patch: { nome?: string; comentario?: string | null } = {};
    if (data.nome !== undefined) patch.nome = data.nome;
    if (data.comentario !== undefined) patch.comentario = data.comentario;
    const { error } = await supabase.from("pastas_links").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const deletePastaSchema = z.object({ id: z.string().uuid() });

export const deletePastaLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deletePastaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("pastas_links").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const addLinkSchema = z.object({
  pasta_id: z.string().uuid(),
  url: z.string().trim().min(1).max(2000),
});

export const addLinkToPasta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => addLinkSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: novo, error } = await supabase
      .from("pastas_links_itens")
      .insert({ pasta_id: data.pasta_id, url: data.url })
      .select("id")
      .single();
    if (error || !novo) throw new Error(error?.message ?? "Falha ao adicionar link");
    return { id: novo.id };
  });

const deleteLinkSchema = z.object({ id: z.string().uuid() });

export const deleteLinkFromPasta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deleteLinkSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("pastas_links_itens").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
