-- Módulo de demandas de ARTE — Fase 3c: ficha de marca por empresa.
--
-- A tela "Marcas das empresas" vira uma ficha única por projeto (logo, paleta,
-- tags, slogan, briefing, briefing completo em PDF, fonte, elementos). Por
-- trás continuam várias linhas em brand_assets; esta migration só ajusta as
-- regras para o formato de ficha. Tudo aditivo — nada é removido.
--
--   1) Tipos novos:
--        'briefing_documento' -> arquivo PDF do briefing completo (path obrigatório)
--        'tags_marca'         -> tags gerais da marca, na coluna `tags`
--      Os dois entram no escopo "exige empresa", como o resto da identidade.
--   2) brand_assets_tem_conteudo passa a aceitar linha só com tags (tags_marca).
--   3) Índice único: no máximo UMA linha ativa por empresa para os campos de
--      valor único da ficha (logo, paleta, slogan, briefing,
--      briefing_documento, fonte, tags_marca). Elementos visuais podem ser
--      vários. Conferido em 2026-10-06: brand_assets só tem as 4 molduras da
--      agência, então o índice nasce sem conflito.
--
-- NÃO muda: RLS, policies, GRANTs, buckets (PDF já é aceito em brand-assets),
-- triggers, FK RESTRICT, molduras.
--
-- RE-EXECUTÁVEL.

BEGIN;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_assets_escopo') THEN
    RAISE EXCEPTION 'Aplique 20261006170000_arte_fase3b_marca_por_projeto.sql antes.';
  END IF;
END
$do$;

-- 1) tipos ---------------------------------------------------------------------
ALTER TABLE public.brand_assets DROP CONSTRAINT IF EXISTS brand_assets_tipo_check;
ALTER TABLE public.brand_assets ADD CONSTRAINT brand_assets_tipo_check CHECK (tipo IN (
  'logo', 'logo_negativo', 'paleta', 'fonte', 'modelo_base',
  'moldura_cargo', 'manual', 'outro', 'elemento_visual',
  'slogan', 'briefing', 'briefing_documento', 'tags_marca'));

ALTER TABLE public.brand_assets DROP CONSTRAINT IF EXISTS brand_assets_escopo;
ALTER TABLE public.brand_assets ADD CONSTRAINT brand_assets_escopo CHECK (
  CASE
    WHEN tipo IN ('logo', 'logo_negativo', 'paleta', 'slogan', 'briefing', 'briefing_documento',
                  'tags_marca', 'fonte', 'elemento_visual')
      THEN projeto_id IS NOT NULL
    WHEN tipo = 'moldura_cargo'
      THEN projeto_id IS NULL
    ELSE true
  END);

ALTER TABLE public.brand_assets DROP CONSTRAINT IF EXISTS brand_assets_documento_tem_arquivo;
ALTER TABLE public.brand_assets ADD CONSTRAINT brand_assets_documento_tem_arquivo CHECK (
  tipo <> 'briefing_documento' OR path IS NOT NULL);

-- 2) linha só com tags ----------------------------------------------------------
ALTER TABLE public.brand_assets DROP CONSTRAINT IF EXISTS brand_assets_tem_conteudo;
ALTER TABLE public.brand_assets ADD CONSTRAINT brand_assets_tem_conteudo CHECK (
  path IS NOT NULL OR valor <> '{}'::jsonb OR cardinality(tags) > 0);

-- 3) um por empresa -------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS brand_assets_ficha_unica_idx
  ON public.brand_assets (projeto_id, tipo)
  WHERE ativo
    AND tipo IN ('logo', 'paleta', 'slogan', 'briefing', 'briefing_documento', 'fonte', 'tags_marca');

-- Verificação -------------------------------------------------------------------
DO $do$
BEGIN
  IF to_regclass('public.brand_assets_ficha_unica_idx') IS NULL THEN
    RAISE EXCEPTION 'indice brand_assets_ficha_unica_idx nao foi criado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'brand_assets'
                    AND policyname = 'Exige equipe interna' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'RESTRICTIVE ausente em brand_assets';
  END IF;
  RAISE NOTICE 'Fase 3c: ficha de marca (briefing_documento, tags_marca, um por empresa) ok.';
END
$do$;

COMMIT;
