import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  BUCKET_MARCA,
  BUCKET_REFERENCIAS,
  EXTENSAO,
  assinarLeitura,
  exigirEquipeInterna,
  removerObjetos,
  urlDeUpload,
  verificarObjeto,
} from "./arte.server";
import {
  ARQUIVO_MIMES,
  ASSET_DE_TEXTO,
  ASSET_EXIGE_EMPRESA,
  ASSET_TEXTO_MAX,
  MARCA_MIMES,
  MOLDURA_MIMES,
  NIVEIS_CARGO,
  NIVEL_CARGO_CONFIG,
  MARCA_TAMANHO_MAX_MB,
  REFERENCIA_TAMANHO_MAX_MB,
  TIPOS_ARTE,
  TIPOS_ASSET,
  rotuloTipo,
  type TipoAsset,
} from "./arte/tipos";

/* Acervo do módulo de artes.
 *
 *   - Referências (art_references): GLOBAIS, organizadas por tipo de arte
 *     (a "pasta" feed, panfleto, stories…). Não pertencem a empresa nenhuma:
 *     projeto_id é sempre NULL. A IA vai usar as referências do tipo pedido.
 *     Foto de perfil não tem referências (modelo fixo).
 *   - Marcas das empresas (brand_assets): identidade visual POR EMPRESA
 *     (logo, cores, slogan, briefing, fonte, elementos). O banco impõe esse
 *     escopo (CHECK brand_assets_escopo).
 *   - Modelos de foto de perfil (brand_assets, tipo moldura_cargo): as 4
 *     molduras por nível, da agência, em fluxo próprio.
 *
 * Só equipe interna ativa — checado aqui e, de novo, pela RLS da Fase 1 (as
 * gravações usam o JWT do membro, então o trigger registra quem cadastrou).
 * Arquivos sobem por URL assinada com path decidido pelo servidor; nenhum
 * bucket tem policy. */

const MB = 1024 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const tiposAsset = Object.keys(TIPOS_ASSET) as [TipoAsset, ...TipoAsset[]];
const IMAGENS = new Set<string>(ARQUIVO_MIMES);

const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(20).default([]);
const projetoSchema = z.string().uuid().nullable();
// Foto de perfil não usa referência (modelo fixo + moldura pelo nível).
const tipoArteReferencia = z
  .enum(TIPOS_ARTE)
  .refine(
    (t) => t !== "foto_perfil",
    "Foto de perfil não usa referências: é sempre o mesmo modelo.",
  );

/** Dono do asset conforme o escopo do tipo. Erro se faltar empresa. */
function projetoDoAsset(tipo: TipoAsset, projetoId: string | null): string | null {
  if (tipo === "moldura_cargo") return null;
  if (ASSET_EXIGE_EMPRESA.has(tipo) && !projetoId) {
    throw new Error(`${TIPOS_ASSET[tipo]} precisa de uma empresa.`);
  }
  return projetoId;
}

/* ---------------- Leitura ---------------- */

export const listAcervoArte = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);

    const [projetosRes, refsRes, assetsRes] = await Promise.all([
      supabase.from("projetos").select("id, nome").order("nome"),
      supabase
        .from("art_references")
        .select("id, titulo, descricao, tipos_arte, categoria, tags, path, mime_type, criado_em")
        .order("criado_em", { ascending: false })
        .limit(500),
      supabase
        .from("brand_assets")
        .select(
          "id, tipo, nome, descricao, tags, valor, projeto_id, path, mime_type, ativo, criado_em",
        )
        .order("criado_em", { ascending: false })
        .limit(500),
    ]);
    for (const r of [projetosRes, refsRes, assetsRes])
      if (r.error) throw new Error(r.error.message);

    const refs = refsRes.data ?? [];
    const assets = assetsRes.data ?? [];
    const [urlsRefs, urlsAssets] = await Promise.all([
      assinarLeitura(
        refs.map((r) => r.path),
        BUCKET_REFERENCIAS,
      ),
      assinarLeitura(
        assets.flatMap((a) => (a.path ? [a.path] : [])),
        BUCKET_MARCA,
      ),
    ]);

    return {
      projetos: projetosRes.data ?? [],
      referencias: refs.map((r) => ({ ...r, url: urlsRefs.get(r.path) ?? null })),
      assets: assets.map((a) => ({
        ...a,
        url: a.path ? (urlsAssets.get(a.path) ?? null) : null,
        // SVG só via <img> (nunca inline) — ver nota (C) de 20261006140000.
        imagem: !!a.mime_type && (IMAGENS.has(a.mime_type) || a.mime_type === "image/svg+xml"),
      })),
    };
  });

/* ---------------- Upload (passo 1: URL assinada) ---------------- */

const iniciarUploadSchema = z.discriminatedUnion("destino", [
  z.object({
    destino: z.literal("referencia"),
    tipo_arte: tipoArteReferencia,
    mime_type: z.enum(ARQUIVO_MIMES),
    tamanho_bytes: z
      .number()
      .int()
      .min(1)
      .max(REFERENCIA_TAMANHO_MAX_MB * MB),
  }),
  z.object({
    destino: z.literal("marca"),
    projeto_id: projetoSchema,
    tipo: z.enum(tiposAsset),
    mime_type: z.enum(MARCA_MIMES),
    tamanho_bytes: z
      .number()
      .int()
      .min(1)
      .max(MARCA_TAMANHO_MAX_MB * MB),
  }),
]);

export const iniciarUploadAcervo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => iniciarUploadSchema.parse(input))
  .handler(async ({ data, context }) => {
    await exigirEquipeInterna(context.userId);
    const ext = EXTENSAO[data.mime_type];
    if (data.destino === "referencia") {
      // "Pasta" da referência = tipo de arte (feed/, panfleto/, stories/…).
      return urlDeUpload(BUCKET_REFERENCIAS, `${data.tipo_arte}/${crypto.randomUUID()}.${ext}`);
    }
    if (ASSET_DE_TEXTO.has(data.tipo)) throw new Error("Este tipo de asset não tem arquivo.");
    const dono = projetoDoAsset(data.tipo, data.projeto_id);
    return urlDeUpload(
      BUCKET_MARCA,
      `${dono ?? "_agencia"}/${data.tipo}/${crypto.randomUUID()}.${ext}`,
    );
  });

/* ---------------- Referências (globais) ---------------- */

const salvarReferenciaSchema = z.object({
  tipo_arte: tipoArteReferencia,
  titulo: z.string().trim().max(200).optional(),
  categoria: z.string().trim().max(80).optional(),
  tags: tagsSchema,
  descricao: z.string().trim().max(2000).optional(),
  path: z.string().min(1).max(300),
  mime_type: z.enum(ARQUIVO_MIMES),
});

export const salvarReferencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => salvarReferenciaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);

    // O path tem que ser exatamente o formato emitido por iniciarUploadAcervo.
    const formato = new RegExp(`^${data.tipo_arte}/${UUID}\\.${EXTENSAO[data.mime_type]}$`);
    if (!formato.test(data.path)) throw new Error("Arquivo inválido. Envie de novo.");
    // Path já usado: recusa ANTES do try, senão a limpeza abaixo apagaria o
    // arquivo de uma referência existente.
    const { data: jaExiste } = await supabase
      .from("art_references")
      .select("id")
      .eq("path", data.path)
      .maybeSingle();
    if (jaExiste) throw new Error("Este arquivo já está cadastrado.");

    try {
      await verificarObjeto(
        data.path,
        data.mime_type,
        REFERENCIA_TAMANHO_MAX_MB * MB,
        BUCKET_REFERENCIAS,
      );
      const titulo =
        data.titulo ||
        `${rotuloTipo(data.tipo_arte)}${data.categoria ? ` — ${data.categoria}` : ""}`;
      const { data: nova, error } = await supabase
        .from("art_references")
        .insert({
          titulo: titulo.slice(0, 200),
          tipos_arte: [data.tipo_arte],
          categoria: data.categoria || null,
          tags: data.tags,
          descricao: data.descricao || null,
          // Referência é global: nunca de uma empresa.
          projeto_id: null,
          path: data.path,
          mime_type: data.mime_type,
        })
        .select("id")
        .single();
      if (error || !nova) throw new Error(error?.message ?? "Falha ao salvar a referência.");
      return { id: nova.id };
    } catch (e) {
      await removerObjetos([data.path], BUCKET_REFERENCIAS);
      throw e;
    }
  });

export const removerReferencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);
    const { data: ref, error } = await supabase
      .from("art_references")
      .delete()
      .eq("id", data.id)
      .select("path")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (ref) await removerObjetos([ref.path], BUCKET_REFERENCIAS);
    return { ok: true };
  });

/* ---------------- Marcas das empresas (por empresa) ---------------- */

const HEX = /^#[0-9A-Fa-f]{6}$/;

const salvarAssetSchema = z
  .object({
    projeto_id: projetoSchema,
    tipo: z.enum(tiposAsset),
    nome: z.string().trim().min(1, "Dê um nome ao asset.").max(200),
    descricao: z.string().trim().max(2000).optional(),
    tags: tagsSchema,
    valor: z.record(z.unknown()).default({}),
    arquivo: z
      .object({ path: z.string().min(1).max(300), mime_type: z.enum(MARCA_MIMES) })
      .nullable(),
  })
  .superRefine((d, ctx) => {
    const erro = (message: string, path: string[] = ["valor"]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    if (JSON.stringify(d.valor).length > 12000) erro("Valor JSON grande demais.");
    if (d.tipo === "moldura_cargo") {
      // Moldura tem fluxo próprio (salvarModeloFotoPerfil), com o nível fixo.
      erro("Molduras são cadastradas em Modelos de foto de perfil.", ["tipo"]);
    } else if (d.tipo === "paleta") {
      const cores = d.valor.cores;
      if (
        !Array.isArray(cores) ||
        cores.length === 0 ||
        !cores.every((c) => typeof c === "string" && HEX.test(c))
      )
        erro("Informe ao menos uma cor no formato #RRGGBB.");
    } else if (d.tipo === "slogan" || d.tipo === "briefing") {
      const texto = typeof d.valor.texto === "string" ? d.valor.texto.trim() : "";
      if (!texto) erro(d.tipo === "slogan" ? "Escreva o slogan." : "Escreva o briefing.");
      if (texto.length > ASSET_TEXTO_MAX[d.tipo]) erro("Texto longo demais.");
      if (d.arquivo) erro("Este tipo de asset não tem arquivo.", ["arquivo"]);
    } else if (!d.arquivo) {
      erro("Envie o arquivo deste asset.", ["arquivo"]);
    }
  });

export const salvarBrandAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => salvarAssetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);

    const projetoId = projetoDoAsset(data.tipo, data.projeto_id);
    let valor: Record<string, unknown> = data.valor;
    if (ASSET_DE_TEXTO.has(data.tipo)) {
      valor = { texto: String(data.valor.texto).trim() };
    }

    if (data.arquivo) {
      const formato = new RegExp(
        `^${projetoId ?? "_agencia"}/${data.tipo}/${UUID}\\.${EXTENSAO[data.arquivo.mime_type]}$`,
      );
      if (!formato.test(data.arquivo.path)) throw new Error("Arquivo inválido. Envie de novo.");
      const { data: jaExiste } = await supabase
        .from("brand_assets")
        .select("id")
        .eq("path", data.arquivo.path)
        .maybeSingle();
      if (jaExiste) throw new Error("Este arquivo já está cadastrado.");
    }

    try {
      if (data.arquivo) {
        await verificarObjeto(
          data.arquivo.path,
          data.arquivo.mime_type,
          MARCA_TAMANHO_MAX_MB * MB,
          BUCKET_MARCA,
        );
      }
      const { data: novo, error } = await supabase
        .from("brand_assets")
        .insert({
          projeto_id: projetoId,
          tipo: data.tipo,
          nome: data.nome,
          descricao: data.descricao || null,
          tags: data.tags,
          valor: valor as never,
          path: data.arquivo?.path ?? null,
          mime_type: data.arquivo?.mime_type ?? null,
        })
        .select("id")
        .single();
      if (error || !novo) throw new Error(error?.message ?? "Falha ao salvar o asset.");
      return { id: novo.id };
    } catch (e) {
      if (data.arquivo) await removerObjetos([data.arquivo.path], BUCKET_MARCA);
      throw e;
    }
  });

export const removerBrandAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);
    const { data: asset, error } = await supabase
      .from("brand_assets")
      .delete()
      .eq("id", data.id)
      .select("path")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (asset?.path) await removerObjetos([asset.path], BUCKET_MARCA);
    return { ok: true };
  });

/* ---------------- Modelos de foto de perfil (agência) ---------------- */

const salvarModeloSchema = z.object({
  nivel_cargo: z.enum(NIVEIS_CARGO),
  arquivo: z.object({ path: z.string().min(1).max(300), mime_type: z.enum(MOLDURA_MIMES) }),
});

/**
 * Cadastra ou SUBSTITUI a moldura de um nível (diretor, supervisor, gerente,
 * colaborador). Sempre global da agência (projeto_id NULL), sempre com a cor
 * do nível. valor.tipo_cargo repete o nivel_cargo porque o CHECK e o índice
 * "uma moldura ativa por tipo de cargo" da Fase 1 olham essa chave — então o
 * banco garante uma moldura por nível.
 *
 * Substituir atualiza a linha existente (não cria outra) e só depois apaga o
 * arquivo antigo; se algo falhar no meio, o arquivo novo é que é descartado.
 */
export const salvarModeloFotoPerfil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => salvarModeloSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);

    const { path, mime_type } = data.arquivo;
    const formato = new RegExp(`^_agencia/moldura_cargo/${UUID}\\.${EXTENSAO[mime_type]}$`);
    if (!formato.test(path)) throw new Error("Arquivo inválido. Envie de novo.");
    const { data: jaExiste } = await supabase
      .from("brand_assets")
      .select("id")
      .eq("path", path)
      .maybeSingle();
    if (jaExiste) throw new Error("Este arquivo já está cadastrado.");

    const nivel = data.nivel_cargo;
    const cfg = NIVEL_CARGO_CONFIG[nivel];
    const linha = {
      nome: `Moldura ${cfg.rotulo} (${cfg.moldura})`,
      valor: { nivel_cargo: nivel, tipo_cargo: nivel, cor: cfg.corPadrao },
      path,
      mime_type,
    };

    try {
      await verificarObjeto(path, mime_type, MARCA_TAMANHO_MAX_MB * MB, BUCKET_MARCA);

      const { data: atual, error: errAtual } = await supabase
        .from("brand_assets")
        .select("id, path")
        .eq("tipo", "moldura_cargo")
        .is("projeto_id", null)
        .eq("ativo", true)
        .ilike("valor->>tipo_cargo", nivel)
        .maybeSingle();
      if (errAtual) throw new Error(errAtual.message);

      if (atual) {
        const { error } = await supabase.from("brand_assets").update(linha).eq("id", atual.id);
        if (error) throw new Error(error.message);
        if (atual.path && atual.path !== path) await removerObjetos([atual.path], BUCKET_MARCA);
        return { id: atual.id, substituido: true };
      }

      const { data: novo, error } = await supabase
        .from("brand_assets")
        .insert({ ...linha, tipo: "moldura_cargo", projeto_id: null })
        .select("id")
        .single();
      if (error || !novo) throw new Error(error?.message ?? "Falha ao salvar o modelo.");
      return { id: novo.id, substituido: false };
    } catch (e) {
      await removerObjetos([path], BUCKET_MARCA);
      throw e;
    }
  });
