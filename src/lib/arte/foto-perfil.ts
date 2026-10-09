/*
 * Foto de perfil — composição determinística (sem IA), regras compartilhadas
 * entre a tela e o servidor. A montagem em si (resvg + fontes) fica em
 * arte-foto-perfil-render.server.ts, carregada só quando usada.
 *
 * Camadas, de baixo para cima: foto da pessoa recortada em círculo; modelo
 * PNG do nível do cargo (com o círculo transparente); nome e cargo.
 */

/** Gravado em ai_generation_jobs.parametros.modo (o job é origem 'manual'). */
export const FOTO_PERFIL_MODO = "composicao_foto_perfil";

/** Sobe quando o layout (posições, fontes, tamanhos) mudar. */
export const FOTO_PERFIL_LAYOUT_VERSAO = "fp-v1";

export const FOTO_PERFIL_LADO = 1080;

/** Cor única do nome e do cargo, em todos os níveis. A cor do nível vale só
 * para o modelo (anel/moldura). */
export const FOTO_PERFIL_COR_TEXTO = "#D81068";

/** Job de composição 'processando' há mais que isto foi interrompido. */
export const FOTO_PERFIL_LEASE_MS = 2 * 60 * 1000;

export function ehComposicaoFotoPerfil(parametros: unknown): boolean {
  return (
    !!parametros &&
    typeof parametros === "object" &&
    (parametros as Record<string, unknown>).modo === FOTO_PERFIL_MODO
  );
}
