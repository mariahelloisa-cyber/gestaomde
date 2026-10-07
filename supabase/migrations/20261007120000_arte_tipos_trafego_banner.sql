-- Módulo de demandas de ARTE: tipos novos 'trafego' e 'banner'.
--
--   'trafego' -> anúncio/campanha de tráfego pago. Padrão 1080x1440 ou
--                tamanho personalizado em px (300 a 6000).
--   'banner'  -> sem tamanho padrão: largura e altura sempre informadas, em
--                px (50 a 6000; mínimo baixo por causa de faixas de site,
--                ex.: 728x90).
--
-- Aditivo: só AMPLIA três CHECKs. Nada que hoje é aceito passa a ser recusado.
--   - art_requests_tipo_check     -> + 'trafego', 'banner'
--   - art_requests_dimensoes      -> + faixas de px dos dois tipos novos; os
--                                    tipos existentes ficam exatamente iguais
--   - art_references_tipos_check  -> + 'trafego', 'banner' (referências
--                                    globais por tipo)
--
-- NÃO muda medida_impressao (continua só panfleto), slides, status, RLS,
-- policies, GRANTs, buckets, triggers, brand_assets nem dados.
--
-- RE-EXECUTÁVEL.

BEGIN;

DO $do$
BEGIN
  IF to_regclass('public.art_requests') IS NULL OR to_regclass('public.art_references') IS NULL THEN
    RAISE EXCEPTION 'Aplique as migrations da Fase 1 do módulo de arte antes.';
  END IF;
END
$do$;

ALTER TABLE public.art_requests DROP CONSTRAINT IF EXISTS art_requests_tipo_check;
ALTER TABLE public.art_requests ADD CONSTRAINT art_requests_tipo_check CHECK (tipo IN (
  'foto_perfil', 'panfleto', 'feed', 'feed_data_comemorativa',
  'carrossel', 'vaga_emprego', 'aviso', 'stories',
  'trafego', 'banner'));

ALTER TABLE public.art_requests DROP CONSTRAINT IF EXISTS art_requests_dimensoes;
ALTER TABLE public.art_requests ADD CONSTRAINT art_requests_dimensoes CHECK (
  CASE tipo
    WHEN 'foto_perfil' THEN largura_px = 1080 AND altura_px = 1080
    WHEN 'stories'     THEN largura_px = 1080 AND altura_px = 1920
    WHEN 'panfleto'    THEN largura_px BETWEEN 300 AND 6000 AND altura_px BETWEEN 300 AND 6000
    WHEN 'trafego'     THEN largura_px BETWEEN 300 AND 6000 AND altura_px BETWEEN 300 AND 6000
    WHEN 'banner'      THEN largura_px BETWEEN 50 AND 6000 AND altura_px BETWEEN 50 AND 6000
    ELSE                    largura_px = 1080 AND altura_px = 1440
  END);

ALTER TABLE public.art_references DROP CONSTRAINT IF EXISTS art_references_tipos_check;
ALTER TABLE public.art_references ADD CONSTRAINT art_references_tipos_check CHECK (tipos_arte <@ ARRAY[
  'foto_perfil', 'panfleto', 'feed', 'feed_data_comemorativa',
  'carrossel', 'vaga_emprego', 'aviso', 'stories',
  'trafego', 'banner']::text[]);

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.art_requests'::regclass
                    AND conname = 'art_requests_tipo_check'
                    AND pg_get_constraintdef(oid) LIKE '%banner%') THEN
    RAISE EXCEPTION 'art_requests_tipo_check sem os tipos novos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.art_references'::regclass
                    AND conname = 'art_references_tipos_check'
                    AND pg_get_constraintdef(oid) LIKE '%trafego%') THEN
    RAISE EXCEPTION 'art_references_tipos_check sem os tipos novos';
  END IF;
  RAISE NOTICE 'Tipos trafego e banner ok.';
END
$do$;

COMMIT;
