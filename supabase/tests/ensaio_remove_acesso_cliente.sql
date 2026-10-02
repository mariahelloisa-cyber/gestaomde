-- ENSAIO de 20261002200000_remove_acesso_cliente.sql, para o SQL Editor.
--
--   BEGIN -> corpo da migration -> fixtures -> testes -> ROLLBACK
--
-- Não grava nada. Sem comando de psql, roda igual no SQL Editor e em `psql -f`.
--
-- O corpo da migration aqui é IDÊNTICO ao arquivo em supabase/migrations/,
-- menos o BEGIN/COMMIT. Se mexer em um, mexa no outro.
--
-- ===========================================================================
-- !! LOCK: CREATE/DROP POLICY pega ACCESS EXCLUSIVE em clientes e
-- !! perfis_usuarios, e o lock só sai no ROLLBACK. Com este ensaio aberto,
-- !! QUALQUER tela do app que leia perfil ou cliente fica esperando — e como
-- !! _authenticated.tsx lê perfis_usuarios em todo acesso, isso é o app
-- !! inteiro. É rápido, mas não deixe a aba aberta.
-- ===========================================================================
--
-- COMO LER O RESULTADO: a última query devolve literais e um GUC, sem ler
-- tabela nenhuma.
--   SUCESSO -> uma linha com resultado = 'ENSAIO OK'. Chegar nela é a prova:
--              qualquer asserção que falhasse abortaria a transação antes.
--   FALHA   -> erro vermelho "FALHOU: ..." e nenhuma linha.
--
-- PRÉ-REQUISITO: as partes 1 a 3 (20261002170000/180000/190000) precisam estar
-- aplicadas. A guarda da migration recusa rodar sem elas.
--
-- Os três usuários simulados, criados pelo caminho real (convite +
-- auth.users, deixando o trigger on_auth_user_created montar os perfis):
--   A    aaaa1111-...  Membro
--   ADM  aaaa3333-...  Admin
--   CLI  aaaa5555-...  Cliente, cliente_id = EMPRESA 1

BEGIN;

-- ###########################################################################
-- ##  CORPO DE 20261002200000_remove_acesso_cliente.sql
-- ###########################################################################

-- --- 1) Guarda de ordem ---------------------------------------------------
DO $do$
BEGIN
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Aplique 20261002170000_rls_endurecer_tabelas_abertas.sql primeiro: '
      'public.eh_equipe_interna(uuid) nao existe.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'comentarios_tarefa'
       AND policyname = 'Exige equipe interna'
  ) THEN
    RAISE EXCEPTION
      'Aplique 20261002180000_rls_equipe_interna_resto.sql primeiro: '
      'comentarios_tarefa nao tem a RESTRICTIVE "Exige equipe interna".';
  END IF;
END
$do$;

-- --- 2) clientes ----------------------------------------------------------
DROP POLICY IF EXISTS "Equipe interna ou a propria empresa" ON public.clientes;

DROP POLICY IF EXISTS "Exige equipe interna" ON public.clientes;
CREATE POLICY "Exige equipe interna" ON public.clientes
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.eh_equipe_interna((select auth.uid())))
  WITH CHECK (public.eh_equipe_interna((select auth.uid())));

-- --- 3) perfis_usuarios ---------------------------------------------------
DROP POLICY IF EXISTS "Autenticados podem ver perfis" ON public.perfis_usuarios;
CREATE POLICY "Autenticados podem ver perfis" ON public.perfis_usuarios
  FOR SELECT TO authenticated
  USING (public.eh_equipe_interna((select auth.uid())));

DROP POLICY IF EXISTS "Exige equipe interna" ON public.perfis_usuarios;
CREATE POLICY "Exige equipe interna" ON public.perfis_usuarios
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.eh_equipe_interna((select auth.uid())))
  WITH CHECK (public.eh_equipe_interna((select auth.uid())));

-- --- 4) meu_cliente_id() --------------------------------------------------
DO $do$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE coalesce(qual, '')       LIKE '%meu_cliente_id%'
        OR coalesce(with_check, '') LIKE '%meu_cliente_id%'
  LOOP
    RAISE WARNING 'Ainda referencia meu_cliente_id: %.% -> "%"',
      r.schemaname, r.tablename, r.policyname;
    n := n + 1;
  END LOOP;

  IF n > 0 THEN
    RAISE EXCEPTION
      '% policy(s) ainda usam meu_cliente_id(); nao e seguro apaga-la.', n;
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.meu_cliente_id();

-- --- 5) Verificação do estado final ---------------------------------------
DO $do$
DECLARE
  t text;
  n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['clientes', 'perfis_usuarios']
  LOOP
    SELECT count(*) INTO n
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t
       AND permissive = 'RESTRICTIVE'
       AND policyname = 'Exige equipe interna';
    IF n <> 1 THEN
      RAISE EXCEPTION
        '%: esperava 1 RESTRICTIVE "Exige equipe interna", achei %.', t, n;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE policyname = 'Equipe interna ou a propria empresa') THEN
    RAISE EXCEPTION 'o carve-out "Equipe interna ou a propria empresa" nao saiu.';
  END IF;

  IF to_regprocedure('public.meu_cliente_id()') IS NOT NULL THEN
    RAISE EXCEPTION 'public.meu_cliente_id() nao saiu.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'perfis_usuarios'
       AND policyname = 'Autenticados podem ver perfis'
       AND qual LIKE '%auth.uid()%'
       AND qual LIKE '%OR%'
  ) THEN
    RAISE EXCEPTION
      'a permissiva de perfis_usuarios ainda tem o braco de carve-out.';
  END IF;

  RAISE NOTICE 'Acesso do cargo Cliente encerrado: clientes e perfis_usuarios fechados.';
END
$do$;

-- ###########################################################################
-- ##  FIXTURES
-- ##
-- ##  Pelo caminho real: convite pendente + INSERT em auth.users, deixando o
-- ##  trigger on_auth_user_created montar perfis_usuarios com o cargo e o
-- ##  cliente_id do convite.
-- ###########################################################################

-- public.clientes tem o trigger trg_gerar_setup_cliente, que fabrica uma
-- tarefa por serviço do plano mais uma linha em financeiro_transacoes. Não
-- quero fixture inventada por trigger alheio, então desligo os triggers de
-- usuário das tabelas que as fixtures tocam. É DDL: o ROLLBACK religa.
-- auth.users fica FORA da lista, porque é o on_auth_user_created que monta os
-- perfis, e ele não faz chamada externa.
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clientes', 'convites', 'perfis_usuarios']
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;
END
$do$;

INSERT INTO public.clientes (id, nome_empresa) VALUES
  ('aaaaff01-0000-0000-0000-000000000001', 'Empresa 1 (do CLI)'),
  ('aaaaff02-0000-0000-0000-000000000002', 'Empresa 2 (de outro cliente)');

INSERT INTO public.convites (email, cargo, cliente_id, status) VALUES
  ('a.rc@rlstest.local',   'Membro',  NULL, 'pendente'),
  ('adm.rc@rlstest.local', 'Admin',   NULL, 'pendente'),
  ('cli.rc@rlstest.local', 'Cliente', 'aaaaff01-0000-0000-0000-000000000001', 'pendente');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaa1111-1111-1111-1111-111111111111', 'a.rc@rlstest.local',   '{"nome":"Membro A"}'::jsonb),
  ('aaaa3333-3333-3333-3333-333333333333', 'adm.rc@rlstest.local', '{"nome":"Admin"}'::jsonb),
  ('aaaa5555-5555-5555-5555-555555555555', 'cli.rc@rlstest.local', '{"nome":"Cliente"}'::jsonb);

-- O trigger tem que ter montado os três perfis, com o CLI apontando para a
-- Empresa 1.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.perfis_usuarios
   WHERE email LIKE '%.rc@rlstest.local';
  IF n <> 3 THEN
    RAISE EXCEPTION 'FIXTURES: esperava 3 perfis de teste, o trigger criou %', n;
  END IF;

  SELECT count(*) INTO n FROM public.perfis_usuarios
   WHERE id = 'aaaa5555-5555-5555-5555-555555555555'
     AND cargo::text = 'Cliente'
     AND cliente_id = 'aaaaff01-0000-0000-0000-000000000001';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FIXTURES: o CLI nao ficou Cliente com cliente_id da Empresa 1';
  END IF;

  RAISE NOTICE 'OK: fixtures montadas pelo trigger (Membro, Admin, Cliente)';
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

-- Contador em GUC de transação, e não em TEMP TABLE: o SQL Editor do Supabase
-- executa o último statement por fora da transação, e um SELECT numa temp
-- table ali falha com 42P01.
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

-- RLS filtra em silêncio quando o USING falha: o sinal é ROW_COUNT = 0.
CREATE OR REPLACE FUNCTION pg_temp.sem_efeito(_sql text, _msg text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE _sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    PERFORM pg_temp.falha(format('%s (afetou %s linha(s))', _msg, n));
  END IF;
  PERFORM pg_temp.ok(_msg);
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.barrado(_sql text, _msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION
    WHEN insufficient_privilege THEN
      PERFORM pg_temp.ok(_msg);
      RETURN;
  END;
  PERFORM pg_temp.falha(format('%s (o comando passou)', _msg));
END
$$;

SET LOCAL ROLE authenticated;

-- ###########################################################################
-- ##  TESTES
-- ###########################################################################

-- --- 1) CLI (cargo Cliente) não lê NADA ----------------------------------
DO $$
BEGIN
  PERFORM pg_temp.como('aaaa5555-5555-5555-5555-555555555555');

  -- perfis_usuarios: nem a própria linha. É isso que o desloga em
  -- _authenticated.tsx:24, e é o resultado desejado.
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios
        WHERE id = 'aaaa5555-5555-5555-5555-555555555555'$q$,
    0, 'CLI nao ve NEM a propria linha em perfis_usuarios');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios$q$,
    0, 'CLI nao ve NENHUM perfil');

  -- clientes: nem a própria empresa.
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.clientes
        WHERE id = 'aaaaff01-0000-0000-0000-000000000001'$q$,
    0, 'CLI nao ve NEM a propria empresa');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.clientes$q$,
    0, 'CLI nao ve NENHUM cliente');

  -- O que o getMyPortalContext fazia: própria linha + join clientes.
  PERFORM pg_temp.conta(
    $q$SELECT count(*)
         FROM public.perfis_usuarios p
         JOIN public.clientes c ON c.id = p.cliente_id
        WHERE p.id = 'aaaa5555-5555-5555-5555-555555555555'$q$,
    0, 'getMyPortalContext devolve vazio para o CLI');

  -- Escrita: `sem_efeito` e não `barrado`, porque agora o RESTRICTIVE é
  -- simétrico. O USING já falha, a linha nem é selecionada, e o RLS filtra em
  -- silêncio. Na policy antiga o USING deixava ler a própria empresa, então o
  -- UPDATE a selecionava e o WITH CHECK recusava com 42501.
  PERFORM pg_temp.sem_efeito(
    $q$UPDATE public.clientes SET nome_empresa = 'invadido'
        WHERE id = 'aaaaff01-0000-0000-0000-000000000001'$q$,
    'CLI nao altera nem a propria empresa');

  PERFORM pg_temp.sem_efeito(
    $q$UPDATE public.perfis_usuarios SET nome = 'invadido'
        WHERE id = 'aaaa5555-5555-5555-5555-555555555555'$q$,
    'CLI nao altera nem o proprio perfil');

  PERFORM pg_temp.barrado(
    $q$INSERT INTO public.clientes (nome_empresa) VALUES ('do cliente')$q$,
    'CLI nao cria cliente');
END
$$;

-- --- 2) Membro continua lendo a equipe e os clientes ---------------------
DO $$
BEGIN
  PERFORM pg_temp.como('aaaa1111-1111-1111-1111-111111111111');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios
        WHERE email LIKE '%.rc@rlstest.local'$q$,
    3, 'A (Membro) le os 3 perfis de teste, inclusive o do Cliente');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios
        WHERE id = 'aaaa1111-1111-1111-1111-111111111111'$q$,
    1, 'A (Membro) le o proprio perfil (_authenticated.tsx nao o desloga)');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios
        WHERE id = 'aaaa3333-3333-3333-3333-333333333333'$q$,
    1, 'A (Membro) le o perfil do Admin');

  -- Filtrado pelos ids de fixture: a tabela tem os clientes reais da agência.
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.clientes
        WHERE id IN ('aaaaff01-0000-0000-0000-000000000001',
                     'aaaaff02-0000-0000-0000-000000000002')$q$,
    2, 'A (Membro) ve as duas empresas de teste');

  -- getMyPortalContext para usuário interno: própria linha + join clientes,
  -- que devolve null porque cliente_id é NULL. Não pode dar erro.
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios p
        LEFT JOIN public.clientes c ON c.id = p.cliente_id
        WHERE p.id = 'aaaa1111-1111-1111-1111-111111111111'$q$,
    1, 'getMyPortalContext funciona para o Membro');

  -- Escrita em clientes segue liberada para a equipe interna.
  PERFORM pg_temp.conta(
    $q$WITH u AS (UPDATE public.clientes SET nome_empresa = 'renomeada pelo membro'
                   WHERE id = 'aaaaff01-0000-0000-0000-000000000001'
                 RETURNING 1) SELECT count(*) FROM u$q$,
    1, 'A (Membro) renomeia cliente');

  -- E o Admin também.
  PERFORM pg_temp.como('aaaa3333-3333-3333-3333-333333333333');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.clientes
        WHERE id = 'aaaaff02-0000-0000-0000-000000000002'$q$,
    1, 'o Admin ve a Empresa 2');
END
$$;

-- --- 3) Estado das policies ----------------------------------------------
RESET ROLE;

DO $$
DECLARE
  t text;
  n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['clientes', 'perfis_usuarios']
  LOOP
    SELECT count(*) INTO n
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t
       AND permissive = 'RESTRICTIVE'
       AND policyname = 'Exige equipe interna';
    IF n <> 1 THEN
      PERFORM pg_temp.falha(format(
        '%s deveria ter 1 RESTRICTIVE "Exige equipe interna", tem %s', t, n));
    END IF;
    PERFORM pg_temp.ok(format('%s tem o RESTRICTIVE de equipe interna', t));

    -- O "Exige perfil interno" antigo tem que continuar lá.
    SELECT count(*) INTO n
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t
       AND permissive = 'RESTRICTIVE'
       AND policyname = 'Exige perfil interno';
    IF n <> 1 THEN
      PERFORM pg_temp.falha(format(
        '%s perdeu a RESTRICTIVE "Exige perfil interno", que sustenta o invite-only', t));
    END IF;
    PERFORM pg_temp.ok(format('%s manteve o "Exige perfil interno"', t));
  END LOOP;

  SELECT count(*) INTO n FROM pg_policies
   WHERE policyname = 'Equipe interna ou a propria empresa';
  IF n <> 0 THEN
    PERFORM pg_temp.falha(format('sobrou o carve-out em %s lugar(es)', n));
  END IF;
  PERFORM pg_temp.ok('nenhum carve-out de Cliente sobrou');

  IF to_regprocedure('public.meu_cliente_id()') IS NOT NULL THEN
    PERFORM pg_temp.falha('public.meu_cliente_id() ainda existe');
  END IF;
  PERFORM pg_temp.ok('meu_cliente_id() foi removida');

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'perfis_usuarios'
     AND policyname = 'Autenticados podem ver perfis'
     AND qual LIKE '%eh_equipe_interna%'
     AND qual NOT LIKE '%OR%';
  IF n <> 1 THEN
    PERFORM pg_temp.falha(
      'a permissiva de perfis_usuarios nao ficou so com eh_equipe_interna');
  END IF;
  PERFORM pg_temp.ok('permissiva de perfis_usuarios sem o braco de carve-out');

  -- eh_equipe_interna continua de pé: as partes 1 a 3 dependem dela.
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL THEN
    PERFORM pg_temp.falha('public.eh_equipe_interna(uuid) desapareceu');
  END IF;
  PERFORM pg_temp.ok('eh_equipe_interna() intacta');
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
