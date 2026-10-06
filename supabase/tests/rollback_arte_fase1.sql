-- ROLLBACK de 20261006130000_arte_fase1_tabelas.sql + 20261006140000_arte_fase1_buckets.sql.
--
-- Só para desfazer a Fase 1 inteira DEPOIS de aplicada. APAGA DADOS de arte.
-- Demandas gerais não são tocadas (a coluna `tipo` sai, o resto fica).
--
-- Ordem:
--   1) Esvazie e apague os 5 buckets pelo painel (Storage) ou pela Storage
--      API (emptyBucket + deleteBucket). NÃO dá por SQL: o trigger
--      storage.protect_delete barra DELETE direto tanto em storage.objects
--      quanto em storage.buckets (42501, testado em 2026-10-06).
--        art-request-files, ai-generated-arts, approved-arts,
--        brand-assets, art-references
--   2) Rode este arquivo.
--   3) npx supabase migration repair --status reverted 20261006140000 20261006130000

BEGIN;

DO $do$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM storage.buckets
   WHERE id IN ('art-request-files','ai-generated-arts','approved-arts','brand-assets','art-references');
  IF n > 0 THEN
    RAISE NOTICE 'Ainda ha % bucket(s) de arte. Apague pelo painel/Storage API (passo 1).', n;
  END IF;
END
$do$;

DROP TABLE IF EXISTS public.ai_generation_reviews;
DROP TABLE IF EXISTS public.ai_generations;
ALTER TABLE IF EXISTS public.art_requests DROP CONSTRAINT IF EXISTS art_requests_job_aprovado_fk;
DROP TABLE IF EXISTS public.ai_generation_jobs;
DROP TABLE IF EXISTS public.art_request_files;
DROP TABLE IF EXISTS public.art_requests;
DROP TABLE IF EXISTS public.art_references;
DROP TABLE IF EXISTS public.brand_assets;

DROP FUNCTION IF EXISTS public.tg_art_requests_regras();
DROP FUNCTION IF EXISTS public.tg_art_request_files_regras();
DROP FUNCTION IF EXISTS public.tg_ai_generation_jobs_regras();
DROP FUNCTION IF EXISTS public.tg_ai_generations_regras();
DROP FUNCTION IF EXISTS public.tg_ai_generation_reviews_regras();
DROP FUNCTION IF EXISTS public.tg_arte_acervo_regras();

DROP POLICY IF EXISTS "Equipe interna le demandas de arte" ON public.demandas_externas;
DROP TRIGGER IF EXISTS demandas_externas_tipo_fixo ON public.demandas_externas;
DROP FUNCTION IF EXISTS public.tg_demandas_externas_tipo_fixo();
DROP INDEX IF EXISTS public.demandas_externas_tipo_arte_idx;
ALTER TABLE public.demandas_externas DROP CONSTRAINT IF EXISTS demandas_externas_tipo_check;
ALTER TABLE public.demandas_externas DROP COLUMN IF EXISTS tipo;

COMMIT;
