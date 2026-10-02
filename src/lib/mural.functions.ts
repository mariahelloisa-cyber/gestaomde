import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* Mural: cada pessoa tem vários murais e, dentro de cada um, os seus quadros.
 * A privacidade é garantida pelo RLS (supabase/migrations/20261002120000_murais.sql)
 * — todas as funções aqui usam o client autenticado de quem chamou, nunca o
 * supabaseAdmin. */

/** Paleta fixa de cores dos murais e dos quadros. */
export const CORES_MURAL = [
  "#7B68EE",
  "#3B82F6",
  "#06B6D4",
  "#14B8A6",
  "#22C55E",
  "#84CC16",
  "#F59E0B",
  "#F97316",
  "#EF4444",
  "#EC4899",
] as const;

export interface Mural {
  id: string;
  nome: string;
  cor: string;
  descricao: string | null;
  posicao: number;
}

/** Um mural na tela de listagem, com o que o card mostra. */
export interface MuralResumo extends Mural {
  quadros: number;
  itens: number;
}

export interface MuralQuadro {
  id: string;
  nome: string;
  cor: string;
  posicao: number;
}

export interface MuralItem {
  id: string;
  quadro_id: string;
  tarefa_id: string;
  posicao: number;
}

export interface MuralData {
  /** null quando o mural não existe (link antigo, ou de outra pessoa). */
  mural: Mural | null;
  quadros: MuralQuadro[];
  itens: MuralItem[];
}

const MURAL_CAMPOS = "id, nome, cor, descricao, posicao";

/** Os murais da pessoa, com as contagens que aparecem no card. */
export const listMurais = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MuralResumo[]> => {
    const { supabase, userId } = context;
    const [muraisRes, quadrosRes, itensRes] = await Promise.all([
      supabase
        .from("murais")
        .select(MURAL_CAMPOS)
        .eq("usuario_id", userId)
        .order("posicao")
        .order("criado_em"),
      supabase.from("mural_quadros").select("mural_id").eq("usuario_id", userId),
      supabase.from("mural_itens").select("mural_id").eq("usuario_id", userId),
    ]);
    if (muraisRes.error) throw new Error(muraisRes.error.message);
    if (quadrosRes.error) throw new Error(quadrosRes.error.message);
    if (itensRes.error) throw new Error(itensRes.error.message);

    const contar = (linhas: { mural_id: string }[]) => {
      const m = new Map<string, number>();
      for (const l of linhas) m.set(l.mural_id, (m.get(l.mural_id) ?? 0) + 1);
      return m;
    };
    const porQuadros = contar(quadrosRes.data ?? []);
    const porItens = contar(itensRes.data ?? []);
    return (muraisRes.data ?? []).map((m) => ({
      ...m,
      quadros: porQuadros.get(m.id) ?? 0,
      itens: porItens.get(m.id) ?? 0,
    }));
  });

/** Quadros e itens de um mural. */
export const listMural = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ muralId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<MuralData> => {
    const { supabase, userId } = context;
    const [muralRes, quadrosRes, itensRes] = await Promise.all([
      supabase
        .from("murais")
        .select(MURAL_CAMPOS)
        .eq("id", data.muralId)
        .eq("usuario_id", userId)
        .maybeSingle(),
      supabase
        .from("mural_quadros")
        .select("id, nome, cor, posicao")
        .eq("usuario_id", userId)
        .eq("mural_id", data.muralId)
        .order("posicao")
        .order("criado_em"),
      supabase
        .from("mural_itens")
        .select("id, quadro_id, tarefa_id, posicao")
        .eq("usuario_id", userId)
        .eq("mural_id", data.muralId)
        .order("posicao"),
    ]);
    if (muralRes.error) throw new Error(muralRes.error.message);
    if (quadrosRes.error) throw new Error(quadrosRes.error.message);
    if (itensRes.error) throw new Error(itensRes.error.message);
    if (!muralRes.data) return { mural: null, quadros: [], itens: [] };
    return { mural: muralRes.data, quadros: quadrosRes.data ?? [], itens: itensRes.data ?? [] };
  });

const corSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const nomeSchema = z.string().trim().min(1).max(80);
const descricaoSchema = z
  .string()
  .trim()
  .max(280)
  .transform((v) => v || null)
  .nullable();

export const criarMural = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ nome: nomeSchema, cor: corSchema, descricao: descricaoSchema.optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Novo mural entra no fim da fila.
    const { data: ultimo } = await supabase
      .from("murais")
      .select("posicao")
      .eq("usuario_id", userId)
      .order("posicao", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: novo, error } = await supabase
      .from("murais")
      .insert({
        nome: data.nome,
        cor: data.cor,
        descricao: data.descricao ?? null,
        usuario_id: userId,
        posicao: (ultimo?.posicao ?? 0) + 1,
      })
      .select("id")
      .single();
    if (error || !novo) throw new Error(error?.message ?? "Falha ao criar mural");
    return { id: novo.id };
  });

export const atualizarMural = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        nome: nomeSchema.optional(),
        cor: corSchema.optional(),
        descricao: descricaoSchema.optional(),
        posicao: z.number().finite().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase.from("murais").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Apaga o mural inteiro: quadros, itens e os lembretes que estavam neles. */
export const excluirMural = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("excluir_mural", { _mural_id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const criarQuadroMural = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ muralId: z.string().uuid(), nome: nomeSchema, cor: corSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Novo quadro entra no fim da fila do mural.
    const { data: ultimo } = await supabase
      .from("mural_quadros")
      .select("posicao")
      .eq("mural_id", data.muralId)
      .order("posicao", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: novo, error } = await supabase
      .from("mural_quadros")
      .insert({
        mural_id: data.muralId,
        nome: data.nome,
        cor: data.cor,
        usuario_id: userId,
        posicao: (ultimo?.posicao ?? 0) + 1,
      })
      .select("id")
      .single();
    if (error || !novo) throw new Error(error?.message ?? "Falha ao criar quadro");
    return { id: novo.id };
  });

export const atualizarQuadroMural = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        nome: nomeSchema.optional(),
        cor: corSchema.optional(),
        posicao: z.number().finite().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase.from("mural_quadros").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Apaga o quadro e os lembretes que estão nele; tarefas só saem do quadro. */
export const excluirQuadroMural = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("excluir_mural_quadro", {
      _quadro_id: data.id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Coloca tarefas já existentes (em que a pessoa é responsável) num quadro. */
export const adicionarTarefasMural = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        quadroId: z.string().uuid(),
        tarefaIds: z.array(z.string().uuid()).min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ultimo } = await supabase
      .from("mural_itens")
      .select("posicao")
      .eq("quadro_id", data.quadroId)
      .order("posicao", { ascending: false })
      .limit(1)
      .maybeSingle();
    const base = ultimo?.posicao ?? 0;
    const rows = data.tarefaIds.map((tarefa_id, i) => ({
      quadro_id: data.quadroId,
      tarefa_id,
      usuario_id: userId,
      posicao: base + i + 1,
    }));
    const { error } = await supabase.from("mural_itens").insert(rows);
    if (error) {
      if (error.code === "23505")
        throw new Error("Essa tarefa já está em outro quadro deste mural.");
      throw new Error(error.message);
    }
    return { ok: true };
  });

/** Arrastar: troca de quadro e/ou posição dentro do mural. Não mexe no status
 * da tarefa. */
export const moverItemMural = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        quadroId: z.string().uuid(),
        posicao: z.number().finite(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("mural_itens")
      .update({ quadro_id: data.quadroId, posicao: data.posicao })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Tira o item do quadro. A tarefa continua existindo normalmente. */
export const removerItemMural = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("mural_itens").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
