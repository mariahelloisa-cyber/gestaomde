-- ENSAIO de 20261006150000_arte_fase2_projeto.sql.
--
--   BEGIN -> corpo da migration -> fixtures -> testes -> ROLLBACK
--
-- Não grava nada. Roda com
--   npx supabase db query --linked -f supabase/tests/ensaio_arte_fase2.sql
-- SUCESSO -> uma linha com resultado = 'ENSAIO OK'.

BEGIN;

-- ###########################################################################
-- ##  CORPO DE 20261006150000_arte_fase2_projeto.sql
-- ###########################################################################
-- Módulo de demandas de ARTE — Fase 2: "empresa" do formulário = projeto.
--
-- No CRM, as empresas atendidas ficam em public.projetos (11 em produção em
-- 2026-10-06); public.clientes está vazia. A Fase 1 tinha ligado
-- art_requests.cliente_id a clientes. Esta migration só ACRESCENTA
-- art_requests.projeto_id. Nada da Fase 1 muda:
--   - cliente_id continua lá, nullable e sem uso (não removo para não mexer em
--     schema aplicado sem necessidade);
--   - nenhuma policy, trigger ou GRANT é alterado. O GRANT de SELECT de
--     art_requests é de tabela, então já cobre a coluna nova; e projeto_id
--     fica FORA do GRANT UPDATE de coluna — só o servidor (service role) grava.
--
-- ON DELETE SET NULL, igual a tarefas.projeto_id: excluir um projeto no CRM
-- não pode travar nem apagar demandas de arte.
--
-- RE-EXECUTÁVEL.


DO $do$
BEGIN
  IF to_regclass('public.art_requests') IS NULL OR to_regclass('public.projetos') IS NULL THEN
    RAISE EXCEPTION 'Aplique 20261006130000_arte_fase1_tabelas.sql antes (art_requests/projetos ausentes).';
  END IF;
END
$do$;

ALTER TABLE public.art_requests
  ADD COLUMN IF NOT EXISTS projeto_id uuid;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.art_requests'::regclass
       AND conname = 'art_requests_projeto_id_fkey'
  ) THEN
    ALTER TABLE public.art_requests
      ADD CONSTRAINT art_requests_projeto_id_fkey
      FOREIGN KEY (projeto_id) REFERENCES public.projetos(id) ON DELETE SET NULL;
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS art_requests_projeto_idx ON public.art_requests (projeto_id);

COMMENT ON COLUMN public.art_requests.projeto_id IS
  'Empresa/projeto da arte (select "Empresa" do formulário). Gravado só pelo servidor.';
COMMENT ON COLUMN public.art_requests.cliente_id IS
  'Sem uso desde a Fase 2: a empresa da arte é projeto_id. Mantido por compatibilidade.';

DO $do$
BEGIN
  IF has_column_privilege('authenticated', 'public.art_requests', 'projeto_id', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated nao deveria poder atualizar art_requests.projeto_id';
  END IF;
  RAISE NOTICE 'art_requests.projeto_id criado (FK projetos, ON DELETE SET NULL).';
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

INSERT INTO public.convites (email, cargo, status) VALUES ('membro.f2@rlstest.local', 'Membro', 'pendente');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('eeee1111-1111-1111-1111-111111111111', 'membro.f2@rlstest.local', '{"nome":"Membro F2"}'::jsonb),
  ('eeee4444-4444-4444-4444-444444444444', 'sol.f2@rlstest.local',    '{"nome":"Sol F2","tipo":"demandante"}'::jsonb);

INSERT INTO public.projetos (id, nome) VALUES ('eeee0f01-0000-0000-0000-000000000001', 'Projeto teste F2');
INSERT INTO public.demandas_externas (id, solicitante_nome, solicitante_user_id, descricao, status, tipo) VALUES
  ('eeee0de1-0000-0000-0000-000000000001', 'Sol F2', 'eeee4444-4444-4444-4444-444444444444', 'Arte', 'pendente', 'arte');
INSERT INTO public.art_requests (id, demanda_id, solicitante_user_id, projeto_id, tipo, status, briefing, largura_px, altura_px) VALUES
  ('eeeea001-0000-0000-0000-000000000001', 'eeee0de1-0000-0000-0000-000000000001', 'eeee4444-4444-4444-4444-444444444444',
   'eeee0f01-0000-0000-0000-000000000001', 'feed', 'enviada', 'b', 1080, 1440);

-- ###########################################################################
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
-- ##  TESTES
-- ###########################################################################

SET LOCAL ROLE authenticated;

DO $$
BEGIN
  PERFORM pg_temp.como('eeee4444-4444-4444-4444-444444444444');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_requests
                          WHERE projeto_id = 'eeee0f01-0000-0000-0000-000000000001'$q$, 1,
    'solicitante le o projeto_id da propria arte');
  PERFORM pg_temp.conta('SELECT count(*) FROM public.projetos', 0,
    'solicitante continua SEM leitura direta de projetos (lista vem da server function)');

  PERFORM pg_temp.como('eeee1111-1111-1111-1111-111111111111');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_requests a JOIN public.projetos p ON p.id = a.projeto_id
                          WHERE a.id = 'eeeea001-0000-0000-0000-000000000001'$q$, 1,
    'membro le a arte com o nome do projeto');
  PERFORM pg_temp.erro($q$UPDATE public.art_requests SET projeto_id = NULL
                          WHERE id = 'eeeea001-0000-0000-0000-000000000001'$q$,
    '42501', 'membro nao altera projeto_id direto (so o servidor)');

  -- Aceite com o JWT do membro: o trigger da Fase 1 registra quem aceitou.
  UPDATE public.art_requests SET status = 'aceita', responsavel_id = 'eeee1111-1111-1111-1111-111111111111'
   WHERE id = 'eeeea001-0000-0000-0000-000000000001';
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_requests
                          WHERE id = 'eeeea001-0000-0000-0000-000000000001' AND status = 'aceita'
                            AND status_alterado_por = 'eeee1111-1111-1111-1111-111111111111'$q$, 1,
    'aceite pelo membro registra status_alterado_por');

  -- E o membro continua sem UPDATE em demandas_externas (por isso o aceite usa service role ali).
  PERFORM pg_temp.conta($q$WITH u AS (UPDATE public.demandas_externas SET status = 'aceita'
                                      WHERE id = 'eeee0de1-0000-0000-0000-000000000001' RETURNING 1)
                          SELECT count(*) FROM u$q$, 0,
    'membro segue sem UPDATE direto em demandas_externas');
END
$$;

RESET ROLE;

DO $$
BEGIN
  DELETE FROM public.projetos WHERE id = 'eeee0f01-0000-0000-0000-000000000001';
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_requests
                          WHERE id = 'eeeea001-0000-0000-0000-000000000001' AND projeto_id IS NULL$q$, 1,
    'excluir o projeto nao apaga a arte: projeto_id vira NULL');
END
$$;

SELECT 'ENSAIO OK' AS resultado,
       coalesce(nullif(current_setting('ensaio.assercoes', true), ''), '(contador indisponivel)') AS assercoes_passaram,
       'Nenhuma assercao falhou. ROLLBACK a seguir, nada foi gravado.' AS observacao;

ROLLBACK;
