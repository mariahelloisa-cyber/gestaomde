-- Módulo de demandas de ARTE — Fase 3d: várias logos por empresa.
--
-- Uma empresa pode ter mais de uma logo (com nome, sem nome, versão branca,
-- versão "tec"…). O índice brand_assets_ficha_unica_idx (20261006180000)
-- limitava logo a uma linha ativa por empresa; aqui ele é recriado SEM
-- 'logo'. Cada versão é uma linha tipo 'logo', identificada por `nome`.
--
-- Continuam com no máximo uma linha ativa por empresa: paleta, slogan,
-- briefing, briefing_documento, fonte e tags_marca.
--
-- Aditivo (só afrouxa uma unicidade). NÃO muda: RLS, policies, GRANTs,
-- buckets, triggers, CHECKs, molduras, referências.
--
-- RE-EXECUTÁVEL.

BEGIN;

DO $do$
BEGIN
  IF to_regclass('public.brand_assets_ficha_unica_idx') IS NULL THEN
    RAISE EXCEPTION 'Aplique 20261006180000_arte_fase3c_ficha_marca.sql antes.';
  END IF;
END
$do$;

DROP INDEX IF EXISTS public.brand_assets_ficha_unica_idx;
CREATE UNIQUE INDEX brand_assets_ficha_unica_idx
  ON public.brand_assets (projeto_id, tipo)
  WHERE ativo
    AND tipo IN ('paleta', 'slogan', 'briefing', 'briefing_documento', 'fonte', 'tags_marca');

DO $do$
BEGIN
  IF pg_get_indexdef('public.brand_assets_ficha_unica_idx'::regclass) LIKE '%''logo''%' THEN
    RAISE EXCEPTION 'brand_assets_ficha_unica_idx ainda inclui logo';
  END IF;
  RAISE NOTICE 'Fase 3d: logo liberada para várias versões por empresa.';
END
$do$;

COMMIT;
