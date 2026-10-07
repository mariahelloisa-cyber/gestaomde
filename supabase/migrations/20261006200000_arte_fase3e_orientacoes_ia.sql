-- Módulo de demandas de ARTE — Fase 3e: orientações de marca para a IA.
--
-- A ficha de marca ganha três campos de texto, por empresa:
--   'estilo_visual'  -> estilo visual recomendado (composição, tipografia,
--                       uso de imagens, fundos, chamadas, CTA…)
--   'evitar'         -> o que a IA não deve fazer com a marca
--   'observacao_ia'  -> orientação extra livre
-- Texto em valor->>'texto', como slogan e briefing.
--
-- Aditivo:
--   - os três entram no CHECK de tipo;
--   - exigem empresa (CHECK brand_assets_escopo);
--   - exigem texto não vazio (CHECK brand_assets_texto_formato);
--   - no máximo uma linha ativa por empresa (brand_assets_ficha_unica_idx).
--
-- NÃO remove nada: fonte e elemento_visual continuam aceitos e os dados
-- existentes ficam intactos (só saem da tela por enquanto). NÃO muda RLS,
-- policies, GRANTs, buckets, triggers, molduras, referências.
--
-- RE-EXECUTÁVEL.

BEGIN;

DO $do$
BEGIN
  IF to_regclass('public.brand_assets_ficha_unica_idx') IS NULL THEN
    RAISE EXCEPTION 'Aplique 20261006180000 e 20261006190000 antes.';
  END IF;
END
$do$;

ALTER TABLE public.brand_assets DROP CONSTRAINT IF EXISTS brand_assets_tipo_check;
ALTER TABLE public.brand_assets ADD CONSTRAINT brand_assets_tipo_check CHECK (tipo IN (
  'logo', 'logo_negativo', 'paleta', 'fonte', 'modelo_base',
  'moldura_cargo', 'manual', 'outro', 'elemento_visual',
  'slogan', 'briefing', 'briefing_documento', 'tags_marca',
  'estilo_visual', 'evitar', 'observacao_ia'));

ALTER TABLE public.brand_assets DROP CONSTRAINT IF EXISTS brand_assets_escopo;
ALTER TABLE public.brand_assets ADD CONSTRAINT brand_assets_escopo CHECK (
  CASE
    WHEN tipo IN ('logo', 'logo_negativo', 'paleta', 'slogan', 'briefing', 'briefing_documento',
                  'tags_marca', 'fonte', 'elemento_visual',
                  'estilo_visual', 'evitar', 'observacao_ia')
      THEN projeto_id IS NOT NULL
    WHEN tipo = 'moldura_cargo'
      THEN projeto_id IS NULL
    ELSE true
  END);

ALTER TABLE public.brand_assets DROP CONSTRAINT IF EXISTS brand_assets_texto_formato;
ALTER TABLE public.brand_assets ADD CONSTRAINT brand_assets_texto_formato CHECK (
  tipo NOT IN ('slogan', 'briefing', 'estilo_visual', 'evitar', 'observacao_ia')
  OR char_length(btrim(coalesce(valor->>'texto', ''))) BETWEEN 1 AND 10000);

DROP INDEX IF EXISTS public.brand_assets_ficha_unica_idx;
CREATE UNIQUE INDEX brand_assets_ficha_unica_idx
  ON public.brand_assets (projeto_id, tipo)
  WHERE ativo
    AND tipo IN ('paleta', 'slogan', 'briefing', 'briefing_documento', 'fonte', 'tags_marca',
                 'estilo_visual', 'evitar', 'observacao_ia');

DO $do$
BEGIN
  IF pg_get_indexdef('public.brand_assets_ficha_unica_idx'::regclass) LIKE '%''logo''%' THEN
    RAISE EXCEPTION 'brand_assets_ficha_unica_idx voltou a incluir logo';
  END IF;
  IF pg_get_indexdef('public.brand_assets_ficha_unica_idx'::regclass) NOT LIKE '%observacao_ia%' THEN
    RAISE EXCEPTION 'brand_assets_ficha_unica_idx sem os tipos novos';
  END IF;
  RAISE NOTICE 'Fase 3e: estilo_visual, evitar e observacao_ia ok.';
END
$do$;

COMMIT;
