import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { dimensoesDoCabecalho } from "./arte-referencias-ia.server";
import { BUCKET_ARQUIVOS, BUCKET_GERADAS, BUCKET_MARCA, removerObjetos } from "./arte.server";
import { NIVEIS_CARGO, rotuloNivel } from "./arte/tipos";
import {
  FOTO_PERFIL_LADO,
  FOTO_PERFIL_LAYOUT_VERSAO,
  FOTO_PERFIL_LEASE_MS,
  FOTO_PERFIL_MODO,
} from "./arte/foto-perfil";
import type { AreaFoto, FotoEntrada } from "./arte-foto-perfil-render.server";

/* Foto de perfil: composição determinística, sem IA. Mesmo caminho de
 * revisão das outras artes — 1 job (origem 'manual', parametros.modo =
 * composicao_foto_perfil), 1 imagem em ai_generations, e a aprovação copia
 * para approved-arts. Origem 'manual' de propósito: não conta no teto de
 * gerações por IA da arte nem no gasto diário (custo 0).
 *
 * A montagem (resvg + fontes, alguns MB) é carregada só aqui, por import
 * dinâmico, para não pesar a inicialização das outras páginas. */

const carregarMontagem = () => import("./arte-foto-perfil-render.server");

export const STATUS_COMPOE = ["aceita", "ajustes", "aguardando_revisao"];

const MB = 1024 * 1024;
const MODELO_MAX_BYTES = 10 * MB;
/** A foto chega reduzida a este lado máximo pela transformação do Storage. */
const FOTO_LADO_MAX = 1200;
/** Sem a transformação, só monta a original até este tamanho (memória do Worker). */
const FOTO_ORIGINAL_MAX_PX = 12_000_000;
const FOTO_ORIGINAL_MAX_BYTES = 15 * MB;
const TIMEOUT_MS = 60_000;

const camposSchema = z.object({
  nome: z.string().trim().min(1),
  cargo: z.string().trim().min(1),
  nivel_cargo: z.enum(NIVEIS_CARGO),
});

async function baixar(bucket: string, path: string, maxBytes: number): Promise<Uint8Array> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Falha ao ler o arquivo (${error?.message ?? "sem dados"}).`);
  if (data.size > maxBytes) throw new Error("Arquivo grande demais para a montagem.");
  return new Uint8Array(await data.arrayBuffer());
}

function tipoDaImagem(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Baixa o modelo do Storage e confere transparência e círculo da foto. */
export async function lerModeloFotoPerfil(
  path: string,
): Promise<{ bytes: Uint8Array; area: AreaFoto }> {
  const bytes = await baixar(BUCKET_MARCA, path, MODELO_MAX_BYTES);
  const { analisarModelo } = await carregarMontagem();
  return { bytes, area: await analisarModelo(bytes) };
}

/**
 * Foto da pessoa, de preferência pela transformação de imagem do Storage:
 * reduz para até 1200 px (sem cortar nem ampliar) e aplica a rotação do
 * celular (EXIF). Se a transformação falhar, usa a original quando ela cabe
 * na memória — aí a rotação EXIF não é corrigida, e o job registra isso.
 */
async function baixarFoto(path: string): Promise<FotoEntrada & { ajustada: boolean }> {
  let bytes: Uint8Array | null = null;
  let ajustada = false;
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET_ARQUIVOS)
      .createSignedUrl(path, 120, {
        transform: {
          width: FOTO_LADO_MAX,
          height: FOTO_LADO_MAX,
          resize: "contain",
          format: "origin",
        },
      });
    if (!error && data) {
      const resp = await fetch(data.signedUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (resp.ok) {
        const b = new Uint8Array(await resp.arrayBuffer());
        const dims = dimensoesDoCabecalho(b);
        if (tipoDaImagem(b) && dims && Math.max(dims.largura, dims.altura) <= FOTO_LADO_MAX) {
          bytes = b;
          ajustada = true;
        }
      }
    }
  } catch {
    // cai na original abaixo
  }

  if (!bytes) {
    bytes = await baixar(BUCKET_ARQUIVOS, path, FOTO_ORIGINAL_MAX_BYTES);
    const dims = dimensoesDoCabecalho(bytes);
    if (!dims || dims.largura * dims.altura > FOTO_ORIGINAL_MAX_PX) {
      throw new Error(
        "Não foi possível reduzir a foto da pessoa (a transformação de imagem do Storage falhou e a original é grande demais para montar aqui). Tente de novo em instantes.",
      );
    }
  }

  const mime = tipoDaImagem(bytes);
  if (mime === "image/webp") {
    throw new Error(
      'A foto da pessoa está em WebP, formato que a montagem não lê. Peça a foto em JPG ou PNG, ou use "Enviar arte pronta".',
    );
  }
  if (!mime) throw new Error("A foto da pessoa não é uma imagem JPG ou PNG válida.");
  const dims = dimensoesDoCabecalho(bytes);
  return {
    bytes,
    mime,
    largura: dims?.largura ?? null,
    altura: dims?.altura ?? null,
    ajustada,
  };
}

/** Composição 'processando' que passou do lease (Worker interrompido) vira
 * 'falhou' e libera a arte para nova composição ou envio manual. */
export async function liberarComposicoesTravadas(artRequestId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("ai_generation_jobs")
    .update({ status: "falhou", erro: "Montagem interrompida (tempo esgotado).", lease_ate: null })
    .eq("art_request_id", artRequestId)
    .eq("origem", "manual")
    .eq("status", "processando")
    .eq("parametros->>modo", FOTO_PERFIL_MODO)
    .lt("lease_ate", new Date().toISOString());
  if (error) throw new Error(error.message);
}

/**
 * Monta a foto de perfil de uma demanda aceita e registra job + imagem.
 * NÃO muda o status da arte: quem chama faz isso com o JWT do membro, para o
 * trigger registrar a autoria.
 *
 * Tudo que pode recusar a demanda sem culpa do servidor (texto longo demais,
 * modelo ausente ou sem transparência) é conferido ANTES de abrir o job.
 */
export async function executarComposicaoFotoPerfil(
  artRequestId: string,
  userId: string,
): Promise<{ job_id: string; art_request_id: string }> {
  const { data: art, error } = await supabaseAdmin
    .from("art_requests")
    .select(
      "id, tipo, status, campos, largura_px, altura_px, art_request_files(id, path, categoria, confirmado)",
    )
    .eq("id", artRequestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!art) throw new Error("Demanda de arte não encontrada.");
  if (art.tipo !== "foto_perfil") throw new Error("Esta demanda não é de foto de perfil.");
  if (!STATUS_COMPOE.includes(art.status)) {
    throw new Error("Só dá para gerar a foto de perfil de uma demanda aceita.");
  }
  if (art.largura_px !== FOTO_PERFIL_LADO || art.altura_px !== FOTO_PERFIL_LADO) {
    throw new Error(`Foto de perfil precisa ser ${FOTO_PERFIL_LADO}×${FOTO_PERFIL_LADO} px.`);
  }
  const campos = camposSchema.safeParse(art.campos);
  if (!campos.success) {
    throw new Error("A demanda está sem nome, cargo ou nível do cargo válidos.");
  }
  const { nome, cargo, nivel_cargo: nivel } = campos.data;
  const foto = art.art_request_files.find((f) => f.categoria === "foto_pessoa" && f.confirmado);
  if (!foto) throw new Error("A demanda não tem a foto da pessoa.");

  // O nível escolhe só o modelo; nunca é inferido do texto do cargo.
  const { data: modelo, error: errModelo } = await supabaseAdmin
    .from("brand_assets")
    .select("id, path")
    .eq("tipo", "moldura_cargo")
    .is("projeto_id", null)
    .eq("ativo", true)
    .ilike("valor->>tipo_cargo", nivel)
    .maybeSingle();
  if (errModelo) throw new Error(errModelo.message);
  if (!modelo?.path) {
    throw new Error(
      `Não há modelo cadastrado para o nível ${rotuloNivel(nivel)}. Cadastre em Acervo › Modelos de foto de perfil.`,
    );
  }

  const montagem = await carregarMontagem();
  const textos = montagem.prepararTextos(nome, cargo);
  let lido: { bytes: Uint8Array; area: AreaFoto };
  try {
    lido = await lerModeloFotoPerfil(modelo.path);
  } catch (e) {
    throw new Error(
      `Modelo do nível ${rotuloNivel(nivel)} inválido: ${e instanceof Error ? e.message : String(e)} Substitua em Acervo › Modelos de foto de perfil.`,
    );
  }

  await liberarComposicoesTravadas(art.id);

  const jobId = crypto.randomUUID();
  const agora = Date.now();
  const parametros = {
    modo: FOTO_PERFIL_MODO,
    layout_versao: FOTO_PERFIL_LAYOUT_VERSAO,
    nivel_cargo: nivel,
    entrega: { largura: FOTO_PERFIL_LADO, altura: FOTO_PERFIL_LADO },
    area_foto: lido.area,
    fonte_nome: { familia: "Montserrat Bold", tamanho: textos.nome.tamanho },
    fonte_cargo: { familia: "Montserrat Medium", tamanho: textos.cargo.tamanho },
  };
  const { error: errJob } = await supabaseAdmin.from("ai_generation_jobs").insert({
    id: jobId,
    art_request_id: art.id,
    origem: "manual",
    status: "processando",
    qtd_variacoes: 1,
    solicitado_por: userId,
    iniciado_em: new Date(agora).toISOString(),
    lease_ate: new Date(agora + FOTO_PERFIL_LEASE_MS).toISOString(),
    modelo: `composicao-${FOTO_PERFIL_LAYOUT_VERSAO}`,
    tentativas: 1,
    max_tentativas: 1,
    custo_estimado_usd: 0,
    parametros,
    insumos: { foto_id: foto.id, modelo_id: modelo.id },
  });
  if (errJob) {
    // Índice ai_generation_jobs_um_ativo_idx: um job ativo por demanda.
    if (errJob.code === "23505") {
      throw new Error("Já há uma geração ou envio em andamento para esta arte.");
    }
    throw new Error(errJob.message);
  }

  const path = `${art.id}/${jobId}/s01-v1.png`;
  let enviado = false;
  try {
    const fotoEntrada = await baixarFoto(foto.path);
    const png = await montagem.comporFotoPerfil({
      modelo: lido.bytes,
      area: lido.area,
      foto: fotoEntrada,
      textos,
    });
    const dims = dimensoesDoCabecalho(png);
    if (dims?.largura !== FOTO_PERFIL_LADO || dims?.altura !== FOTO_PERFIL_LADO) {
      throw new Error("A montagem não saiu em 1080×1080.");
    }

    const { error: errUp } = await supabaseAdmin.storage
      .from(BUCKET_GERADAS)
      .upload(path, new Blob([new Uint8Array(png)], { type: "image/png" }), {
        contentType: "image/png",
        upsert: true,
      });
    if (errUp) throw new Error(`Falha ao salvar a foto de perfil: ${errUp.message}`);
    enviado = true;

    const { error: errGen } = await supabaseAdmin.from("ai_generations").insert({
      job_id: jobId,
      art_request_id: art.id,
      slide_index: 1,
      variacao: 1,
      path,
      mime_type: "image/png",
      largura: FOTO_PERFIL_LADO,
      altura: FOTO_PERFIL_LADO,
    });
    if (errGen) throw new Error(errGen.message);

    const { error: errFim } = await supabaseAdmin
      .from("ai_generation_jobs")
      .update({
        status: "concluido",
        lease_ate: null,
        parametros: {
          ...parametros,
          foto: {
            ajustada_pelo_storage: fotoEntrada.ajustada,
            largura: fotoEntrada.largura,
            altura: fotoEntrada.altura,
            mime: fotoEntrada.mime,
          },
        } as Json,
      })
      .eq("id", jobId);
    if (errFim) throw new Error(errFim.message);

    return { job_id: jobId, art_request_id: art.id };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "Falha na montagem.").slice(0, 500);
    await supabaseAdmin
      .from("ai_generation_jobs")
      .update({ status: "falhou", erro: msg, lease_ate: null })
      .eq("id", jobId);
    if (enviado) await removerObjetos([path], BUCKET_GERADAS);
    throw new Error(msg);
  }
}
