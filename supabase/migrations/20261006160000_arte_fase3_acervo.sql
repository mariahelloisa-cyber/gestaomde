-- Módulo de demandas de ARTE — Fase 3: acervo (referências e assets da marca)
-- por PROJETO, que é a "empresa" do CRM (public.clientes está vazia).
--
-- Tudo ADITIVO. O que muda em relação à Fase 1, e por quê:
--   1) art_references.projeto_id e brand_assets.projeto_id: FK para projetos,
--      ON DELETE SET NULL (pedido explícito). Consequência: se um projeto for
--      excluído, as referências/assets dele passam a valer como "da agência"
--      (projeto_id NULL). cliente_id continua lá, sem uso.
--   2) brand_assets ganha `descricao` e `tags` (a tela pede tags/descrição; a
--      Fase 1 só tinha em art_references).
--   3) O CHECK de brand_assets.tipo é AMPLIADO com 'elemento_visual'. Nenhum
--      valor existente é removido. (brand_assets está vazia em produção.)
--   4) tg_arte_acervo_regras passa a normalizar tags nas DUAS tabelas — antes
--      só art_references tinha a coluna.
--
-- NÃO muda: RLS, policies, GRANTs, buckets e o índice "uma moldura ativa por
-- tipo de cargo". Molduras ficam como asset da agência (projeto_id NULL):
-- o formulário de foto de perfil não tem campo de empresa, então moldura por
-- projeto nunca seria escolhida.
--
-- GRANTs da Fase 1 em art_references/brand_assets são de TABELA (INSERT,
-- UPDATE, DELETE, SELECT para authenticated, com RESTRICTIVE eh_equipe_interna),
-- então as colunas novas já ficam cobertas, só para a equipe interna.
--
-- RE-EXECUTÁVEL.

BEGIN;

DO $do$
BEGIN
  IF to_regclass('public.art_references') IS NULL
     OR to_regclass('public.brand_assets') IS NULL
     OR to_regclass('public.projetos') IS NULL THEN
    RAISE EXCEPTION 'Aplique as migrations da Fase 1 antes (art_references/brand_assets/projetos ausentes).';
  END IF;
END
$do$;

-- 1) projeto_id ------------------------------------------------------------
ALTER TABLE public.art_references ADD COLUMN IF NOT EXISTS projeto_id uuid;
ALTER TABLE public.brand_assets   ADD COLUMN IF NOT EXISTS projeto_id uuid;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.art_references'::regclass
                    AND conname = 'art_references_projeto_id_fkey') THEN
    ALTER TABLE public.art_references
      ADD CONSTRAINT art_references_projeto_id_fkey
      FOREIGN KEY (projeto_id) REFERENCES public.projetos(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.brand_assets'::regclass
                    AND conname = 'brand_assets_projeto_id_fkey') THEN
    ALTER TABLE public.brand_assets
      ADD CONSTRAINT brand_assets_projeto_id_fkey
      FOREIGN KEY (projeto_id) REFERENCES public.projetos(id) ON DELETE SET NULL;
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS art_references_projeto_idx ON public.art_references (projeto_id);
CREATE INDEX IF NOT EXISTS brand_assets_projeto_idx ON public.brand_assets (projeto_id, tipo);

COMMENT ON COLUMN public.art_references.projeto_id IS 'Empresa/projeto da referência. NULL = vale para a agência toda.';
COMMENT ON COLUMN public.brand_assets.projeto_id IS 'Empresa/projeto do asset. NULL = asset da agência (ex.: molduras de cargo).';
COMMENT ON COLUMN public.art_references.cliente_id IS 'Sem uso desde a Fase 3: a empresa é projeto_id.';
COMMENT ON COLUMN public.brand_assets.cliente_id IS 'Sem uso desde a Fase 3: a empresa é projeto_id.';

-- 2) descricao e tags em brand_assets ----------------------------------------
ALTER TABLE public.brand_assets ADD COLUMN IF NOT EXISTS descricao text;
ALTER TABLE public.brand_assets ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.brand_assets'::regclass
                    AND conname = 'brand_assets_descricao_tamanho') THEN
    ALTER TABLE public.brand_assets
      ADD CONSTRAINT brand_assets_descricao_tamanho
      CHECK (descricao IS NULL OR char_length(descricao) <= 2000);
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS brand_assets_tags_idx ON public.brand_assets USING gin (tags);

-- 3) tipo 'elemento_visual' ---------------------------------------------------
ALTER TABLE public.brand_assets DROP CONSTRAINT IF EXISTS brand_assets_tipo_check;
ALTER TABLE public.brand_assets ADD CONSTRAINT brand_assets_tipo_check CHECK (tipo IN (
  'logo', 'logo_negativo', 'paleta', 'fonte', 'modelo_base',
  'moldura_cargo', 'manual', 'outro', 'elemento_visual'));

-- 4) normalização de tags nas duas tabelas -----------------------------------
CREATE OR REPLACE FUNCTION public.tg_arte_acervo_regras()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL THEN
      NEW.criado_por := v_uid;
    END IF;
    NEW.criado_em := now();
  ELSE
    -- criado_por só pode virar NULL (ON DELETE SET NULL), nunca outra pessoa.
    IF NEW.criado_por IS NOT NULL THEN
      NEW.criado_por := OLD.criado_por;
    END IF;
    NEW.criado_em := OLD.criado_em;
  END IF;
  NEW.atualizado_em := now();

  -- Tags em minúsculas, sem espaços nas pontas e sem repetição, para a busca
  -- por tag (operadores && e @>) não depender de como cada pessoa digitou.
  -- Desde a Fase 3 as duas tabelas (art_references e brand_assets) têm tags.
  NEW.tags := coalesce(
    ARRAY(SELECT DISTINCT lower(btrim(t)) FROM unnest(NEW.tags) AS t
           WHERE btrim(coalesce(t, '')) <> '' ORDER BY 1),
    '{}');
  RETURN NEW;
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.tg_arte_acervo_regras() FROM public, anon, authenticated;

-- Verificação -----------------------------------------------------------------
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['art_references', 'brand_assets'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', t)::regclass) THEN
      RAISE EXCEPTION 'RLS desligada em %', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                      AND policyname = 'Exige equipe interna' AND permissive = 'RESTRICTIVE') THEN
      RAISE EXCEPTION 'RESTRICTIVE ausente em %', t;
    END IF;
    IF has_table_privilege('anon', format('public.%I', t), 'SELECT') THEN
      RAISE EXCEPTION 'anon com SELECT em %', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'Arte fase 3: projeto_id, descricao/tags e elemento_visual ok; RLS intacta.';
END
$do$;

COMMIT;
