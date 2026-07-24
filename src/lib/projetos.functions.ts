import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listProjetos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [projetosRes, tarefasRes] = await Promise.all([
      supabase.from("projetos").select("id, nome, criado_em").order("criado_em", { ascending: false }),
      supabase
        .from("tarefas")
        .select("id, projeto_id, titulo, status, cliente_id")
        .not("projeto_id", "is", null),
    ]);
    if (projetosRes.error) throw new Error(projetosRes.error.message);
    if (tarefasRes.error) throw new Error(tarefasRes.error.message);

    const tarefasPorProjeto = new Map<
      string,
      Array<{ id: string; titulo: string; status: string; cliente_id: string | null }>
    >();
    for (const t of tarefasRes.data ?? []) {
      if (!t.projeto_id) continue;
      const arr = tarefasPorProjeto.get(t.projeto_id) ?? [];
      arr.push({ id: t.id, titulo: t.titulo, status: t.status, cliente_id: t.cliente_id });
      tarefasPorProjeto.set(t.projeto_id, arr);
    }

    return (projetosRes.data ?? []).map((p) => ({
      id: p.id,
      nome: p.nome,
      criado_em: p.criado_em,
      tarefas: tarefasPorProjeto.get(p.id) ?? [],
    }));
  });

const createProjetoSchema = z.object({
  nome: z.string().trim().min(1).max(200),
});

export const createProjeto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createProjetoSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: novo, error } = await supabase
      .from("projetos")
      .insert({ nome: data.nome, criado_por: userId })
      .select("id")
      .single();
    if (error || !novo) throw new Error(error?.message ?? "Falha ao criar projeto");
    return { id: novo.id };
  });

const updateProjetoSchema = z.object({
  id: z.string().uuid(),
  nome: z.string().trim().min(1).max(200),
});

export const updateProjeto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateProjetoSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("projetos").update({ nome: data.nome }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const deleteProjetoSchema = z.object({ id: z.string().uuid() });

export const deleteProjeto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deleteProjetoSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("projetos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
