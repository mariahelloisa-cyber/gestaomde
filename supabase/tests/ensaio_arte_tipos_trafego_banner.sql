-- ENSAIO de 20261007120000_arte_tipos_trafego_banner.sql.
--
--   BEGIN -> corpo da migration -> testes -> ROLLBACK
--
-- Não grava nada. Roda com
--   npx supabase db query --linked -f supabase/tests/ensaio_arte_tipos_trafego_banner.sql
-- SUCESSO -> uma linha com resultado = 'ENSAIO OK'.

BEGIN;

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


-- ###########################################################################
-- ##  HELPERS (mesmos dos outros ensaios)
-- ###########################################################################

CREATE OR REPLACE FUNCTION pg_temp.ok(_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('ensaio.assercoes',
    (coalesce(nullif(current_setting('ensaio.assercoes', true), ''), '0')::int + 1)::text, true);
  RAISE NOTICE 'OK: %', _msg;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.falha(_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FALHOU: %', _msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.erro(_sql text, _estado text, _msg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_estado text; v_texto text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE, v_texto = MESSAGE_TEXT;
    IF v_estado = _estado THEN PERFORM pg_temp.ok(_msg); RETURN; END IF;
    PERFORM pg_temp.falha(format('%s (esperava %s, veio %s: %s)', _msg, _estado, v_estado, v_texto));
  END;
  PERFORM pg_temp.falha(format('%s (o comando passou)', _msg));
END $$;
-- Insere um rascunho (sem demanda) só para exercitar os CHECKs.
CREATE OR REPLACE FUNCTION pg_temp.rascunho(_tipo text, _l int, _a int) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO public.art_requests (tipo, status, largura_px, altura_px) VALUES (%L, %L, %s, %s)',
                _tipo, 'rascunho', _l, _a)
$$;

-- ###########################################################################
-- ##  TESTES (CHECKs valem para qualquer papel; roda como o dono)
-- ###########################################################################

DO $$
BEGIN
  -- Tráfego: padrão e personalizado.
  EXECUTE pg_temp.rascunho('trafego', 1080, 1440);
  PERFORM pg_temp.ok('trafego 1080x1440 (padrao) aceito');
  EXECUTE pg_temp.rascunho('trafego', 1200, 628);
  PERFORM pg_temp.ok('trafego 1200x628 (personalizado) aceito');
  PERFORM pg_temp.erro(pg_temp.rascunho('trafego', 200, 1440), '23514', 'trafego abaixo de 300 px recusado');
  PERFORM pg_temp.erro(pg_temp.rascunho('trafego', 1080, 7000), '23514', 'trafego acima de 6000 px recusado');
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.art_requests (tipo, status, largura_px, altura_px, medida_impressao)
       VALUES ('trafego', 'rascunho', 1080, 1440, '{"largura_mm":150}')$q$,
    '23514', 'medida_impressao continua so para panfleto');

  -- Banner: sempre personalizado, faixa mais larga.
  EXECUTE pg_temp.rascunho('banner', 728, 90);
  PERFORM pg_temp.ok('banner 728x90 aceito');
  EXECUTE pg_temp.rascunho('banner', 1920, 400);
  PERFORM pg_temp.ok('banner 1920x400 aceito');
  PERFORM pg_temp.erro(pg_temp.rascunho('banner', 40, 90), '23514', 'banner abaixo de 50 px recusado');
  PERFORM pg_temp.erro(pg_temp.rascunho('banner', 6001, 400), '23514', 'banner acima de 6000 px recusado');

  -- Slides: os tipos novos são de arte única.
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.art_requests (tipo, status, largura_px, altura_px, qtd_slides)
       VALUES ('banner', 'rascunho', 1920, 400, 3)$q$,
    '23514', 'banner com mais de 1 slide recusado');

  -- Tipos existentes continuam com as mesmas regras.
  EXECUTE pg_temp.rascunho('feed', 1080, 1440);
  EXECUTE pg_temp.rascunho('stories', 1080, 1920);
  EXECUTE pg_temp.rascunho('foto_perfil', 1080, 1080);
  EXECUTE pg_temp.rascunho('panfleto', 886, 1240);
  PERFORM pg_temp.ok('feed, stories, foto_perfil e panfleto continuam aceitos');
  PERFORM pg_temp.erro(pg_temp.rascunho('feed', 1200, 628), '23514', 'feed fora de 1080x1440 continua recusado');
  PERFORM pg_temp.erro(pg_temp.rascunho('stories', 1080, 1440), '23514', 'stories fora de 1080x1920 continua recusado');
  PERFORM pg_temp.erro(pg_temp.rascunho('outdoor', 1080, 1440), '23514', 'tipo desconhecido continua recusado');

  -- Referências globais por tipo.
  INSERT INTO public.art_references (titulo, tipos_arte, path)
  VALUES ('Ref trafego', ARRAY['trafego'], 'trafego/ensaio-0001.png'),
         ('Ref banner',  ARRAY['banner'],  'banner/ensaio-0002.png');
  PERFORM pg_temp.ok('referencias de trafego e banner aceitas');
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.art_references (titulo, tipos_arte, path)
       VALUES ('Ref ruim', ARRAY['outdoor'], 'outdoor/ensaio-0003.png')$q$,
    '23514', 'referencia de tipo desconhecido continua recusada');
END
$$;

SELECT 'ENSAIO OK' AS resultado,
       coalesce(nullif(current_setting('ensaio.assercoes', true), ''), '(contador indisponivel)') AS assercoes_passaram,
       'Nenhuma assercao falhou. ROLLBACK a seguir, nada foi gravado.' AS observacao;

ROLLBACK;
