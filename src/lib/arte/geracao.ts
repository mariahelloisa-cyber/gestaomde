/*
 * Geração de artes com IA (OpenAI Image API) — regras compartilhadas entre a
 * tela e o servidor. Sem segredo e sem chamada externa: a chamada, a chave e
 * o cálculo de custo ficam em arte-geracao-ia.server.ts.
 */

import type { TipoArte } from "./tipos";

/** Sobe quando o prompt mudar: fica gravado em ai_generation_jobs.prompt_versao. */
export const GERACAO_PROMPT_VERSAO = "4b-v1";

export const GERACAO_MODELO_PADRAO = "gpt-image-2.5-sunburst";
export const GERACAO_QUALIDADE = "medium";
export const GERACAO_VARIACOES = 2;
export const GERACAO_LIMITE_DIARIO_PADRAO_USD = 5;

/** Job 'processando' há mais que isto foi abandonado (aba fechada, Worker
 * interrompido): libera a demanda para nova geração ou envio manual. */
export const GERACAO_LEASE_MS = 8 * 60 * 1000;

/** A tela para de esperar a resposta depois disto (pouco antes do lease) e
 * passa a confiar na lista recarregada. */
export const GERACAO_TELA_TIMEOUT_MS = 7.5 * 60 * 1000;

/** Tipos que a IA gera livremente. Foto de perfil é composição em template
 * fixo (fase própria) e nunca entra aqui. */
export const TIPOS_GERATIVOS: readonly TipoArte[] = [
  "feed",
  "feed_data_comemorativa",
  "panfleto",
  "stories",
  "aviso",
  "vaga_emprego",
  "trafego",
  "banner",
  "carrossel",
];

/** Carrossel é gerativo, mas a geração por slide (conteúdo dividido entre os
 * slides e revisão de uma variação por slide) entra na próxima etapa. */
export const TIPOS_GERATIVOS_AINDA_NAO: ReadonlySet<TipoArte> = new Set<TipoArte>(["carrossel"]);

export function podeGerarComIA(tipo: string): boolean {
  return (
    (TIPOS_GERATIVOS as readonly string[]).includes(tipo) &&
    !TIPOS_GERATIVOS_AINDA_NAO.has(tipo as TipoArte)
  );
}

/** Lado máximo de ENTREGA para a geração com IA. A arte vai ao tamanho exato
 * pela transformação de imagem do Supabase Storage, que aceita até 2500 px
 * por lado; acima disso, envio manual. */
export const GERACAO_ENTREGA_LADO_MAX = 2500;

export function entregaCabeNaGeracao(largura: number, altura: number): boolean {
  return largura <= GERACAO_ENTREGA_LADO_MAX && altura <= GERACAO_ENTREGA_LADO_MAX;
}

/** Começo da mensagem de erro do teto diário. */
export const ERRO_TETO_GERACAO = "Teto diário de geração de artes atingido";
