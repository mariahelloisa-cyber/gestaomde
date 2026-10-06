-- ENSAIO de 20261006170000_arte_fase3b_marca_por_projeto.sql.
--
--   BEGIN -> corpo da migration -> fixtures -> testes -> ROLLBACK
--
-- Não grava nada. Roda com
--   npx supabase db query --linked -f supabase/tests/ensaio_arte_fase3b.sql
-- SUCESSO -> uma linha com resultado = 'ENSAIO OK'.

BEGIN;

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

  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (tipo, nome, path, mime_type)
                         VALUES ('logo', 'Logo sem empresa', '_agencia/logo/x.png', 'image/png')$q$,
    '23514', 'logo sem empresa e recusado (marca e sempre de uma empresa)');

  INSERT INTO public.brand_assets (projeto_id, tipo, nome, path, mime_type)
  VALUES ('abcd0f01-0000-0000-0000-000000000001', 'logo', 'Logo', 'abcd0f01-0000-0000-0000-000000000001/logo/x.png', 'image/png');
  INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
  VALUES ('abcd0f01-0000-0000-0000-000000000001', 'slogan', 'Slogan', '{"texto":"Educação que transforma"}');
  INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
  VALUES ('abcd0f01-0000-0000-0000-000000000001', 'briefing', 'Briefing da marca', '{"texto":"Tom acolhedor, público adulto."}');
  PERFORM pg_temp.ok('logo, slogan e briefing com empresa sao aceitos');

  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
                         VALUES ('abcd0f01-0000-0000-0000-000000000001', 'slogan', 'Vazio', '{"outra":"coisa"}')$q$,
    '23514', 'slogan sem texto e recusado');

  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (projeto_id, tipo, nome, valor)
                         VALUES ('abcd0f01-0000-0000-0000-000000000001', 'moldura_cargo', 'Moldura',
                                 '{"tipo_cargo":"Professor","cor":"#FFCC00"}')$q$,
    '23514', 'moldura com empresa e recusada (moldura e da agencia)');

  INSERT INTO public.brand_assets (tipo, nome, valor)
  VALUES ('moldura_cargo', 'Moldura Professor', '{"tipo_cargo":"Professor","cor":"#FFCC00"}');
  PERFORM pg_temp.ok('moldura da agencia (sem empresa) e aceita');

  INSERT INTO public.art_references (titulo, tipos_arte, path, mime_type)
  VALUES ('Ref global de feed', ARRAY['feed'], 'feed/ref.png', 'image/png');
  PERFORM pg_temp.ok('referencia global (sem empresa) e aceita');

  PERFORM pg_temp.como('abcd4444-4444-4444-4444-444444444444');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.brand_assets WHERE projeto_id = 'abcd0f01-0000-0000-0000-000000000001'$q$, 0,
    'solicitante segue sem ver a marca das empresas');
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
BEGIN
  PERFORM pg_temp.erro($q$DELETE FROM public.projetos WHERE id = 'abcd0f01-0000-0000-0000-000000000001'$q$,
    '23503', 'projeto com marca cadastrada nao pode ser excluido (RESTRICT): a marca nunca vira global');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.brand_assets
                          WHERE projeto_id = 'abcd0f01-0000-0000-0000-000000000001'$q$, 3,
    'os assets da empresa continuam ligados a ela');

  DELETE FROM public.projetos WHERE id = 'abcd0f02-0000-0000-0000-000000000002';
  PERFORM pg_temp.ok('projeto sem marca segue podendo ser excluido');

  DELETE FROM public.brand_assets WHERE projeto_id = 'abcd0f01-0000-0000-0000-000000000001';
  DELETE FROM public.projetos WHERE id = 'abcd0f01-0000-0000-0000-000000000001';
  PERFORM pg_temp.ok('removendo os assets antes, o projeto pode ser excluido');
END
$$;

SELECT 'ENSAIO OK' AS resultado,
       coalesce(nullif(current_setting('ensaio.assercoes', true), ''), '(contador indisponivel)') AS assercoes_passaram,
       'Nenhuma assercao falhou. ROLLBACK a seguir, nada foi gravado.' AS observacao;

ROLLBACK;
