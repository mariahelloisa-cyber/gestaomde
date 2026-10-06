import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
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
  CAMPOS_ARQUIVO_FICHA,
  FICHA_ARQUIVO_MIMES,
  FICHA_CAMPO_UNICO,
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

/* ---------------- Ficha de marca (por empresa) ----------------
 * Uma ficha única por projeto na tela; por trás, uma linha de brand_assets
 * por campo, com o tipo decidido aqui (nunca pelo usuário). Campos de valor
 * único (paleta, slogan, briefing, briefing_documento, fonte, tags_marca)
 * têm no máximo uma linha ativa por empresa — o índice
 * brand_assets_ficha_unica_idx garante no banco. Logos e elementos visuais
 * podem ser vários; cada logo é uma versão nomeada em `nome`. Gravações com
 * o JWT do membro: RLS da equipe interna + autoria pelo trigger. */

const HEX = /^#[0-9A-Fa-f]{6}$/;

type LinhaFicha = {
  id: string;
  tipo: string;
  nome: string;
  valor: unknown;
  tags: string[];
  path: string | null;
  mime_type: string | null;
};

async function linhasDaFicha(
  supabase: SupabaseClient<Database>,
  projetoId: string,
): Promise<LinhaFicha[]> {
  const { data, error } = await supabase
    .from("brand_assets")
    .select("id, tipo, nome, valor, tags, path, mime_type")
    .eq("projeto_id", projetoId)
    .eq("ativo", true)
    .order("criado_em");
  if (error) throw new Error(error.message);
  return (data ?? []) as LinhaFicha[];
}

export const getFichaMarca = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ projeto_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);
    const linhas = await linhasDaFicha(supabase, data.projeto_id);
    const urls = await assinarLeitura(
      linhas.flatMap((l) => (l.path ? [l.path] : [])),
      BUCKET_MARCA,
    );
    const umDe = (tipo: string) => linhas.find((l) => l.tipo === tipo) ?? null;
    const valorDe = (l: LinhaFicha | null) => (l?.valor ?? {}) as Record<string, unknown>;
    const arquivoDe = (l: LinhaFicha | null) =>
      l?.path
        ? {
            id: l.id,
            nome: l.nome,
            mime_type: l.mime_type,
            url: urls.get(l.path) ?? null,
          }
        : null;

    const fonte = umDe("fonte");
    const cores = valorDe(umDe("paleta")).cores;
    const varios = (tipo: string) =>
      linhas
        .filter((l) => l.tipo === tipo)
        .map((l) => arquivoDe(l))
        .filter((a): a is NonNullable<typeof a> => !!a);
    return {
      logos: varios("logo"),
      paleta: Array.isArray(cores) ? cores.filter((c): c is string => typeof c === "string") : [],
      tags: umDe("tags_marca")?.tags ?? [],
      slogan: String(valorDe(umDe("slogan")).texto ?? ""),
      briefing: String(valorDe(umDe("briefing")).texto ?? ""),
      briefing_documento: arquivoDe(umDe("briefing_documento")),
      fonte_nome: String(valorDe(fonte).nome_fonte ?? ""),
      fonte_arquivo: arquivoDe(fonte),
      elementos: varios("elemento_visual"),
    };
  });

const salvarTextosSchema = z.object({
  projeto_id: z.string().uuid(),
  paleta: z.array(z.string().regex(HEX, "Cor no formato #RRGGBB.")).max(20, "No máximo 20 cores."),
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
  slogan: z.string().trim().max(ASSET_TEXTO_MAX.slogan),
  briefing: z.string().trim().max(ASSET_TEXTO_MAX.briefing),
  fonte_nome: z.string().trim().max(120),
});

/** Salva os campos de texto da ficha. Campo vazio = remove a linha (ou, na
 * fonte com arquivo, só limpa o nome). */
export const salvarTextosFicha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => salvarTextosSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);
    const projetoId = data.projeto_id;
    const linhas = await linhasDaFicha(supabase, projetoId);

    const gravar = async (
      tipo: TipoAsset,
      conteudo: { valor?: Record<string, unknown>; tags?: string[] } | null,
    ) => {
      const atual = linhas.find((l) => l.tipo === tipo);
      if (!conteudo) {
        if (!atual) return;
        // Fonte com arquivo: tira só o nome, o arquivo continua.
        const r =
          tipo === "fonte" && atual.path
            ? await supabase.from("brand_assets").update({ valor: {} }).eq("id", atual.id)
            : await supabase.from("brand_assets").delete().eq("id", atual.id);
        if (r.error) throw new Error(r.error.message);
        return;
      }
      const campos = {
        nome: TIPOS_ASSET[tipo],
        ...(conteudo.valor ? { valor: conteudo.valor as never } : {}),
        ...(conteudo.tags ? { tags: conteudo.tags } : {}),
      };
      const r = atual
        ? await supabase.from("brand_assets").update(campos).eq("id", atual.id)
        : await supabase.from("brand_assets").insert({ ...campos, projeto_id: projetoId, tipo });
      if (r.error) throw new Error(r.error.message);
    };

    const cores = Array.from(new Set(data.paleta.map((c) => c.toUpperCase())));
    await gravar("paleta", cores.length ? { valor: { cores } } : null);
    await gravar("tags_marca", data.tags.length ? { tags: data.tags } : null);
    await gravar("slogan", data.slogan ? { valor: { texto: data.slogan } } : null);
    await gravar("briefing", data.briefing ? { valor: { texto: data.briefing } } : null);
    await gravar("fonte", data.fonte_nome ? { valor: { nome_fonte: data.fonte_nome } } : null);
    return { ok: true };
  });

const salvarArquivoSchema = z.object({
  projeto_id: z.string().uuid(),
  campo: z.enum(CAMPOS_ARQUIVO_FICHA),
  path: z.string().min(1).max(300),
  mime_type: z.string().min(1).max(100),
  nome_arquivo: z.string().trim().min(1).max(200),
  /** Logo: nome da versão ("Com nome", "Versão branca"…). Vira o `nome`. */
  versao: z.string().trim().max(80).optional(),
});

/**
 * Registra um arquivo da ficha já enviado por URL assinada. Briefing
 * completo e fonte SUBSTITUEM o arquivo anterior (mesma linha; o objeto
 * antigo é apagado depois). Logos e elementos visuais acumulam.
 */
export const salvarArquivoFicha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => salvarArquivoSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);

    const mimes = FICHA_ARQUIVO_MIMES[data.campo] as readonly string[];
    if (!mimes.includes(data.mime_type)) throw new Error("Formato de arquivo não aceito aqui.");
    const formato = new RegExp(
      `^${data.projeto_id}/${data.campo}/${UUID}\\.${EXTENSAO[data.mime_type]}$`,
    );
    if (!formato.test(data.path)) throw new Error("Arquivo inválido. Envie de novo.");
    const { data: jaExiste } = await supabase
      .from("brand_assets")
      .select("id")
      .eq("path", data.path)
      .maybeSingle();
    if (jaExiste) throw new Error("Este arquivo já está cadastrado.");

    try {
      await verificarObjeto(data.path, data.mime_type, MARCA_TAMANHO_MAX_MB * MB, BUCKET_MARCA);
      const nome = data.campo === "logo" ? data.versao || "Logo" : data.nome_arquivo;
      const arquivo = { path: data.path, mime_type: data.mime_type, nome };

      if (FICHA_CAMPO_UNICO.has(data.campo)) {
        const atual = (await linhasDaFicha(supabase, data.projeto_id)).find(
          (l) => l.tipo === data.campo,
        );
        if (atual) {
          const { error } = await supabase.from("brand_assets").update(arquivo).eq("id", atual.id);
          if (error) throw new Error(error.message);
          if (atual.path && atual.path !== data.path)
            await removerObjetos([atual.path], BUCKET_MARCA);
          return { id: atual.id };
        }
      }

      const { data: novo, error } = await supabase
        .from("brand_assets")
        .insert({ ...arquivo, projeto_id: data.projeto_id, tipo: data.campo })
        .select("id")
        .single();
      if (error || !novo) throw new Error(error?.message ?? "Falha ao salvar o arquivo.");
      return { id: novo.id };
    } catch (e) {
      await removerObjetos([data.path], BUCKET_MARCA);
      throw e;
    }
  });

/** Remove um arquivo da ficha. Na fonte com nome cadastrado, mantém a linha
 * (o nome continua valendo) e só tira o arquivo. */
export const removerArquivoFicha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);
    const { data: linha, error } = await supabase
      .from("brand_assets")
      .select("id, tipo, valor, path, projeto_id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // Só itens da ficha de uma empresa; molduras têm fluxo próprio.
    if (!linha || !linha.projeto_id || !linha.path) throw new Error("Arquivo não encontrado.");

    const temNome = linha.tipo === "fonte" && Object.keys((linha.valor ?? {}) as object).length > 0;
    const r = temNome
      ? await supabase
          .from("brand_assets")
          .update({ path: null, mime_type: null })
          .eq("id", linha.id)
      : await supabase.from("brand_assets").delete().eq("id", linha.id);
    if (r.error) throw new Error(r.error.message);
    await removerObjetos([linha.path], BUCKET_MARCA);
    return { ok: true };
  });

/** Renomeia a versão de uma logo ("Com nome", "Versão branca"…). */
export const renomearLogoFicha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        versao: z.string().trim().min(1, "Dê um nome à versão.").max(80),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);
    const { data: linha, error } = await supabase
      .from("brand_assets")
      .update({ nome: data.versao })
      .eq("id", data.id)
      .eq("tipo", "logo")
      .not("projeto_id", "is", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!linha) throw new Error("Logo não encontrada.");
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
