import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  BUCKET_ARQUIVOS,
  BUCKET_GERADAS,
  BUCKET_MARCA,
  BUCKET_REFERENCIAS,
  removerObjetos,
} from "./arte.server";
import { normalizarPng } from "./arte-imagem.server";
import { dimensoesDoCabecalho, inicioDoDiaSP } from "./arte-referencias-ia.server";
import { metadadosIA, statusAnalise, type MetadadosIA } from "./arte/analise-referencias";
import {
  ERRO_TETO_GERACAO,
  GERACAO_ENTREGA_MAX_PX,
  GERACAO_LEASE_MS,
  GERACAO_LIMITE_DIARIO_PADRAO_USD,
  GERACAO_MODELO_PADRAO,
  GERACAO_PROMPT_VERSAO,
  GERACAO_QUALIDADE,
  GERACAO_VARIACOES,
  entregaCabeNaGeracao,
  podeGerarComIA,
} from "./arte/geracao";
import { DIRECAO_CRIATIVA_EDUCACIONAL, camposParaExibir, rotuloTipo } from "./arte/tipos";

/* Geração de artes com a OpenAI Image API (Fase 4B). Só servidor: a chave
 * OPENAI_API_KEY é lida dentro das funções (no Workers o env existe só durante
 * a requisição) e nunca sai daqui. Storage e banco com service role; a tela só
 * recebe URLs assinadas das imagens, pela listagem da equipe interna. */

const MB = 1024 * 1024;
const OPENAI_URL = "https://api.openai.com/v1/images";
/** Abaixo do lease, para o job nunca ser liberado com a chamada ainda viva. */
const OPENAI_TIMEOUT_MS = 6 * 60 * 1000;
/** Status em que a arte pode receber uma versão nova (mesmo do envio manual). */
export const STATUS_GERA = ["aceita", "ajustes", "aguardando_revisao"];

export function configGeracao() {
  const limite = Number(process.env.IA_GERACAO_LIMITE_DIARIO_USD);
  return {
    configurado: !!process.env.OPENAI_API_KEY,
    modelo: process.env.ARTE_GERACAO_MODELO || GERACAO_MODELO_PADRAO,
    limiteDiarioUsd: limite > 0 ? limite : GERACAO_LIMITE_DIARIO_PADRAO_USD,
  };
}

/* ---------------- Tamanho pedido à API ----------------
 * gpt-image-2 / 2.5 aceitam WIDTHxHEIGHT com lados múltiplos de 16, proporção
 * entre 1:3 e 3:1 e de 655.360 a 8.294.400 px. Gera perto da área pedida (o
 * custo cresce com a área), limitado a ~2,4 MP. Depois, normalizarPng
 * (arte-imagem.server.ts) leva cada variação ao tamanho EXATO de entrega. */

const PX_MIN = 655_360;
const PX_MAX_API = 8_294_400;
const PX_MAX_GERACAO = 2_359_296;
const LADO_MAX = 3840;

export function tamanhoDeGeracao(
  largura: number,
  altura: number,
): { largura: number; altura: number; proporcaoAjustada: boolean } {
  const original = largura / altura;
  const r = Math.min(3, Math.max(1 / 3, original));
  const alvoPx = Math.min(PX_MAX_GERACAO, Math.max(PX_MIN, largura * altura));
  const hIdeal = Math.sqrt(alvoPx / r);
  let melhor: { w: number; h: number; erro: number } | null = null;
  for (let k = Math.floor(hIdeal / 16) - 4; k <= Math.ceil(hIdeal / 16) + 4; k++) {
    const h = k * 16;
    if (h < 16 || h > LADO_MAX) continue;
    for (const w of [Math.floor((r * h) / 16) * 16, Math.ceil((r * h) / 16) * 16]) {
      const px = w * h;
      const rr = w / h;
      if (w < 16 || w > LADO_MAX || px < PX_MIN || px > PX_MAX_API || rr < 1 / 3 || rr > 3) {
        continue;
      }
      // Proporção pesa mais que área: errar a proporção corta a arte. Ficar
      // abaixo da área pesa 3x: ampliar depois perde nitidez, reduzir não.
      const erro =
        Math.abs(Math.log(rr / r)) * 10 + (Math.abs(px - alvoPx) / alvoPx) * (px < alvoPx ? 3 : 1);
      if (!melhor || erro < melhor.erro) melhor = { w, h, erro };
    }
  }
  return {
    largura: melhor?.w ?? 1024,
    altura: melhor?.h ?? 1024,
    proporcaoAjustada: Math.abs(original - r) > 1e-9,
  };
}

/* ---------------- Custo ----------------
 * US$ por 1M tokens (tabela da OpenAI, conferida em 2026-10-08). Modelo
 * desconhecido usa a linha mais cara, para o teto errar para o lado seguro. */

type Preco = { texto: number; imagem: number; saida: number };
const PRECOS: Record<string, Preco> = {
  "gpt-image-2.5-sunburst": { texto: 5, imagem: 8, saida: 30 },
  "gpt-image-2.5-flare": { texto: 5, imagem: 8, saida: 30 },
  "gpt-image-2": { texto: 5, imagem: 8, saida: 30 },
  "gpt-image-1.5": { texto: 5, imagem: 8, saida: 32 },
  "chatgpt-image-latest": { texto: 5, imagem: 8, saida: 32 },
  "gpt-image-1-mini": { texto: 2, imagem: 2.5, saida: 8 },
  "gpt-image-1": { texto: 5, imagem: 10, saida: 40 },
};
const PRECO_DESCONHECIDO: Preco = { texto: 5, imagem: 10, saida: 40 };

function precoDe(modelo: string): Preco {
  if (PRECOS[modelo]) return PRECOS[modelo];
  const chave = Object.keys(PRECOS)
    .filter((k) => modelo.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return chave ? PRECOS[chave] : PRECO_DESCONHECIDO;
}

type UsoOpenAI = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  output_tokens_details?: { text_tokens?: number; image_tokens?: number };
};

/** Toda a saída é cobrada como imagem (a tarifa mais alta), por segurança. */
export function custoDoUso(modelo: string, uso: UsoOpenAI): number {
  const p = precoDe(modelo);
  const entrada = uso.input_tokens ?? 0;
  const imagem = uso.input_tokens_details?.image_tokens ?? 0;
  const texto = uso.input_tokens_details?.text_tokens ?? Math.max(0, entrada - imagem);
  const saida = uso.output_tokens ?? 0;
  return (texto * p.texto + imagem * p.imagem + saida * p.saida) / 1_000_000;
}

/** Máximo de imagens anexadas por geração (logo + referências + arquivos). */
const MAX_ANEXOS = 10;

/** Estimativa antes da chamada, para o teto. Sem histórico: fórmula com
 * folga (medium 1024x1024 sai por ~US$ 0,05 no gpt-image-2). Com 3+ gerações
 * reais: média real por megapixel, com 25% de margem. */
export async function estimarCustoGeracao(px: number): Promise<number> {
  const { data } = await supabaseAdmin
    .from("ai_generation_jobs")
    .select("custo_estimado_usd, parametros")
    .eq("origem", "ia")
    .eq("status", "concluido")
    .order("criado_em", { ascending: false })
    .limit(10);
  const porPx = (data ?? []).flatMap((j) => {
    const custo = Number(j.custo_estimado_usd);
    const area = Number((j.parametros as { area_px?: number } | null)?.area_px);
    return custo > 0 && area > 0 ? [custo / area] : [];
  });
  if (porPx.length >= 3) {
    return (porPx.reduce((a, b) => a + b, 0) / porPx.length) * px * 1.25;
  }
  return GERACAO_VARIACOES * 0.08 * (px / MB) + MAX_ANEXOS * 0.02 + 0.02;
}

/** Gasto de hoje (dia de São Paulo) com geração. Inclui a reserva dos jobs em
 * andamento e o custo das falhas que a API cobrou. */
export async function gastoGeracaoHoje(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("ai_generation_jobs")
    .select("custo_estimado_usd")
    .eq("origem", "ia")
    .gte("criado_em", new Date(inicioDoDiaSP()).toISOString());
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((s, j) => s + (Number(j.custo_estimado_usd) || 0), 0);
}

/** Job de IA que passou do lease (aba fechada, Worker interrompido) vira
 * 'falhou' e libera a demanda. A reserva de custo continua contando no teto:
 * a OpenAI pode ter cobrado. */
export async function liberarGeracoesTravadas(artRequestId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("ai_generation_jobs")
    .update({ status: "falhou", erro: "Geração interrompida (tempo esgotado).", lease_ate: null })
    .eq("art_request_id", artRequestId)
    .eq("origem", "ia")
    .eq("status", "processando")
    .lt("lease_ate", new Date().toISOString());
  if (error) throw new Error(error.message);
}

/* ---------------- Ficha de marca ---------------- */

type Marca = {
  nome: string | null;
  paleta: string[];
  slogan: string;
  briefing: string;
  estilo_visual: string;
  evitar: string;
  observacao_ia: string;
  tags: string[];
  fonte_nome: string;
  logo: { id: string; path: string; mime_type: string; nome: string } | null;
};

const RASTER = ["image/png", "image/jpeg", "image/webp"];

async function carregarMarca(projetoId: string | null, nome: string | null): Promise<Marca> {
  const vazia: Marca = {
    nome,
    paleta: [],
    slogan: "",
    briefing: "",
    estilo_visual: "",
    evitar: "",
    observacao_ia: "",
    tags: [],
    fonte_nome: "",
    logo: null,
  };
  if (!projetoId) return vazia;
  const { data, error } = await supabaseAdmin
    .from("brand_assets")
    .select("id, tipo, nome, valor, tags, path, mime_type")
    .eq("projeto_id", projetoId)
    .eq("ativo", true)
    .order("criado_em");
  if (error) throw new Error(error.message);
  const linhas = data ?? [];
  const valor = (tipo: string) =>
    (linhas.find((l) => l.tipo === tipo)?.valor ?? {}) as Record<string, unknown>;
  const texto = (tipo: string) => String(valor(tipo).texto ?? "").trim();
  const cores = valor("paleta").cores;

  // SVG não é aceito como imagem de entrada: só logos em bitmap. Prefere a
  // versão "com nome", que é a que identifica a empresa sozinha.
  const logos = linhas.filter(
    (l) => l.tipo === "logo" && l.path && l.mime_type && RASTER.includes(l.mime_type),
  );
  const logo =
    logos.find((l) => normalizar(l.nome).includes("com nome")) ??
    logos.find((l) => !/branc|negativ/.test(normalizar(l.nome))) ??
    logos[0];

  return {
    ...vazia,
    paleta: Array.isArray(cores)
      ? cores.filter((c): c is string => typeof c === "string" && /^#[0-9A-Fa-f]{6}$/.test(c))
      : [],
    slogan: texto("slogan"),
    briefing: texto("briefing"),
    estilo_visual: texto("estilo_visual"),
    evitar: texto("evitar"),
    observacao_ia: texto("observacao_ia"),
    tags: linhas.find((l) => l.tipo === "tags_marca")?.tags ?? [],
    fonte_nome: String(valor("fonte").nome_fonte ?? "").trim(),
    logo: logo
      ? { id: logo.id, path: logo.path!, mime_type: logo.mime_type!, nome: logo.nome }
      : null,
  };
}

/* ---------------- Seleção de referências globais ----------------
 * Pontua pela análise da Fase 4A: tema, objetivo, estilo, elementos,
 * composição e proporção. COR NÃO ENTRA: a referência empresta estrutura e a
 * arte usa a paleta da empresa. Um pouco de acaso desempata e varia as
 * referências entre gerações da mesma demanda. */

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

type Desejo = {
  tema: Set<string>;
  objetivo: Set<string>;
  estilo: Set<string>;
  elementos: Set<string>;
  composicao: Set<string>;
};

const DESEJO_POR_TIPO: Record<string, Partial<Record<keyof Desejo, string[]>>> = {
  feed: { objetivo: ["captacao-matricula", "engajar"] },
  feed_data_comemorativa: {
    tema: ["data-comemorativa"],
    objetivo: ["comemorar", "fortalecer-marca"],
  },
  panfleto: {
    objetivo: ["captacao-matricula", "promocao-oferta"],
    composicao: ["card-de-oferta", "lista-de-itens"],
  },
  stories: { objetivo: ["captacao-matricula", "engajar"], composicao: ["pouco-texto"] },
  aviso: {
    tema: ["aviso-comunicado"],
    objetivo: ["informar"],
    composicao: ["texto-dominante", "titulo-grande"],
  },
  vaga_emprego: {
    tema: ["vaga-de-emprego"],
    objetivo: ["recrutar"],
    elementos: ["profissional-trabalhando"],
    composicao: ["lista-de-itens"],
  },
  trafego: {
    objetivo: ["gerar-lead", "captacao-matricula", "promocao-oferta"],
    composicao: ["titulo-grande", "pouco-texto"],
  },
  banner: { objetivo: ["captacao-matricula", "fortalecer-marca"], composicao: ["pouco-texto"] },
  carrossel: { objetivo: ["informar", "engajar"] },
};

const PALAVRAS: Array<[RegExp, Partial<Record<keyof Desejo, string[]>>]> = [
  [/bolsa/, { tema: ["bolsa-de-estudo"], objetivo: ["captacao-matricula"] }],
  [
    /desconto|% ?off|\d+ ?%|promoc/,
    { tema: ["desconto"], objetivo: ["promocao-oferta"], elementos: ["porcentagem"] },
  ],
  [/matricula|inscric/, { tema: ["matricula-aberta"], objetivo: ["captacao-matricula"] }],
  [/vestibular/, { tema: ["vestibular"] }],
  [/\benem\b/, { tema: ["enem"] }],
  [/ultimos dias|ultima chance|prazo|so ate|encerra/, { tema: ["prazo-ultimos-dias"] }],
  [/\bvagas?\b|emprego|contrata/, { tema: ["vaga-de-emprego"], objetivo: ["recrutar"] }],
  [/aviso|comunicado|informamos/, { tema: ["aviso-comunicado"], objetivo: ["informar"] }],
  [
    /evento|palestra|workshop|feira|aula inaugural/,
    { tema: ["evento"], objetivo: ["divulgar-evento"] },
  ],
  [/tecnico/, { tema: ["curso-tecnico"] }],
  [/segunda graduacao/, { tema: ["segunda-graduacao"] }],
  [/graduacao|faculdade|bacharel|licenciatura|tecnologo/, { tema: ["graduacao"] }],
  [/pos[- ]graduacao|\bpos\b|mba|especializacao/, { tema: ["pos-graduacao"] }],
  [/\bead\b|a distancia|online/, { tema: ["ead"], elementos: ["notebook-ou-celular"] }],
  [/cursos? livres?/, { tema: ["cursos-livres"] }],
  [/carreira|profiss|mercado de trabalho/, { tema: ["profissao-carreira"] }],
  [/depoimento/, { tema: ["depoimento"] }],
  [/aprovad/, { tema: ["resultado-aprovacao"] }],
  [/formatura|formand/, { elementos: ["formatura-beca"] }],
  [/qr ?code/, { elementos: ["qr-code"] }],
];

/** Estilos que a ficha da marca pode pedir por escrito (os de luz/contraste
 * ficam de fora: são consequência da paleta, não escolha de referência). */
const ESTILOS_DA_FICHA = [
  "acolhedor",
  "popular",
  "institucional",
  "corporativo",
  "jovem",
  "moderno",
  "minimalista",
  "editorial",
  "premium",
  "ludico",
  "tipografico",
  "fotografico",
  "ilustrado",
  "vibrante",
  "sobrio",
];

function desejoDaSolicitacao(tipo: string, textoPedido: string, textoMarca: string): Desejo {
  const d: Desejo = {
    tema: new Set(),
    objetivo: new Set(),
    estilo: new Set(["acolhedor", "popular"]), // direção criativa geral
    elementos: new Set(["pessoa-estudando", "pessoa-sorrindo"]),
    composicao: new Set(["pessoa-em-destaque"]),
  };
  const somar = (p: Partial<Record<keyof Desejo, string[]>>) => {
    for (const [k, vs] of Object.entries(p) as Array<[keyof Desejo, string[]]>) {
      for (const v of vs) d[k].add(v);
    }
  };
  somar(DESEJO_POR_TIPO[tipo] ?? {});
  const pedido = normalizar(textoPedido);
  for (const [re, p] of PALAVRAS) if (re.test(pedido)) somar(p);
  const marca = normalizar(textoMarca);
  for (const e of ESTILOS_DA_FICHA) if (marca.includes(e)) d.estilo.add(e);
  return d;
}

type LinhaReferencia = {
  id: string;
  titulo: string;
  descricao: string | null;
  path: string;
  mime_type: string;
  largura: number | null;
  altura: number | null;
  metadados: unknown;
  criado_em: string;
};

export type ReferenciaEscolhida = {
  id: string;
  titulo: string;
  descricao: string | null;
  path: string;
  mime_type: string;
  ia: MetadadosIA | null;
  pontos: number | null;
  criterio: "analise" | "fallback";
};

async function referenciasDoTipo(tipo: string): Promise<LinhaReferencia[]> {
  const { data, error } = await supabaseAdmin
    .from("art_references")
    .select("id, titulo, descricao, path, mime_type, largura, altura, metadados, criado_em")
    .eq("ativo", true)
    .is("projeto_id", null)
    .contains("tipos_arte", [tipo])
    .order("criado_em", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function embaralhar<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function selecionarReferencias(
  tipo: string,
  desejo: Desejo,
  alvo: { largura: number; altura: number },
  qtd = 3,
): Promise<{ tipoUsado: string; refs: ReferenciaEscolhida[] }> {
  let tipoUsado = tipo;
  let linhas = await referenciasDoTipo(tipo);
  // Carrossel sem acervo próprio usa as referências de feed (provisório).
  if (linhas.length === 0 && tipo === "carrossel") {
    tipoUsado = "feed";
    linhas = await referenciasDoTipo("feed");
  }

  const rAlvo = alvo.largura / alvo.altura;
  const conta = (tags: string[] | undefined, s: Set<string>) =>
    (tags ?? []).filter((t) => s.has(t)).length;

  const pontuadas = linhas
    .filter((l) => statusAnalise(l.metadados) === "analisada")
    .map((l) => {
      const ia = metadadosIA(l.metadados)!;
      const proporcao =
        l.largura && l.altura
          ? Math.max(0, 1 - Math.abs(Math.log(l.largura / l.altura / rAlvo)) / Math.log(2))
          : 0.5;
      const pontos =
        3 * conta(ia.tags_tema, desejo.tema) +
        2 * conta(ia.tags_objetivo, desejo.objetivo) +
        1.5 * conta(ia.tags_estilo, desejo.estilo) +
        1 * conta(ia.tags_elementos, desejo.elementos) +
        0.5 * conta(ia.tags_composicao, desejo.composicao) +
        2 * proporcao +
        (ia.uso_pessoa_foto?.presente ? 1 : 0) -
        (ia.aviso_logo_terceiro ? 0.5 : 0) +
        Math.random() * 0.75;
      return { l, ia, pontos };
    })
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, qtd);

  const refs: ReferenciaEscolhida[] = pontuadas.map(({ l, ia, pontos }) => ({
    id: l.id,
    titulo: l.titulo,
    descricao: l.descricao,
    path: l.path,
    mime_type: l.mime_type,
    ia,
    pontos: Number(pontos.toFixed(2)),
    criterio: "analise",
  }));

  // Sem análise (ou poucas): completa com recentes + aleatórias do mesmo tipo.
  // Sem nenhuma analisada, vão 4 (2 recentes + 2 sorteadas).
  const meta = refs.length === 0 ? 4 : qtd;
  if (refs.length < meta) {
    const usados = new Set(refs.map((r) => r.id));
    const resto = linhas.filter((l) => !usados.has(l.id));
    const faltam = meta - refs.length;
    const recentes = resto.slice(0, Math.ceil(faltam / 2));
    const sorteadas = embaralhar(resto.slice(recentes.length)).slice(0, faltam - recentes.length);
    for (const l of [...recentes, ...sorteadas]) {
      refs.push({
        id: l.id,
        titulo: l.titulo,
        descricao: l.descricao,
        path: l.path,
        mime_type: l.mime_type,
        ia: metadadosIA(l.metadados),
        pontos: null,
        criterio: "fallback",
      });
    }
  }
  return { tipoUsado, refs };
}

/* ---------------- Imagens anexadas ---------------- */

type Anexo = {
  papel: "logo" | "referencia_global" | "elemento_obrigatorio" | "referencia_solicitante";
  id: string;
  rotulo: string;
  blob: Blob;
  nome: string;
};

const ANEXO_MAX_BYTES = 10 * MB;
const ANEXOS_TOTAL_MAX_BYTES = 35 * MB; // folga dentro dos 128 MB do Worker

async function baixar(
  bucket: string,
  path: string,
  mime: string,
): Promise<{ blob: Blob; bytes: number } | null> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
  if (error || !data) return null;
  if (data.size <= 0 || data.size > ANEXO_MAX_BYTES) return null;
  // Força o content-type certo: o multipart da OpenAI decide o formato por ele.
  return { blob: new Blob([await data.arrayBuffer()], { type: mime }), bytes: data.size };
}

type ArquivoSolicitante = {
  id: string;
  path: string;
  categoria: string;
  mime_type: string;
  nome_arquivo: string;
  confirmado: boolean;
};

async function montarAnexos(
  marca: Marca,
  refs: ReferenciaEscolhida[],
  arquivos: ArquivoSolicitante[],
): Promise<{ anexos: Anexo[]; ignorados: string[] }> {
  const pedidos: Array<
    Omit<Anexo, "blob" | "nome"> & { bucket: string; path: string; mime: string }
  > = [];
  if (marca.logo && RASTER.includes(marca.logo.mime_type)) {
    pedidos.push({
      papel: "logo",
      id: marca.logo.id,
      rotulo: `logo "${marca.logo.nome}"`,
      bucket: BUCKET_MARCA,
      path: marca.logo.path,
      mime: marca.logo.mime_type,
    });
  }
  for (const r of refs) {
    pedidos.push({
      papel: "referencia_global",
      id: r.id,
      rotulo: r.titulo,
      bucket: BUCKET_REFERENCIAS,
      path: r.path,
      mime: r.mime_type,
    });
  }
  const confirmados = arquivos.filter((f) => f.confirmado && RASTER.includes(f.mime_type));
  for (const f of confirmados.filter((x) => x.categoria === "elemento_obrigatorio").slice(0, 4)) {
    pedidos.push({
      papel: "elemento_obrigatorio",
      id: f.id,
      rotulo: f.nome_arquivo,
      bucket: BUCKET_ARQUIVOS,
      path: f.path,
      mime: f.mime_type,
    });
  }
  for (const f of confirmados.filter((x) => x.categoria === "referencia").slice(0, 2)) {
    pedidos.push({
      papel: "referencia_solicitante",
      id: f.id,
      rotulo: f.nome_arquivo,
      bucket: BUCKET_ARQUIVOS,
      path: f.path,
      mime: f.mime_type,
    });
  }

  const anexos: Anexo[] = [];
  const ignorados: string[] = [];
  let total = 0;
  for (const p of pedidos.slice(0, MAX_ANEXOS)) {
    const arq = await baixar(p.bucket, p.path, p.mime);
    if (!arq || total + arq.bytes > ANEXOS_TOTAL_MAX_BYTES) {
      ignorados.push(`${p.papel}:${p.id}`);
      continue;
    }
    total += arq.bytes;
    const ext = p.mime === "image/png" ? "png" : p.mime === "image/webp" ? "webp" : "jpg";
    anexos.push({
      papel: p.papel,
      id: p.id,
      rotulo: p.rotulo,
      blob: arq.blob,
      nome: `${anexos.length + 1}-${p.papel}.${ext}`,
    });
  }
  return { anexos, ignorados };
}

/* ---------------- Prompt ---------------- */

const corta = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

function blocoReferencia(r: ReferenciaEscolhida, n: number | null): string {
  const cab = `### Referência de layout${n ? ` (imagem ${n})` : ""}: ${r.titulo}`;
  const ia = r.ia;
  if (!ia?.estrutura_reaproveitavel) {
    return [cab, r.descricao ? `- Descrição da equipe: ${corta(r.descricao, 600)}` : null]
      .filter(Boolean)
      .join("\n");
  }
  return [
    cab,
    `- Estrutura a reaproveitar: ${corta(ia.estrutura_reaproveitavel, 700)}`,
    ia.composicao && `- Composição: ${corta(ia.composicao, 500)}`,
    ia.hierarquia_texto && `- Hierarquia do texto: ${corta(ia.hierarquia_texto, 500)}`,
    ia.posicionamento_elementos &&
      `- Posição dos elementos: ${corta(ia.posicionamento_elementos, 400)}`,
    ia.cta?.presente &&
      `- Chamada para ação: ${[ia.cta.posicao, ia.cta.estilo].filter(Boolean).join(", ")}`,
    ia.tipo_fundo &&
      `- Fundo: ${ia.tipo_fundo.categoria}, luminosidade ${ia.tipo_fundo.luminosidade} (tom vem da paleta da marca)`,
    ia.uso_pessoa_foto?.presente && `- Pessoa/foto: ${corta(ia.uso_pessoa_foto.descricao, 400)}`,
    ia.observacoes_geracao && `- Por que funciona: ${corta(ia.observacoes_geracao, 500)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

type ArteParaPrompt = {
  tipo: string;
  briefing: string | null;
  campos: unknown;
  qtd_slides: number;
  data_comemorativa: string | null;
  largura_px: number;
  altura_px: number;
  medida_impressao: unknown;
};

function montarPrompt(
  art: ArteParaPrompt,
  marca: Marca,
  refs: ReferenciaEscolhida[],
  anexos: Anexo[],
  gerado: { largura: number; altura: number; proporcaoAjustada: boolean },
): string {
  const empresa = marca.nome ?? "a empresa";
  const numero = (papel: Anexo["papel"], id: string) => {
    const i = anexos.findIndex((a) => a.papel === papel && a.id === id);
    return i >= 0 ? i + 1 : null;
  };
  const faixa = (papel: Anexo["papel"]) =>
    anexos.flatMap((a, i) => (a.papel === papel ? [i + 1] : []));
  const lista = (ns: number[]) =>
    ns.length === 1 ? `Imagem ${ns[0]}` : `Imagens ${ns.slice(0, -1).join(", ")} e ${ns.at(-1)}`;

  const orientacao =
    art.largura_px === art.altura_px
      ? "quadrada"
      : art.largura_px > art.altura_px
        ? "horizontal"
        : "vertical";

  const secoes: Array<string | null> = [];
  secoes.push(
    `Crie uma arte de marketing educacional NOVA e finalizada, pronta para publicar, para ${empresa}.`,
  );

  secoes.push(
    [
      "## Peça",
      `- Tipo: ${rotuloTipo(art.tipo)}`,
      `- Tamanho final de entrega: ${art.largura_px} × ${art.altura_px} px (${orientacao}). Componha para essa proporção, com margem de segurança de ~6% nas bordas para textos e logo.`,
      gerado.proporcaoAjustada
        ? "- A proporção pedida é mais alongada que a tela de geração: deixe o conteúdo essencial numa faixa central, com fundo contínuo nas pontas, porque a arte será recortada."
        : null,
      art.tipo === "panfleto"
        ? "- Peça impressa (panfleto): leitura de perto, pode ter um pouco mais de informação, organizada em blocos."
        : null,
      art.tipo === "stories"
        ? "- Stories: deixe livres os ~12% de cima e de baixo (interface do Instagram)."
        : null,
      ...camposParaExibir(art)
        .filter((c) => c.rotulo !== "Formato")
        .map((c) => `- ${c.rotulo}: ${corta(c.valor, 1000)}`),
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (art.briefing?.trim()) {
    secoes.push(`## Briefing do solicitante\n${corta(art.briefing.trim(), 3000)}`);
  }

  secoes.push(
    [
      "## Direção criativa (sempre)",
      DIRECAO_CRIATIVA_EDUCACIONAL,
      "Pessoas brasileiras reais e diversas, em fotografia realista, estudando ou em momento de crescimento profissional, com expressão positiva. A mensagem central é oportunidade e acesso facilitado à educação.",
    ].join("\n"),
  );

  const logoN = marca.logo ? numero("logo", marca.logo.id) : null;
  secoes.push(
    [
      "## Identidade da marca (prevalece sobre as referências)",
      marca.paleta.length
        ? `- Paleta OBRIGATÓRIA: ${marca.paleta.join(", ")}. Use somente estas cores como cores de marca (fundos, faixas, botões, destaques); branco, preto e cinzas podem complementar.`
        : logoN
          ? `- Sem paleta cadastrada: tire as cores da logo (imagem ${logoN}).`
          : "- Sem paleta cadastrada: use uma paleta sóbria e confiável, sem copiar as cores das referências.",
      marca.slogan && `- Slogan: "${corta(marca.slogan, 300)}"`,
      marca.estilo_visual && `- Estilo visual recomendado: ${corta(marca.estilo_visual, 1200)}`,
      marca.briefing && `- Sobre a marca: ${corta(marca.briefing, 1500)}`,
      marca.observacao_ia && `- Observações para a geração: ${corta(marca.observacao_ia, 1200)}`,
      marca.tags.length ? `- Palavras-chave da marca: ${marca.tags.join(", ")}` : null,
      marca.fonte_nome && `- Tipografia da marca: ${marca.fonte_nome} (use uma fonte parecida).`,
      marca.evitar && `- EVITAR: ${corta(marca.evitar, 1200)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const imagens: string[] = [];
  if (logoN) {
    imagens.push(
      `- Imagem ${logoN}: LOGO OFICIAL de ${empresa}. Reproduza exatamente (mesmo desenho, letras e proporção), sem redesenhar, distorcer ou recolorir. Posicione com destaque e área de respiro.`,
    );
  }
  const refsN = faixa("referencia_global");
  if (refsN.length) {
    imagens.push(
      `- ${lista(refsN)}: REFERÊNCIAS DE LAYOUT do acervo da agência, feitas para outras marcas. Use só a estrutura: composição, hierarquia do texto, posição da pessoa/foto, estilo da chamada e do CTA, distribuição dos elementos. NÃO copie cores, logos, nomes de instituições, textos, preços nem as pessoas.`,
    );
  }
  const elementosN = faixa("elemento_obrigatorio");
  if (elementosN.length) {
    imagens.push(
      `- ${lista(elementosN)}: ELEMENTOS OBRIGATÓRIOS enviados pelo solicitante. Devem aparecer na arte, reconhecíveis e sem distorção.`,
    );
  }
  const refSolN = faixa("referencia_solicitante");
  if (refSolN.length) {
    imagens.push(
      `- ${lista(refSolN)}: referências enviadas pelo solicitante. Inspire-se no clima e no conteúdo, sem copiar marcas de terceiros.`,
    );
  }
  if (imagens.length) secoes.push(`## Imagens anexadas\n${imagens.join("\n")}`);

  if (refs.length) {
    secoes.push(
      [
        "## Como usar as referências",
        ...refs.map((r) => blocoReferencia(r, numero("referencia_global", r.id))),
      ].join("\n\n"),
    );
  }

  secoes.push(
    [
      "## Regra de cores",
      "As cores das referências são só informação e NÃO devem ser usadas. Reaproveite estrutura, composição e hierarquia, trocando todas as cores pela paleta da marca. Se a referência é verde e a marca é rosa, a arte sai rosa.",
    ].join("\n"),
  );

  secoes.push(
    [
      "## Texto na arte",
      "- Todo texto em português do Brasil, com ortografia e acentos corretos.",
      "- Use só informações do briefing e dos campos acima. Não invente preços, percentuais, datas, telefones, endereços, sites, nomes de cursos ou de instituições.",
      "- Pouco texto: um título forte, um apoio curto e uma chamada para ação clara.",
      "- Texto nítido e legível, com alto contraste sobre o fundo.",
    ].join("\n"),
  );

  secoes.push(
    [
      "## Proibido",
      "- Logos, nomes ou marcas de outras empresas e instituições.",
      "- Marca d'água, mockup (moldura de celular, tela, papel) ou bordas artificiais.",
      "- Texto em inglês, letras deformadas ou texto de preenchimento.",
    ].join("\n"),
  );

  return secoes.filter(Boolean).join("\n\n").slice(0, 30000);
}

/* ---------------- Chamada à OpenAI ---------------- */

/** Erro devolvido pela API (HTTP != 2xx): a OpenAI não cobra a geração. */
class ErroOpenAI extends Error {}

type RespostaImagens = {
  data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  usage?: UsoOpenAI;
  error?: { message?: string; code?: string };
};

function mensagemAmigavel(status: number, corpo: RespostaImagens | null): string {
  const msg = corpo?.error?.message ?? "";
  if (status === 401) return "Chave da OpenAI inválida ou revogada (OPENAI_API_KEY).";
  if (status === 429) {
    return /quota|billing|credit/i.test(msg)
      ? "A conta da OpenAI está sem créditos. Recarregue e tente de novo."
      : "Limite de uso da OpenAI por minuto atingido. Tente de novo em instantes.";
  }
  if (status === 400 && /safety|moderation/i.test(msg)) {
    return "A OpenAI recusou este pedido pelo filtro de segurança. Revise o briefing e as imagens.";
  }
  return `A OpenAI recusou a geração (HTTP ${status})${msg ? `: ${msg.slice(0, 300)}` : "."}`;
}

async function chamarOpenAI(p: {
  modelo: string;
  prompt: string;
  size: string;
  anexos: Anexo[];
}): Promise<{ corpo: RespostaImagens; requestId: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada no servidor.");

  const parametros: Record<string, string> = {
    model: p.modelo,
    prompt: p.prompt,
    n: String(GERACAO_VARIACOES),
    size: p.size,
    quality: GERACAO_QUALIDADE,
    output_format: "png",
  };
  const signal = AbortSignal.timeout(OPENAI_TIMEOUT_MS);
  let resp: Response;
  if (p.anexos.length > 0) {
    // Com imagens de entrada: /images/edits, multipart com image[] repetido.
    const form = new FormData();
    for (const [k, v] of Object.entries(parametros)) form.append(k, v);
    for (const a of p.anexos) form.append("image[]", a.blob, a.nome);
    resp = await fetch(`${OPENAI_URL}/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    });
  } else {
    resp = await fetch(`${OPENAI_URL}/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...parametros, n: GERACAO_VARIACOES }),
      signal,
    });
  }
  const requestId = resp.headers.get("x-request-id");
  const corpo = (await resp.json().catch(() => null)) as RespostaImagens | null;
  if (!resp.ok || !corpo) {
    console.error("[arte-ia] OpenAI recusou", resp.status, requestId, corpo?.error);
    throw new ErroOpenAI(mensagemAmigavel(resp.status, corpo));
  }
  return { corpo, requestId };
}

function deBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------------- Execução completa ----------------
 * Validações, reserva de custo, job (trava contra clique duplo), referências,
 * prompt, chamada, upload e registros. NÃO muda o status da arte: quem chama
 * faz isso com o JWT do membro, para o trigger registrar a autoria. */

const custo4 = (n: number) => Number(n.toFixed(4));

export async function executarGeracaoIA(
  artRequestId: string,
  userId: string,
): Promise<{ job_id: string; art_request_id: string; custoUsd: number; imagens: number }> {
  const cfg = configGeracao();
  if (!cfg.configurado) throw new Error("OPENAI_API_KEY não configurada no servidor.");

  const { data: art, error } = await supabaseAdmin
    .from("art_requests")
    .select(
      "id, tipo, status, briefing, campos, largura_px, altura_px, medida_impressao, qtd_slides, data_comemorativa, max_geracoes, projeto_id, projetos(nome), art_request_files(id, path, categoria, mime_type, nome_arquivo, confirmado)",
    )
    .eq("id", artRequestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!art) throw new Error("Demanda de arte não encontrada.");
  if (art.tipo === "foto_perfil") {
    throw new Error("Foto de perfil não é gerada com IA: ela usa o modelo fixo com moldura.");
  }
  if (!podeGerarComIA(art.tipo)) {
    throw new Error(`${rotuloTipo(art.tipo)} ainda não tem geração com IA. Use o envio manual.`);
  }
  if (!STATUS_GERA.includes(art.status)) {
    throw new Error("Só dá para gerar arte de uma demanda aceita.");
  }
  if (!entregaCabeNaGeracao(art.largura_px, art.altura_px)) {
    throw new Error(
      `Arte de ${art.largura_px}×${art.altura_px} px é grande demais para a geração com IA (até ${(GERACAO_ENTREGA_MAX_PX / 1e6).toFixed(1)} MP). Use o envio manual.`,
    );
  }

  await liberarGeracoesTravadas(art.id);

  // Teto da demanda (o trigger da Fase 1 confere de novo, com FOR UPDATE).
  const { count, error: errCount } = await supabaseAdmin
    .from("ai_generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("art_request_id", art.id)
    .eq("origem", "ia")
    .not("status", "in", "(falhou,cancelado)");
  if (errCount) throw new Error(errCount.message);
  if ((count ?? 0) >= art.max_geracoes) {
    throw new Error(`Esta arte já usou as ${art.max_geracoes} gerações com IA permitidas.`);
  }

  // Teto diário: a estimativa entra como reserva no próprio job, então duas
  // gerações simultâneas em artes diferentes enxergam uma à outra.
  const gerado = tamanhoDeGeracao(art.largura_px, art.altura_px);
  const areaPx = gerado.largura * gerado.altura;
  const estimativa = await estimarCustoGeracao(areaPx);
  const gastoHoje = await gastoGeracaoHoje();
  if (gastoHoje + estimativa > cfg.limiteDiarioUsd) {
    throw new Error(
      `${ERRO_TETO_GERACAO} (US$ ${gastoHoje.toFixed(2)} de US$ ${cfg.limiteDiarioUsd.toFixed(2)}; esta geração custa ~US$ ${estimativa.toFixed(2)}). Tente amanhã.`,
    );
  }

  const jobId = crypto.randomUUID();
  const agora = Date.now();
  const size = `${gerado.largura}x${gerado.altura}`;
  const parametros = {
    size,
    area_px: areaPx,
    quality: GERACAO_QUALIDADE,
    n: GERACAO_VARIACOES,
    output_format: "png",
    entrega: { largura: art.largura_px, altura: art.altura_px },
    proporcao_ajustada: gerado.proporcaoAjustada,
  };
  const { error: errJob } = await supabaseAdmin.from("ai_generation_jobs").insert({
    id: jobId,
    art_request_id: art.id,
    origem: "ia",
    status: "processando",
    qtd_variacoes: GERACAO_VARIACOES,
    solicitado_por: userId,
    iniciado_em: new Date(agora).toISOString(),
    lease_ate: new Date(agora + GERACAO_LEASE_MS).toISOString(),
    modelo: cfg.modelo,
    tentativas: 1,
    max_tentativas: 1,
    custo_estimado_usd: custo4(estimativa),
    parametros,
  });
  if (errJob) {
    // Índice ai_generation_jobs_um_ativo_idx: um job ativo por demanda.
    if (errJob.code === "23505") {
      throw new Error("Já há uma geração ou envio em andamento para esta arte.");
    }
    throw new Error(errJob.message);
  }

  const enviados: string[] = [];
  let custo = estimativa; // sem resposta da API, a reserva continua valendo
  try {
    const projetoNome = (art.projetos as { nome: string } | null)?.nome ?? null;
    const marca = await carregarMarca(art.projeto_id, projetoNome);
    const textoPedido = [
      art.briefing ?? "",
      ...Object.values((art.campos ?? {}) as Record<string, unknown>).map(String),
    ].join(" ");
    const textoMarca = [
      marca.estilo_visual,
      marca.briefing,
      marca.observacao_ia,
      ...marca.tags,
    ].join(" ");
    const desejo = desejoDaSolicitacao(art.tipo, textoPedido, textoMarca);
    const { tipoUsado, refs } = await selecionarReferencias(art.tipo, desejo, {
      largura: art.largura_px,
      altura: art.altura_px,
    });
    const { anexos, ignorados } = await montarAnexos(marca, refs, art.art_request_files);
    const prompt = montarPrompt(art, marca, refs, anexos, gerado);

    await supabaseAdmin
      .from("ai_generation_jobs")
      .update({
        prompt_final: prompt,
        prompt_versao: GERACAO_PROMPT_VERSAO,
        insumos: {
          referencias: refs.map((r) => ({ id: r.id, criterio: r.criterio, pontos: r.pontos })),
          referencias_tipo: tipoUsado,
          logo_id: marca.logo?.id ?? null,
          paleta: marca.paleta,
          anexos: anexos.map((a, i) => ({ imagem: i + 1, papel: a.papel, id: a.id })),
          ignorados,
          desejo: Object.fromEntries(Object.entries(desejo).map(([k, v]) => [k, [...v]])),
        } as Json,
      })
      .eq("id", jobId);

    let resposta: Awaited<ReturnType<typeof chamarOpenAI>>;
    try {
      resposta = await chamarOpenAI({ modelo: cfg.modelo, prompt, size, anexos });
    } catch (e) {
      if (e instanceof ErroOpenAI) custo = 0;
      throw e;
    }
    const uso = resposta.corpo.usage ?? null;
    custo = uso ? custoDoUso(cfg.modelo, uso) : estimativa;

    const imagens = (resposta.corpo.data ?? []).filter(
      (d): d is { b64_json: string; revised_prompt?: string } => typeof d.b64_json === "string",
    );
    if (imagens.length === 0) throw new Error("A OpenAI não devolveu nenhuma imagem.");

    // Para cada variação: a bruta da OpenAI fica guardada para auditoria
    // (-bruta.png, listada no job) e a normalizada no tamanho EXATO de entrega
    // é a que vira ai_generations — é ela que a equipe revisa e que é copiada
    // para approved-arts na aprovação.
    const salvar = async (path: string, bytes: Uint8Array<ArrayBuffer>) => {
      const { error: errUp } = await supabaseAdmin.storage
        .from(BUCKET_GERADAS)
        .upload(path, new Blob([bytes], { type: "image/png" }), {
          contentType: "image/png",
          upsert: true,
        });
      if (errUp) throw new Error(`Falha ao salvar a imagem gerada: ${errUp.message}`);
      enviados.push(path);
    };
    const linhas = [];
    const brutas = [];
    for (const [i, img] of imagens.slice(0, GERACAO_VARIACOES).entries()) {
      const bruta = deBase64(img.b64_json);
      const dimsBruta = dimensoesDoCabecalho(bruta);
      const final = normalizarPng(bruta, art.largura_px, art.altura_px);
      const base = `${art.id}/${jobId}/s01-v${i + 1}`;
      if (final.alterada) {
        await salvar(`${base}-bruta.png`, bruta);
        brutas.push({
          variacao: i + 1,
          path: `${base}-bruta.png`,
          largura: dimsBruta?.largura ?? null,
          altura: dimsBruta?.altura ?? null,
        });
      }
      const path = `${base}.png`;
      await salvar(path, final.bytes);
      linhas.push({
        job_id: jobId,
        art_request_id: art.id,
        slide_index: 1,
        variacao: i + 1,
        path,
        mime_type: "image/png",
        largura: final.largura,
        altura: final.altura,
        revised_prompt: img.revised_prompt?.slice(0, 4000) ?? null,
      });
    }
    const { error: errGen } = await supabaseAdmin.from("ai_generations").insert(linhas);
    if (errGen) throw new Error(errGen.message);

    const { error: errFim } = await supabaseAdmin
      .from("ai_generation_jobs")
      .update({
        status: "concluido",
        lease_ate: null,
        custo_estimado_usd: custo4(custo),
        uso: (uso ?? {}) as Json,
        openai_response_id: resposta.requestId,
        parametros: { ...parametros, brutas } as Json,
      })
      .eq("id", jobId);
    if (errFim) throw new Error(errFim.message);

    return { job_id: jobId, art_request_id: art.id, custoUsd: custo, imagens: linhas.length };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "Falha na geração.").slice(0, 500);
    await supabaseAdmin
      .from("ai_generation_jobs")
      .update({ status: "falhou", erro: msg, lease_ate: null, custo_estimado_usd: custo4(custo) })
      .eq("id", jobId);
    await removerObjetos(enviados, BUCKET_GERADAS);
    throw new Error(
      e instanceof DOMException && e.name === "TimeoutError"
        ? "A OpenAI demorou demais para responder. Tente de novo."
        : msg,
    );
  }
}
