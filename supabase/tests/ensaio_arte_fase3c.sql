-- ENSAIO de 20261006180000_arte_fase3c_ficha_marca.sql.
--
--   BEGIN -> corpo da migration -> fixtures -> testes -> ROLLBACK
--
-- Não grava nada. Roda com
--   npx supabase db query --linked -f supabase/tests/ensaio_arte_fase3c.sql
-- SUCESSO -> uma linha com resultado = 'ENSAIO OK'.

BEGIN;

-- ###########################################################################
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

-- ###########################################################################
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

  INSERT INTO public.brand_assets (projeto_id, tipo, nome, tags)
  VALUES ('abcd0f01-0000-0000-0000-000000000001', 'tags_marca', 'Tags da marca', ARRAY['Jovem', ' educação ']);
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.brand_assets WHERE tipo = 'tags_marca'
                            AND tags = ARRAY['educação','jovem']$q$, 1,
    'tags_marca com so tags e aceita (e normalizada)');

  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (projeto_id, tipo, nome)
                         VALUES ('abcd0f01-0000-0000-0000-000000000001', 'outro', 'Vazio')$q$,
    '23514', 'linha sem arquivo, valor nem tags continua recusada');

  INSERT INTO public.brand_assets (projeto_id, tipo, nome, path, mime_type)
  VALUES ('abcd0f01-0000-0000-0000-000000000001', 'briefing_documento', 'Briefing completo',
          'abcd0f01-0000-0000-0000-000000000001/briefing_documento/x.pdf', 'application/pdf');
  PERFORM pg_temp.ok('briefing_documento com arquivo e empresa e aceito');

  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
                         VALUES ('abcd0f01-0000-0000-0000-000000000001', 'briefing_documento', 'Sem arquivo',
                                 '{"x":1}')$q$,
    '23514', 'briefing_documento sem arquivo e recusado');
  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (tipo, nome, path, mime_type)
                         VALUES ('briefing_documento', 'Sem empresa', '_agencia/briefing_documento/y.pdf', 'application/pdf')$q$,
    '23514', 'briefing_documento sem empresa e recusado');

  INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
  VALUES ('abcd0f01-0000-0000-0000-000000000001', 'slogan', 'Slogan', '{"texto":"Primeiro"}');
  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
                         VALUES ('abcd0f01-0000-0000-0000-000000000001', 'slogan', 'Slogan 2', '{"texto":"Segundo"}')$q$,
    '23505', 'so um slogan ativo por empresa');
  INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
  VALUES ('abcd0f02-0000-0000-0000-000000000002', 'slogan', 'Slogan', '{"texto":"Outra empresa"}');
  PERFORM pg_temp.ok('outra empresa pode ter o proprio slogan');

  INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
  VALUES ('abcd0f01-0000-0000-0000-000000000001', 'fonte', 'Fonte', '{"nome_fonte":"Montserrat"}');
  PERFORM pg_temp.ok('fonte so com o nome (sem arquivo) e aceita');

  INSERT INTO public.brand_assets (projeto_id, tipo, nome, path, mime_type) VALUES
    ('abcd0f01-0000-0000-0000-000000000001', 'elemento_visual', 'E1', 'abcd0f01-0000-0000-0000-000000000001/elemento_visual/1.png', 'image/png'),
    ('abcd0f01-0000-0000-0000-000000000001', 'elemento_visual', 'E2', 'abcd0f01-0000-0000-0000-000000000001/elemento_visual/2.png', 'image/png');
  PERFORM pg_temp.ok('elementos visuais podem ser varios por empresa');

  PERFORM pg_temp.como('abcd4444-4444-4444-4444-444444444444');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.brand_assets WHERE projeto_id IS NOT NULL$q$, 0,
    'solicitante segue sem ver a ficha de marca');
END
$$;

SELECT 'ENSAIO OK' AS resultado,
       coalesce(nullif(current_setting('ensaio.assercoes', true), ''), '(contador indisponivel)') AS assercoes_passaram,
       'Nenhuma assercao falhou. ROLLBACK a seguir, nada foi gravado.' AS observacao;

ROLLBACK;
