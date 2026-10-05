-- ENSAIO de 20261002210000_eh_equipe_interna_exige_ativo.sql.
--
--   BEGIN -> corpo da migration -> fixtures -> testes -> ROLLBACK
--
-- Não grava nada. Sem comando de psql: roda no SQL Editor e em `psql -f`.
-- O corpo da migration é IDÊNTICO ao arquivo, menos o BEGIN/COMMIT.
--
-- ===========================================================================
-- !! LOCK: CREATE OR REPLACE FUNCTION pega lock na função, e as ~20 policies
-- !! que dependem dela passam a usar a nova definição dentro desta transação.
-- !! Enquanto o ensaio estiver aberto, consulta do app que avalie essas
-- !! policies espera. É rápido. Não deixe a aba aberta.
-- ===========================================================================
--
-- SUCESSO -> uma linha com resultado = 'ENSAIO OK'.
-- FALHA   -> erro vermelho "FALHOU: ..." e nenhuma linha.
--
-- Os quatro usuários simulados:
--   ATIVO    bbbb1111-...  Membro,     status ativo
--   INATIVO  bbbb2222-...  Membro,     status inativo
--   SUPINAT  bbbb3333-...  Supervisor, status inativo
--   ADMATIVO bbbb4444-...  Admin,      status ativo

BEGIN;

-- ###########################################################################
-- ##  CORPO DE 20261002210000_eh_equipe_interna_exige_ativo.sql
-- ###########################################################################

DO $do$
BEGIN
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Aplique 20261002170000_rls_endurecer_tabelas_abertas.sql primeiro: '
      'public.eh_equipe_interna(uuid) nao existe.';
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.eh_equipe_interna(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis_usuarios
     WHERE id = _user_id
       AND cargo::text IN ('Admin', 'Membro', 'Supervisor')
       AND status IS DISTINCT FROM 'inativo'
  )
$fn$;

COMMENT ON FUNCTION public.eh_equipe_interna(uuid) IS
  'true para cargo Admin, Membro ou Supervisor com conta ATIVA. Diferente de '
  'tem_perfil(), que aceita o cargo Cliente e ignora status. Use esta em '
  'policy de dado interno.';

DO $do$
DECLARE
  corpo text;
BEGIN
  SELECT prosrc INTO corpo
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'eh_equipe_interna';

  IF corpo IS NULL THEN
    RAISE EXCEPTION 'eh_equipe_interna desapareceu.';
  END IF;
  IF corpo NOT LIKE '%status%' THEN
    RAISE EXCEPTION 'eh_equipe_interna nao ficou com o corte de status.';
  END IF;

  RAISE NOTICE 'eh_equipe_interna agora exige conta ativa.';
END
$do$;

-- ###########################################################################
-- ##  FIXTURES (convite + auth.users, deixando o trigger montar os perfis)
-- ###########################################################################

DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clientes', 'convites', 'perfis_usuarios', 'tarefas']
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;
END
$do$;

INSERT INTO public.convites (email, cargo, status) VALUES
  ('ativo.st@rlstest.local',   'Membro',     'pendente'),
  ('inativo.st@rlstest.local', 'Membro',     'pendente'),
  ('supinat.st@rlstest.local', 'Supervisor', 'pendente'),
  ('admativo.st@rlstest.local','Admin',      'pendente');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('bbbb1111-1111-1111-1111-111111111111', 'ativo.st@rlstest.local',   '{"nome":"Membro Ativo"}'::jsonb),
  ('bbbb2222-2222-2222-2222-222222222222', 'inativo.st@rlstest.local', '{"nome":"Membro Inativo"}'::jsonb),
  ('bbbb3333-3333-3333-3333-333333333333', 'supinat.st@rlstest.local', '{"nome":"Supervisor Inativo"}'::jsonb),
  ('bbbb4444-4444-4444-4444-444444444444', 'admativo.st@rlstest.local','{"nome":"Admin Ativo"}'::jsonb);

-- O trigger cria com status default ('ativo'); inativo dois deles.
UPDATE public.perfis_usuarios SET status = 'inativo'
 WHERE id IN ('bbbb2222-2222-2222-2222-222222222222',
              'bbbb3333-3333-3333-3333-333333333333');

INSERT INTO public.clientes (id, nome_empresa) VALUES
  ('bbbbff01-0000-0000-0000-000000000001', 'Empresa de teste de status');

INSERT INTO public.tarefas (id, titulo, tipo, escopo, criado_por) VALUES
  ('bbbbaa01-0000-0000-0000-000000000001', 'Tarefa geral de teste', 'tarefa', 'geral',
   'bbbb1111-1111-1111-1111-111111111111');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.perfis_usuarios
   WHERE email LIKE '%.st@rlstest.local';
  IF n <> 4 THEN
    RAISE EXCEPTION 'FIXTURES: esperava 4 perfis, o trigger criou %', n;
  END IF;

  SELECT count(*) INTO n FROM public.perfis_usuarios
   WHERE email LIKE '%.st@rlstest.local' AND status = 'inativo';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FIXTURES: esperava 2 perfis inativos, tem %', n;
  END IF;

  RAISE NOTICE 'OK: fixtures montadas (2 ativos, 2 inativos)';
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

-- --- 1) A função classifica por cargo E por status -----------------------
DO $$
BEGIN
  IF NOT public.eh_equipe_interna('bbbb1111-1111-1111-1111-111111111111')
     THEN PERFORM pg_temp.falha('Membro ATIVO deveria ser equipe interna'); END IF;
  PERFORM pg_temp.ok('Membro ativo e equipe interna');

  IF NOT public.eh_equipe_interna('bbbb4444-4444-4444-4444-444444444444')
     THEN PERFORM pg_temp.falha('Admin ATIVO deveria ser equipe interna'); END IF;
  PERFORM pg_temp.ok('Admin ativo e equipe interna');

  -- O ponto da migration:
  IF public.eh_equipe_interna('bbbb2222-2222-2222-2222-222222222222')
     THEN PERFORM pg_temp.falha('Membro INATIVO NAO deveria ser equipe interna'); END IF;
  PERFORM pg_temp.ok('Membro inativo NAO e equipe interna');

  IF public.eh_equipe_interna('bbbb3333-3333-3333-3333-333333333333')
     THEN PERFORM pg_temp.falha('Supervisor INATIVO NAO deveria ser equipe interna'); END IF;
  PERFORM pg_temp.ok('Supervisor inativo NAO e equipe interna');

  -- tem_perfil continua ignorando status: é o contraste que justifica as duas
  -- funções existirem.
  IF NOT public.tem_perfil('bbbb2222-2222-2222-2222-222222222222')
     THEN PERFORM pg_temp.falha('tem_perfil deveria aceitar o inativo (ela ignora status)'); END IF;
  PERFORM pg_temp.ok('tem_perfil ainda aceita conta inativa, como antes');
END
$$;

-- --- 2) Membro INATIVO nao le nada -------------------------------------
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  PERFORM pg_temp.como('bbbb2222-2222-2222-2222-222222222222');

  FOREACH t IN ARRAY ARRAY[
    'tarefas', 'tarefa_responsaveis', 'tarefa_checklist_itens',
    'comentarios_tarefa', 'projetos', 'pastas_links', 'pastas_links_itens',
    'ideias', 'configuracoes_planos', 'organograma_nos', 'compartilhamentos',
    'murais', 'mural_quadros', 'mural_itens',
    'aniversariantes', 'aniversariante_visualizacoes',
    'clientes', 'perfis_usuarios'
  ]
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 0 THEN
      PERFORM pg_temp.falha(format('INATIVO leu %s linha(s) de %s', n, t));
    END IF;
    PERFORM pg_temp.ok(format('INATIVO nao le nada de %s', t));
  END LOOP;

  -- Nem a própria linha de perfil: é isso que o app lê em _authenticated.tsx,
  -- então ele também passa a ser barrado lá pelo banco, não só pela UI.
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios
        WHERE id = 'bbbb2222-2222-2222-2222-222222222222'$q$,
    0, 'INATIVO nao le nem a propria linha de perfil');

  -- Escrita também fechada.
  PERFORM pg_temp.sem_efeito(
    $q$UPDATE public.tarefas SET titulo = 'invadido'
        WHERE id = 'bbbbaa01-0000-0000-0000-000000000001'$q$,
    'INATIVO nao altera tarefa');

  PERFORM pg_temp.barrado(
    $q$INSERT INTO public.projetos (nome) VALUES ('do inativo')$q$,
    'INATIVO nao cria projeto');

  PERFORM pg_temp.barrado(
    $q$INSERT INTO public.tarefas (titulo, tipo, escopo)
       VALUES ('do inativo', 'tarefa', 'geral')$q$,
    'INATIVO nao cria tarefa');

  -- Storage: os dois buckets com corte de cargo.
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'contratos'$q$,
    0, 'INATIVO nao le contratos');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'aniversariantes'$q$,
    0, 'INATIVO nao le o bucket aniversariantes');
END
$$;

-- --- 3) Supervisor INATIVO tambem nao, apesar do cargo ------------------
DO $$
BEGIN
  PERFORM pg_temp.como('bbbb3333-3333-3333-3333-333333333333');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefas$q$,
    0, 'Supervisor inativo nao le tarefas (cargo alto nao salva)');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.clientes$q$,
    0, 'Supervisor inativo nao le clientes');
END
$$;

-- --- 4) Membro ATIVO continua normal -----------------------------------
DO $$
BEGIN
  PERFORM pg_temp.como('bbbb1111-1111-1111-1111-111111111111');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios
        WHERE id = 'bbbb1111-1111-1111-1111-111111111111'$q$,
    1, 'ATIVO le a propria linha de perfil');

  -- Lê os perfis da equipe, inclusive os inativos (a lista de membros precisa
  -- mostrar quem está inativo para o admin poder reativar).
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios
        WHERE email LIKE '%.st@rlstest.local'$q$,
    4, 'ATIVO le os 4 perfis de teste, inclusive os inativos');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefas
        WHERE id = 'bbbbaa01-0000-0000-0000-000000000001'$q$,
    1, 'ATIVO le a tarefa de teste');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.clientes
        WHERE id = 'bbbbff01-0000-0000-0000-000000000001'$q$,
    1, 'ATIVO le o cliente de teste');

  PERFORM pg_temp.conta(
    $q$WITH u AS (UPDATE public.tarefas SET titulo = 'editada pelo ativo'
                   WHERE id = 'bbbbaa01-0000-0000-0000-000000000001'
                 RETURNING 1) SELECT count(*) FROM u$q$,
    1, 'ATIVO edita tarefa');

  PERFORM pg_temp.conta(
    $q$WITH i AS (INSERT INTO public.projetos (nome)
                  VALUES ('projeto do ativo') RETURNING 1)
       SELECT count(*) FROM i$q$,
    1, 'ATIVO cria projeto');

  -- E o Admin ativo também.
  PERFORM pg_temp.como('bbbb4444-4444-4444-4444-444444444444');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.clientes
        WHERE id = 'bbbbff01-0000-0000-0000-000000000001'$q$,
    1, 'Admin ativo le o cliente de teste');
END
$$;

-- --- 5) Reativar devolve o acesso na hora ------------------------------
RESET ROLE;

UPDATE public.perfis_usuarios SET status = 'ativo'
 WHERE id = 'bbbb2222-2222-2222-2222-222222222222';

SET LOCAL ROLE authenticated;

DO $$
BEGIN
  PERFORM pg_temp.como('bbbb2222-2222-2222-2222-222222222222');

  IF NOT public.eh_equipe_interna('bbbb2222-2222-2222-2222-222222222222')
     THEN PERFORM pg_temp.falha('reativado deveria voltar a ser equipe interna'); END IF;
  PERFORM pg_temp.ok('reativar devolve eh_equipe_interna');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefas
        WHERE id = 'bbbbaa01-0000-0000-0000-000000000001'$q$,
    1, 'reativado volta a ler tarefa');
END
$$;

-- --- 6) Valor de status desconhecido NAO tranca ninguem ----------------
-- A condição é IS DISTINCT FROM 'inativo', e não = 'ativo', de propósito: um
-- valor inesperado inserido à mão não deve derrubar a pessoa.
RESET ROLE;

UPDATE public.perfis_usuarios SET status = 'suspenso_temporario'
 WHERE id = 'bbbb2222-2222-2222-2222-222222222222';

SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF NOT public.eh_equipe_interna('bbbb2222-2222-2222-2222-222222222222')
     THEN PERFORM pg_temp.falha(
       'status desconhecido NAO deveria trancar: a condicao e IS DISTINCT FROM ''inativo'''); END IF;
  PERFORM pg_temp.ok('status desconhecido nao tranca (erra para o lado de nao derrubar a equipe)');
END
$$;

-- --- 7) Estado da função -----------------------------------------------
RESET ROLE;

DO $$
DECLARE corpo text;
BEGIN
  SELECT prosrc INTO corpo
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'eh_equipe_interna';

  IF corpo NOT LIKE '%status%' THEN
    PERFORM pg_temp.falha('eh_equipe_interna sem o corte de status');
  END IF;
  PERFORM pg_temp.ok('eh_equipe_interna com o corte de status no corpo');

  IF corpo NOT LIKE '%Admin%' OR corpo NOT LIKE '%Supervisor%' THEN
    PERFORM pg_temp.falha('eh_equipe_interna perdeu o corte de cargo');
  END IF;
  PERFORM pg_temp.ok('eh_equipe_interna manteve o corte de cargo');

  -- Continua SECURITY DEFINER com search_path fixo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'eh_equipe_interna'
      AND p.prosecdef
      AND array_to_string(coalesce(p.proconfig, '{}'), ',') LIKE '%search_path%'
  ) THEN
    PERFORM pg_temp.falha('eh_equipe_interna perdeu SECURITY DEFINER ou o search_path fixo');
  END IF;
  PERFORM pg_temp.ok('eh_equipe_interna segue SECURITY DEFINER com search_path fixo');
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
