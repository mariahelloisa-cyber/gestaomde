import { convertIndexedToRgb, decode, encode } from "fast-png";

/* Normalização da arte gerada para o tamanho EXATO de entrega.
 *
 * A OpenAI só gera lados múltiplos de 16 e proporção até 3:1, então a imagem
 * bruta sai perto do tamanho pedido (ex.: 1104x1472 para 1080x1440). Aqui ela
 * é redimensionada para cobrir o tamanho final e cortada no centro — o mesmo
 * "cover" de CSS. Sem distorção: quando a proporção bate (o caso comum), o
 * corte é de poucos pixels; banner mais alongado que 3:1 perde as pontas de
 * cima/baixo, que o prompt já pede para deixar livres.
 *
 * JS puro (fast-png): roda igual no Workers e no Node, sem binding extra. */

type Rgb = { largura: number; altura: number; canais: 3 | 4; px: Uint8Array };

/** PNG -> pixels 8 bits, RGB ou RGBA (aceita paleta, cinza e 16 bits). */
function decodificar(bytes: Uint8Array): Rgb {
  const png = decode(bytes);
  let dados: Uint8Array;
  let canais = png.channels;
  if (png.palette) {
    dados = convertIndexedToRgb(png);
    // A saída tem os canais de cada cor da paleta (RGB ou RGBA).
    canais = png.palette[0]?.length === 4 ? 4 : 3;
  } else if (png.depth === 16) {
    const d16 = png.data as Uint16Array;
    dados = new Uint8Array(d16.length);
    for (let i = 0; i < d16.length; i++) dados[i] = d16[i] >> 8;
  } else if (png.depth === 8) {
    dados = png.data as Uint8Array;
  } else {
    throw new Error(`PNG com profundidade ${png.depth} bits não suportado.`);
  }

  const n = png.width * png.height;
  if (canais === 3 || canais === 4) {
    return { largura: png.width, altura: png.height, canais, px: dados };
  }
  // Cinza (1) ou cinza + alfa (2) -> RGB/RGBA.
  const comAlfa = canais === 2;
  const saida = new Uint8Array(n * (comAlfa ? 4 : 3));
  for (let i = 0; i < n; i++) {
    const g = dados[i * canais];
    const o = i * (comAlfa ? 4 : 3);
    saida[o] = saida[o + 1] = saida[o + 2] = g;
    if (comAlfa) saida[o + 3] = dados[i * 2 + 1];
  }
  return { largura: png.width, altura: png.height, canais: comAlfa ? 4 : 3, px: saida };
}

/** Pesos de um eixo: filtro linear (triângulo), alargado na redução para
 * fazer média da área coberta (antialias), como o BILINEAR do Pillow. */
function pesosDoEixo(origem: number, destino: number, escala: number, inicio: number) {
  const suporte = escala < 1 ? 1 / escala : 1;
  const primeiros = new Int32Array(destino);
  const quantos = new Int32Array(destino);
  const lista: number[][] = [];
  for (let i = 0; i < destino; i++) {
    const centro = inicio + (i + 0.5) / escala;
    const de = Math.max(0, Math.floor(centro - suporte));
    const ate = Math.min(origem - 1, Math.ceil(centro + suporte));
    const ws: number[] = [];
    let soma = 0;
    for (let j = de; j <= ate; j++) {
      const w = Math.max(0, 1 - Math.abs(j + 0.5 - centro) / suporte);
      ws.push(w);
      soma += w;
    }
    if (soma === 0) {
      // Borda extrema: usa o pixel mais próximo.
      const j = Math.min(origem - 1, Math.max(0, Math.floor(centro)));
      primeiros[i] = j;
      quantos[i] = 1;
      lista.push([1]);
      continue;
    }
    primeiros[i] = de;
    quantos[i] = ws.length;
    lista.push(ws.map((w) => w / soma));
  }
  return { primeiros, quantos, lista };
}

function redimensionarCobrindo(img: Rgb, largura: number, altura: number): Uint8Array {
  const c = img.canais;
  const escala = Math.max(largura / img.largura, altura / img.altura);
  // Recorte centralizado, em coordenadas da origem.
  const x0 = (img.largura - largura / escala) / 2;
  const y0 = (img.altura - altura / escala) / 2;
  const h = pesosDoEixo(img.largura, largura, escala, x0);
  const v = pesosDoEixo(img.altura, altura, escala, y0);

  // Passo horizontal só nas linhas que o vertical vai usar.
  const linhaMin = v.primeiros[0];
  const linhaMax = v.primeiros[altura - 1] + v.quantos[altura - 1] - 1;
  const nLinhas = linhaMax - linhaMin + 1;
  // Intermediário em ponto fixo (valor x 64) num Uint16: metade da memória de
  // um Float32, o que importa nos 128 MB do Worker.
  const FIXO = 64;
  const meio = new Uint16Array(nLinhas * largura * c);
  const acc = new Float64Array(c);
  for (let y = 0; y < nLinhas; y++) {
    const base = (y + linhaMin) * img.largura * c;
    for (let x = 0; x < largura; x++) {
      const ws = h.lista[x];
      const j0 = h.primeiros[x];
      acc.fill(0);
      for (let k = 0; k < ws.length; k++) {
        const p = base + (j0 + k) * c;
        for (let ch = 0; ch < c; ch++) acc[ch] += img.px[p + ch] * ws[k];
      }
      const o = (y * largura + x) * c;
      for (let ch = 0; ch < c; ch++) {
        meio[o + ch] = Math.min(255 * FIXO, Math.max(0, Math.round(acc[ch] * FIXO)));
      }
    }
  }

  const saida = new Uint8Array(largura * altura * c);
  for (let y = 0; y < altura; y++) {
    const ws = v.lista[y];
    const j0 = v.primeiros[y] - linhaMin;
    for (let x = 0; x < largura; x++) {
      const o = (y * largura + x) * c;
      for (let ch = 0; ch < c; ch++) {
        let s = 0;
        for (let k = 0; k < ws.length; k++) s += meio[((j0 + k) * largura + x) * c + ch] * ws[k];
        s /= FIXO;
        saida[o + ch] = s < 0 ? 0 : s > 255 ? 255 : Math.round(s);
      }
    }
  }
  return saida;
}

/** Devolve o PNG já no tamanho exato. Se a origem já tem esse tamanho, devolve
 * os mesmos bytes (sem recompressão). */
export function normalizarPng(
  bytes: Uint8Array,
  largura: number,
  altura: number,
): { bytes: Uint8Array<ArrayBuffer>; largura: number; altura: number; alterada: boolean } {
  const img = decodificar(bytes);
  if (img.largura === largura && img.altura === altura) {
    return { bytes: new Uint8Array(bytes), largura, altura, alterada: false };
  }
  const px = redimensionarCobrindo(img, largura, altura);
  const png = encode({ width: largura, height: altura, data: px, depth: 8, channels: img.canais });
  return { bytes: new Uint8Array(png), largura, altura, alterada: true };
}
