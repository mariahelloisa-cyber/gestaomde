import { z } from "zod";

/*
 * Configuração única dos tipos de arte — usada pelo formulário (o que mostrar)
 * e pelo servidor (o que aceitar). Tamanhos e limites espelham os CHECKs de
 * public.art_requests (20261006130000_arte_fase1_tabelas.sql); se mudar um,
 * mude o outro.
 */

export const TIPOS_ARTE = [
  "foto_perfil",
  "panfleto",
  "feed",
  "feed_data_comemorativa",
  "carrossel",
  "vaga_emprego",
  "aviso",
  "stories",
] as const;
export type TipoArte = (typeof TIPOS_ARTE)[number];

export type CategoriaArquivo = "foto_pessoa" | "referencia" | "elemento_obrigatorio";

/** Mesmos valores do bucket art-request-files (allowed_mime_types / file_size_limit). */
export const ARQUIVO_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ARQUIVO_TAMANHO_MAX_MB = 15;
export const ARQUIVO_TAMANHO_MAX = ARQUIVO_TAMANHO_MAX_MB * 1024 * 1024;

export const CARROSSEL_SLIDES_MIN = 2;
export const CARROSSEL_SLIDES_MAX = 10;

/* Panfleto: entregue em PNG nesta versão. Medidas em mm viram px a 150 dpi
 * (15x21cm -> 886x1240). PDF/300 dpi para gráfica fica para fase posterior. */
export const PANFLETO_PADRAO_MM = { largura: 150, altura: 210 } as const;
export const PANFLETO_DPI = 150;
export const PANFLETO_MM_MIN = 60;
export const PANFLETO_MM_MAX = 600;

type UploadConfig = {
  categoria: CategoriaArquivo;
  rotulo: string;
  obrigatorio: boolean;
  max: number;
};

type TipoConfig = {
  rotulo: string;
  /** Texto curto exibido abaixo do seletor de tipo. */
  formato: string;
  usaProjeto: boolean;
  uploads: UploadConfig[];
};

const REFERENCIA: UploadConfig = {
  categoria: "referencia",
  rotulo: "Referências (opcional)",
  obrigatorio: false,
  max: 5,
};
const ELEMENTOS: UploadConfig = {
  categoria: "elemento_obrigatorio",
  rotulo: "Elementos que devem aparecer no post (opcional)",
  obrigatorio: false,
  max: 10,
};

export const TIPOS_CONFIG: Record<TipoArte, TipoConfig> = {
  foto_perfil: {
    rotulo: "Foto de perfil",
    formato: "1080 × 1080 px",
    usaProjeto: false,
    uploads: [{ categoria: "foto_pessoa", rotulo: "Foto da pessoa *", obrigatorio: true, max: 1 }],
  },
  panfleto: {
    rotulo: "Arte panfleto",
    formato: "15 × 21 cm ou tamanho personalizado",
    usaProjeto: true,
    uploads: [REFERENCIA],
  },
  feed: {
    rotulo: "Arte feed comum",
    formato: "1080 × 1440 px",
    usaProjeto: true,
    uploads: [REFERENCIA, ELEMENTOS],
  },
  feed_data_comemorativa: {
    rotulo: "Arte feed data comemorativa",
    formato: "1080 × 1440 px",
    usaProjeto: true,
    uploads: [REFERENCIA, ELEMENTOS],
  },
  carrossel: {
    rotulo: "Carrossel",
    formato: `1080 × 1440 px por slide (${CARROSSEL_SLIDES_MIN} a ${CARROSSEL_SLIDES_MAX} slides)`,
    usaProjeto: true,
    uploads: [REFERENCIA, ELEMENTOS],
  },
  vaga_emprego: {
    rotulo: "Arte divulgar vagas de emprego",
    formato: "1080 × 1440 px",
    usaProjeto: true,
    uploads: [REFERENCIA],
  },
  aviso: {
    rotulo: "Avisos",
    formato: "1080 × 1440 px",
    usaProjeto: true,
    uploads: [REFERENCIA],
  },
  stories: {
    rotulo: "Stories",
    formato: "1080 × 1920 px",
    usaProjeto: true,
    uploads: [REFERENCIA],
  },
};

/** Tipos que usam referências globais. Foto de perfil fica de fora: é sempre
 * o mesmo modelo (muda só a moldura pelo nível), não se inspira em referência. */
export const TIPOS_ARTE_REFERENCIA = TIPOS_ARTE.filter(
  (t): t is Exclude<TipoArte, "foto_perfil"> => t !== "foto_perfil",
);

/* ---------------- Foto de perfil: nível do cargo -> moldura ----------------
 * Foto de perfil NÃO é arte generativa: é sempre o mesmo modelo. Muda só a
 * moldura (pelo nível) e os textos (nome e cargo). A geração futura compõe
 * foto + moldura + textos em 1080x1080, sem reinventar layout nem mexer no
 * rosto. O nível é escolhido pelo solicitante — nunca inferido do cargo. */

export const NIVEIS_CARGO = ["diretor", "supervisor", "gerente", "colaborador"] as const;
export type NivelCargo = (typeof NIVEIS_CARGO)[number];

export const NIVEL_CARGO_CONFIG: Record<
  NivelCargo,
  { rotulo: string; moldura: string; corPadrao: string }
> = {
  diretor: { rotulo: "Diretor", moldura: "preta", corPadrao: "#000000" },
  supervisor: { rotulo: "Supervisor", moldura: "vermelha", corPadrao: "#C62828" },
  gerente: { rotulo: "Gerente", moldura: "dourada", corPadrao: "#C9A227" },
  colaborador: { rotulo: "Colaborador", moldura: "branca", corPadrao: "#FFFFFF" },
};

export function rotuloNivel(nivel: string): string {
  return (
    (NIVEL_CARGO_CONFIG as Record<string, { rotulo: string } | undefined>)[nivel]?.rotulo ?? nivel
  );
}

export const CATEGORIA_ROTULO: Record<CategoriaArquivo, string> = {
  foto_pessoa: "Foto da pessoa",
  referencia: "Referência",
  elemento_obrigatorio: "Elemento obrigatório",
};

/* ---------------- Validação do formulário ---------------- */

const texto = (max: number, nome: string) =>
  z.string().trim().min(1, `Preencha ${nome}.`).max(max, `${nome} passa de ${max} caracteres.`);
const briefing = texto(5000, "o briefing");
const projetoId = z.string().uuid("Escolha a empresa.");

const medidaMm = z
  .number({ invalid_type_error: "Informe a medida em mm." })
  .int("Use mm inteiros.")
  .min(PANFLETO_MM_MIN, `Medida mínima: ${PANFLETO_MM_MIN} mm.`)
  .max(PANFLETO_MM_MAX, `Medida máxima: ${PANFLETO_MM_MAX} mm.`);

export const solicitacaoArteSchema = z
  .discriminatedUnion("tipo", [
    z.object({
      tipo: z.literal("foto_perfil"),
      nome: texto(120, "o nome"),
      nivel_cargo: z.enum(NIVEIS_CARGO, {
        errorMap: () => ({ message: "Escolha o nível do cargo." }),
      }),
      cargo: texto(120, "o cargo"),
    }),
    z.object({
      tipo: z.literal("panfleto"),
      projeto_id: projetoId,
      briefing,
      tamanho: z.enum(["padrao", "personalizado"]),
      largura_mm: medidaMm.optional(),
      altura_mm: medidaMm.optional(),
    }),
    z.object({ tipo: z.literal("feed"), projeto_id: projetoId, briefing }),
    z.object({
      tipo: z.literal("feed_data_comemorativa"),
      projeto_id: projetoId,
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data comemorativa."),
      descricao_data: texto(200, "o nome da data"),
      briefing,
    }),
    z.object({
      tipo: z.literal("carrossel"),
      projeto_id: projetoId,
      qtd_slides: z
        .number()
        .int()
        .min(CARROSSEL_SLIDES_MIN, `Mínimo de ${CARROSSEL_SLIDES_MIN} slides.`)
        .max(CARROSSEL_SLIDES_MAX, `Máximo de ${CARROSSEL_SLIDES_MAX} slides.`),
      briefing,
    }),
    z.object({
      tipo: z.literal("vaga_emprego"),
      projeto_id: projetoId,
      funcao: texto(120, "a função"),
      beneficios: texto(2000, "os benefícios"),
      briefing,
    }),
    z.object({
      tipo: z.literal("aviso"),
      projeto_id: projetoId,
      aviso: texto(2000, "o aviso"),
      briefing,
    }),
    z.object({ tipo: z.literal("stories"), projeto_id: projetoId, briefing }),
  ])
  // .refine dentro de discriminatedUnion não é aceito pelo zod 3, então a regra
  // do tamanho personalizado fica aqui, na união.
  .superRefine((d, ctx) => {
    if (
      d.tipo === "panfleto" &&
      d.tamanho === "personalizado" &&
      (d.largura_mm == null || d.altura_mm == null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["largura_mm"],
        message: `Informe largura e altura entre ${PANFLETO_MM_MIN} e ${PANFLETO_MM_MAX} mm.`,
      });
    }
  });
export type SolicitacaoArte = z.infer<typeof solicitacaoArteSchema>;

export const arquivoDeclaradoSchema = z.object({
  categoria: z.enum(["foto_pessoa", "referencia", "elemento_obrigatorio"]),
  nome_arquivo: z.string().trim().min(1).max(255),
  mime_type: z.enum(ARQUIVO_MIMES),
  tamanho_bytes: z.number().int().min(1).max(ARQUIVO_TAMANHO_MAX),
});
export type ArquivoDeclarado = z.infer<typeof arquivoDeclaradoSchema>;

/** Regras de quantidade por categoria. Retorna a mensagem de erro, ou null. */
export function validarArquivos(
  tipo: TipoArte,
  arquivos: Array<Pick<ArquivoDeclarado, "categoria">>,
): string | null {
  const uploads = TIPOS_CONFIG[tipo].uploads;
  for (const a of arquivos) {
    if (!uploads.some((u) => u.categoria === a.categoria)) {
      return `${CATEGORIA_ROTULO[a.categoria]} não se aplica a ${TIPOS_CONFIG[tipo].rotulo}.`;
    }
  }
  for (const u of uploads) {
    const n = arquivos.filter((a) => a.categoria === u.categoria).length;
    if (u.obrigatorio && n === 0) return `Envie: ${CATEGORIA_ROTULO[u.categoria]}.`;
    if (n > u.max) return `${CATEGORIA_ROTULO[u.categoria]}: no máximo ${u.max} arquivo(s).`;
  }
  return null;
}

/* ---------------- Derivações para gravar em art_requests ---------------- */

export function dimensoesDe(d: SolicitacaoArte): {
  largura_px: number;
  altura_px: number;
  medida_impressao: {
    largura_mm: number;
    altura_mm: number;
    personalizado: boolean;
    dpi: number;
  } | null;
} {
  switch (d.tipo) {
    case "foto_perfil":
      return { largura_px: 1080, altura_px: 1080, medida_impressao: null };
    case "stories":
      return { largura_px: 1080, altura_px: 1920, medida_impressao: null };
    case "panfleto": {
      const personalizado = d.tamanho === "personalizado";
      const largura_mm = personalizado ? d.largura_mm! : PANFLETO_PADRAO_MM.largura;
      const altura_mm = personalizado ? d.altura_mm! : PANFLETO_PADRAO_MM.altura;
      const px = (mm: number) => Math.round((mm / 25.4) * PANFLETO_DPI);
      return {
        largura_px: px(largura_mm),
        altura_px: px(altura_mm),
        medida_impressao: { largura_mm, altura_mm, personalizado, dpi: PANFLETO_DPI },
      };
    }
    default:
      return { largura_px: 1080, altura_px: 1440, medida_impressao: null };
  }
}

/** O que vai para art_requests.campos (tudo que não virou coluna própria). */
export function camposDe(d: SolicitacaoArte): Record<string, string | number> {
  switch (d.tipo) {
    case "foto_perfil":
      return { nome: d.nome, nivel_cargo: d.nivel_cargo, cargo: d.cargo };
    case "panfleto":
      return { tamanho: d.tamanho };
    case "feed_data_comemorativa":
      return { descricao_data: d.descricao_data };
    case "vaga_emprego":
      return { funcao: d.funcao, beneficios: d.beneficios };
    case "aviso":
      return { aviso: d.aviso };
    default:
      return {};
  }
}

const CAMPO_ROTULO: Record<string, string> = {
  nome: "Nome",
  nivel_cargo: "Nível do cargo",
  cargo: "Cargo",
  // Formato antigo (antes do select fixo de nível); mantido só para exibir.
  tipo_cargo: "Tipo de cargo",
  descricao_data: "Data comemorativa",
  funcao: "Função",
  beneficios: "Benefícios",
  aviso: "Aviso",
};

/** Linhas "rótulo: valor" dos campos específicos, para exibir em telas. */
export function camposParaExibir(row: {
  tipo: string;
  campos: unknown;
  qtd_slides: number;
  data_comemorativa: string | null;
  largura_px: number;
  altura_px: number;
  medida_impressao: unknown;
}): Array<{ rotulo: string; valor: string }> {
  const out: Array<{ rotulo: string; valor: string }> = [];
  const campos = (row.campos ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(campos)) {
    if (k === "tamanho" || v == null || v === "") continue;
    if (k === "nivel_cargo") {
      const nivel = String(v);
      const moldura = (NIVEL_CARGO_CONFIG as Record<string, { moldura: string } | undefined>)[nivel]
        ?.moldura;
      out.push({
        rotulo: CAMPO_ROTULO[k],
        valor: `${rotuloNivel(nivel)}${moldura ? ` (moldura ${moldura})` : ""}`,
      });
      continue;
    }
    out.push({ rotulo: CAMPO_ROTULO[k] ?? k, valor: String(v) });
  }
  if (row.data_comemorativa) {
    const [a, m, d] = row.data_comemorativa.split("-");
    out.push({ rotulo: "Dia", valor: `${d}/${m}/${a}` });
  }
  if (row.tipo === "carrossel") out.push({ rotulo: "Slides", valor: String(row.qtd_slides) });
  const mi = row.medida_impressao as {
    largura_mm?: number;
    altura_mm?: number;
    personalizado?: boolean;
  } | null;
  const formato =
    row.tipo === "panfleto" && mi?.largura_mm && mi?.altura_mm
      ? `${mi.largura_mm / 10} × ${mi.altura_mm / 10} cm${mi.personalizado ? " (personalizado)" : ""}`
      : `${row.largura_px} × ${row.altura_px} px`;
  out.push({ rotulo: "Formato", valor: formato });
  return out;
}

/* ---------------- Status ---------------- */

export type StatusArte =
  | "rascunho"
  | "enviada"
  | "aceita"
  | "em_geracao"
  | "aguardando_revisao"
  | "ajustes"
  | "concluida"
  | "recusada"
  | "cancelada";

export const STATUS_INTERNO_ROTULO: Record<StatusArte, string> = {
  rascunho: "Rascunho",
  enviada: "Aguardando aceite",
  aceita: "Aceita",
  em_geracao: "Em geração",
  aguardando_revisao: "Aguardando revisão",
  ajustes: "Em ajustes",
  concluida: "Concluída",
  recusada: "Recusada",
  cancelada: "Cancelada",
};

/** O solicitante não vê as etapas internas: tudo entre o aceite e a aprovação é "Em produção". */
export function statusParaSolicitante(
  s: string,
): "Em análise" | "Em produção" | "Concluída" | "Recusada" | "Cancelada" {
  if (s === "concluida") return "Concluída";
  if (s === "recusada") return "Recusada";
  if (s === "cancelada") return "Cancelada";
  if (s === "aceita" || s === "em_geracao" || s === "aguardando_revisao" || s === "ajustes") {
    return "Em produção";
  }
  return "Em análise";
}

export function rotuloTipo(tipo: string): string {
  return (TIPOS_CONFIG as Record<string, TipoConfig | undefined>)[tipo]?.rotulo ?? tipo;
}

/* ---------------- Acervo (referências e assets) e arte pronta ---------------- */

/** Limites espelham os buckets da Fase 1 (file_size_limit / allowed_mime_types). */
export const REFERENCIA_TAMANHO_MAX_MB = 15;
export const MARCA_TAMANHO_MAX_MB = 20;
export const ARTE_PRONTA_TAMANHO_MAX_MB = 25;

export const MARCA_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
] as const;
export type MarcaMime = (typeof MARCA_MIMES)[number];

/** Tipos de asset oferecidos na tela (o banco aceita outros valores legados). */
export const TIPOS_ASSET = {
  logo: "Logo",
  paleta: "Cores / paleta",
  slogan: "Slogan",
  briefing: "Briefing da marca",
  fonte: "Fonte",
  elemento_visual: "Elemento visual",
  modelo_base: "Modelo",
  moldura_cargo: "Moldura de cargo",
} as const;
export type TipoAsset = keyof typeof TIPOS_ASSET;

/* Escopo (espelha o CHECK brand_assets_escopo de 20261006170000): identidade
 * visual é sempre de uma empresa; moldura de cargo é sempre da agência;
 * modelo pode ser de uma empresa ou da agência. */
export const ASSET_EXIGE_EMPRESA: ReadonlySet<TipoAsset> = new Set<TipoAsset>([
  "logo",
  "paleta",
  "slogan",
  "briefing",
  "fonte",
  "elemento_visual",
]);
/** Tipos da tela "Marcas das empresas". Moldura de cargo fica de fora: tem
 * seção própria ("Modelos de foto de perfil"), porque é da agência. */
export const TIPOS_ASSET_MARCA = (Object.keys(TIPOS_ASSET) as TipoAsset[]).filter(
  (t) => t !== "moldura_cargo",
);

/** Moldura é sobreposição sobre a foto: precisa de transparência. */
export const MOLDURA_MIMES = ["image/png", "image/webp", "image/svg+xml"] as const;

/** Assets só de texto (guardado em valor.texto, sem arquivo). */
export const ASSET_DE_TEXTO: ReadonlySet<TipoAsset> = new Set<TipoAsset>(["slogan", "briefing"]);
export const ASSET_TEXTO_MAX = { slogan: 300, briefing: 10000 } as const;

/** Navegadores costumam mandar fonte sem content-type (ou com um x-font-*):
 * resolve pela extensão para bater com o allowed_mime_types do bucket. */
export function mimeDoArquivo(file: { name: string; type: string }): string {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const porExtensao: Record<string, string> = {
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
    svg: "image/svg+xml",
  };
  return porExtensao[ext] ?? file.type;
}

/** Quantos arquivos a arte pronta precisa: um por slide no carrossel, um no resto. */
export function slidesEsperados(tipo: string, qtdSlides: number): number {
  return tipo === "carrossel" ? qtdSlides : 1;
}
