-- ENSAIO das migrations de RLS, para colar no SQL Editor do Supabase.
--
--   BEGIN  ->  corpo de 20261002170000  (parte 1: tabelas abertas)
--          ->  corpo de 20261002180000  (parte 2: equipe interna no resto)
--          ->  corpo de 20261002190000  (parte 3: buckets de storage)
--          ->  fixtures  ->  testes  ->  ROLLBACK
--
-- Uma transação só, uma janela de manutenção só.
--
-- Não grava nada. Não tem comando de psql (nada de \set, \echo), então roda
-- igual no SQL Editor e em `psql -f`.
--
-- O corpo das migrations aqui é IDÊNTICO aos três arquivos de
-- supabase/migrations/, menos o BEGIN/COMMIT de cada um. Se mexer em um, mexa
-- no outro.
--
-- ===========================================================================
-- !! ANTES DE RODAR EM PRODUÇÃO, LEIA ISTO
-- !!
-- !! ALTER TABLE ... ENABLE ROW LEVEL SECURITY e CREATE/DROP POLICY pegam
-- !! ACCESS EXCLUSIVE nas tabelas afetadas, e o lock só sai no ROLLBACK. Com
-- !! este ensaio aberto, qualquer query do app em tarefas, clientes,
-- !! perfis_usuarios, projetos, murais etc. FICA ESPERANDO. É rápido, mas é
-- !! um congelamento real.
-- !!
-- !! A parte 3 mexe em policy de storage.objects, então o congelamento alcança
-- !! TODO upload e download de arquivo do app enquanto a transação estiver
-- !! aberta — anexo de tarefa, imagem de aniversariante, anexo de demanda do
-- !! portal público. Mais uma razão para não deixar a aba aberta.
-- !!
-- !! Rode num branch do Supabase ou em staging. Se for em produção mesmo,
-- !! faça em horário morto e não deixe a aba aberta sem terminar.
-- ===========================================================================
--
-- COMO LER O RESULTADO. O SQL Editor pode não mostrar RAISE NOTICE, então não
-- conte com eles. O sinal é a última query, que devolve literais e não lê
-- tabela nenhuma:
--
--   SUCESSO -> uma linha com resultado = 'ENSAIO OK'. Chegar até ela já é a
--              prova, porque qualquer asserção que falhasse teria levantado
--              exceção e abortado a transação antes.
--   FALHA   -> erro vermelho "FALHOU: <o que falhou>" e nenhuma linha. A
--              mensagem diz qual asserção quebrou e o que veio no lugar do
--              esperado.
--
-- Não existe resultado intermediário: ou vem a linha, ou vem o erro.
--
-- TRIGGERS E CHAMADA EXTERNA: as fixtures desligam todos os triggers de usuário
-- das tabelas que elas tocam, justamente porque dois deles chamam net.http_post.
-- Ver o bloco "0) Silencia os triggers" na seção FIXTURES.
--
-- DOIS SINAIS DIFERENTES DE "ESCRITA NEGADA", e quando esperar cada um:
--   falha no USING      -> RLS filtra em SILÊNCIO, ROW_COUNT = 0. É o que o
--                          helper pg_temp.sem_efeito() espera.
--   falha no WITH CHECK -> RLS levanta 42501 "new row violates row-level
--                          security policy". É o que pg_temp.barrado() espera.
--
--   A diferença só aparece quando USING e WITH CHECK DIVERGEM: se a linha
--   passa pelo USING, ela é selecionada, e aí o WITH CHECK recusa com erro.
--   Nas três migrations existe exatamente UMA policy assim — a de `clientes`
--   ("Equipe interna ou a propria empresa"), cujo USING tem o braço
--   `id = meu_cliente_id()` e o WITH CHECK não. É de propósito: o Cliente lê a
--   própria empresa e não escreve nela. Todas as outras policies têm USING
--   igual ao WITH CHECK, ou só um dos dois, então nelas o sinal é sempre
--   ROW_COUNT = 0.
--
-- O QUE ESTE ENSAIO NÃO CONSEGUE PROVAR, e por quê:
--   DELETE e UPDATE em storage.objects. O Supabase tem um trigger
--   storage.protect_delete() que levanta 42501 ("Direct deletion from storage
--   tables is not allowed. Use the Storage API instead.") em qualquer delete
--   direto por SQL, antes de a semântica de RLS ficar observável. Não dá para
--   desligar: a tabela pertence a supabase_storage_admin, não ao postgres.
--   Consequência: a asserção negativa passaria sempre pelo motivo errado e a
--   positiva é impossível. As duas viraram verificação declarativa em
--   pg_policies, na seção 7. SELECT e INSERT de storage.objects continuam
--   sendo exercitados de verdade, com RLS valendo.
--
-- Os seis usuários simulados, criados pelo caminho real (convite + auth.users,
-- deixando o trigger on_auth_user_created montar os perfis):
--   A    11111111-...  Membro
--   B    22222222-...  Membro
--   ADM  33333333-...  Admin
--   SEM  44444444-...  conta 'demandante' (vai para demandas_externas_usuarios,
--                      NÃO ganha perfis_usuarios)
--   CLI  55555555-...  Cliente, cliente_id = EMPRESA 1
--   SUP  66666666-...  Supervisor

BEGIN;

-- ###########################################################################
-- ###########################################################################
-- ##  PARTE 1 — corpo de 20261002170000_rls_endurecer_tabelas_abertas.sql
-- ###########################################################################
-- ###########################################################################

-- --- 1) eh_equipe_interna() e meu_cliente_id() -----------------------------
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
  )
$fn$;

REVOKE EXECUTE ON FUNCTION public.eh_equipe_interna(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.eh_equipe_interna(uuid) TO authenticated;

COMMENT ON FUNCTION public.eh_equipe_interna(uuid) IS
  'true para cargo Admin, Membro ou Supervisor. Diferente de tem_perfil(), '
  'que também aceita o cargo Cliente. Use esta em policy de dado interno.';

CREATE OR REPLACE FUNCTION public.meu_cliente_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p.cliente_id
    FROM public.perfis_usuarios p
   WHERE p.id = auth.uid()
   LIMIT 1
$fn$;

REVOKE EXECUTE ON FUNCTION public.meu_cliente_id() FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.meu_cliente_id() TO authenticated;

-- --- 2) RLS ligado ---------------------------------------------------------
ALTER TABLE public.configuracoes_planos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pastas_links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pastas_links_itens     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarefa_checklist_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideias                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projetos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarefas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarefa_responsaveis    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes               ENABLE ROW LEVEL SECURITY;

-- --- 3) Remove as policies abertas, por condição e não por nome ------------
DO $do$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY (ARRAY[
             'configuracoes_planos', 'pastas_links', 'pastas_links_itens',
             'tarefa_checklist_itens', 'ideias', 'projetos'
           ])
       AND permissive = 'PERMISSIVE'
       AND 'authenticated' = ANY (roles)
       AND coalesce(qual, 'true') = 'true'
       AND coalesce(with_check, 'true') = 'true'
     ORDER BY tablename, policyname
  LOOP
    RAISE NOTICE 'Removendo policy aberta: %.% -> "%" (%)',
      r.schemaname, r.tablename, r.policyname, r.cmd;
    EXECUTE format('DROP POLICY %I ON %I.%I',
                   r.policyname, r.schemaname, r.tablename);
    n := n + 1;
  END LOOP;

  RAISE NOTICE '% policy(s) aberta(s) removida(s).', n;

  IF n = 0 THEN
    RAISE WARNING 'Nenhuma policy aberta encontrada: confirme em pg_policies se o estado do banco e o esperado antes de seguir.';
  END IF;
END
$do$;

-- --- 4) RESTRICTIVE "Exige equipe interna" ---------------------------------
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'configuracoes_planos', 'pastas_links', 'pastas_links_itens',
    'tarefa_checklist_itens', 'ideias', 'projetos',
    'tarefas', 'tarefa_responsaveis'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Exige equipe interna" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Exige equipe interna" ON public.%I'
      ' AS RESTRICTIVE FOR ALL TO authenticated'
      ' USING (public.eh_equipe_interna((select auth.uid())))'
      ' WITH CHECK (public.eh_equipe_interna((select auth.uid())))', t);
    RAISE NOTICE 'RESTRICTIVE "Exige equipe interna" aplicada em public.%', t;
  END LOOP;
END
$do$;

-- --- 5) projetos, pastas_links, pastas_links_itens -------------------------
DROP POLICY IF EXISTS "Equipe interna gerencia projetos" ON public.projetos;
CREATE POLICY "Equipe interna gerencia projetos" ON public.projetos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Equipe interna gerencia pastas" ON public.pastas_links;
CREATE POLICY "Equipe interna gerencia pastas" ON public.pastas_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Equipe interna gerencia itens de pasta"
  ON public.pastas_links_itens;
CREATE POLICY "Equipe interna gerencia itens de pasta" ON public.pastas_links_itens
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.projetos
  ALTER COLUMN criado_por SET DEFAULT auth.uid();
ALTER TABLE public.pastas_links
  ALTER COLUMN criado_por SET DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_pastas_links_itens_pasta_id
  ON public.pastas_links_itens (pasta_id);

-- --- 6) tarefa_checklist_itens herda a visibilidade da tarefa --------------
DROP POLICY IF EXISTS "Checklist herda a visibilidade da tarefa"
  ON public.tarefa_checklist_itens;
CREATE POLICY "Checklist herda a visibilidade da tarefa"
  ON public.tarefa_checklist_itens
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.id = tarefa_checklist_itens.tarefa_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.id = tarefa_checklist_itens.tarefa_id
    )
  );

CREATE INDEX IF NOT EXISTS idx_tarefa_checklist_itens_tarefa_id
  ON public.tarefa_checklist_itens (tarefa_id);

-- --- 7) clientes: interna vê tudo, Cliente vê só a própria empresa ---------
DROP POLICY IF EXISTS "Equipe interna ou a propria empresa" ON public.clientes;
CREATE POLICY "Equipe interna ou a propria empresa" ON public.clientes
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.eh_equipe_interna((select auth.uid()))
    OR id = (select public.meu_cliente_id())
  )
  WITH CHECK (
    public.eh_equipe_interna((select auth.uid()))
  );

-- --- 8) ideias e configuracoes_planos --------------------------------------
DROP POLICY IF EXISTS "Equipe interna le ideias" ON public.ideias;
CREATE POLICY "Equipe interna le ideias" ON public.ideias
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Equipe interna le planos" ON public.configuracoes_planos;
CREATE POLICY "Equipe interna le planos" ON public.configuracoes_planos
  FOR SELECT TO authenticated USING (true);

-- --- 9) tarefas: tarefa de Admin de SELECT para ALL -----------------------
DROP POLICY IF EXISTS "Tarefas de Admin so para Admins" ON public.tarefas;
CREATE POLICY "Tarefas de Admin so para Admins" ON public.tarefas
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_admin((select auth.uid()))
    OR NOT public.tarefa_de_admin(id)
  )
  WITH CHECK (
    public.is_admin((select auth.uid()))
    OR NOT public.tarefa_de_admin(id)
  );

-- ###########################################################################
-- ###########################################################################
-- ##  PARTE 2 — corpo de 20261002180000_rls_equipe_interna_resto.sql
-- ###########################################################################
-- ###########################################################################

-- --- 1) Pré-condição ------------------------------------------------------
DO $do$
BEGIN
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Aplique 20261002170000_rls_endurecer_tabelas_abertas.sql primeiro: '
      'public.eh_equipe_interna(uuid) nao existe.';
  END IF;
  IF to_regprocedure('public.meu_cliente_id()') IS NULL THEN
    RAISE EXCEPTION
      'Aplique 20261002170000_rls_endurecer_tabelas_abertas.sql primeiro: '
      'public.meu_cliente_id() nao existe.';
  END IF;
END
$do$;

-- --- 2) RLS ligado --------------------------------------------------------
ALTER TABLE public.comentarios_tarefa           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfis_usuarios              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organograma_nos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compartilhamentos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.murais                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mural_quadros                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mural_itens                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aniversariantes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aniversariante_visualizacoes ENABLE ROW LEVEL SECURITY;

-- --- 3) RESTRICTIVE "Exige equipe interna" no resto ------------------------
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'comentarios_tarefa', 'organograma_nos', 'compartilhamentos',
    'murais', 'mural_quadros', 'mural_itens',
    'aniversariantes', 'aniversariante_visualizacoes'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Exige equipe interna" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Exige equipe interna" ON public.%I'
      ' AS RESTRICTIVE FOR ALL TO authenticated'
      ' USING (public.eh_equipe_interna((select auth.uid())))'
      ' WITH CHECK (public.eh_equipe_interna((select auth.uid())))', t);
    RAISE NOTICE 'RESTRICTIVE "Exige equipe interna" aplicada em public.%', t;
  END LOOP;
END
$do$;

-- --- 4) comentarios_tarefa herda a visibilidade da tarefa -----------------
DROP POLICY IF EXISTS "Comentario herda a visibilidade da tarefa"
  ON public.comentarios_tarefa;
CREATE POLICY "Comentario herda a visibilidade da tarefa"
  ON public.comentarios_tarefa
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.id = comentarios_tarefa.tarefa_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.id = comentarios_tarefa.tarefa_id
    )
  );

CREATE INDEX IF NOT EXISTS idx_comentarios_tarefa_tarefa_id
  ON public.comentarios_tarefa (tarefa_id);

-- --- 5) perfis_usuarios: interna vê todos, Cliente vê só a própria linha ---
DROP POLICY IF EXISTS "Autenticados podem ver perfis" ON public.perfis_usuarios;
CREATE POLICY "Autenticados podem ver perfis" ON public.perfis_usuarios
  FOR SELECT TO authenticated
  USING (
    public.eh_equipe_interna((select auth.uid()))
    OR id = (select auth.uid())
  );

-- --- 6) aniversariantes ---------------------------------------------------
DROP POLICY IF EXISTS "Equipe ve aniversariantes" ON public.aniversariantes;
CREATE POLICY "Equipe ve aniversariantes" ON public.aniversariantes
  FOR SELECT TO authenticated
  USING (public.eh_equipe_interna((select auth.uid())));

-- --- 7) storage.objects do bucket 'aniversariantes' -----------------------
DROP POLICY IF EXISTS "Aniversariantes: leitura autenticada" ON storage.objects;
CREATE POLICY "Aniversariantes: leitura autenticada"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'aniversariantes'
    AND public.eh_equipe_interna((select auth.uid()))
  );

-- ###########################################################################
-- ###########################################################################
-- ##  PARTE 3 — corpo de 20261002190000_rls_storage_buckets.sql
-- ###########################################################################
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
     WHERE schemaname = 'storage'
       AND tablename  = 'objects'
       AND policyname = 'Aniversariantes: leitura autenticada'
       AND qual LIKE '%eh_equipe_interna%'
  ) THEN
    RAISE EXCEPTION
      'Aplique 20261002180000_rls_equipe_interna_resto.sql primeiro: a policy '
      'de storage do bucket aniversariantes ainda nao usa eh_equipe_interna.';
  END IF;
END
$do$;

-- --- 2) Bucket 'contratos' ------------------------------------------------
DROP POLICY IF EXISTS "Autenticados leem contratos"      ON storage.objects;
DROP POLICY IF EXISTS "Autenticados enviam contratos"    ON storage.objects;
DROP POLICY IF EXISTS "Autenticados atualizam contratos" ON storage.objects;
DROP POLICY IF EXISTS "Autenticados excluem contratos"   ON storage.objects;

DROP POLICY IF EXISTS "Contratos: equipe interna le"     ON storage.objects;
CREATE POLICY "Contratos: equipe interna le"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'contratos'
    AND public.eh_equipe_interna((select auth.uid()))
  );

DROP POLICY IF EXISTS "Contratos: equipe interna envia"  ON storage.objects;
CREATE POLICY "Contratos: equipe interna envia"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contratos'
    AND public.eh_equipe_interna((select auth.uid()))
  );

DROP POLICY IF EXISTS "Contratos: gestao atualiza"       ON storage.objects;
CREATE POLICY "Contratos: gestao atualiza"
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'contratos'
    AND public.is_admin((select auth.uid()))
  )
  WITH CHECK (
    bucket_id = 'contratos'
    AND public.is_admin((select auth.uid()))
  );

DROP POLICY IF EXISTS "Contratos: gestao exclui"         ON storage.objects;
CREATE POLICY "Contratos: gestao exclui"
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'contratos'
    AND public.is_admin((select auth.uid()))
  );

-- --- 3) Bucket 'treinamentos-pdfs': sweep defensivo, hoje no-op -----------
DO $do$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT policyname, cmd
      FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename  = 'objects'
       AND (coalesce(qual, '') LIKE '%treinamentos-pdfs%'
            OR coalesce(with_check, '') LIKE '%treinamentos-pdfs%')
     ORDER BY policyname
  LOOP
    RAISE NOTICE 'Removendo policy residual de treinamentos-pdfs: "%" (%)',
      r.policyname, r.cmd;
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
    n := n + 1;
  END LOOP;

  IF n = 0 THEN
    RAISE NOTICE 'treinamentos-pdfs: nenhuma policy encontrada, bucket segue fechado por ausencia de policy.';
  END IF;
END
$do$;

-- ###########################################################################
-- ###########################################################################
-- ##  FIXTURES
-- ##
-- ##  Pelo caminho real: convite pendente + INSERT em auth.users. O trigger
-- ##  on_auth_user_created (SECURITY DEFINER) monta perfis_usuarios com o
-- ##  cargo e o cliente_id do convite. Para o SEM uso
-- ##  raw_user_meta_data->>'tipo' = 'demandante', que o trigger manda para
-- ##  demandas_externas_usuarios SEM criar perfil — exatamente a conta que
-- ##  queremos testar.
-- ##
-- ##  Não precisa de session_replication_role nem de nenhum privilégio
-- ##  especial além de INSERT em auth.users, que o papel do SQL Editor tem.
-- ###########################################################################
-- ###########################################################################

-- --- 0) Silencia os triggers que fazem chamada EXTERNA --------------------
--
-- public.tarefa_responsaveis tem DOIS triggers AFTER INSERT que chamam
-- net.http_post (pg_net):
--   trg_notificar_designacao        -> notificar_designacao_whatsapp()
--   trg_notificar_designacao_email  -> notificar_designacao_email(), que posta
--                                      em https://gestaomde.lovable.app/api/
--                                      public/hooks/email-assignment
-- e public.clientes tem trg_gerar_setup_cliente, que fabrica uma tarefa por
-- serviço do plano mais uma linha em financeiro_transacoes.
--
-- pg_net é transacional: net.http_post só faz INSERT em net.http_request_queue,
-- o worker em background lê apenas linhas COMMITADAS, e o ROLLBACK apaga a
-- linha antes disso. Então, em teoria, nada sairia. Mesmo assim desligo os
-- triggers: não quero que a prova dependa do comportamento interno do pg_net,
-- e não quero fixture fabricada por trigger alheio.
--
-- Uso DISABLE TRIGGER USER, que derruba TODO trigger de usuário das tabelas
-- abaixo — inclusive algum que exista só em produção e não nas migrations
-- (este projeto tem esse histórico). Triggers internos de FK continuam ativos,
-- então integridade referencial segue valendo. É DDL, logo o ROLLBACK religa
-- tudo.
--
-- auth.users fica FORA da lista de propósito: é o on_auth_user_created que
-- monta os perfis a partir dos convites, e ele não faz chamada externa.
DO $do$
DECLARE
  t text;
  r record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clientes', 'tarefas', 'tarefa_responsaveis', 'tarefa_checklist_itens',
    'comentarios_tarefa', 'projetos', 'pastas_links', 'pastas_links_itens',
    'ideias', 'configuracoes_planos', 'convites', 'perfis_usuarios'
  ]
  LOOP
    FOR r IN
      SELECT tg.tgname
        FROM pg_trigger tg
        JOIN pg_class c ON c.oid = tg.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = t
         AND NOT tg.tgisinternal
         AND tg.tgenabled <> 'D'
    LOOP
      RAISE NOTICE 'Desativando trigger para o ensaio: public.% -> %', t, r.tgname;
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;
END
$do$;

INSERT INTO public.clientes (id, nome_empresa) VALUES
  ('ffff0001-0000-0000-0000-000000000001', 'Empresa 1 (do CLI)'),
  ('ffff0002-0000-0000-0000-000000000002', 'Empresa 2 (de outro cliente)');

INSERT INTO public.convites (email, cargo, cliente_id, status) VALUES
  ('a@rlstest.local',   'Membro',     NULL, 'pendente'),
  ('b@rlstest.local',   'Membro',     NULL, 'pendente'),
  ('adm@rlstest.local', 'Admin',      NULL, 'pendente'),
  ('cli@rlstest.local', 'Cliente',    'ffff0001-0000-0000-0000-000000000001', 'pendente'),
  ('sup@rlstest.local', 'Supervisor', NULL, 'pendente');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'a@rlstest.local',   '{"nome":"Usuario A"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'b@rlstest.local',   '{"nome":"Usuario B"}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'adm@rlstest.local', '{"nome":"Admin"}'::jsonb),
  ('55555555-5555-5555-5555-555555555555', 'cli@rlstest.local', '{"nome":"Cliente"}'::jsonb),
  ('66666666-6666-6666-6666-666666666666', 'sup@rlstest.local', '{"nome":"Supervisor"}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'sem@rlstest.local', '{"nome":"Demandante","tipo":"demandante"}'::jsonb);

-- O trigger tem que ter montado 5 perfis e nenhum para o SEM.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.perfis_usuarios
   WHERE email LIKE '%@rlstest.local';
  IF n <> 5 THEN
    RAISE EXCEPTION 'FIXTURES: esperava 5 perfis de teste, o trigger criou %', n;
  END IF;

  SELECT count(*) INTO n FROM public.perfis_usuarios
   WHERE id = '44444444-4444-4444-4444-444444444444';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FIXTURES: a conta demandante nao deveria ter perfil';
  END IF;

  SELECT count(*) INTO n FROM public.perfis_usuarios
   WHERE id = '55555555-5555-5555-5555-555555555555'
     AND cargo::text = 'Cliente'
     AND cliente_id = 'ffff0001-0000-0000-0000-000000000001';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FIXTURES: o CLI nao ficou com cargo Cliente e cliente_id da Empresa 1';
  END IF;

  RAISE NOTICE 'OK: fixtures de usuario montadas pelo trigger (5 perfis + 1 demandante)';
END
$$;

-- Dados
INSERT INTO public.tarefas (id, titulo, tipo, escopo, criado_por) VALUES
  ('aaaa0001-0000-0000-0000-000000000001', 'Lembrete pessoal de A', 'lembrete', 'pessoal', '11111111-1111-1111-1111-111111111111'),
  ('aaaa0002-0000-0000-0000-000000000002', 'Tarefa geral de A',     'tarefa',   'geral',   '11111111-1111-1111-1111-111111111111'),
  ('aaaa0003-0000-0000-0000-000000000003', 'Tarefa do Admin',       'tarefa',   'geral',   '11111111-1111-1111-1111-111111111111');

INSERT INTO public.tarefa_responsaveis (tarefa_id, usuario_id) VALUES
  ('aaaa0003-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333');

INSERT INTO public.tarefa_checklist_itens (id, tarefa_id, texto) VALUES
  ('cccc0001-0000-0000-0000-000000000001', 'aaaa0001-0000-0000-0000-000000000001', 'item do lembrete pessoal de A'),
  ('cccc0002-0000-0000-0000-000000000002', 'aaaa0002-0000-0000-0000-000000000002', 'item da tarefa geral'),
  ('cccc0003-0000-0000-0000-000000000003', 'aaaa0003-0000-0000-0000-000000000003', 'item da tarefa do admin');

INSERT INTO public.comentarios_tarefa (id, tarefa_id, usuario_id, conteudo) VALUES
  ('c0de0001-0000-0000-0000-000000000001', 'aaaa0001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'comentario no lembrete pessoal de A'),
  ('c0de0002-0000-0000-0000-000000000002', 'aaaa0002-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'comentario na tarefa geral'),
  ('c0de0003-0000-0000-0000-000000000003', 'aaaa0003-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'comentario na tarefa do admin');

INSERT INTO public.projetos (id, nome, criado_por) VALUES
  ('bbbb0001-0000-0000-0000-000000000001', 'Projeto de A', '11111111-1111-1111-1111-111111111111'),
  ('bbbb0002-0000-0000-0000-000000000002', 'Projeto legado sem dono', NULL);

INSERT INTO public.pastas_links (id, nome, criado_por) VALUES
  ('dddd0001-0000-0000-0000-000000000001', 'Pasta de A', '11111111-1111-1111-1111-111111111111');

INSERT INTO public.pastas_links_itens (id, pasta_id, url) VALUES
  ('eeee0001-0000-0000-0000-000000000001', 'dddd0001-0000-0000-0000-000000000001', 'https://exemplo.local/a');

INSERT INTO public.ideias (id, titulo, criado_por) VALUES
  ('a1de0001-0000-0000-0000-000000000001', 'Ideia de A', '11111111-1111-1111-1111-111111111111');

INSERT INTO public.configuracoes_planos (id, nome_plano, valor_mensal) VALUES
  ('91a40001-0000-0000-0000-000000000001', 'Plano de teste', 1234.56);

-- --- Fixtures de storage -------------------------------------------------
--
-- storage.objects NÃO entra no DISABLE TRIGGER USER acima, e isso é de
-- propósito: no Supabase essa tabela pertence a supabase_storage_admin, não ao
-- postgres, e o ALTER TABLE falharia por falta de dono. A lista do DISABLE tem
-- só tabelas de `public`. Os triggers internos do storage (o que mantém
-- path_tokens, por exemplo) continuam ativos, que é o certo.
--
-- O INSERT direto em storage.objects precisa de duas coisas do papel que roda
-- o ensaio: privilégio de INSERT na tabela e capacidade de passar pelo RLS
-- dela (BYPASSRLS ou ser o dono), porque nenhuma policy vale para o papel
-- `postgres`. O bloco abaixo confere isso ANTES de tentar, e se faltar algo
-- diz exatamente o quê, em vez de estourar um erro obscuro no meio do ensaio.
DO $$
DECLARE
  v_bypass boolean;
  v_insert boolean;
  v_select boolean;
BEGIN
  SELECT rolbypassrls INTO v_bypass FROM pg_roles WHERE rolname = current_user;
  v_insert := has_table_privilege(current_user, 'storage.objects', 'INSERT');
  v_select := has_table_privilege(current_user, 'storage.objects', 'SELECT');

  RAISE NOTICE 'storage.objects -> papel=% bypassrls=% insert=% select=%',
    current_user, v_bypass, v_insert, v_select;

  IF NOT v_insert THEN
    RAISE EXCEPTION
      'Sem privilegio de INSERT em storage.objects como "%". Rode o ensaio '
      'pelo SQL Editor do Supabase (papel postgres). Se ainda falhar, apague '
      'as fixtures e os testes de storage e rode o resto.', current_user;
  END IF;

  IF NOT coalesce(v_bypass, false) THEN
    RAISE WARNING
      'O papel "%" nao tem BYPASSRLS. Se o INSERT em storage.objects falhar '
      'com 42501, e isso: nenhuma policy de storage.objects vale para ele.',
      current_user;
  END IF;
END
$$;

-- Os buckets 'aniversariantes' e 'contratos' já existem em produção
-- (storage.buckets ao vivo, os dois com public = false). Os INSERTs são
-- idempotentes e somem no ROLLBACK de qualquer jeito.
--
-- NÃO crio 'treinamentos-pdfs': storage.buckets ao vivo tem só três buckets, e
-- esse não está entre eles. Criar um bucket que não existe só para depois
-- provar que ninguém o lê seria teatro, e ainda tomaria lock em
-- storage.buckets sem motivo. A prova de que o bucket segue fechado é a
-- asserção de pg_policies na seção 7.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('aniversariantes', 'aniversariantes', false),
  ('contratos',       'contratos',       false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.objects (id, bucket_id, name) VALUES
  ('57060001-0000-0000-0000-000000000001'::uuid, 'aniversariantes', 'rlstest/foto-aniversario.png'),
  ('57060002-0000-0000-0000-000000000002'::uuid, 'contratos',       'rlstest/contrato-empresa-1.pdf');

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

-- Contador de asserções, num GUC de transação em vez de tabela temporária.
--
-- A primeira versão disto usava uma TEMP TABLE e um SELECT nela no fim. Os
-- INSERTs funcionavam (centenas deles), mas o SELECT final de topo falhava com
-- 42P01 "relation resultado_ensaio does not exist" — pelo visto o SQL Editor
-- do Supabase executa o último statement por fora da transação onde a temp
-- table vive. GUC de transação não tem esse problema: não é relação, não
-- depende de search_path e não depende de a temp table existir.
--
-- As funções abaixo são SECURITY INVOKER de propósito: elas rodam como
-- `authenticated` para que o EXECUTE interno sofra o RLS.
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

-- RLS não dá erro em UPDATE/DELETE: filtra em silêncio. O sinal é ROW_COUNT.
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

CREATE OR REPLACE FUNCTION pg_temp.afeta(_sql text, _esperado bigint, _msg text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE _sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM _esperado THEN
    PERFORM pg_temp.falha(format('%s (esperava %s linha(s), afetou %s)', _msg, _esperado, n));
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

-- Daqui para baixo nada roda como superusuário.
SET LOCAL ROLE authenticated;

-- ###########################################################################
-- ##  TESTES
-- ###########################################################################

-- --- 0) Classificação de cargo --------------------------------------------
DO $$
BEGIN
  IF NOT public.eh_equipe_interna('11111111-1111-1111-1111-111111111111')
     THEN PERFORM pg_temp.falha('Membro deveria ser equipe interna'); END IF;
  IF NOT public.eh_equipe_interna('33333333-3333-3333-3333-333333333333')
     THEN PERFORM pg_temp.falha('Admin deveria ser equipe interna'); END IF;
  IF NOT public.eh_equipe_interna('66666666-6666-6666-6666-666666666666')
     THEN PERFORM pg_temp.falha('Supervisor deveria ser equipe interna'); END IF;
  IF public.eh_equipe_interna('55555555-5555-5555-5555-555555555555')
     THEN PERFORM pg_temp.falha('Cliente NAO deveria ser equipe interna'); END IF;
  IF public.eh_equipe_interna('44444444-4444-4444-4444-444444444444')
     THEN PERFORM pg_temp.falha('conta demandante NAO deveria ser equipe interna'); END IF;
  PERFORM pg_temp.ok('eh_equipe_interna: Admin/Membro/Supervisor internos, Cliente externo');

  -- O furo que motivou tudo: tem_perfil aceita o Cliente.
  IF NOT public.tem_perfil('55555555-5555-5555-5555-555555555555')
     THEN PERFORM pg_temp.falha('tem_perfil deveria aceitar o Cliente'); END IF;
  PERFORM pg_temp.ok('confirmado: tem_perfil aceita o Cliente, eh_equipe_interna nao');
END
$$;

-- --- 1) Lembrete pessoal de A: B não vê, não altera, nem o checklist ------
DO $$
BEGIN
  PERFORM pg_temp.como('22222222-2222-2222-2222-222222222222');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefas
        WHERE id = 'aaaa0001-0000-0000-0000-000000000001'$q$,
    0, 'B nao ve o lembrete pessoal de A');

  PERFORM pg_temp.sem_efeito(
    $q$UPDATE public.tarefas SET titulo = 'invadido'
        WHERE id = 'aaaa0001-0000-0000-0000-000000000001'$q$,
    'B nao altera o lembrete pessoal de A');

  PERFORM pg_temp.sem_efeito(
    $q$DELETE FROM public.tarefas
        WHERE id = 'aaaa0001-0000-0000-0000-000000000001'$q$,
    'B nao exclui o lembrete pessoal de A');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefa_checklist_itens
        WHERE id = 'cccc0001-0000-0000-0000-000000000001'$q$,
    0, 'B nao ve o checklist do lembrete pessoal de A');

  PERFORM pg_temp.sem_efeito(
    $q$UPDATE public.tarefa_checklist_itens SET texto = 'invadido'
        WHERE id = 'cccc0001-0000-0000-0000-000000000001'$q$,
    'B nao altera o checklist do lembrete pessoal de A');

  PERFORM pg_temp.barrado(
    $q$INSERT INTO public.tarefa_checklist_itens (tarefa_id, texto)
       VALUES ('aaaa0001-0000-0000-0000-000000000001', 'plantado por B')$q$,
    'B nao cria checklist no lembrete pessoal de A');

  -- Comentário herda a mesma visibilidade (parte 2).
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.comentarios_tarefa
        WHERE id = 'c0de0001-0000-0000-0000-000000000001'$q$,
    0, 'B nao ve o comentario do lembrete pessoal de A');

  PERFORM pg_temp.barrado(
    $q$INSERT INTO public.comentarios_tarefa (tarefa_id, usuario_id, conteudo)
       VALUES ('aaaa0001-0000-0000-0000-000000000001',
               '22222222-2222-2222-2222-222222222222', 'plantado por B')$q$,
    'B nao comenta no lembrete pessoal de A');

  -- Contraprova: A vê o que é dele.
  PERFORM pg_temp.como('11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefa_checklist_itens
        WHERE id = 'cccc0001-0000-0000-0000-000000000001'$q$,
    1, 'A ve o checklist do proprio lembrete');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.comentarios_tarefa
        WHERE id = 'c0de0001-0000-0000-0000-000000000001'$q$,
    1, 'A ve o comentario do proprio lembrete');
END
$$;

-- --- 2) Tarefa de admin: não-admin fora; Admin e Supervisor dentro --------
DO $$
BEGIN
  PERFORM pg_temp.como('22222222-2222-2222-2222-222222222222');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefas
        WHERE id = 'aaaa0003-0000-0000-0000-000000000003'$q$,
    0, 'B nao ve a tarefa do admin');

  -- O buraco que o FOR ALL fecha: antes da migration este UPDATE passava.
  PERFORM pg_temp.sem_efeito(
    $q$UPDATE public.tarefas SET titulo = 'invadido'
        WHERE id = 'aaaa0003-0000-0000-0000-000000000003'$q$,
    'B nao altera a tarefa do admin');

  PERFORM pg_temp.sem_efeito(
    $q$DELETE FROM public.tarefas
        WHERE id = 'aaaa0003-0000-0000-0000-000000000003'$q$,
    'B nao exclui a tarefa do admin');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefa_checklist_itens
        WHERE id = 'cccc0003-0000-0000-0000-000000000003'$q$,
    0, 'B nao ve o checklist da tarefa do admin');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.comentarios_tarefa
        WHERE id = 'c0de0003-0000-0000-0000-000000000003'$q$,
    0, 'B nao ve o comentario da tarefa do admin');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefa_responsaveis
        WHERE tarefa_id = 'aaaa0003-0000-0000-0000-000000000003'$q$,
    0, 'B nao ve os responsaveis da tarefa do admin');

  PERFORM pg_temp.como('11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefas
        WHERE id = 'aaaa0003-0000-0000-0000-000000000003'$q$,
    0, 'nem A, que criou a tarefa do admin, continua vendo ela');

  PERFORM pg_temp.como('33333333-3333-3333-3333-333333333333');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefas
        WHERE id = 'aaaa0003-0000-0000-0000-000000000003'$q$,
    1, 'o Admin ve a tarefa do admin');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.comentarios_tarefa
        WHERE id = 'c0de0003-0000-0000-0000-000000000003'$q$,
    1, 'o Admin ve o comentario da tarefa do admin');

  -- is_admin() inclui Supervisor: decisão confirmada.
  PERFORM pg_temp.como('66666666-6666-6666-6666-666666666666');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefas
        WHERE id = 'aaaa0003-0000-0000-0000-000000000003'$q$,
    1, 'o Supervisor ve a tarefa do admin');
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.tarefa_checklist_itens
        WHERE id = 'cccc0003-0000-0000-0000-000000000003'$q$,
    1, 'o Supervisor ve o checklist da tarefa do admin');
  PERFORM pg_temp.afeta(
    $q$UPDATE public.tarefas SET titulo = 'editado pelo supervisor'
        WHERE id = 'aaaa0003-0000-0000-0000-000000000003'$q$,
    1, 'o Supervisor edita a tarefa do admin');
END
$$;

-- --- 3) Projetos e pastas são da equipe interna toda ----------------------
DO $$
BEGIN
  PERFORM pg_temp.como('22222222-2222-2222-2222-222222222222');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.projetos
        WHERE id = 'bbbb0001-0000-0000-0000-000000000001'$q$,
    1, 'B le o projeto de A');

  PERFORM pg_temp.afeta(
    $q$UPDATE public.projetos SET nome = 'renomeado por B'
        WHERE id = 'bbbb0001-0000-0000-0000-000000000001'$q$,
    1, 'B renomeia o projeto de A');

  PERFORM pg_temp.afeta(
    $q$UPDATE public.projetos SET nome = 'legado renomeado por B'
        WHERE id = 'bbbb0002-0000-0000-0000-000000000002'$q$,
    1, 'B renomeia o projeto legado com criado_por NULL');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.pastas_links
        WHERE id = 'dddd0001-0000-0000-0000-000000000001'$q$,
    1, 'B le a pasta de A');

  PERFORM pg_temp.afeta(
    $q$UPDATE public.pastas_links SET nome = 'renomeada por B'
        WHERE id = 'dddd0001-0000-0000-0000-000000000001'$q$,
    1, 'B renomeia a pasta de A');

  PERFORM pg_temp.afeta(
    $q$INSERT INTO public.pastas_links_itens (pasta_id, url)
       VALUES ('dddd0001-0000-0000-0000-000000000001', 'https://adicionado-por-b.local')$q$,
    1, 'B adiciona item na pasta de A');

  PERFORM pg_temp.conta(
    $q$WITH i AS (
         INSERT INTO public.projetos (nome) VALUES ('projeto de B sem criado_por explicito')
         RETURNING criado_por)
       SELECT count(*) FROM i
        WHERE criado_por = '22222222-2222-2222-2222-222222222222'$q$,
    1, 'DEFAULT de projetos.criado_por estampa o auth.uid() de quem insere');

  -- Exclusões por último, para não derrubar as asserções acima.
  PERFORM pg_temp.afeta(
    $q$DELETE FROM public.pastas_links_itens
        WHERE id = 'eeee0001-0000-0000-0000-000000000001'$q$,
    1, 'B exclui item da pasta de A');

  PERFORM pg_temp.afeta(
    $q$DELETE FROM public.pastas_links
        WHERE id = 'dddd0001-0000-0000-0000-000000000001'$q$,
    1, 'B exclui a pasta de A');

  PERFORM pg_temp.afeta(
    $q$DELETE FROM public.projetos
        WHERE id = 'bbbb0001-0000-0000-0000-000000000001'$q$,
    1, 'B exclui o projeto de A');
END
$$;

-- --- 4) Membro continua lendo os perfis da equipe -------------------------
DO $$
BEGIN
  PERFORM pg_temp.como('11111111-1111-1111-1111-111111111111');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios
        WHERE email LIKE '%@rlstest.local'$q$,
    5, 'A (Membro) le os 5 perfis de teste da equipe, inclusive o do Cliente');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios
        WHERE id = '22222222-2222-2222-2222-222222222222'$q$,
    1, 'A (Membro) le o perfil de B');

  -- Filtrado pelos ids de fixture: a tabela tem os clientes reais da agência,
  -- e um Membro vê todos. Contar a tabela inteira aqui daria falso negativo.
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.clientes
        WHERE id IN ('ffff0001-0000-0000-0000-000000000001',
                     'ffff0002-0000-0000-0000-000000000002')$q$,
    2, 'A (Membro) ve as duas empresas de teste');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.configuracoes_planos
        WHERE id = '91a40001-0000-0000-0000-000000000001'$q$,
    1, 'A (Membro) le os planos');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.ideias
        WHERE id = 'a1de0001-0000-0000-0000-000000000001'$q$,
    1, 'A (Membro) le as ideias');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.comentarios_tarefa
        WHERE id = 'c0de0002-0000-0000-0000-000000000002'$q$,
    1, 'A (Membro) le comentario de tarefa geral');

  -- Storage: o Membro continua baixando a imagem de aniversariante.
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM storage.objects
        WHERE id = '57060001-0000-0000-0000-000000000001'$q$,
    1, 'A (Membro) le o objeto do bucket aniversariantes');
END
$$;

-- --- 4b) Storage, bucket 'contratos' ------------------------------------
-- Decisão [B]: equipe interna lê e sobe; só is_admin atualiza e apaga.
DO $$
BEGIN
  -- Membro: lê e sobe, mas NÃO apaga nem atualiza.
  PERFORM pg_temp.como('11111111-1111-1111-1111-111111111111');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM storage.objects
        WHERE id = '57060002-0000-0000-0000-000000000002'$q$,
    1, 'A (Membro) le o contrato');

  -- Sobe um objeto NOVO (57060011). O contrato 57060002 fica intocado de
  -- propósito: as seções 5 e 6 precisam dele existindo para provar que CLI e
  -- SEM não o alcançam. Apagar aqui daria falso positivo lá.
  PERFORM pg_temp.afeta(
    $q$INSERT INTO storage.objects (id, bucket_id, name)
       VALUES ('57060011-0000-0000-0000-000000000011',
               'contratos', 'rlstest/subido-pelo-membro.pdf')$q$,
    1, 'A (Membro) sobe contrato');

  -- DELETE e UPDATE em storage.objects NÃO são testáveis por SQL. O Supabase
  -- tem um trigger storage.protect_delete() que levanta 42501 ("Direct
  -- deletion from storage tables is not allowed. Use the Storage API instead.")
  -- em QUALQUER delete direto, antes de a semântica de RLS ficar observável.
  -- Então:
  --   - a asserção negativa (Membro/CLI/SEM não apagam) passaria sempre, por
  --     causa da guarda, e provaria nada sobre a policy;
  --   - a asserção positiva (Admin apaga) é impossível de exercitar aqui.
  -- As duas viraram verificação DECLARATIVA na seção 7: confere-se em
  -- pg_policies que "Contratos: gestao exclui" e "Contratos: gestao atualiza"
  -- existem e usam is_admin. A policy continua valendo de verdade, porque o
  -- caminho real do app é a Storage API, e ela aplica RLS como `authenticated`.
  PERFORM pg_temp.ok(
    'DELETE/UPDATE de storage.objects nao exercitados: bloqueados por '
    'storage.protect_delete(); regra conferida em pg_policies na secao 7');

  -- O Admin também sobe, porque é equipe interna.
  PERFORM pg_temp.como('33333333-3333-3333-3333-333333333333');
  PERFORM pg_temp.afeta(
    $q$INSERT INTO storage.objects (id, bucket_id, name)
       VALUES ('57060012-0000-0000-0000-000000000012',
               'contratos', 'rlstest/subido-pelo-admin.pdf')$q$,
    1, 'o Admin sobe contrato');
END
$$;

-- --- 5) CLI (cargo Cliente): nada de interno, só o que é dele ------------
DO $$
DECLARE
  t text;
  n bigint;
  tabelas text[] := ARRAY[
    'tarefas', 'tarefa_responsaveis', 'tarefa_checklist_itens',
    'comentarios_tarefa', 'projetos', 'pastas_links', 'pastas_links_itens',
    'ideias', 'configuracoes_planos', 'organograma_nos', 'compartilhamentos',
    'murais', 'mural_quadros', 'mural_itens',
    'aniversariantes', 'aniversariante_visualizacoes'
  ];
BEGIN
  PERFORM pg_temp.como('55555555-5555-5555-5555-555555555555');

  FOREACH t IN ARRAY tabelas
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 0 THEN
      PERFORM pg_temp.falha(format('CLI leu %s linha(s) de %s', n, t));
    END IF;
    PERFORM pg_temp.ok(format('CLI nao le nada de %s', t));
  END LOOP;

  -- Preço de plano: a razão de configuracoes_planos estar na lista.
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.configuracoes_planos
        WHERE valor_mensal IS NOT NULL$q$,
    0, 'CLI nao le preco de plano');

  -- perfis_usuarios: só a própria linha.
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios$q$,
    1, 'CLI ve exatamente 1 linha de perfis_usuarios');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios
        WHERE id = '55555555-5555-5555-5555-555555555555'$q$,
    1, 'CLI ve a propria linha em perfis_usuarios (_authenticated.tsx nao desloga)');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.perfis_usuarios
        WHERE id = '11111111-1111-1111-1111-111111111111'$q$,
    0, 'CLI nao ve o perfil de outra pessoa');

  -- clientes: só a própria empresa (nota A da parte 1).
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.clientes$q$,
    1, 'CLI ve exatamente 1 linha de clientes');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.clientes
        WHERE id = 'ffff0001-0000-0000-0000-000000000001'$q$,
    1, 'CLI ve a propria empresa (o portal monta o card "Sua empresa")');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM public.clientes
        WHERE id = 'ffff0002-0000-0000-0000-000000000002'$q$,
    0, 'CLI nao ve a empresa de outro cliente');

  -- O que o getMyPortalContext faz de verdade: própria linha + join clientes.
  PERFORM pg_temp.conta(
    $q$SELECT count(*)
         FROM public.perfis_usuarios p
         JOIN public.clientes c ON c.id = p.cliente_id
        WHERE p.id = '55555555-5555-5555-5555-555555555555'$q$,
    1, 'getMyPortalContext: CLI resolve nome_empresa e plano da propria empresa');

  -- Escrita: nada.
  --
  -- Este é `barrado` e não `sem_efeito`, e a diferença importa. A linha da
  -- própria empresa É visível para o CLI, porque o USING da policy
  -- "Equipe interna ou a propria empresa" tem o braço `id = meu_cliente_id()`.
  -- Então o UPDATE seleciona a linha, e só aí o WITH CHECK — que exige
  -- eh_equipe_interna, sem braço de cliente_id — recusa. RLS levanta 42501
  -- ("new row violates row-level security policy") em falha de WITH CHECK, e
  -- filtra em silêncio só quando a falha é no USING.
  --
  -- Recusar com erro é mais forte que filtrar: a escrita não passa e o cliente
  -- fica sabendo. É de propósito que a policy esteja assim.
  PERFORM pg_temp.barrado(
    $q$UPDATE public.clientes SET nome_empresa = 'invadido'
        WHERE id = 'ffff0001-0000-0000-0000-000000000001'$q$,
    'CLI nao altera nem a propria empresa (WITH CHECK recusa com 42501)');

  PERFORM pg_temp.sem_efeito(
    $q$UPDATE public.projetos SET nome = 'invadido pelo cliente'
        WHERE id = 'bbbb0002-0000-0000-0000-000000000002'$q$,
    'CLI nao altera projeto');

  PERFORM pg_temp.barrado(
    $q$INSERT INTO public.projetos (nome) VALUES ('do cliente')$q$,
    'CLI nao cria projeto');

  PERFORM pg_temp.barrado(
    $q$INSERT INTO public.tarefas (titulo, tipo, escopo)
       VALUES ('do cliente', 'tarefa', 'geral')$q$,
    'CLI nao cria tarefa');

  PERFORM pg_temp.barrado(
    $q$INSERT INTO public.comentarios_tarefa (tarefa_id, usuario_id, conteudo)
       VALUES ('aaaa0002-0000-0000-0000-000000000002',
               '55555555-5555-5555-5555-555555555555', 'do cliente')$q$,
    'CLI nao comenta em tarefa');

  PERFORM pg_temp.barrado(
    $q$INSERT INTO public.ideias (titulo, criado_por)
       VALUES ('do cliente', '55555555-5555-5555-5555-555555555555')$q$,
    'CLI nao cria ideia');

  -- Storage: era o furo que sobrava. Fechar só a tabela aniversariantes nao
  -- bastava, porque o Cliente podia baixar a imagem direto do bucket.
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM storage.objects
        WHERE id = '57060001-0000-0000-0000-000000000001'$q$,
    0, 'CLI nao le o objeto do bucket aniversariantes');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM storage.objects
        WHERE bucket_id = 'aniversariantes'$q$,
    0, 'CLI nao le NENHUM objeto do bucket aniversariantes');

  -- contratos: era o pior furo. Antes da parte 3 o CLI lia e APAGAVA contrato
  -- assinado de todos os clientes da agencia.
  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM storage.objects
        WHERE id = '57060002-0000-0000-0000-000000000002'$q$,
    0, 'CLI nao le o contrato');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM storage.objects
        WHERE bucket_id = 'contratos'$q$,
    0, 'CLI nao le NENHUM contrato');

  PERFORM pg_temp.barrado(
    $q$INSERT INTO storage.objects (bucket_id, name)
       VALUES ('contratos', 'rlstest/subido-pelo-cliente.pdf')$q$,
    'CLI nao sobe contrato');

  -- DELETE/UPDATE de contrato pelo CLI: ver a explicação na seção 4b. A guarda
  -- storage.protect_delete() barra todo mundo antes do RLS, então testar aqui
  -- daria um falso "passou". A regra está conferida em pg_policies na seção 7.
END
$$;

-- --- 6) SEM (conta demandante, sem perfil): nada em lugar nenhum ---------
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  PERFORM pg_temp.como('44444444-4444-4444-4444-444444444444');

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
      PERFORM pg_temp.falha(format('SEM leu %s linha(s) de %s', n, t));
    END IF;
    PERFORM pg_temp.ok(format('SEM nao le nada de %s', t));
  END LOOP;

  -- perfis_usuarios vazio para o SEM é o que sustenta o invite-only:
  -- _authenticated.tsx:24 recebe null e faz signOut com "Acesso negado".
  PERFORM pg_temp.ok('SEM continua barrado no invite-only (perfis_usuarios devolve vazio)');

  PERFORM pg_temp.barrado(
    $q$INSERT INTO public.projetos (nome) VALUES ('do intruso')$q$,
    'SEM nao cria projeto');

  PERFORM pg_temp.barrado(
    $q$INSERT INTO public.tarefas (titulo, tipo, escopo)
       VALUES ('do intruso', 'tarefa', 'geral')$q$,
    'SEM nao cria tarefa');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM storage.objects
        WHERE bucket_id = 'aniversariantes'$q$,
    0, 'SEM nao le nenhum objeto do bucket aniversariantes');

  PERFORM pg_temp.conta(
    $q$SELECT count(*) FROM storage.objects
        WHERE bucket_id = 'contratos'$q$,
    0, 'SEM nao le nenhum contrato');

  PERFORM pg_temp.barrado(
    $q$INSERT INTO storage.objects (bucket_id, name)
       VALUES ('contratos', 'rlstest/subido-pelo-intruso.pdf')$q$,
    'SEM nao sobe contrato');
END
$$;

-- --- 7) Toda tabela da lista tem o RESTRICTIVE de equipe interna ---------
RESET ROLE;

DO $$
DECLARE
  t text;
  n int;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'configuracoes_planos', 'pastas_links', 'pastas_links_itens',
    'tarefa_checklist_itens', 'ideias', 'projetos',
    'tarefas', 'tarefa_responsaveis',
    'comentarios_tarefa', 'organograma_nos', 'compartilhamentos',
    'murais', 'mural_quadros', 'mural_itens',
    'aniversariantes', 'aniversariante_visualizacoes'
  ]
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
  END LOOP;

  -- clientes usa a variante que preserva o portal (nota A da parte 1).
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'clientes'
     AND permissive = 'RESTRICTIVE'
     AND policyname = 'Equipe interna ou a propria empresa';
  IF n <> 1 THEN
    PERFORM pg_temp.falha(format(
      'clientes deveria ter a RESTRICTIVE "Equipe interna ou a propria empresa", tem %s', n));
  END IF;
  PERFORM pg_temp.ok('clientes tem a RESTRICTIVE que preserva o portal');

  -- perfis_usuarios NAO deve ter o RESTRICTIVE em bloco: deslogaria o Cliente.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'perfis_usuarios'
     AND permissive = 'RESTRICTIVE'
     AND policyname = 'Exige equipe interna';
  IF n <> 0 THEN
    PERFORM pg_temp.falha(
      'perfis_usuarios NAO pode ter RESTRICTIVE "Exige equipe interna": deslogaria o Cliente');
  END IF;
  PERFORM pg_temp.ok('perfis_usuarios sem RESTRICTIVE em bloco, como planejado');

  -- A policy de storage tem que estar com o corte de cargo.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'Aniversariantes: leitura autenticada'
     AND qual LIKE '%eh_equipe_interna%';
  IF n <> 1 THEN
    PERFORM pg_temp.falha(
      'a policy de storage do bucket aniversariantes nao esta usando eh_equipe_interna');
  END IF;
  PERFORM pg_temp.ok('policy de storage do bucket aniversariantes com corte de cargo');

  -- Nenhuma policy do bucket 'contratos' pode ter sobrado aberta.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') LIKE '%contratos%'
          OR coalesce(with_check, '') LIKE '%contratos%')
     AND coalesce(qual, '')       NOT LIKE '%eh_equipe_interna%'
     AND coalesce(with_check, '') NOT LIKE '%eh_equipe_interna%'
     AND coalesce(qual, '')       NOT LIKE '%is_admin%'
     AND coalesce(with_check, '') NOT LIKE '%is_admin%';
  IF n <> 0 THEN
    PERFORM pg_temp.falha(format(
      '%s policy(s) do bucket contratos sem corte de cargo', n));
  END IF;
  PERFORM pg_temp.ok('nenhuma policy do bucket contratos sem corte de cargo');

  -- As quatro novas do bucket contratos existem.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('Contratos: equipe interna le',
                        'Contratos: equipe interna envia',
                        'Contratos: gestao atualiza',
                        'Contratos: gestao exclui');
  IF n <> 4 THEN
    PERFORM pg_temp.falha(format(
      'esperava as 4 policies novas do bucket contratos, achei %s', n));
  END IF;
  PERFORM pg_temp.ok('as 4 policies novas do bucket contratos estao no lugar');

  -- SELECT e INSERT do bucket contratos: corte de equipe interna.
  -- Estas duas TAMBEM foram exercitadas de verdade nas secoes 4b, 5 e 6.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'Contratos: equipe interna le'
     AND cmd = 'SELECT'
     AND qual LIKE '%eh_equipe_interna%';
  IF n <> 1 THEN
    PERFORM pg_temp.falha('"Contratos: equipe interna le" nao esta em SELECT com eh_equipe_interna');
  END IF;
  PERFORM pg_temp.ok('contratos SELECT: eh_equipe_interna');

  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'Contratos: equipe interna envia'
     AND cmd = 'INSERT'
     AND with_check LIKE '%eh_equipe_interna%';
  IF n <> 1 THEN
    PERFORM pg_temp.falha('"Contratos: equipe interna envia" nao esta em INSERT com eh_equipe_interna');
  END IF;
  PERFORM pg_temp.ok('contratos INSERT: eh_equipe_interna');

  -- UPDATE e DELETE: esta é a ÚNICA prova possível, porque
  -- storage.protect_delete() impede exercitar delete direto por SQL.
  -- Exijo is_admin nas DUAS pontas do UPDATE (a policy antiga tinha with_check
  -- null, que era o furo de mover o objeto para fora do bucket).
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'Contratos: gestao atualiza'
     AND cmd = 'UPDATE'
     AND qual       LIKE '%is_admin%'
     AND with_check LIKE '%is_admin%';
  IF n <> 1 THEN
    PERFORM pg_temp.falha('"Contratos: gestao atualiza" precisa de is_admin em USING e em WITH CHECK');
  END IF;
  PERFORM pg_temp.ok('contratos UPDATE: is_admin nas duas pontas (declarativo)');

  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'Contratos: gestao exclui'
     AND cmd = 'DELETE'
     AND qual LIKE '%is_admin%';
  IF n <> 1 THEN
    PERFORM pg_temp.falha('"Contratos: gestao exclui" nao esta em DELETE com is_admin');
  END IF;
  PERFORM pg_temp.ok('contratos DELETE: is_admin (declarativo)');

  -- E nenhuma policy de contratos pode ter ficado com cmd = ALL, que
  -- reintroduziria delete para quem não é admin.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND cmd = 'ALL'
     AND (coalesce(qual, '') LIKE '%contratos%'
          OR coalesce(with_check, '') LIKE '%contratos%');
  IF n <> 0 THEN
    PERFORM pg_temp.falha(format(
      '%s policy(s) FOR ALL citando contratos: separe por operacao', n));
  END IF;
  PERFORM pg_temp.ok('nenhuma policy FOR ALL no bucket contratos');

  -- treinamentos-pdfs tem que seguir SEM policy alguma.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') LIKE '%treinamentos-pdfs%'
          OR coalesce(with_check, '') LIKE '%treinamentos-pdfs%');
  IF n <> 0 THEN
    PERFORM pg_temp.falha(format(
      'treinamentos-pdfs deveria seguir sem policy, achei %s', n));
  END IF;
  PERFORM pg_temp.ok('treinamentos-pdfs segue sem policy (o bucket nem existe mais)');
END
$$;

-- ###########################################################################
-- ##  SINAL DE SUCESSO
-- ##
-- ##  Este SELECT é de literais e de um GUC de transação: não lê nenhuma
-- ##  tabela, temporária ou não. Se ele aparecer, o ensaio passou inteiro,
-- ##  porque QUALQUER asserção que falhasse teria levantado exceção e abortado
-- ##  a transação antes de chegar aqui.
-- ##
-- ##  Sucesso -> uma linha com resultado = 'ENSAIO OK'.
-- ##  Falha   -> erro vermelho "FALHOU: <descricao>" e nenhuma linha.
-- ##
-- ##  A coluna assercoes_passaram pode vir "(contador indisponivel)" se o
-- ##  editor rodar este statement fora da transação. Isso NÃO é falha: o sinal
-- ##  é a linha existir.
-- ###########################################################################

SELECT 'ENSAIO OK' AS resultado,
       coalesce(nullif(current_setting('ensaio.assercoes', true), ''),
                '(contador indisponivel)') AS assercoes_passaram,
       'Nenhuma assercao falhou: qualquer falha abortaria a transacao com "FALHOU: ...". ROLLBACK a seguir, nada foi gravado.' AS observacao;

ROLLBACK;
