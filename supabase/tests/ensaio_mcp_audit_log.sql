-- ENSAIO de 20261007130000_mcp_audit_log.sql.
--
--   BEGIN -> corpo da migration -> fixtures -> testes -> ROLLBACK
--
-- Não grava nada. Sem comando de psql: roda no SQL Editor e em
-- `npx supabase db query --linked -f`. O corpo da migration é IDÊNTICO ao
-- arquivo, menos o BEGIN/COMMIT.
--
-- A tabela é nova, então o lock só alcança ela mesma e as tabelas das
-- fixtures (DISABLE TRIGGER). É rápido. Não deixe a aba aberta.
--
-- SUCESSO -> uma linha com resultado = 'ENSAIO OK'.
-- FALHA   -> erro vermelho "FALHOU: ..." e nenhuma linha.
--
-- Os cinco usuários simulados:
--   MEMBRO   dddd1111-...  Membro,     ativo
--   ADMIN    dddd2222-...  Admin,      ativo
--   SUPERV   dddd3333-...  Supervisor, ativo
--   INATIVO  dddd4444-...  Membro,     inativo
--   CLIENTE  dddd5555-...  Cliente,    ativo

BEGIN;

-- ###########################################################################
-- ##  CORPO DE 20261007130000_mcp_audit_log.sql
-- ###########################################################################

DO $do$
BEGIN
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL
     OR to_regprocedure('public.is_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'eh_equipe_interna/is_admin ausentes: aplique as partes 1–5 antes';
  END IF;
END
$do$;

CREATE TABLE public.mcp_audit_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  criado_em    timestamptz NOT NULL DEFAULT now(),
  user_id      uuid        NOT NULL DEFAULT auth.uid(),
  ferramenta   text        NOT NULL CHECK (ferramenta ~ '^[a-z_]{1,64}$'),
  -- Sem FK de propósito: o registro tem que sobreviver à exclusão da tarefa.
  tarefa_id    uuid,
  ids_afetados uuid[]      NOT NULL DEFAULT '{}' CHECK (cardinality(ids_afetados) <= 50),
  -- Resumo: títulos cortados em 120, textos longos só como tamanho.
  argumentos   jsonb       NOT NULL DEFAULT '{}'
               CHECK (jsonb_typeof(argumentos) = 'object' AND pg_column_size(argumentos) <= 2048),
  resultado    text        NOT NULL
               CHECK (resultado IN ('ok','duplicata','sem_mudanca','parcial','negado','erro')),
  detalhe      text        CHECK (detalhe IS NULL OR length(detalhe) <= 200)
);

CREATE INDEX mcp_audit_log_user_criado_idx ON public.mcp_audit_log (user_id, criado_em DESC);
CREATE INDEX mcp_audit_log_tarefa_idx      ON public.mcp_audit_log (tarefa_id) WHERE tarefa_id IS NOT NULL;
CREATE INDEX mcp_audit_log_criado_idx      ON public.mcp_audit_log (criado_em DESC);

-- Privilégios. O Supabase concede ALL a anon/authenticated em tabela nova do
-- public; tira tudo e devolve só o necessário. INSERT por COLUNA: o cliente
-- não consegue escolher id, criado_em nem user_id (vêm dos defaults).
REVOKE ALL ON public.mcp_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mcp_audit_log TO authenticated;
GRANT INSERT (ferramenta, tarefa_id, ids_afetados, argumentos, resultado, detalhe)
  ON public.mcp_audit_log TO authenticated;

ALTER TABLE public.mcp_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Registra a propria acao" ON public.mcp_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.eh_equipe_interna((SELECT auth.uid())));

CREATE POLICY "Admins leem a auditoria" ON public.mcp_audit_log
  FOR SELECT TO authenticated
  USING (public.is_admin((SELECT auth.uid())));

-- Sem policy de UPDATE/DELETE, e sem GRANT. Além disso, um trigger barra
-- UPDATE/DELETE/TRUNCATE para QUALQUER papel, inclusive service_role.
CREATE FUNCTION public.mcp_audit_log_imutavel() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'mcp_audit_log é append-only (% recusado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_audit_log_imutavel() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_mcp_audit_log_imutavel
  BEFORE UPDATE OR DELETE ON public.mcp_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.mcp_audit_log_imutavel();
CREATE TRIGGER trg_mcp_audit_log_sem_truncate
  BEFORE TRUNCATE ON public.mcp_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.mcp_audit_log_imutavel();

COMMENT ON TABLE public.mcp_audit_log IS
  'Ações de escrita feitas pelo conector MCP. Append-only; leitura só is_admin().';

-- ###########################################################################
-- ##  FIXTURES (convite + auth.users, deixando o trigger montar os perfis)
-- ###########################################################################

DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['convites', 'perfis_usuarios']
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;
END
$do$;

-- O Cliente nasce Membro e vira Cliente depois: não dependo de o trigger de
-- auth.users ainda aceitar convite com cargo Cliente.
INSERT INTO public.convites (email, cargo, status) VALUES
  ('membro.au@rlstest.local',  'Membro',     'pendente'),
  ('admin.au@rlstest.local',   'Admin',      'pendente'),
  ('superv.au@rlstest.local',  'Supervisor', 'pendente'),
  ('inativo.au@rlstest.local', 'Membro',     'pendente'),
  ('cliente.au@rlstest.local', 'Membro',     'pendente');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('dddd1111-1111-1111-1111-111111111111', 'membro.au@rlstest.local',  '{"nome":"Membro Auditoria"}'::jsonb),
  ('dddd2222-2222-2222-2222-222222222222', 'admin.au@rlstest.local',   '{"nome":"Admin Auditoria"}'::jsonb),
  ('dddd3333-3333-3333-3333-333333333333', 'superv.au@rlstest.local',  '{"nome":"Supervisor Auditoria"}'::jsonb),
  ('dddd4444-4444-4444-4444-444444444444', 'inativo.au@rlstest.local', '{"nome":"Inativo Auditoria"}'::jsonb),
  ('dddd5555-5555-5555-5555-555555555555', 'cliente.au@rlstest.local', '{"nome":"Cliente Auditoria"}'::jsonb);

UPDATE public.perfis_usuarios SET status = 'inativo'
 WHERE id = 'dddd4444-4444-4444-4444-444444444444';
UPDATE public.perfis_usuarios SET cargo = 'Cliente'
 WHERE id = 'dddd5555-5555-5555-5555-555555555555';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.perfis_usuarios WHERE email LIKE '%.au@rlstest.local';
  IF n <> 5 THEN
    RAISE EXCEPTION 'FIXTURES: esperava 5 perfis, o trigger criou %', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.perfis_usuarios
                  WHERE id = 'dddd2222-2222-2222-2222-222222222222' AND cargo::text = 'Admin') THEN
    RAISE EXCEPTION 'FIXTURES: o Admin nao nasceu Admin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.perfis_usuarios
                  WHERE id = 'dddd3333-3333-3333-3333-333333333333' AND cargo::text = 'Supervisor') THEN
    RAISE EXCEPTION 'FIXTURES: o Supervisor nao nasceu Supervisor';
  END IF;
  RAISE NOTICE 'OK: fixtures montadas';
END
$$;

-- ###########################################################################
-- ##  HELPERS
-- ###########################################################################

CREATE OR REPLACE FUNCTION pg_temp.como(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text,
    true);
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.ok(_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config(
    'ensaio.assercoes',
    (coalesce(nullif(current_setting('ensaio.assercoes', true), ''), '0')::int + 1)::text,
    true);
  RAISE NOTICE 'OK: %', _msg;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.falha(_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FALHOU: %', _msg;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.conta(_sql text, _esperado bigint, _msg text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE _sql INTO n;
  IF n IS DISTINCT FROM _esperado THEN
    PERFORM pg_temp.falha(format('%s (esperava %s, veio %s)', _msg, _esperado, n));
  END IF;
  PERFORM pg_temp.ok(_msg);
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.passa(_sql text, _msg text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_estado text; v_texto text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE, v_texto = MESSAGE_TEXT;
    PERFORM pg_temp.falha(format('%s (falhou com %s: %s)', _msg, v_estado, v_texto));
  END;
  PERFORM pg_temp.ok(_msg);
END
$$;

-- Erro com SQLSTATE exato e, opcionalmente, um trecho da mensagem. O trecho
-- separa os dois 42501 desta tabela: "permission denied" (falta de GRANT) e
-- "row-level security" (policy), que exigem asserções diferentes.
CREATE OR REPLACE FUNCTION pg_temp.erro(_sql text, _estado text, _trecho text, _msg text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_estado text; v_texto text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE, v_texto = MESSAGE_TEXT;
    IF v_estado = _estado AND (_trecho IS NULL OR v_texto ILIKE '%' || _trecho || '%') THEN
      PERFORM pg_temp.ok(_msg);
      RETURN;
    END IF;
    PERFORM pg_temp.falha(format('%s (esperava %s/%s, veio %s: %s)',
                                 _msg, _estado, coalesce(_trecho, '*'), v_estado, v_texto));
  END;
  PERFORM pg_temp.falha(format('%s (o comando passou)', _msg));
END
$$;

-- ###########################################################################
-- ##  TESTES DECLARATIVOS (como postgres)
-- ###########################################################################

DO $$
DECLARE n int;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mcp_audit_log'::regclass) THEN
    PERFORM pg_temp.falha('RLS desligado em mcp_audit_log');
  END IF;
  PERFORM pg_temp.ok('RLS ligado');

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'mcp_audit_log';
  IF n <> 2 THEN PERFORM pg_temp.falha(format('esperava 2 policies, ha %s', n)); END IF;
  PERFORM pg_temp.ok('exatamente 2 policies');

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mcp_audit_log'
                  AND policyname = 'Registra a propria acao' AND cmd = 'INSERT'
                  AND permissive = 'PERMISSIVE') THEN
    PERFORM pg_temp.falha('policy de INSERT ausente ou com outro cmd');
  END IF;
  PERFORM pg_temp.ok('policy de INSERT presente');

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mcp_audit_log'
                  AND policyname = 'Admins leem a auditoria' AND cmd = 'SELECT') THEN
    PERFORM pg_temp.falha('policy de SELECT ausente ou com outro cmd');
  END IF;
  PERFORM pg_temp.ok('policy de SELECT presente');

  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mcp_audit_log'
              AND cmd IN ('UPDATE', 'DELETE', 'ALL')) THEN
    PERFORM pg_temp.falha('existe policy de UPDATE/DELETE/ALL');
  END IF;
  PERFORM pg_temp.ok('nenhuma policy de UPDATE/DELETE/ALL');

  -- Privilégios: SELECT na tabela, INSERT só nas colunas de conteúdo.
  IF has_table_privilege('authenticated', 'public.mcp_audit_log', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.mcp_audit_log', 'DELETE')
     OR has_table_privilege('authenticated', 'public.mcp_audit_log', 'TRUNCATE') THEN
    PERFORM pg_temp.falha('authenticated tem UPDATE/DELETE/TRUNCATE');
  END IF;
  PERFORM pg_temp.ok('authenticated sem UPDATE/DELETE/TRUNCATE');

  IF has_table_privilege('authenticated', 'public.mcp_audit_log', 'INSERT') THEN
    PERFORM pg_temp.falha('authenticated tem INSERT na tabela inteira, devia ser por coluna');
  END IF;
  PERFORM pg_temp.ok('INSERT de authenticated nao e na tabela inteira');

  IF has_column_privilege('authenticated', 'public.mcp_audit_log', 'user_id', 'INSERT')
     OR has_column_privilege('authenticated', 'public.mcp_audit_log', 'criado_em', 'INSERT')
     OR has_column_privilege('authenticated', 'public.mcp_audit_log', 'id', 'INSERT') THEN
    PERFORM pg_temp.falha('authenticated pode escolher id/criado_em/user_id');
  END IF;
  PERFORM pg_temp.ok('id, criado_em e user_id fora do INSERT de authenticated');

  IF NOT has_column_privilege('authenticated', 'public.mcp_audit_log', 'ferramenta', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.mcp_audit_log', 'argumentos', 'INSERT') THEN
    PERFORM pg_temp.falha('authenticated perdeu INSERT nas colunas de conteudo');
  END IF;
  PERFORM pg_temp.ok('INSERT nas colunas de conteudo');

  IF has_any_column_privilege('anon', 'public.mcp_audit_log', 'SELECT')
     OR has_any_column_privilege('anon', 'public.mcp_audit_log', 'INSERT') THEN
    PERFORM pg_temp.falha('anon tem algum privilegio');
  END IF;
  PERFORM pg_temp.ok('anon sem nenhum privilegio');

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'public.mcp_audit_log'::regclass AND NOT tgisinternal AND tgenabled = 'O';
  IF n <> 2 THEN PERFORM pg_temp.falha(format('esperava 2 triggers ativos, ha %s', n)); END IF;
  PERFORM pg_temp.ok('2 triggers de imutabilidade ativos');
END
$$;

-- ###########################################################################
-- ##  TESTES COMO authenticated
-- ###########################################################################

SET LOCAL ROLE authenticated;

-- --- 1) Membro registra a propria acao, sem escolher quem nem quando -------
DO $$
BEGIN
  PERFORM pg_temp.como('dddd1111-1111-1111-1111-111111111111');

  PERFORM pg_temp.passa(
    $q$INSERT INTO public.mcp_audit_log (ferramenta, tarefa_id, ids_afetados, argumentos, resultado)
       VALUES ('ensaio_criar', 'dddd0000-0000-0000-0000-00000000aaaa',
               ARRAY['dddd0000-0000-0000-0000-00000000aaaa']::uuid[],
               '{"titulo":"x","descricao_len":10}', 'ok')$q$,
    'Membro insere a propria linha');

  PERFORM pg_temp.passa(
    $q$INSERT INTO public.mcp_audit_log (ferramenta, resultado, detalhe)
       VALUES ('ensaio_comentar', 'duplicata', 'devolveu o existente')$q$,
    'Membro insere com os defaults de ids_afetados e argumentos');

  PERFORM pg_temp.erro(
    $q$INSERT INTO public.mcp_audit_log (user_id, ferramenta, resultado)
       VALUES ('dddd2222-2222-2222-2222-222222222222', 'ensaio_forjado', 'ok')$q$,
    '42501', 'permission denied', 'Membro NAO escolhe user_id (nem o de outro)');

  PERFORM pg_temp.erro(
    $q$INSERT INTO public.mcp_audit_log (user_id, ferramenta, resultado)
       VALUES ('dddd1111-1111-1111-1111-111111111111', 'ensaio_forjado', 'ok')$q$,
    '42501', 'permission denied', 'Membro NAO escolhe user_id nem o proprio');

  PERFORM pg_temp.erro(
    $q$INSERT INTO public.mcp_audit_log (criado_em, ferramenta, resultado)
       VALUES ('2020-01-01', 'ensaio_forjado', 'ok')$q$,
    '42501', 'permission denied', 'Membro NAO escolhe criado_em');

  PERFORM pg_temp.erro(
    $q$INSERT INTO public.mcp_audit_log (id, ferramenta, resultado)
       VALUES (gen_random_uuid(), 'ensaio_forjado', 'ok')$q$,
    '42501', 'permission denied', 'Membro NAO escolhe id');

  -- Não lê nada, nem a própria linha.
  PERFORM pg_temp.conta('SELECT count(*) FROM public.mcp_audit_log', 0,
    'Membro nao le a auditoria, nem a propria linha');

  -- Sem GRANT: o erro vem antes do RLS e do trigger.
  PERFORM pg_temp.erro(
    $q$UPDATE public.mcp_audit_log SET resultado = 'erro'$q$,
    '42501', 'permission denied', 'Membro NAO altera');
  PERFORM pg_temp.erro(
    $q$DELETE FROM public.mcp_audit_log$q$,
    '42501', 'permission denied', 'Membro NAO apaga');
  PERFORM pg_temp.erro(
    $q$TRUNCATE public.mcp_audit_log$q$,
    '42501', 'permission denied', 'Membro NAO trunca');
END
$$;

-- --- 2) CHECKs: o que o Worker nunca deveria mandar, o banco recusa ---------
DO $$
BEGIN
  PERFORM pg_temp.como('dddd1111-1111-1111-1111-111111111111');

  PERFORM pg_temp.erro(
    $q$INSERT INTO public.mcp_audit_log (ferramenta, resultado) VALUES ('ensaio_x', 'talvez')$q$,
    '23514', NULL, 'resultado fora da lista e recusado');
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.mcp_audit_log (ferramenta, resultado) VALUES ('DROP TABLE x', 'ok')$q$,
    '23514', NULL, 'ferramenta com formato invalido e recusada');
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.mcp_audit_log (ferramenta, resultado, argumentos)
       VALUES ('ensaio_x', 'ok', jsonb_build_object('texto', repeat(md5(random()::text), 200)))$q$,
    '23514', NULL, 'argumentos acima de 2 KB e recusado');
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.mcp_audit_log (ferramenta, resultado, argumentos)
       VALUES ('ensaio_x', 'ok', '[1,2]')$q$,
    '23514', NULL, 'argumentos que nao e objeto e recusado');
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.mcp_audit_log (ferramenta, resultado, detalhe)
       VALUES ('ensaio_x', 'ok', repeat('a', 201))$q$,
    '23514', NULL, 'detalhe acima de 200 e recusado');
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.mcp_audit_log (ferramenta, resultado, ids_afetados)
       VALUES ('ensaio_x', 'ok', (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 51)))$q$,
    '23514', NULL, 'mais de 50 ids afetados e recusado');
END
$$;

-- --- 3) Inativo e Cliente nao registram (policy, nao GRANT) -----------------
DO $$
BEGIN
  PERFORM pg_temp.como('dddd4444-4444-4444-4444-444444444444');
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.mcp_audit_log (ferramenta, resultado) VALUES ('ensaio_inativo', 'ok')$q$,
    '42501', 'row-level security', 'Membro INATIVO nao registra');

  PERFORM pg_temp.como('dddd5555-5555-5555-5555-555555555555');
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.mcp_audit_log (ferramenta, resultado) VALUES ('ensaio_cliente', 'ok')$q$,
    '42501', 'row-level security', 'Cliente nao registra');
  PERFORM pg_temp.conta('SELECT count(*) FROM public.mcp_audit_log', 0, 'Cliente nao le');
END
$$;

-- --- 4) Admin e Supervisor leem tudo, e tambem nao alteram -----------------
DO $$
BEGIN
  PERFORM pg_temp.como('dddd2222-2222-2222-2222-222222222222');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.mcp_audit_log WHERE ferramenta LIKE 'ensaio\_%'$q$,
    2, 'Admin le as linhas do Membro');
  PERFORM pg_temp.passa(
    $q$INSERT INTO public.mcp_audit_log (ferramenta, resultado) VALUES ('ensaio_admin', 'negado')$q$,
    'Admin registra a propria acao');
  PERFORM pg_temp.erro(
    $q$UPDATE public.mcp_audit_log SET resultado = 'ok'$q$,
    '42501', 'permission denied', 'Admin NAO altera');
  PERFORM pg_temp.erro(
    $q$DELETE FROM public.mcp_audit_log$q$,
    '42501', 'permission denied', 'Admin NAO apaga');

  PERFORM pg_temp.como('dddd3333-3333-3333-3333-333333333333');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.mcp_audit_log WHERE ferramenta LIKE 'ensaio\_%'$q$,
    3, 'Supervisor le tudo (is_admin inclui Supervisor)');
END
$$;

RESET ROLE;

-- --- 5) anon: nada -----------------------------------------------------------
SET LOCAL ROLE anon;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM pg_temp.erro(
    $q$SELECT count(*) FROM public.mcp_audit_log$q$,
    '42501', 'permission denied', 'anon nao le');
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.mcp_audit_log (ferramenta, resultado) VALUES ('ensaio_anon', 'ok')$q$,
    '42501', 'permission denied', 'anon nao insere');
END
$$;

RESET ROLE;

-- --- 6) Como postgres: defaults corretos, e o trigger barra ate o dono ----
DO $$
BEGIN
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.mcp_audit_log
        WHERE ferramenta IN ('ensaio_criar', 'ensaio_comentar')
          AND user_id = 'dddd1111-1111-1111-1111-111111111111'
          AND criado_em = now()$q$,
    2, 'user_id = auth.uid() e criado_em = now() vieram dos defaults');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.mcp_audit_log
        WHERE ferramenta = 'ensaio_comentar' AND ids_afetados = '{}' AND argumentos = '{}'$q$,
    1, 'ids_afetados e argumentos tem default vazio');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.mcp_audit_log WHERE ferramenta = 'ensaio_forjado'$q$,
    0, 'nenhuma linha forjada entrou');

  PERFORM pg_temp.erro(
    $q$UPDATE public.mcp_audit_log SET resultado = 'erro'$q$,
    '42501', 'append-only', 'postgres NAO altera (trigger)');
  PERFORM pg_temp.erro(
    $q$DELETE FROM public.mcp_audit_log$q$,
    '42501', 'append-only', 'postgres NAO apaga (trigger)');
  PERFORM pg_temp.erro(
    $q$TRUNCATE public.mcp_audit_log$q$,
    '42501', 'append-only', 'postgres NAO trunca (trigger)');
END
$$;

-- ###########################################################################
-- ##  SINAL DE SUCESSO
-- ###########################################################################

SELECT 'ENSAIO OK' AS resultado,
       coalesce(nullif(current_setting('ensaio.assercoes', true), ''),
                '(contador indisponivel)') AS assercoes_passaram,
       'Nenhuma assercao falhou. ROLLBACK a seguir, nada foi gravado.' AS observacao;

ROLLBACK;
