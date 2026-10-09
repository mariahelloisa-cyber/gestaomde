import { Resvg } from "@cf-wasm/resvg";
import { parse, type Font, type RenderOptions } from "opentype.js";
import fonteNomeUrl from "@/assets/fontes/montserrat/Montserrat-Bold.ttf?inline";
import fonteCargoUrl from "@/assets/fontes/montserrat/Montserrat-Medium.ttf?inline";
import { FOTO_PERFIL_COR_TEXTO, FOTO_PERFIL_LADO } from "./arte/foto-perfil";

/* Montagem da foto de perfil: resvg (WASM) rasteriza um SVG 1080x1080 e o
 * opentype.js transforma nome e cargo em contorno, então o resvg não precisa
 * de fonte nenhuma e o resultado é o mesmo em qualquer servidor.
 *
 * SÓ por import dinâmico (arte-foto-perfil.server.ts): o WASM (~2,4 MB) e as
 * fontes embutidas ficam num chunk próprio. Import estático faz o bundler
 * pendurar tudo isso na inicialização de todas as páginas.
 *
 * opentype.js fica na 1.3.4: a 2.0.0 gera NaN no caminho de frases longas da
 * Montserrat (o resvg para de desenhar no primeiro número inválido). */

const LADO = FOTO_PERFIL_LADO;

/** Área do texto dentro da caixa branca do modelo, à direita do logo, e as
 * linhas de base. Medidas nos mockups dos 4 níveis (out/2026). */
const TEXTO = {
  x0: 310,
  x1: 885,
  nome: { baseline: 806, tamanho: 46, minimo: 26, espacamento: 0 },
  cargo: { baseline: 853, tamanho: 28, minimo: 16, espacamento: 0.08 },
} as const;

/** A foto passa um pouco por baixo do anel, para não sobrar fresta na borda
 * suavizada do círculo. */
const SANGRIA_FOTO = 6;
/** Pixel do modelo com alfa até isto conta como transparente. */
const ALFA_TRANSPARENTE = 16;
/** Em foto retrato, o ponto (fração da altura) que vai para o centro do
 * círculo: o rosto costuma ficar acima do meio. Só desloca o corte; a foto
 * nunca é distorcida. */
const FOCO_VERTICAL_RETRATO = 0.42;

export type AreaFoto = { cx: number; cy: number; r: number };
export type TextoPronto = { d: string; tamanho: number; largura: number };
export type FotoEntrada = {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  largura: number | null;
  altura: number | null;
};

/* ---------------- Rasterização ---------------- */

async function renderizar<T>(
  svg: string,
  ler: (img: { asPng(): Uint8Array; pixels: Uint8Array }) => T,
): Promise<T> {
  const resvg = await Resvg.async(svg, {
    fitTo: { mode: "width", value: LADO },
    font: { loadSystemFonts: false },
  });
  try {
    const img = resvg.render();
    try {
      return ler(img);
    } finally {
      img.free();
    }
  } finally {
    resvg.free();
  }
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

const SVG_ABRE = `<svg xmlns="http://www.w3.org/2000/svg" width="${LADO}" height="${LADO}" viewBox="0 0 ${LADO} ${LADO}">`;

/* ---------------- Modelo: transparência e círculo da foto ---------------- */

/** Dimensões e se o PNG tem transparência (canal alfa ou chunk tRNS). */
function infoPng(b: Uint8Array): { largura: number; altura: number; temAlfa: boolean } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || !sig.every((v, i) => b[i] === v)) return null;
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const tipo = (i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
  const corTipo = b[25];
  let temAlfa = corTipo === 4 || corTipo === 6;
  for (let i = 8; !temAlfa && i + 8 <= b.length; ) {
    const t = tipo(i + 4);
    if (t === "tRNS") temAlfa = true;
    if (t === "IDAT" || t === "IEND") break;
    i += 12 + u32(i);
  }
  return { largura: u32(16), altura: u32(20), temAlfa };
}

/**
 * Confere que o modelo serve para a montagem e acha o círculo da foto.
 *
 * O círculo é a região TRANSPARENTE conectada que fica no meio do modelo:
 * flood fill a partir do centro, em resolução cheia. Exige que ela não
 * encoste na borda, que quase não haja transparência fora dela (o fundo tem
 * de ser opaco) e que tenha tamanho e formato de círculo — a parte de baixo
 * pode estar coberta pela caixa do nome. O centro e o raio saem da largura e do topo da região, então
 * pequenas diferenças de posição entre os modelos não importam.
 */
export async function analisarModelo(png: Uint8Array): Promise<AreaFoto> {
  const info = infoPng(png);
  if (!info) throw new Error("O modelo precisa ser um arquivo PNG.");
  if (info.largura !== LADO || info.altura !== LADO) {
    throw new Error(
      `O modelo precisa ter exatamente ${LADO}×${LADO} px (este tem ${info.largura}×${info.altura}).`,
    );
  }
  if (!info.temAlfa) {
    throw new Error(
      "O modelo não tem transparência (PNG sem canal alfa). Exporte em PNG com fundo transparente, deixando vazio o círculo onde entra a foto.",
    );
  }

  const pixels = await renderizar(
    `${SVG_ABRE}<image href="data:image/png;base64,${base64(png)}" x="0" y="0" width="${LADO}" height="${LADO}"/></svg>`,
    (img) => img.pixels,
  );
  const transparente = (i: number) => pixels[i * 4 + 3] <= ALFA_TRANSPARENTE;

  // Semente: o pixel transparente mais perto do centro (até 160 px).
  const c = LADO / 2;
  let semente = -1;
  let melhor = Infinity;
  for (let dy = -160; dy <= 160; dy += 4) {
    for (let dx = -160; dx <= 160; dx += 4) {
      const i = (c + dy) * LADO + (c + dx);
      const dist = dx * dx + dy * dy;
      if (dist < melhor && transparente(i)) {
        melhor = dist;
        semente = i;
      }
    }
  }
  if (semente < 0) {
    throw new Error(
      "O círculo da foto não está transparente: o miolo do círculo precisa ficar vazio (sem imagem de exemplo).",
    );
  }

  const visto = new Uint8Array(LADO * LADO);
  const fila = new Int32Array(LADO * LADO);
  let ini = 0;
  let fim = 0;
  fila[fim++] = semente;
  visto[semente] = 1;
  let x0 = LADO;
  let x1 = -1;
  let y0 = LADO;
  let y1 = -1;
  let total = 0;
  let encostaNaBorda = false;
  while (ini < fim) {
    const i = fila[ini++];
    const x = i % LADO;
    const y = (i - x) / LADO;
    total++;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (x === 0 || y === 0 || x === LADO - 1 || y === LADO - 1) {
      encostaNaBorda = true;
      continue;
    }
    for (const v of [i - 1, i + 1, i - LADO, i + LADO]) {
      if (!visto[v] && transparente(v)) {
        visto[v] = 1;
        fila[fim++] = v;
      }
    }
  }
  if (encostaNaBorda) {
    throw new Error(
      "A transparência do círculo vaza até a borda da imagem: o fundo do modelo (fora do círculo) precisa ser opaco.",
    );
  }

  // Furo fechado, mas fundo vazado em outro lugar (ex.: só o anel sobre fundo
  // transparente): a arte final sairia com buracos. Tolera bordas suavizadas.
  let transparentesNoTodo = 0;
  for (let i = 0; i < LADO * LADO; i++) if (transparente(i)) transparentesNoTodo++;
  const fora = transparentesNoTodo - total;
  if (fora > 0.02 * LADO * LADO) {
    throw new Error(
      `Há áreas transparentes fora do círculo da foto (${Math.round((100 * fora) / (LADO * LADO))}% da imagem): o fundo do modelo precisa ser opaco; só o miolo do círculo fica vazio.`,
    );
  }

  const largura = x1 - x0 + 1;
  const altura = y1 - y0 + 1;
  const r = largura / 2;
  const formatoOk =
    largura >= 300 && largura <= 1000 && altura >= largura * 0.5 && total >= 0.6 * Math.PI * r * r;
  if (!formatoOk) {
    throw new Error(
      `A área transparente do modelo (${largura}×${altura} px) não tem formato de círculo da foto. Só o miolo do círculo deve ser transparente.`,
    );
  }
  const arred = (n: number) => Math.round(n * 10) / 10;
  return { cx: arred(x0 + r), cy: arred(y0 + r), r: arred(r) };
}

/* ---------------- Texto ---------------- */

function bytesDeDataUrl(dataUrl: string): ArrayBuffer {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

let fontes: { nome: Font; cargo: Font } | null = null;
function carregarFontes() {
  fontes ??= {
    nome: parse(bytesDeDataUrl(fonteNomeUrl)),
    cargo: parse(bytesDeDataUrl(fonteCargoUrl)),
  };
  return fontes;
}

/** Uma linha centralizada na área de texto, em MAIÚSCULAS. Reduz a fonte até
 * o mínimo; se ainda não couber, recusa — nunca corta nem abrevia. */
function prepararLinha(
  fonte: Font,
  original: string,
  cfg: (typeof TEXTO)["nome" | "cargo"],
  rotulo: "O nome" | "O cargo",
): TextoPronto {
  const texto = original.trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
  if (!texto) throw new Error(`${rotulo} está vazio.`);

  // Caractere que a fonte não tem sairia como um quadrado vazio.
  const faltando = [...new Set([...texto])].filter(
    (ch) => ch !== " " && fonte.charToGlyphIndex(ch) === 0,
  );
  if (faltando.length > 0) {
    throw new Error(
      `${rotulo} tem caractere que a fonte do modelo não desenha: ${faltando.join(" ")}. Peça o texto sem ele.`,
    );
  }

  const opts: RenderOptions = { kerning: true, letterSpacing: cfg.espacamento };
  // O opentype soma o espaçamento também depois da última letra.
  const medir = (t: number) => fonte.getAdvanceWidth(texto, t, opts) - cfg.espacamento * t;
  const larguraMax = TEXTO.x1 - TEXTO.x0;
  let tamanho: number = cfg.tamanho;
  while (tamanho > cfg.minimo && medir(tamanho) > larguraMax) tamanho -= 1;
  const largura = medir(tamanho);
  if (largura > larguraMax) {
    throw new Error(
      `${rotulo} "${original.trim()}" é longo demais para o modelo, mesmo com a fonte no tamanho mínimo. Peça ao solicitante um texto mais curto — o sistema não corta nem abrevia.`,
    );
  }

  const centro = (TEXTO.x0 + TEXTO.x1) / 2;
  const d = fonte.getPath(texto, centro - largura / 2, cfg.baseline, tamanho, opts).toPathData(2);
  if (!d || d.includes("NaN")) throw new Error(`Falha ao desenhar ${rotulo.toLowerCase()}.`);
  return { d, tamanho, largura: Math.round(largura) };
}

/** Prepara nome e cargo. Chamado antes de abrir o job: texto longo demais
 * falha sem deixar rastro. */
export function prepararTextos(
  nome: string,
  cargo: string,
): { nome: TextoPronto; cargo: TextoPronto } {
  const f = carregarFontes();
  return {
    nome: prepararLinha(f.nome, nome, TEXTO.nome, "O nome"),
    cargo: prepararLinha(f.cargo, cargo, TEXTO.cargo, "O cargo"),
  };
}

/* ---------------- Composição ---------------- */

/** Posição da foto: cobre o círculo inteiro sem distorcer (escala uniforme)
 * e, em retrato, sobe o corte para o rosto ficar no meio do círculo. */
function posicaoDaFoto(foto: FotoEntrada, area: AreaFoto, raio: number): string {
  const { cx, cy } = area;
  if (!foto.largura || !foto.altura) {
    return `x="${cx - raio}" y="${cy - raio}" width="${2 * raio}" height="${2 * raio}" preserveAspectRatio="xMidYMid slice"`;
  }
  const escala = (2 * raio) / Math.min(foto.largura, foto.altura);
  const w = foto.largura * escala;
  const h = foto.altura * escala;
  const x = cx - w / 2;
  let y = cy - h / 2;
  if (h > w) {
    y = cy - h * FOCO_VERTICAL_RETRATO;
    // Sem deixar o círculo descoberto em cima ou embaixo.
    y = Math.min(cy - raio, Math.max(cy + raio - h, y));
  }
  const n = (v: number) => v.toFixed(2);
  return `x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none"`;
}

/** Foto (atrás, em círculo) + modelo (por cima) + nome e cargo. PNG 1080x1080. */
export async function comporFotoPerfil(p: {
  modelo: Uint8Array;
  area: AreaFoto;
  foto: FotoEntrada;
  textos: { nome: TextoPronto; cargo: TextoPronto };
}): Promise<Uint8Array> {
  const raio = p.area.r + SANGRIA_FOTO;
  const svg =
    SVG_ABRE +
    `<defs><clipPath id="foto"><circle cx="${p.area.cx}" cy="${p.area.cy}" r="${raio}"/></clipPath></defs>` +
    // Base branca: se o modelo tiver algum ponto semitransparente fora do
    // círculo, o PNG final não fica vazado.
    `<rect width="${LADO}" height="${LADO}" fill="#ffffff"/>` +
    `<image clip-path="url(#foto)" href="data:${p.foto.mime};base64,${base64(p.foto.bytes)}" ${posicaoDaFoto(p.foto, p.area, raio)}/>` +
    `<image href="data:image/png;base64,${base64(p.modelo)}" x="0" y="0" width="${LADO}" height="${LADO}"/>` +
    `<path d="${p.textos.nome.d}" fill="${FOTO_PERFIL_COR_TEXTO}"/>` +
    `<path d="${p.textos.cargo.d}" fill="${FOTO_PERFIL_COR_TEXTO}"/>` +
    `</svg>`;
  return renderizar(svg, (img) => img.asPng());
}
