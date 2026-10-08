import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { BUCKET_REFERENCIAS } from "./arte.server";
import {
  ANALISE_CUSTO_ESTIMADO_USD,
  ANALISE_IMAGEM_MAX_MB,
  ANALISE_LIMITE_DIARIO_PADRAO_USD,
  ANALISE_TRAVADA_MS,
  ANALISE_VERSAO,
  ERRO_TETO_ANALISE,
  LUMINOSIDADES_FUNDO,
  mesclarTags,
  metadadosIA,
  statusAnalise,
  type MetadadosIA,
  TIPOS_FUNDO,
  VOCAB_COMPOSICAO,
  VOCAB_ELEMENTO,
  VOCAB_ESTILO,
  VOCAB_OBJETIVO,
  VOCAB_TEMA,
  type AnaliseReferencia,
  type EsforcoAnalise,
} from "./arte/analise-referencias";
import { rotuloTipo } from "./arte/tipos";

/* Análise das referências globais com Claude (visão). Só servidor: a chave
 * ANTHROPIC_API_KEY é lida dentro das funções (no Workers o env existe só
 * durante a requisição) e nunca sai daqui. */

const MB = 1024 * 1024;

export function configAnalise() {
  const limite = Number(process.env.IA_ANALISE_LIMITE_DIARIO_USD);
  return {
    configurado: !!process.env.ANTHROPIC_API_KEY,
    modelo: process.env.ARTE_ANALISE_MODELO || "claude-opus-5-5",
    limiteDiarioUsd: limite > 0 ? limite : ANALISE_LIMITE_DIARIO_PADRAO_USD,
  };
}

function cliente(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada no servidor.");
  return new Anthropic({ apiKey });
}

/* ---------------- Custo ---------------- */

/** US$ por 1M tokens. Modelo desconhecido (ex.: fallback novo) usa a linha
 * mais cara conhecida, para o teto errar para o lado seguro. */
const PRECOS: Record<string, { entrada: number; saida: number }> = {
  "claude-opus-5-5": { entrada: 4, saida: 20 },
  "claude-opus-5": { entrada: 5, saida: 25 },
  "claude-opus-4-8": { entrada: 5, saida: 25 },
  "claude-opus-4-7": { entrada: 5, saida: 25 },
  "claude-sonnet-5-5": { entrada: 2, saida: 10 },
  "claude-fable-5-1": { entrada: 10, saida: 50 },
};
const PRECO_DESCONHECIDO = { entrada: 10, saida: 50 };

type Tokens = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/** Preço do modelo; aceita id com sufixo (ex.: data) pelo prefixo mais longo. */
function precoDe(modelo: string | null | undefined) {
  if (!modelo) return null;
  if (PRECOS[modelo]) return PRECOS[modelo];
  const chave = Object.keys(PRECOS)
    .filter((k) => modelo.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return chave ? PRECOS[chave] : null;
}

function custoDe(p: { entrada: number; saida: number }, t: Tokens): number {
  const entrada =
    t.input_tokens +
    (t.cache_creation_input_tokens ?? 0) * 1.25 +
    (t.cache_read_input_tokens ?? 0) * 0.1;
  return (entrada * p.entrada + t.output_tokens * p.saida) / 1_000_000;
}

/** Com fallback, cada tentativa vem em usage.iterations com o próprio modelo.
 * Iteração sem modelo reconhecível usa o preço do modelo da resposta. */
function custoDaResposta(resp: Anthropic.Beta.BetaMessage): number {
  const precoResposta = precoDe(resp.model) ?? PRECO_DESCONHECIDO;
  const iteracoes = (resp.usage.iterations ?? []).filter(
    (i): i is typeof i & Tokens & { model?: string | null } =>
      "input_tokens" in i && "output_tokens" in i,
  );
  if (iteracoes.length > 0) {
    return iteracoes.reduce((s, i) => s + custoDe(precoDe(i.model) ?? precoResposta, i), 0);
  }
  return custoDe(precoResposta, resp.usage);
}

/* ---------------- Teto diário (separado do teto de geração) ----------------
 * O gasto fica em art_references.metadados.ia_gastos ({em, usd}), fora de
 * ai_generation_jobs, então não consome o teto da geração de artes. Falhas
 * depois da chamada também entram: a API cobrou. */

export type Gasto = { em: string; usd: number };

/** Início do dia em São Paulo (UTC-3, sem horário de verão desde 2019). */
export function inicioDoDiaSP(agora = new Date()): number {
  const sp = new Date(agora.getTime() - 3 * 3600 * 1000);
  return Date.parse(`${sp.toISOString().slice(0, 10)}T00:00:00-03:00`);
}

/** Gasto de hoje e custo médio real por análise, separado por esforço. */
export async function gastoAnaliseHoje(): Promise<{
  total: number;
  media: Record<EsforcoAnalise, number | null>;
}> {
  const { data, error } = await supabaseAdmin.from("art_references").select("metadados");
  if (error) throw new Error(error.message);
  const desde = inicioDoDiaSP();
  let total = 0;
  const custos: Record<EsforcoAnalise, number[]> = { medio: [], alto: [] };
  for (const r of data ?? []) {
    const m = r.metadados as {
      ia_gastos?: Gasto[];
      ia?: { custo_estimado?: number; esforco?: EsforcoAnalise };
    } | null;
    for (const g of m?.ia_gastos ?? []) if (Date.parse(g.em) >= desde) total += g.usd;
    const ia = m?.ia;
    if (typeof ia?.custo_estimado === "number" && ia.esforco && custos[ia.esforco]) {
      custos[ia.esforco].push(ia.custo_estimado);
    }
  }
  const mediaDe = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return { total, media: { medio: mediaDe(custos.medio), alto: mediaDe(custos.alto) } };
}

/* ---------------- Medidas da imagem (lendo o cabeçalho) ---------------- */

export function dimensoesDoCabecalho(b: Uint8Array): { largura: number; altura: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const ascii = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));

  // PNG: IHDR logo depois da assinatura.
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG") {
    return { largura: u32be(16), altura: u32be(20) };
  }
  // WebP: VP8 (com perdas), VP8L (sem perdas) ou VP8X (estendido).
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ") return { largura: u16le(26) & 0x3fff, altura: u16le(28) & 0x3fff };
    if (chunk === "VP8L") {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { largura: (v & 0x3fff) + 1, altura: ((v >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { largura: u24le(24) + 1, altura: u24le(27) + 1 };
    return null;
  }
  // JPEG: percorre os segmentos até um SOFn.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marcador = b[i + 1];
      if (marcador === 0xff) {
        i += 1;
        continue;
      }
      const sof =
        marcador >= 0xc0 &&
        marcador <= 0xcf &&
        marcador !== 0xc4 &&
        marcador !== 0xc8 &&
        marcador !== 0xcc;
      if (sof) return { altura: u16be(i + 5), largura: u16be(i + 7) };
      i += 2 + u16be(i + 2);
    }
  }
  return null;
}

async function lerMedidas(url: string): Promise<{ largura: number; altura: number } | null> {
  // O cabeçalho quase sempre está no começo; JPEG com EXIF grande pode
  // empurrar o SOF, então tenta o arquivo inteiro se o pedaço não bastar.
  const parcial = await fetch(url, { headers: { Range: "bytes=0-262143" } });
  if (parcial.ok) {
    const dims = dimensoesDoCabecalho(new Uint8Array(await parcial.arrayBuffer()));
    if (dims) return dims;
  }
  const inteiro = await fetch(url);
  if (!inteiro.ok) return null;
  return dimensoesDoCabecalho(new Uint8Array(await inteiro.arrayBuffer()));
}

/* ---------------- Formato pedido ao modelo ---------------- */

const esquemaAnalise = z.object({
  descricao_visual: z
    .string()
    .describe("Descrição visual curta e objetiva da peça, em português, até 300 caracteres."),
  tags_tema: z.array(z.enum(VOCAB_TEMA)).describe("Assunto da peça. De 1 a 4."),
  tags_objetivo: z.array(z.enum(VOCAB_OBJETIVO)).describe("Para que a peça serve. De 1 a 3."),
  tags_estilo: z.array(z.enum(VOCAB_ESTILO)).describe("Estilo visual. De 2 a 6."),
  tags_composicao: z.array(z.enum(VOCAB_COMPOSICAO)).describe("Estrutura da página. De 2 a 7."),
  tags_elementos: z.array(z.enum(VOCAB_ELEMENTO)).describe("Elementos visuais presentes. 0 a 8."),
  estrutura_reaproveitavel: z
    .string()
    .describe(
      "O esqueleto que vale copiar para outra marca: blocos, ordem de leitura, proporções e espaçamentos, sem citar cores.",
    ),
  composicao: z.string().describe("Como a área está dividida e onde o olhar entra e sai."),
  hierarquia_texto: z
    .string()
    .describe(
      "Níveis de texto em ordem de destaque (título, subtítulo, apoio, letras miúdas): tamanho relativo, peso e posição de cada um.",
    ),
  posicionamento_elementos: z
    .string()
    .describe("Onde ficam pessoa/foto, logo, selos, ícones e blocos de informação."),
  cta: z.object({
    presente: z.boolean(),
    posicao: z
      .string()
      .describe("Ex.: rodapé centralizado, canto inferior direito. Vazio se não houver."),
    estilo: z
      .string()
      .describe("Ex.: botão arredondado, faixa, texto com seta. Vazio se não houver."),
  }),
  tipo_fundo: z.object({
    categoria: z.enum(TIPOS_FUNDO),
    luminosidade: z.enum(LUMINOSIDADES_FUNDO),
    descricao: z.string(),
  }),
  uso_pessoa_foto: z.object({
    presente: z.boolean(),
    descricao: z
      .string()
      .describe(
        "Quem aparece, enquadramento, recorte, posição e o que a pessoa transmite. Vazio se não houver.",
      ),
  }),
  cores_originais: z
    .array(z.string())
    .describe("Até 6 cores predominantes da referência, em hexadecimal #RRGGBB. Só registro."),
  observacoes_geracao: z
    .string()
    .describe(
      "O que faz a peça funcionar e como reaproveitá-la ao gerar uma arte nova para outra marca. Até 600 caracteres.",
    ),
  aviso_logo_terceiro: z
    .boolean()
    .describe("true se a peça mostra logo, nome ou marca de alguma empresa/instituição."),
  aviso_logo_terceiro_detalhe: z
    .string()
    .describe("Qual marca aparece e onde. Vazio se aviso_logo_terceiro for false."),
});

/** Leitura da resposta: mesmo formato, mas tags e categorias como texto livre
 * (filtradas depois), para uma tag fora da lista não derrubar a análise. */
const esquemaLeitura = esquemaAnalise.extend({
  tags_tema: z.array(z.string()),
  tags_objetivo: z.array(z.string()),
  tags_estilo: z.array(z.string()),
  tags_composicao: z.array(z.string()),
  tags_elementos: z.array(z.string()),
  tipo_fundo: z.object({ categoria: z.string(), luminosidade: z.string(), descricao: z.string() }),
});

const SISTEMA = `Você analisa artes de referência de uma agência de marketing educacional brasileira. A análise fica salva e será usada depois para gerar artes NOVAS, para OUTRAS empresas, no estilo desta referência.

Para que serve cada análise:
- A referência empresta estrutura: layout, composição, hierarquia de texto, posição do texto e da pessoa/foto, estilo da chamada, estrutura do CTA e distribuição dos elementos.
- A referência NÃO empresta cores. A arte nova sempre usa a paleta da empresa escolhida. Uma referência verde serve perfeitamente para uma marca rosa.

Por isso:
- Descreva estrutura, composição, hierarquia, posições e CTA sem depender de cor ("faixa no rodapé", não "faixa verde no rodapé"). Diga o papel do contraste ("título claro sobre fundo escuro"), não o tom.
- Registre as cores só em cores_originais, como informação.
- Nas tags de estilo, use no máximo os termos genéricos de luz e energia (fundo-claro, fundo-escuro, alto-contraste, vibrante, sobrio). Nunca escolha tags pela cor exata.

Seja específico e útil para quem vai recriar a peça: proporções aproximadas ("título ocupa o terço superior"), ordem de leitura, quantidade de texto. Não invente o que não está na imagem. Escreva em português do Brasil. Escolha as tags só da lista permitida, as que realmente se aplicam.`;

export type ResultadoAnalise = {
  analise: AnaliseReferencia;
  modelo: string;
  custoUsd: number;
  tokens: { entrada: number; saida: number };
  medidas: { largura: number; altura: number } | null;
};

const EFFORT_API: Record<EsforcoAnalise, "medium" | "high"> = { medio: "medium", alto: "high" };

/** Erro depois de a API já ter cobrado: o custo vai junto para o teto. */
export class ErroAnaliseCobrada extends Error {
  constructor(
    message: string,
    readonly custoUsd: number,
  ) {
    super(message);
  }
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

export async function analisarImagemReferencia(
  ref: {
    path: string;
    titulo: string;
    categoria: string | null;
    tipos_arte: string[];
    descricao: string | null;
  },
  esforco: EsforcoAnalise,
): Promise<ResultadoAnalise> {
  const { modelo } = configAnalise();

  const { data: info, error: errInfo } = await supabaseAdmin.storage
    .from(BUCKET_REFERENCIAS)
    .info(ref.path);
  if (errInfo || !info) throw new Error("Arquivo da referência não encontrado no storage.");
  if ((info.size ?? 0) > ANALISE_IMAGEM_MAX_MB * MB) {
    throw new Error(
      `Imagem acima de ${ANALISE_IMAGEM_MAX_MB} MB: a análise aceita até ${ANALISE_IMAGEM_MAX_MB} MB.`,
    );
  }
  const { data: assinada, error: errUrl } = await supabaseAdmin.storage
    .from(BUCKET_REFERENCIAS)
    .createSignedUrl(ref.path, 10 * 60);
  if (errUrl || !assinada) throw new Error("Falha ao gerar o link da imagem.");

  const medidas = await lerMedidas(assinada.signedUrl).catch(() => null);

  const contexto = [
    `Pasta (tipo de arte): ${ref.tipos_arte.map(rotuloTipo).join(", ")}`,
    `Título: ${ref.titulo}`,
    ref.categoria ? `Categoria: ${ref.categoria}` : null,
    ref.descricao ? `Observação da equipe: ${ref.descricao}` : null,
    medidas ? `Tamanho: ${medidas.largura} × ${medidas.altura} px` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // create (não parse): a leitura é feita aqui, tolerante a tag fora do
  // vocabulário, e o custo é registrado mesmo se a resposta vier ruim.
  const resp = await cliente().beta.messages.create({
    model: modelo,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SISTEMA,
    output_config: { effort: EFFORT_API[esforco], format: betaZodOutputFormat(esquemaAnalise) },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: assinada.signedUrl } },
          { type: "text", text: `Analise esta referência.\n\n${contexto}` },
        ],
      },
    ],
  });

  const custoUsd = custoDaResposta(resp);
  if (resp.stop_reason === "refusal") {
    throw new ErroAnaliseCobrada("O modelo recusou analisar esta imagem.", custoUsd);
  }
  if (resp.stop_reason === "max_tokens") {
    throw new ErroAnaliseCobrada("A resposta da análise veio incompleta.", custoUsd);
  }
  const texto = resp.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new ErroAnaliseCobrada("A resposta da análise não veio em JSON.", custoUsd);
  }
  const lido = esquemaLeitura.safeParse(bruto);
  if (!lido.success) {
    throw new ErroAnaliseCobrada("A resposta da análise veio em formato inválido.", custoUsd);
  }
  const p = lido.data;

  const unicos = <T>(xs: T[], max: number) => Array.from(new Set(xs)).slice(0, max);
  // O formato pedido já limita as tags ao vocabulário, mas o modelo às vezes
  // escapa: tag desconhecida é descartada em vez de perder a análise inteira.
  const doVocab = <T extends string>(xs: string[], vocab: readonly T[], max: number) =>
    unicos(
      xs.filter((t): t is T => (vocab as readonly string[]).includes(t)),
      max,
    );
  const analise: AnaliseReferencia = {
    ...p,
    descricao_visual: p.descricao_visual.trim().slice(0, 400),
    tags_tema: doVocab(p.tags_tema, VOCAB_TEMA, 6),
    tags_objetivo: doVocab(p.tags_objetivo, VOCAB_OBJETIVO, 4),
    tags_estilo: doVocab(p.tags_estilo, VOCAB_ESTILO, 8),
    tags_composicao: doVocab(p.tags_composicao, VOCAB_COMPOSICAO, 9),
    tags_elementos: doVocab(p.tags_elementos, VOCAB_ELEMENTO, 10),
    tipo_fundo: {
      ...p.tipo_fundo,
      categoria: (TIPOS_FUNDO as readonly string[]).includes(p.tipo_fundo.categoria)
        ? p.tipo_fundo.categoria
        : "misto",
      luminosidade: (LUMINOSIDADES_FUNDO as readonly string[]).includes(p.tipo_fundo.luminosidade)
        ? p.tipo_fundo.luminosidade
        : "medio",
    },
    cores_originais: unicos(
      p.cores_originais.map((c) => c.trim().toUpperCase()).filter((c) => HEX.test(c)),
      6,
    ),
    cores_substituiveis: true,
    observacoes_geracao: p.observacoes_geracao.trim().slice(0, 1200),
    aviso_logo_terceiro_detalhe: p.aviso_logo_terceiro ? p.aviso_logo_terceiro_detalhe : "",
  };
  const tokens = {
    entrada:
      resp.usage.input_tokens +
      (resp.usage.cache_creation_input_tokens ?? 0) +
      (resp.usage.cache_read_input_tokens ?? 0),
    saida: resp.usage.output_tokens,
  };
  return { analise, modelo: resp.model, custoUsd, tokens, medidas };
}

/* ---------------- Execução completa de uma referência ----------------
 * Status, teto, trava contra execução dupla, chamada e gravação. Usada pela
 * server function (depois de checar a equipe interna) e por scripts de
 * manutenção com service role — uma única implementação. */

/** Guarda só os gastos recentes no histórico da referência. */
const GASTOS_GUARDADOS = 30;

export type ResultadoExecucao =
  | { resultado: "pulada" | "em_andamento" }
  | { resultado: "analisada"; custoUsd: number };

export async function executarAnaliseReferencia(
  id: string,
  opcoes: { forcar: boolean; esforco: EsforcoAnalise },
): Promise<ResultadoExecucao> {
  const cfg = configAnalise();
  if (!cfg.configurado) throw new Error("ANTHROPIC_API_KEY não configurada no servidor.");

  const { data: ref, error } = await supabaseAdmin
    .from("art_references")
    .select("id, titulo, categoria, tipos_arte, descricao, tags, path, metadados")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!ref) throw new Error("Referência não encontrada.");

  // Já analisada na versão atual: não paga de novo (o lote retoma daqui).
  const status = statusAnalise(ref.metadados);
  if (status === "analisando") return { resultado: "em_andamento" };
  if (status === "analisada" && !opcoes.forcar) return { resultado: "pulada" };

  const { total: gastoHoje, media } = await gastoAnaliseHoje();
  const proxima = media[opcoes.esforco] ?? ANALISE_CUSTO_ESTIMADO_USD[opcoes.esforco];
  if (gastoHoje + proxima > cfg.limiteDiarioUsd) {
    throw new Error(
      `${ERRO_TETO_ANALISE} (US$ ${gastoHoje.toFixed(2)} de US$ ${cfg.limiteDiarioUsd.toFixed(2)}). Continue amanhã.`,
    );
  }

  const base = (ref.metadados ?? {}) as Record<string, unknown>;
  const anterior = metadadosIA(ref.metadados);
  const gastos = (base.ia_gastos as Gasto[] | undefined) ?? [];
  const agora = new Date().toISOString();

  // Trava: só um processo analisa esta referência por vez. O filtro roda no
  // momento da escrita, então de dois cliques simultâneos só um "pega".
  const travadaAntes = new Date(Date.now() - ANALISE_TRAVADA_MS).toISOString();
  const { data: pegou, error: errTrava } = await supabaseAdmin
    .from("art_references")
    .update({
      metadados: {
        ...base,
        ia: { ...(anterior ?? {}), status: "analisando", iniciado_em: agora },
      } as Json,
    })
    .eq("id", ref.id)
    .or(
      `metadados->ia->>status.is.null,metadados->ia->>status.neq.analisando,metadados->ia->>iniciado_em.lt.${travadaAntes}`,
    )
    .select("id");
  if (errTrava) throw new Error(errTrava.message);
  if (!pegou || pegou.length === 0) return { resultado: "em_andamento" };

  const gravar = (ia: MetadadosIA, extras: Record<string, unknown>, custo: number) =>
    supabaseAdmin
      .from("art_references")
      .update({
        ...extras,
        metadados: {
          ...base,
          ia,
          ia_gastos:
            custo > 0 ? [...gastos, { em: agora, usd: custo }].slice(-GASTOS_GUARDADOS) : gastos,
        } as Json,
      })
      .eq("id", ref.id);

  try {
    const r = await analisarImagemReferencia(ref, opcoes.esforco);
    const ia: MetadadosIA = {
      ...r.analise,
      status: "analisada",
      versao: ANALISE_VERSAO,
      modelo_usado: r.modelo,
      esforco: opcoes.esforco,
      custo_estimado: Number(r.custoUsd.toFixed(4)),
      analisado_em: new Date().toISOString(),
    };
    const { error: errGrava } = await gravar(
      ia,
      {
        tags: mesclarTags(ref.tags ?? [], r.analise),
        // A descrição da equipe nunca é sobrescrita.
        ...(ref.descricao?.trim() ? {} : { descricao: r.analise.descricao_visual.slice(0, 2000) }),
        ...(r.medidas ? { largura: r.medidas.largura, altura: r.medidas.altura } : {}),
      },
      r.custoUsd,
    );
    if (errGrava) throw new ErroAnaliseCobrada(errGrava.message, r.custoUsd);
    return { resultado: "analisada", custoUsd: r.custoUsd };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "Falha na análise.").slice(0, 500);
    const custo = e instanceof ErroAnaliseCobrada ? e.custoUsd : 0;
    // Reanálise que falha não apaga a análise que já existia.
    const temAnterior = !!anterior?.analisado_em && !!anterior?.descricao_visual;
    const ia: MetadadosIA = temAnterior
      ? { ...anterior, status: anterior.status === "erro" ? "erro" : "analisada", ultimo_erro: msg }
      : { status: "erro", erro: msg, analisado_em: new Date().toISOString() };
    if (ia.status === "analisada") delete ia.iniciado_em;
    await gravar(ia, {}, custo);
    throw new Error(msg);
  }
}
