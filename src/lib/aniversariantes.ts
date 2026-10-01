/**
 * Regras de data e rótulos do módulo Aniversariantes, compartilhadas entre a UI
 * e as server functions para as duas pontas nunca divergirem sobre que dia é
 * "hoje". Mesma ideia de organograma-auditoria.ts.
 *
 * `data_comemoracao` é um `date` puro no banco ("2026-10-01"). Tudo aqui trata
 * essa string como data civil: nada de `new Date("2026-10-01")`, que o
 * JavaScript interpreta como meia-noite UTC e, em Brasília, cai no dia anterior.
 */

export const FUSO_ANIVERSARIOS = "America/Sao_Paulo";

/** Hoje em America/Sao_Paulo no formato "YYYY-MM-DD", independente do fuso do servidor. */
export function dataHojeSaoPaulo(agora: Date = new Date()): string {
  // en-CA formata como YYYY-MM-DD, que é exatamente o formato de `date` do Postgres.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_ANIVERSARIOS,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/** Ano e mês (1-12) de hoje em America/Sao_Paulo — base do filtro mensal. */
export function mesAtualSaoPaulo(agora: Date = new Date()): { ano: number; mes: number } {
  const [ano, mes] = dataHojeSaoPaulo(agora).split("-");
  return { ano: Number(ano), mes: Number(mes) };
}

/** Primeiro e último dia do mês como "YYYY-MM-DD", para filtrar o período no banco. */
export function intervaloDoMes(ano: number, mes: number): { inicio: string; fim: string } {
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, "0");
  return {
    inicio: `${ano}-${mm}-01`,
    fim: `${ano}-${mm}-${String(ultimoDia).padStart(2, "0")}`,
  };
}

export const NOMES_MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** "01/10" — dia e mês, para listas e cartões. */
export function diaEMes(iso: string): string {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

/** "1º de outubro de 2026" — data por extenso. */
export function dataPorExtenso(iso: string): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const nome = NOMES_MESES[(mes ?? 1) - 1]?.toLowerCase() ?? "";
  return `${dia === 1 ? "1º" : dia} de ${nome} de ${ano}`;
}

/** Título do pop-up, no singular ou no plural conforme a quantidade de pessoas. */
export function tituloAniversariantes(quantidade: number): string {
  return quantidade === 1 ? "Aniversariante de hoje" : "Aniversariantes de hoje";
}

/**
 * Chamada do pop-up, adaptada a uma ou várias pessoas:
 *   1  → "Hoje é aniversário de Aparecida!"
 *   2  → "Hoje é aniversário de Aparecida e mais 1 pessoa!"
 *   3+ → "Hoje é aniversário de Aparecida e mais 2 pessoas!"
 */
export function fraseAniversarioDoDia(nomes: string[]): string {
  if (nomes.length === 0) return "";
  const primeiro = nomes[0].trim().split(/\s+/)[0];
  const outros = nomes.length - 1;
  if (outros === 0) return `Hoje é aniversário de ${primeiro}!`;
  return `Hoje é aniversário de ${primeiro} e mais ${outros} ${
    outros === 1 ? "pessoa" : "pessoas"
  }!`;
}

/** Tipos de imagem aceitos no upload da arte. */
export const TIPOS_IMAGEM_ACEITOS = ["image/jpeg", "image/png", "image/webp"];
export const IMAGEM_TAMANHO_MAX_MB = 10;

/** Bucket privado da arte — mesmo nome usado no upload (cliente) e na leitura (servidor). */
export const BUCKET_ANIVERSARIANTES = "aniversariantes";

/**
 * Caminho do endpoint que serve uma arte de um link público. `indice` é a
 * posição no array `imagens` — 0 é a capa, usada no og:image da prévia.
 */
export function caminhoImagemPublica(token: string, indice = 0): string {
  return `/api/public/aniversariante-imagem/${token}?i=${indice}`;
}
