-- ENSAIO de 20261006200000_arte_fase3e_orientacoes_ia.sql.
--
--   BEGIN -> corpo da migration -> fixtures -> testes -> ROLLBACK
--
-- Não grava nada. Roda com
--   npx supabase db query --linked -f supabase/tests/ensaio_arte_fase3e.sql
-- SUCESSO -> uma linha com resultado = 'ENSAIO OK'.

BEGIN;

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

  INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor) VALUES
    ('abcd0f01-0000-0000-0000-000000000001', 'estilo_visual', 'Estilo', '{"texto":"Foto grande, título curto, CTA no rodapé."}'),
    ('abcd0f01-0000-0000-0000-000000000001', 'evitar', 'Evitar', '{"texto":"Nada de fundo neon."}'),
    ('abcd0f01-0000-0000-0000-000000000001', 'observacao_ia', 'Obs', '{"texto":"Público 18-24."}');
  PERFORM pg_temp.ok('estilo_visual, evitar e observacao_ia com empresa e texto sao aceitos');

  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
                         VALUES ('abcd0f01-0000-0000-0000-000000000001', 'evitar', 'Evitar 2', '{"texto":"Outro"}')$q$,
    '23505', 'evitar e um por empresa');
  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
                         VALUES ('abcd0f02-0000-0000-0000-000000000002', 'estilo_visual', 'Vazio', '{"texto":"  "}')$q$,
    '23514', 'estilo_visual sem texto e recusado');
  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (tipo, nome, valor)
                         VALUES ('observacao_ia', 'Sem empresa', '{"texto":"x"}')$q$,
    '23514', 'observacao_ia sem empresa e recusada');

  -- Regras anteriores seguem valendo.
  INSERT INTO public.brand_assets (projeto_id, tipo, nome, path, mime_type) VALUES
    ('abcd0f01-0000-0000-0000-000000000001', 'logo', 'Com nome', 'abcd0f01-0000-0000-0000-000000000001/logo/1.png', 'image/png'),
    ('abcd0f01-0000-0000-0000-000000000001', 'logo', 'Sem nome', 'abcd0f01-0000-0000-0000-000000000001/logo/2.png', 'image/png');
  PERFORM pg_temp.ok('varias logos por empresa continuam aceitas');
  INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
  VALUES ('abcd0f01-0000-0000-0000-000000000001', 'fonte', 'Fonte', '{"nome_fonte":"Montserrat"}');
  PERFORM pg_temp.ok('fonte continua aceita no banco (so saiu da tela)');
END
$$;

SELECT 'ENSAIO OK' AS resultado,
       coalesce(nullif(current_setting('ensaio.assercoes', true), ''), '(contador indisponivel)') AS assercoes_passaram,
       'Nenhuma assercao falhou. ROLLBACK a seguir, nada foi gravado.' AS observacao;

ROLLBACK;
