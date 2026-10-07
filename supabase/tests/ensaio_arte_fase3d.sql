-- ENSAIO de 20261006190000_arte_fase3d_varias_logos.sql.
--
--   BEGIN -> corpo da migration -> fixtures -> testes -> ROLLBACK
--
-- Não grava nada. Roda com
--   npx supabase db query --linked -f supabase/tests/ensaio_arte_fase3d.sql
-- SUCESSO -> uma linha com resultado = 'ENSAIO OK'.

BEGIN;

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

-- ##  FIXTURES
-- ###########################################################################

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['convites', 'perfis_usuarios', 'projetos']
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;
END
$do$;

INSERT INTO public.convites (email, cargo, status) VALUES ('membro.f3b@rlstest.local', 'Membro', 'pendente');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('abcd1111-1111-1111-1111-111111111111', 'membro.f3b@rlstest.local', '{"nome":"Membro F3b"}'::jsonb),
  ('abcd4444-4444-4444-4444-444444444444', 'sol.f3b@rlstest.local',    '{"nome":"Sol F3b","tipo":"demandante"}'::jsonb);
INSERT INTO public.projetos (id, nome) VALUES
  ('abcd0f01-0000-0000-0000-000000000001', 'Empresa com marca'),
  ('abcd0f02-0000-0000-0000-000000000002', 'Empresa sem marca');

-- ###########################################################################
-- ##  HELPERS (mesmos dos outros ensaios)
-- ###########################################################################

CREATE OR REPLACE FUNCTION pg_temp.como(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('ensaio.assercoes',
    (coalesce(nullif(current_setting('ensaio.assercoes', true), ''), '0')::int + 1)::text, true);
  RAISE NOTICE 'OK: %', _msg;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.falha(_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FALHOU: %', _msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.conta(_sql text, _esperado bigint, _msg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE _sql INTO n;
  IF n IS DISTINCT FROM _esperado THEN
    PERFORM pg_temp.falha(format('%s (esperava %s, veio %s)', _msg, _esperado, n));
  END IF;
  PERFORM pg_temp.ok(_msg);
END $$;
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


-- ###########################################################################
-- ##  TESTES (membro, com JWT)
-- ###########################################################################

SET LOCAL ROLE authenticated;

DO $$
BEGIN
  PERFORM pg_temp.como('abcd1111-1111-1111-1111-111111111111');

  INSERT INTO public.brand_assets (projeto_id, tipo, nome, path, mime_type) VALUES
    ('abcd0f01-0000-0000-0000-000000000001', 'logo', 'Com nome',
     'abcd0f01-0000-0000-0000-000000000001/logo/1.png', 'image/png'),
    ('abcd0f01-0000-0000-0000-000000000001', 'logo', 'Sem nome',
     'abcd0f01-0000-0000-0000-000000000001/logo/2.png', 'image/png'),
    ('abcd0f01-0000-0000-0000-000000000001', 'logo', 'Versão branca',
     'abcd0f01-0000-0000-0000-000000000001/logo/3.svg', 'image/svg+xml');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.brand_assets
                          WHERE projeto_id = 'abcd0f01-0000-0000-0000-000000000001' AND tipo = 'logo'$q$, 3,
    'empresa aceita varias logos');

  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (tipo, nome, path, mime_type)
                         VALUES ('logo', 'Sem empresa', '_agencia/logo/x.png', 'image/png')$q$,
    '23514', 'logo continua exigindo empresa');

  INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
  VALUES ('abcd0f01-0000-0000-0000-000000000001', 'slogan', 'Slogan', '{"texto":"Primeiro"}');
  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
                         VALUES ('abcd0f01-0000-0000-0000-000000000001', 'slogan', 'Slogan 2', '{"texto":"Segundo"}')$q$,
    '23505', 'slogan continua um por empresa');

  INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
  VALUES ('abcd0f01-0000-0000-0000-000000000001', 'paleta', 'Paleta', '{"cores":["#000000"]}');
  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
                         VALUES ('abcd0f01-0000-0000-0000-000000000001', 'paleta', 'Paleta 2', '{"cores":["#FFFFFF"]}')$q$,
    '23505', 'paleta continua uma por empresa');
END
$$;

SELECT 'ENSAIO OK' AS resultado,
       coalesce(nullif(current_setting('ensaio.assercoes', true), ''), '(contador indisponivel)') AS assercoes_passaram,
       'Nenhuma assercao falhou. ROLLBACK a seguir, nada foi gravado.' AS observacao;

ROLLBACK;
