/*
 * Análise das referências globais com IA (visão) — vocabulário, formato e
 * status. Arquivo compartilhado (sem segredo nem chamada externa): a tela usa
 * os rótulos e o status; o servidor usa o vocabulário para pedir e validar.
 *
 * Tudo da análise fica em art_references.metadados.ia. As tags também vão
 * para art_references.tags com prefixo (tema:, objetivo:, estilo:,
 * composicao:, elemento:), para a busca por tag; tags digitadas pela equipe
 * (sem prefixo) nunca são tocadas.
 *
 * REGRA DE COR: a cor da referência é informação, nunca filtro. A arte gerada
 * reaproveita estrutura, composição e hierarquia da referência e troca as
 * cores pela paleta da empresa. Por isso as cores originais ficam fora das
 * tags e só existem tags genéricas de luminosidade/contraste/energia.
 */

/** Sobe quando o prompt ou o formato da análise mudar: o lote passa a tratar
 * análises de versão antiga como pendentes. */
export const ANALISE_VERSAO = "v1";

/** Esforço do modelo na análise. Médio é o padrão (lote e análise
 * automática); alto só por escolha na reanálise individual. */
export const ESFORCOS_ANALISE = ["medio", "alto"] as const;
export type EsforcoAnalise = (typeof ESFORCOS_ANALISE)[number];
export const ESFORCO_PADRAO: EsforcoAnalise = "medio";
export const ESFORCO_ROTULO: Record<EsforcoAnalise, string> = { medio: "médio", alto: "alto" };

/** Estimativa por imagem (Opus 5.5), só para o aviso antes do lote; depois
 * das primeiras análises a tela usa a média real de cada esforço. Medido em
 * 2026-10-07 (feed, banner, tráfego): médio US$ 0,048–0,055; alto
 * US$ 0,052–0,058. Arredondado para cima: imagem maior usa mais tokens. */
export const ANALISE_CUSTO_ESTIMADO_USD: Record<EsforcoAnalise, number> = {
  medio: 0.06,
  alto: 0.065,
};
export const ANALISE_LIMITE_DIARIO_PADRAO_USD = 3;
/** Limite da API de visão por imagem. O bucket aceita até 15 MB. */
export const ANALISE_IMAGEM_MAX_MB = 5;
/** Começo da mensagem de erro do teto: a tela para o lote ao recebê-la. */
export const ERRO_TETO_ANALISE = "Teto diário da análise de referências atingido";

export const VOCAB_TEMA = [
  "bolsa-de-estudo",
  "desconto",
  "matricula-aberta",
  "vestibular",
  "enem",
  "prazo-ultimos-dias",
  "vaga-de-emprego",
  "aviso-comunicado",
  "data-comemorativa",
  "evento",
  "curso-tecnico",
  "graduacao",
  "segunda-graduacao",
  "pos-graduacao",
  "ead",
  "cursos-livres",
  "profissao-carreira",
  "depoimento",
  "resultado-aprovacao",
  "institucional",
] as const;

export const VOCAB_OBJETIVO = [
  "captacao-matricula",
  "promocao-oferta",
  "gerar-lead",
  "informar",
  "recrutar",
  "divulgar-evento",
  "engajar",
  "comemorar",
  "fortalecer-marca",
] as const;

/** Inclui as únicas tags "de cor" permitidas: genéricas, nunca uma cor exata. */
export const VOCAB_ESTILO = [
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
  "fundo-claro",
  "fundo-escuro",
  "alto-contraste",
] as const;

export const VOCAB_COMPOSICAO = [
  "pessoa-em-destaque",
  "foto-de-fundo-inteiro",
  "foto-recortada",
  "titulo-grande",
  "texto-dominante",
  "pouco-texto",
  "muito-texto",
  "card-de-oferta",
  "lista-de-itens",
  "layout-dividido",
  "layout-centralizado",
  "layout-assimetrico",
  "grade-ou-colagem",
  "faixa-ou-tarja",
  "diagonal-dinamica",
  "moldura-ou-borda",
  "cta-no-rodape",
  "cta-no-centro",
  "cta-ao-lado",
  "logo-no-topo",
  "logo-no-rodape",
] as const;

export const VOCAB_ELEMENTO = [
  "pessoa-estudando",
  "pessoa-sorrindo",
  "grupo-de-pessoas",
  "profissional-trabalhando",
  "formatura-beca",
  "notebook-ou-celular",
  "livros",
  "selo-ou-badge",
  "porcentagem",
  "preco",
  "icones",
  "ilustracao",
  "formas-geometricas",
  "setas",
  "calendario-ou-data",
  "qr-code",
  "mascote",
  "objetos-da-profissao",
  "textura-ou-padrao",
] as const;

export const TIPOS_FUNDO = [
  "foto",
  "cor-solida",
  "gradiente",
  "textura",
  "ilustracao",
  "formas",
  "misto",
] as const;
export const LUMINOSIDADES_FUNDO = ["claro", "medio", "escuro"] as const;

/** Formato de art_references.metadados.ia depois de uma análise. */
export type AnaliseReferencia = {
  descricao_visual: string;
  tags_tema: string[];
  tags_objetivo: string[];
  tags_estilo: string[];
  tags_composicao: string[];
  tags_elementos: string[];
  estrutura_reaproveitavel: string;
  composicao: string;
  hierarquia_texto: string;
  posicionamento_elementos: string;
  cta: { presente: boolean; posicao: string; estilo: string };
  tipo_fundo: { categoria: string; luminosidade: string; descricao: string };
  uso_pessoa_foto: { presente: boolean; descricao: string };
  cores_originais: string[];
  cores_substituiveis: true;
  observacoes_geracao: string;
  aviso_logo_terceiro: boolean;
  aviso_logo_terceiro_detalhe: string;
};

export type StatusAnalise = "pendente" | "analisando" | "analisada" | "erro";

export type MetadadosIA = Partial<AnaliseReferencia> & {
  status?: StatusAnalise;
  versao?: string;
  modelo_usado?: string;
  esforco?: EsforcoAnalise;
  custo_estimado?: number;
  analisado_em?: string;
  iniciado_em?: string;
  erro?: string;
  /** Falha de uma REanálise: a análise anterior continua valendo. */
  ultimo_erro?: string;
};

/** Uma análise "analisando" há mais que isto é considerada abandonada. */
export const ANALISE_TRAVADA_MS = 5 * 60 * 1000;

export function metadadosIA(metadados: unknown): MetadadosIA | null {
  const m = metadados as { ia?: unknown } | null;
  return m && typeof m.ia === "object" && m.ia !== null ? (m.ia as MetadadosIA) : null;
}

export function statusAnalise(metadados: unknown, agora = Date.now()): StatusAnalise {
  const ia = metadadosIA(metadados);
  if (!ia?.status) return "pendente";
  if (ia.status === "analisando") {
    const desde = ia.iniciado_em ? Date.parse(ia.iniciado_em) : 0;
    if (agora - desde < ANALISE_TRAVADA_MS) return "analisando";
    // Abandonada: volta ao que era antes (análise anterior, se houver).
    return ia.analisado_em && ia.descricao_visual ? "analisada" : "pendente";
  }
  if (ia.status === "analisada" && ia.versao !== ANALISE_VERSAO) return "pendente";
  return ia.status;
}

export const STATUS_ANALISE_ROTULO: Record<StatusAnalise, string> = {
  pendente: "Pendente",
  analisando: "Analisando…",
  analisada: "Analisada",
  erro: "Erro",
};

/** Prefixos das tags geradas pela IA em art_references.tags. */
export const PREFIXOS_TAG = {
  tags_tema: "tema",
  tags_objetivo: "objetivo",
  tags_estilo: "estilo",
  tags_composicao: "composicao",
  tags_elementos: "elemento",
} as const;

export function ehTagDaIA(tag: string): boolean {
  return Object.values(PREFIXOS_TAG).some((p) => tag.startsWith(`${p}:`));
}

/** Tags com prefixo de uma análise, mais as tags manuais que já existiam. */
export function mesclarTags(tagsAtuais: string[], analise: AnaliseReferencia): string[] {
  const manuais = tagsAtuais.filter((t) => !ehTagDaIA(t));
  const daIA = (Object.keys(PREFIXOS_TAG) as Array<keyof typeof PREFIXOS_TAG>).flatMap((campo) =>
    analise[campo].map((t) => `${PREFIXOS_TAG[campo]}:${t}`),
  );
  return Array.from(new Set([...manuais, ...daIA]));
}

/** "pessoa-em-destaque" -> "pessoa em destaque" (exibição). */
export function rotuloTag(tag: string): string {
  return tag.replace(/-/g, " ");
}
