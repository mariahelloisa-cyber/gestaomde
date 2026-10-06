-- ENSAIO de 20261006160000_arte_fase3_acervo.sql + sequência de banco do
-- upload manual / revisão / conclusão (a mesma que src/lib/arte.functions.ts faz).
--
--   BEGIN -> corpo da migration -> fixtures -> testes -> ROLLBACK
--
-- Não grava nada. Roda com
--   npx supabase db query --linked -f supabase/tests/ensaio_arte_fase3.sql
-- SUCESSO -> uma linha com resultado = 'ENSAIO OK'.

BEGIN;

-- ###########################################################################
-- ##  CORPO DE 20261006160000_arte_fase3_acervo.sql
-- ###########################################################################
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

INSERT INTO public.convites (email, cargo, status) VALUES ('membro.f3@rlstest.local', 'Membro', 'pendente');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('ffff1111-1111-1111-1111-111111111111', 'membro.f3@rlstest.local', '{"nome":"Membro F3"}'::jsonb),
  ('ffff4444-4444-4444-4444-444444444444', 'sol.f3@rlstest.local',    '{"nome":"Sol F3","tipo":"demandante"}'::jsonb);

INSERT INTO public.projetos (id, nome) VALUES ('ffff0f01-0000-0000-0000-000000000001', 'Projeto teste F3');
INSERT INTO public.demandas_externas (id, solicitante_nome, solicitante_user_id, descricao, status, tipo) VALUES
  ('ffff0de1-0000-0000-0000-000000000001', 'Sol F3', 'ffff4444-4444-4444-4444-444444444444', 'Carrossel', 'aceita', 'arte');
INSERT INTO public.art_requests (id, demanda_id, solicitante_user_id, projeto_id, tipo, status, briefing,
                                 largura_px, altura_px, qtd_slides) VALUES
  ('ffffa001-0000-0000-0000-000000000001', 'ffff0de1-0000-0000-0000-000000000001', 'ffff4444-4444-4444-4444-444444444444',
   'ffff0f01-0000-0000-0000-000000000001', 'carrossel', 'aceita', 'b', 1080, 1440, 2);

-- ##  HELPERS
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
-- ##  1) ACERVO (membro, com JWT)
-- ###########################################################################

SET LOCAL ROLE authenticated;

DO $$
DECLARE v_tags text[]; v_por uuid;
BEGIN
  PERFORM pg_temp.como('ffff1111-1111-1111-1111-111111111111');

  INSERT INTO public.art_references (titulo, tipos_arte, categoria, tags, descricao, projeto_id, path, mime_type)
  VALUES ('Ref F3', ARRAY['feed','carrossel'], 'institucional', ARRAY[' Azul ', 'azul', 'Minimalista'],
          'Fundo claro, tipografia grande', 'ffff0f01-0000-0000-0000-000000000001',
          'ffff0f01-0000-0000-0000-000000000001/ref.png', 'image/png')
  RETURNING tags, criado_por INTO v_tags, v_por;
  IF v_tags IS DISTINCT FROM ARRAY['azul','minimalista'] OR v_por <> 'ffff1111-1111-1111-1111-111111111111' THEN
    PERFORM pg_temp.falha(format('referencia: tags/autor errados %s %s', v_tags, v_por));
  END IF;
  PERFORM pg_temp.ok('membro cadastra referencia por projeto; tags normalizadas; autor registrado');

  INSERT INTO public.brand_assets (projeto_id, tipo, nome, descricao, tags, path, mime_type)
  VALUES ('ffff0f01-0000-0000-0000-000000000001', 'elemento_visual', 'Grafismo', 'Onda da marca',
          ARRAY['Onda', ' onda '], 'ffff0f01-0000-0000-0000-000000000001/elemento_visual/g.png', 'image/png')
  RETURNING tags INTO v_tags;
  IF v_tags IS DISTINCT FROM ARRAY['onda'] THEN
    PERFORM pg_temp.falha(format('brand_assets: tags nao normalizadas %s', v_tags));
  END IF;
  PERFORM pg_temp.ok('brand_assets aceita elemento_visual, descricao e tags normalizadas');

  INSERT INTO public.brand_assets (tipo, nome, valor)
  VALUES ('moldura_cargo', 'Moldura Professor', '{"tipo_cargo":"Professor","cor":"#FFCC00"}');
  PERFORM pg_temp.ok('membro cadastra moldura de cargo da agencia');
  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (tipo, nome, valor)
                         VALUES ('moldura_cargo', 'Outra', '{"tipo_cargo":"professor","cor":"#000000"}')$q$,
    '23505', 'segue valendo uma moldura ativa por tipo de cargo');

  PERFORM pg_temp.como('ffff4444-4444-4444-4444-444444444444');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_references WHERE titulo = 'Ref F3'$q$, 0,
    'solicitante nao ve referencias');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.brand_assets WHERE nome = 'Grafismo'$q$, 0,
    'solicitante nao ve brand assets');
END
$$;

-- ###########################################################################
-- ##  2) UPLOAD MANUAL -> REVISAO -> CONCLUSAO (mesma sequencia do servidor)
-- ###########################################################################

RESET ROLE;
-- Como o servidor (service role): sem "sub" no JWT, auth.uid() = NULL.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Passo do servidor (service role): job manual 'processando' + 2 slides.
INSERT INTO public.ai_generation_jobs (id, art_request_id, origem, status, solicitado_por)
VALUES ('ffff0b01-0000-0000-0000-000000000001', 'ffffa001-0000-0000-0000-000000000001', 'manual', 'processando',
        'ffff1111-1111-1111-1111-111111111111');
INSERT INTO public.ai_generations (id, job_id, art_request_id, slide_index, path, mime_type) VALUES
  ('ffff0e01-0000-0000-0000-000000000001', 'ffff0b01-0000-0000-0000-000000000001', 'ffffa001-0000-0000-0000-000000000001', 1,
   'ffffa001-0000-0000-0000-000000000001/ffff0b01-0000-0000-0000-000000000001/s01-v1.png', 'image/png'),
  ('ffff0e02-0000-0000-0000-000000000002', 'ffff0b01-0000-0000-0000-000000000001', 'ffffa001-0000-0000-0000-000000000001', 2,
   'ffffa001-0000-0000-0000-000000000001/ffff0b01-0000-0000-0000-000000000001/s02-v1.png', 'image/png');
UPDATE public.ai_generation_jobs SET status = 'concluido' WHERE id = 'ffff0b01-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;

DO $$
BEGIN
  PERFORM pg_temp.como('ffff1111-1111-1111-1111-111111111111');

  PERFORM pg_temp.erro($q$INSERT INTO public.ai_generation_jobs (art_request_id, origem)
                         VALUES ('ffffa001-0000-0000-0000-000000000001', 'manual')$q$,
    '42501', 'membro nao escolhe origem do job direto (so o servidor)');

  UPDATE public.art_requests SET status = 'aguardando_revisao' WHERE id = 'ffffa001-0000-0000-0000-000000000001';
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_requests WHERE id = 'ffffa001-0000-0000-0000-000000000001'
                            AND status = 'aguardando_revisao'
                            AND status_alterado_por = 'ffff1111-1111-1111-1111-111111111111'$q$, 1,
    'envio manual deixa a arte aguardando revisao, com autor registrado');

  PERFORM pg_temp.erro($q$UPDATE public.ai_generations SET path_aprovado = 'x'
                          WHERE id = 'ffff0e01-0000-0000-0000-000000000001'$q$,
    '42501', 'membro nao grava path_aprovado direto (so o servidor, depois de copiar)');

  INSERT INTO public.ai_generation_reviews (art_request_id, job_id, decisao, generation_ids)
  VALUES ('ffffa001-0000-0000-0000-000000000001', 'ffff0b01-0000-0000-0000-000000000001', 'aprovada',
          ARRAY['ffff0e01-0000-0000-0000-000000000001','ffff0e02-0000-0000-0000-000000000002']::uuid[]);
  UPDATE public.ai_generations SET status = 'aprovada' WHERE job_id = 'ffff0b01-0000-0000-0000-000000000001';
  PERFORM pg_temp.ok('membro registra revisao aprovada e marca os slides');
END
$$;

RESET ROLE;
-- Como o servidor (service role): sem "sub" no JWT, auth.uid() = NULL.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.ai_generations SET path_aprovado = 'ffffa001-0000-0000-0000-000000000001/' || id || '.png'
 WHERE job_id = 'ffff0b01-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  PERFORM pg_temp.como('ffff1111-1111-1111-1111-111111111111');
  UPDATE public.art_requests SET job_aprovado_id = 'ffff0b01-0000-0000-0000-000000000001', status = 'concluida'
   WHERE id = 'ffffa001-0000-0000-0000-000000000001';
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_requests WHERE id = 'ffffa001-0000-0000-0000-000000000001'
                            AND status = 'concluida' AND aprovado_por = 'ffff1111-1111-1111-1111-111111111111'$q$, 1,
    'conclusao com revisao aprovada registra aprovado_por');

  PERFORM pg_temp.como('ffff4444-4444-4444-4444-444444444444');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_requests WHERE id = 'ffffa001-0000-0000-0000-000000000001'
                            AND status = 'concluida'$q$, 1, 'solicitante ve a propria arte concluida');
  PERFORM pg_temp.conta('SELECT count(*) FROM public.ai_generations', 0,
    'solicitante segue sem ler ai_generations (download so via servidor)');
END
$$;

RESET ROLE;
-- Como o servidor (service role): sem "sub" no JWT, auth.uid() = NULL.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
BEGIN
  DELETE FROM public.projetos WHERE id = 'ffff0f01-0000-0000-0000-000000000001';
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_references WHERE titulo = 'Ref F3' AND projeto_id IS NULL$q$, 1,
    'excluir projeto: referencia fica com projeto_id NULL');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.brand_assets WHERE nome = 'Grafismo' AND projeto_id IS NULL$q$, 1,
    'excluir projeto: asset fica com projeto_id NULL');
END
$$;

SELECT 'ENSAIO OK' AS resultado,
       coalesce(nullif(current_setting('ensaio.assercoes', true), ''), '(contador indisponivel)') AS assercoes_passaram,
       'Nenhuma assercao falhou. ROLLBACK a seguir, nada foi gravado.' AS observacao;

ROLLBACK;
