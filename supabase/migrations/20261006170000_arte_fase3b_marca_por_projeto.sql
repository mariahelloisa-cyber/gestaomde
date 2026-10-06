-- Módulo de demandas de ARTE — Fase 3b (corretiva): identidade visual é
-- POR EMPRESA; referências são GLOBAIS.
--
-- Regra de negócio (2026-10-06): referências de arte valem para todas as
-- empresas, organizadas por tipo de arte. A IA vai combinar "referências do
-- tipo pedido" + "identidade visual da empresa escolhida". Logo, cores,
-- slogan, briefing, fontes e elementos visuais são da empresa e NUNCA podem
-- virar globais.
--
-- O que esta migration muda (20261006160000 já aplicada, não é editada):
--
--   1) brand_assets.projeto_id: ON DELETE SET NULL -> ON DELETE RESTRICT.
--      Com SET NULL, excluir um projeto transformava a marca dele em asset
--      "da agência". RESTRICT impede excluir projeto que ainda tenha assets
--      de marca: primeiro remove os assets (e os arquivos), depois o projeto.
--      (CASCADE foi descartado: apagaria a marca em silêncio e deixaria os
--      arquivos órfãos no storage.)
--
--   2) Novos tipos 'slogan' e 'briefing' (texto em valor->>'texto', sem
--      arquivo).
--
--   3) CHECK brand_assets_escopo:
--        - logo, logo_negativo, paleta, slogan, briefing, fonte e
--          elemento_visual EXIGEM projeto_id;
--        - moldura_cargo EXIGE projeto_id NULL (é da agência: o formulário de
--          foto de perfil não tem empresa);
--        - modelo_base, manual e outro: projeto opcional.
--      brand_assets está vazia em produção (conferido em 2026-10-06), então o
--      CHECK valida sem migrar dado.
--
-- art_references.projeto_id fica como está (SET NULL): referências são
-- globais, a UI grava NULL, e a coluna fica só por compatibilidade futura.
--
-- NÃO muda: RLS, policies, GRANTs, buckets, triggers.
--
-- RE-EXECUTÁVEL.

BEGIN;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'brand_assets'
                    AND column_name = 'projeto_id') THEN
    RAISE EXCEPTION 'Aplique 20261006160000_arte_fase3_acervo.sql antes (brand_assets.projeto_id ausente).';
  END IF;
END
$do$;

-- 1) FK RESTRICT ---------------------------------------------------------------
ALTER TABLE public.brand_assets DROP CONSTRAINT IF EXISTS brand_assets_projeto_id_fkey;
ALTER TABLE public.brand_assets
  ADD CONSTRAINT brand_assets_projeto_id_fkey
  FOREIGN KEY (projeto_id) REFERENCES public.projetos(id) ON DELETE RESTRICT;

-- 2) tipos slogan e briefing ---------------------------------------------------
ALTER TABLE public.brand_assets DROP CONSTRAINT IF EXISTS brand_assets_tipo_check;
ALTER TABLE public.brand_assets ADD CONSTRAINT brand_assets_tipo_check CHECK (tipo IN (
  'logo', 'logo_negativo', 'paleta', 'fonte', 'modelo_base',
  'moldura_cargo', 'manual', 'outro', 'elemento_visual',
  'slogan', 'briefing'));

ALTER TABLE public.brand_assets DROP CONSTRAINT IF EXISTS brand_assets_texto_formato;
ALTER TABLE public.brand_assets ADD CONSTRAINT brand_assets_texto_formato CHECK (
  tipo NOT IN ('slogan', 'briefing')
  OR char_length(btrim(coalesce(valor->>'texto', ''))) BETWEEN 1 AND 10000);

-- 3) escopo: marca é da empresa; moldura é da agência -------------------------
ALTER TABLE public.brand_assets DROP CONSTRAINT IF EXISTS brand_assets_escopo;
ALTER TABLE public.brand_assets ADD CONSTRAINT brand_assets_escopo CHECK (
  CASE
    WHEN tipo IN ('logo', 'logo_negativo', 'paleta', 'slogan', 'briefing', 'fonte', 'elemento_visual')
      THEN projeto_id IS NOT NULL
    WHEN tipo = 'moldura_cargo'
      THEN projeto_id IS NULL
    ELSE true
  END);

COMMENT ON COLUMN public.brand_assets.projeto_id IS
  'Empresa/projeto dono do asset. Obrigatório para identidade visual (logo, cores, slogan, briefing, fonte, elementos); NULL só para moldura de cargo e modelos da agência. ON DELETE RESTRICT: marca de empresa nunca vira global.';
COMMENT ON COLUMN public.art_references.projeto_id IS
  'Sem uso: referências são globais por tipo de arte (a UI grava NULL). Mantido por compatibilidade futura.';

-- Verificação ------------------------------------------------------------------
DO $do$
BEGIN
  IF (SELECT confdeltype FROM pg_constraint WHERE conname = 'brand_assets_projeto_id_fkey') <> 'r' THEN
    RAISE EXCEPTION 'brand_assets_projeto_id_fkey nao ficou ON DELETE RESTRICT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'brand_assets'
                    AND policyname = 'Exige equipe interna' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'RESTRICTIVE ausente em brand_assets';
  END IF;
  RAISE NOTICE 'Fase 3b: marca por projeto (RESTRICT), slogan/briefing e escopo ok.';
END
$do$;

COMMIT;
