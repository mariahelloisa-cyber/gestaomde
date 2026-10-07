-- ENSAIO de 20261007140000_tarefa_responsaveis_herda_tarefa.sql.
--
--   BEGIN -> fixtures -> ANTES (prova o furo) -> corpo da migration
--         -> DEPOIS (furo fechado, fluxos do app intactos) -> ROLLBACK
--
-- Não grava nada. Sem comando de psql: roda no SQL Editor e em
-- `npx supabase db query --linked -f`. O corpo da migration é IDÊNTICO ao
-- arquivo, menos o BEGIN/COMMIT.
--
-- ===========================================================================
-- !! LOCK: CREATE POLICY e DISABLE TRIGGER pegam lock em tarefas e
-- !! tarefa_responsaveis. Enquanto o ensaio estiver aberto, quem abrir ou
-- !! editar tarefa no app espera. É rápido. Não deixe a aba aberta.
-- ===========================================================================
--
-- SUCESSO -> uma linha com resultado = 'ENSAIO OK'.
-- FALHA   -> erro vermelho "FALHOU: ..." e nenhuma linha.
--
-- Usuários simulados:
--   M    eeee1111-...  Membro,     ativo
--   M2   eeee2222-...  Membro,     ativo
--   A    eeee3333-...  Admin,      ativo
--   S    eeee4444-...  Supervisor, ativo
--   I    eeee5555-...  Membro,     inativo
--
-- Tarefas:
--   T1 eeeeaa01  geral, criada por M, sem responsável     -> M vê
--   T2 eeeeaa02  geral, responsável A                     -> "de Admin": M não vê
--   T3 eeeeaa03  lembrete PESSOAL de M2, responsável M2   -> só M2 vê
--   T4 eeeeaa04  geral, criada por M, responsável M2      -> M vê (fluxo updateTarefa)

BEGIN;

-- ###########################################################################
-- ##  FIXTURES
-- ###########################################################################

DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['convites', 'perfis_usuarios', 'tarefas', 'tarefa_responsaveis']
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;
END
$do$;

INSERT INTO public.convites (email, cargo, status) VALUES
  ('m.rs@rlstest.local',  'Membro',     'pendente'),
  ('m2.rs@rlstest.local', 'Membro',     'pendente'),
  ('a.rs@rlstest.local',  'Admin',      'pendente'),
  ('s.rs@rlstest.local',  'Supervisor', 'pendente'),
  ('i.rs@rlstest.local',  'Membro',     'pendente');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('eeee1111-1111-1111-1111-111111111111', 'm.rs@rlstest.local',  '{"nome":"Membro M"}'::jsonb),
  ('eeee2222-2222-2222-2222-222222222222', 'm2.rs@rlstest.local', '{"nome":"Membro M2"}'::jsonb),
  ('eeee3333-3333-3333-3333-333333333333', 'a.rs@rlstest.local',  '{"nome":"Admin A"}'::jsonb),
  ('eeee4444-4444-4444-4444-444444444444', 's.rs@rlstest.local',  '{"nome":"Supervisor S"}'::jsonb),
  ('eeee5555-5555-5555-5555-555555555555', 'i.rs@rlstest.local',  '{"nome":"Inativo I"}'::jsonb);

UPDATE public.perfis_usuarios SET status = 'inativo'
 WHERE id = 'eeee5555-5555-5555-5555-555555555555';

INSERT INTO public.tarefas (id, titulo, tipo, escopo, criado_por) VALUES
  ('eeeeaa01-0000-0000-0000-000000000001', 'T1 geral do M',         'tarefa',   'geral',   'eeee1111-1111-1111-1111-111111111111'),
  ('eeeeaa02-0000-0000-0000-000000000002', 'T2 de Admin',           'tarefa',   'geral',   'eeee3333-3333-3333-3333-333333333333'),
  ('eeeeaa03-0000-0000-0000-000000000003', 'T3 lembrete pessoal M2','lembrete', 'pessoal', 'eeee2222-2222-2222-2222-222222222222'),
  ('eeeeaa04-0000-0000-0000-000000000004', 'T4 geral do M',         'tarefa',   'geral',   'eeee1111-1111-1111-1111-111111111111');

INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id) VALUES
  ('eeeeaa02-0000-0000-0000-000000000002', 'eeee3333-3333-3333-3333-333333333333'),
  ('eeeeaa03-0000-0000-0000-000000000003', 'eeee2222-2222-2222-2222-222222222222'),
  ('eeeeaa04-0000-0000-0000-000000000004', 'eeee2222-2222-2222-2222-222222222222');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.perfis_usuarios WHERE email LIKE '%.rs@rlstest.local';
  IF n <> 5 THEN
    RAISE EXCEPTION 'FIXTURES: esperava 5 perfis, o trigger criou %', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.perfis_usuarios
                  WHERE id = 'eeee3333-3333-3333-3333-333333333333' AND cargo::text = 'Admin') THEN
    RAISE EXCEPTION 'FIXTURES: A nao nasceu Admin';
  END IF;
  IF NOT public.tarefa_de_admin('eeeeaa02-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'FIXTURES: T2 deveria ser tarefa de Admin';
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

-- Executa e confere quantas linhas o comando afetou.
CREATE OR REPLACE FUNCTION pg_temp.afeta(_sql text, _esperado bigint, _msg text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; v_estado text; v_texto text;
BEGIN
  BEGIN
    EXECUTE _sql;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE, v_texto = MESSAGE_TEXT;
    PERFORM pg_temp.falha(format('%s (falhou com %s: %s)', _msg, v_estado, v_texto));
  END;
  IF n <> _esperado THEN
    PERFORM pg_temp.falha(format('%s (afetou %s linha(s), esperava %s)', _msg, n, _esperado));
  END IF;
  PERFORM pg_temp.ok(_msg);
END
$$;

-- Erro com SQLSTATE exato e trecho da mensagem. "row-level security" garante
-- que quem barrou foi a policy, e não a FK nem o UNIQUE.
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
-- ##  ANTES: o furo existe
-- ###########################################################################

SET LOCAL ROLE authenticated;

DO $$
BEGIN
  PERFORM pg_temp.como('eeee1111-1111-1111-1111-111111111111');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefas WHERE id = 'eeeeaa02-0000-0000-0000-000000000002'$q$,
    0, 'ANTES: M nao ve T2 (de Admin)');

  PERFORM pg_temp.afeta(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id)
       VALUES ('eeeeaa02-0000-0000-0000-000000000002', 'eeee1111-1111-1111-1111-111111111111')$q$,
    1, 'ANTES (o furo): M insere responsavel em T2, que ele nao ve');

  PERFORM pg_temp.afeta(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id)
       VALUES ('eeeeaa03-0000-0000-0000-000000000003', 'eeee1111-1111-1111-1111-111111111111')$q$,
    1, 'ANTES (o furo): M insere responsavel no lembrete pessoal de M2');
END
$$;

RESET ROLE;

-- Desfaz o que o furo deixou entrar, para o DEPOIS partir das fixtures.
DELETE FROM public.tarefa_responsaveis
 WHERE usuario_id = 'eeee1111-1111-1111-1111-111111111111'
   AND tarefa_id IN ('eeeeaa02-0000-0000-0000-000000000002', 'eeeeaa03-0000-0000-0000-000000000003');

-- ###########################################################################
-- ##  CORPO DE 20261007140000_tarefa_responsaveis_herda_tarefa.sql
-- ###########################################################################


DO $do$
BEGIN
  IF to_regclass('public.tarefa_responsaveis') IS NULL OR to_regclass('public.tarefas') IS NULL THEN
    RAISE EXCEPTION 'tarefas/tarefa_responsaveis nao existem.';
  END IF;
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL THEN
    RAISE EXCEPTION 'eh_equipe_interna ausente: aplique as partes 1–5 antes.';
  END IF;
END
$do$;

-- "Exige equipe interna" já existe em produção (parte 2). Criada aqui só se
-- tiver sumido, para a migration não depender disso.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'tarefa_responsaveis'
       AND policyname = 'Exige equipe interna'
  ) THEN
    CREATE POLICY "Exige equipe interna" ON public.tarefa_responsaveis
      AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.eh_equipe_interna((SELECT auth.uid())))
      WITH CHECK (public.eh_equipe_interna((SELECT auth.uid())));
    RAISE NOTICE 'Exige equipe interna criada (nao existia).';
  END IF;
END
$do$;

DROP POLICY IF EXISTS "Inserir responsavel exige ver a tarefa" ON public.tarefa_responsaveis;
DROP POLICY IF EXISTS "Alterar responsavel exige ver a tarefa" ON public.tarefa_responsaveis;
DROP POLICY IF EXISTS "Remover responsavel exige ver a tarefa" ON public.tarefa_responsaveis;

CREATE POLICY "Inserir responsavel exige ver a tarefa" ON public.tarefa_responsaveis
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_responsaveis.tarefa_id));

CREATE POLICY "Alterar responsavel exige ver a tarefa" ON public.tarefa_responsaveis
  AS RESTRICTIVE FOR UPDATE TO public
  USING (EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_responsaveis.tarefa_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_responsaveis.tarefa_id));

CREATE POLICY "Remover responsavel exige ver a tarefa" ON public.tarefa_responsaveis
  AS RESTRICTIVE FOR DELETE TO public
  USING (EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_responsaveis.tarefa_id));

DO $do$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'tarefa_responsaveis'
     AND permissive = 'RESTRICTIVE'
     AND policyname IN ('Inserir responsavel exige ver a tarefa',
                        'Alterar responsavel exige ver a tarefa',
                        'Remover responsavel exige ver a tarefa');
  IF n <> 3 THEN
    RAISE EXCEPTION 'esperava 3 policies novas RESTRICTIVE, ha %', n;
  END IF;
END
$do$;


-- ###########################################################################
-- ##  DEPOIS: declarativo (como postgres)
-- ###########################################################################

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'tarefa_responsaveis'
     AND permissive = 'RESTRICTIVE'
     AND ((policyname = 'Inserir responsavel exige ver a tarefa' AND cmd = 'INSERT')
       OR (policyname = 'Alterar responsavel exige ver a tarefa' AND cmd = 'UPDATE')
       OR (policyname = 'Remover responsavel exige ver a tarefa' AND cmd = 'DELETE'));
  IF n <> 3 THEN PERFORM pg_temp.falha(format('esperava as 3 RESTRICTIVE novas, ha %s', n)); END IF;
  PERFORM pg_temp.ok('3 RESTRICTIVE novas, uma por comando de escrita');

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'tarefa_responsaveis'
                    AND policyname = 'Exige equipe interna' AND permissive = 'RESTRICTIVE'
                    AND cmd = 'ALL') THEN
    PERFORM pg_temp.falha('Exige equipe interna ausente em tarefa_responsaveis');
  END IF;
  PERFORM pg_temp.ok('Exige equipe interna presente');

  -- O SELECT não mudou: nenhuma policy nova de SELECT/ALL.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'tarefa_responsaveis'
     AND policyname LIKE '%exige ver a tarefa' AND cmd IN ('SELECT', 'ALL');
  IF n <> 0 THEN PERFORM pg_temp.falha('a migration criou policy de SELECT/ALL'); END IF;
  PERFORM pg_temp.ok('leitura de tarefa_responsaveis intocada');
END
$$;

SET LOCAL ROLE authenticated;

-- ###########################################################################
-- ##  DEPOIS: o furo fechou
-- ###########################################################################

DO $$
BEGIN
  PERFORM pg_temp.como('eeee1111-1111-1111-1111-111111111111');

  PERFORM pg_temp.erro(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id)
       VALUES ('eeeeaa02-0000-0000-0000-000000000002', 'eeee1111-1111-1111-1111-111111111111')$q$,
    '42501', 'row-level security', 'M NAO insere responsavel em T2 (de Admin)');

  PERFORM pg_temp.erro(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id)
       VALUES ('eeeeaa03-0000-0000-0000-000000000003', 'eeee1111-1111-1111-1111-111111111111')$q$,
    '42501', 'row-level security', 'M NAO insere responsavel no lembrete pessoal de M2');

  -- O RLS decide antes da FK: tarefa inexistente também é "não vejo".
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id)
       VALUES ('eeeeaa99-0000-0000-0000-000000000099', 'eeee1111-1111-1111-1111-111111111111')$q$,
    '42501', 'row-level security', 'M NAO insere em tarefa inexistente (RLS antes da FK)');

  PERFORM pg_temp.afeta(
    $q$DELETE FROM public.tarefa_responsaveis
        WHERE tarefa_id = 'eeeeaa02-0000-0000-0000-000000000002'$q$,
    0, 'M NAO remove responsavel de T2');

  PERFORM pg_temp.afeta(
    $q$DELETE FROM public.tarefa_responsaveis
        WHERE tarefa_id = 'eeeeaa03-0000-0000-0000-000000000003'$q$,
    0, 'M NAO remove responsavel do lembrete pessoal de M2');

  PERFORM pg_temp.afeta(
    $q$UPDATE public.tarefa_responsaveis SET usuario_id = 'eeee1111-1111-1111-1111-111111111111'
        WHERE tarefa_id = 'eeeeaa02-0000-0000-0000-000000000002'$q$,
    0, 'M NAO altera responsavel de T2');
END
$$;

-- ###########################################################################
-- ##  DEPOIS: o que tem que continuar funcionando
-- ###########################################################################

DO $$
BEGIN
  PERFORM pg_temp.como('eeee1111-1111-1111-1111-111111111111');

  -- Tarefa visível: insere normalmente.
  PERFORM pg_temp.afeta(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id)
       VALUES ('eeeeaa01-0000-0000-0000-000000000001', 'eeee1111-1111-1111-1111-111111111111')$q$,
    1, 'M insere responsavel em T1, que ele ve');

  -- UPDATE com USING ok e WITH CHECK recusando: mover a linha para uma tarefa
  -- invisível dá ERRO (não filtro silencioso), porque a linha passou no USING.
  PERFORM pg_temp.erro(
    $q$UPDATE public.tarefa_responsaveis SET tarefa_id = 'eeeeaa02-0000-0000-0000-000000000002'
        WHERE tarefa_id = 'eeeeaa01-0000-0000-0000-000000000001'$q$,
    '42501', 'row-level security', 'M NAO move responsavel de T1 para T2');

  -- createTarefa do app, Membro designando um Admin: tarefa nova e todos os
  -- responsáveis num INSERT só.
  PERFORM pg_temp.afeta(
    $q$INSERT INTO public.tarefas (id, titulo, tipo, escopo, criado_por)
       VALUES ('eeeeaa06-0000-0000-0000-000000000006', 'T6 criada pelo app', 'tarefa', 'geral',
               'eeee1111-1111-1111-1111-111111111111')$q$,
    1, 'createTarefa: M cria T6');
  PERFORM pg_temp.afeta(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id) VALUES
         ('eeeeaa06-0000-0000-0000-000000000006', 'eeee3333-3333-3333-3333-333333333333'),
         ('eeeeaa06-0000-0000-0000-000000000006', 'eeee1111-1111-1111-1111-111111111111')$q$,
    2, 'createTarefa: M designa Admin + ele mesmo num INSERT so (as 2 linhas entram)');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefas WHERE id = 'eeeeaa06-0000-0000-0000-000000000006'$q$,
    0, 'createTarefa: T6 virou de Admin e sumiu para M (comportamento ja existente)');
  -- E por isso o MCP insere tudo de uma vez: um segundo INSERT já é barrado.
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id)
       VALUES ('eeeeaa06-0000-0000-0000-000000000006', 'eeee2222-2222-2222-2222-222222222222')$q$,
    '42501', 'row-level security', 'segundo INSERT em T6, ja de Admin, e barrado');

  -- aceitarDemanda / aceitarDemandaArte: tarefa nova + UM responsável.
  PERFORM pg_temp.afeta(
    $q$INSERT INTO public.tarefas (id, titulo, tipo, escopo, criado_por)
       VALUES ('eeeeaa07-0000-0000-0000-000000000007', 'T7 demanda aceita', 'tarefa', 'geral',
               'eeee1111-1111-1111-1111-111111111111')$q$,
    1, 'aceitarDemanda: M cria T7');
  PERFORM pg_temp.afeta(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id)
       VALUES ('eeeeaa07-0000-0000-0000-000000000007', 'eeee2222-2222-2222-2222-222222222222')$q$,
    1, 'aceitarDemanda: M designa M2');

  -- updateTarefa: remove quem sai, depois insere quem entra (um INSERT só),
  -- inclusive um Admin.
  PERFORM pg_temp.afeta(
    $q$DELETE FROM public.tarefa_responsaveis
        WHERE tarefa_id = 'eeeeaa04-0000-0000-0000-000000000004'
          AND usuario_id IN ('eeee2222-2222-2222-2222-222222222222')$q$,
    1, 'updateTarefa: M remove M2 de T4');
  PERFORM pg_temp.afeta(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id) VALUES
         ('eeeeaa04-0000-0000-0000-000000000004', 'eeee3333-3333-3333-3333-333333333333'),
         ('eeeeaa04-0000-0000-0000-000000000004', 'eeee1111-1111-1111-1111-111111111111')$q$,
    2, 'updateTarefa: M adiciona Admin + ele mesmo em T4');

  -- deleteTarefa: responsáveis primeiro, depois a tarefa.
  PERFORM pg_temp.afeta(
    $q$DELETE FROM public.tarefa_responsaveis WHERE tarefa_id = 'eeeeaa01-0000-0000-0000-000000000001'$q$,
    1, 'deleteTarefa: M remove os responsaveis de T1');
  PERFORM pg_temp.afeta(
    $q$DELETE FROM public.tarefas WHERE id = 'eeeeaa01-0000-0000-0000-000000000001'$q$,
    1, 'deleteTarefa: M apaga T1');
END
$$;

-- --- Admin, Supervisor, autor do lembrete e inativo -------------------------
DO $$
BEGIN
  PERFORM pg_temp.como('eeee3333-3333-3333-3333-333333333333');
  PERFORM pg_temp.afeta(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id)
       VALUES ('eeeeaa02-0000-0000-0000-000000000002', 'eeee2222-2222-2222-2222-222222222222')$q$,
    1, 'Admin insere responsavel em T2');
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id)
       VALUES ('eeeeaa03-0000-0000-0000-000000000003', 'eeee3333-3333-3333-3333-333333333333')$q$,
    '42501', 'row-level security', 'Admin NAO insere no lembrete pessoal de M2');

  PERFORM pg_temp.como('eeee4444-4444-4444-4444-444444444444');
  PERFORM pg_temp.afeta(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id)
       VALUES ('eeeeaa02-0000-0000-0000-000000000002', 'eeee4444-4444-4444-4444-444444444444')$q$,
    1, 'Supervisor insere responsavel em T2 (is_admin inclui Supervisor)');
  PERFORM pg_temp.afeta(
    $q$DELETE FROM public.tarefa_responsaveis
        WHERE tarefa_id = 'eeeeaa02-0000-0000-0000-000000000002'
          AND usuario_id = 'eeee4444-4444-4444-4444-444444444444'$q$,
    1, 'Supervisor remove responsavel de T2');

  PERFORM pg_temp.como('eeee2222-2222-2222-2222-222222222222');
  PERFORM pg_temp.afeta(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id)
       VALUES ('eeeeaa03-0000-0000-0000-000000000003', 'eeee1111-1111-1111-1111-111111111111')$q$,
    1, 'M2 insere responsavel no proprio lembrete pessoal');

  PERFORM pg_temp.como('eeee5555-5555-5555-5555-555555555555');
  PERFORM pg_temp.erro(
    $q$INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id)
       VALUES ('eeeeaa04-0000-0000-0000-000000000004', 'eeee5555-5555-5555-5555-555555555555')$q$,
    '42501', 'row-level security', 'INATIVO NAO insere responsavel');
END
$$;

RESET ROLE;

-- --- Conferência final, como postgres ---------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefa_responsaveis
        WHERE tarefa_id = 'eeeeaa06-0000-0000-0000-000000000006'$q$,
    2, 'T6 ficou com exatamente Admin + M');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefa_responsaveis
        WHERE tarefa_id = 'eeeeaa04-0000-0000-0000-000000000004'$q$,
    2, 'T4 ficou com Admin + M');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefa_responsaveis
        WHERE tarefa_id = 'eeeeaa02-0000-0000-0000-000000000002'
          AND usuario_id = 'eeee1111-1111-1111-1111-111111111111'$q$,
    0, 'M nao entrou em T2');
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
