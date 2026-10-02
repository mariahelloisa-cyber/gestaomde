-- ROLLBACK das três migrations de RLS, para colar no SQL Editor do Supabase.
--
--   20261002170000_rls_endurecer_tabelas_abertas.sql
--   20261002180000_rls_equipe_interna_resto.sql
--   20261002190000_rls_storage_buckets.sql
--
-- Roda em UMA transação e termina em COMMIT. Se qualquer passo falhar, nada é
-- aplicado.
--
-- ===========================================================================
-- !! O QUE ESTE SCRIPT GARANTE, E O QUE NÃO GARANTA
-- !!
-- !! Ele restaura o COMPORTAMENTO anterior, não necessariamente o estado
-- !! byte-a-byte. Três níveis de confiança, marcados em cada seção:
-- !!
-- !!   [EXATO]    vem do pg_policies ao vivo de storage.objects que você
-- !!              colou. Nome, cmd, roles e condição são os verdadeiros.
-- !!
-- !!   [INFERIDO] a condição vem do arquivo de migration que criou a policy,
-- !!              não de leitura do banco. Se produção divergia do arquivo,
-- !!              isto restaura o arquivo, não o que estava rodando.
-- !!
-- !!   [NOME NOVO] comportamento idêntico, NOME diferente do original. As
-- !!              policies abertas que a parte 1 removeu foram encontradas por
-- !!              CONDIÇÃO, não por nome — nunca soubemos os nomes delas. O
-- !!              efeito é o mesmo (acesso aberto para authenticated na mesma
-- !!              operação), só o rótulo muda.
-- !!
-- !! PARA UM ROLLBACK EXATO, rode supabase/tests/snapshot_rls_antes_do_push.sql
-- !! ANTES do push e guarde a saída. Aquilo sim é byte-a-byte, com os nomes
-- !! verdadeiros. Este arquivo aqui é o plano B para quando ninguém capturou.
-- ===========================================================================
--
-- MESMO AVISO DE LOCK do ensaio: CREATE/DROP POLICY pega ACCESS EXCLUSIVE, e
-- como mexe em storage.objects o congelamento alcança upload e download de
-- arquivo. É rápido. Não deixe a aba aberta.

BEGIN;

-- ###########################################################################
-- ##  1) Remove tudo que as três migrations criaram
-- ###########################################################################

-- --- RESTRICTIVE "Exige equipe interna", das partes 1 e 2 ------------------
DO $do$
DECLARE
  t text;
  n int := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- parte 1
    'configuracoes_planos', 'pastas_links', 'pastas_links_itens',
    'tarefa_checklist_itens', 'ideias', 'projetos',
    'tarefas', 'tarefa_responsaveis',
    -- parte 2
    'comentarios_tarefa', 'organograma_nos', 'compartilhamentos',
    'murais', 'mural_quadros', 'mural_itens',
    'aniversariantes', 'aniversariante_visualizacoes'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Exige equipe interna" ON public.%I', t);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Removida a RESTRICTIVE "Exige equipe interna" de % tabelas.', n;
END
$do$;

-- --- Policies nomeadas da parte 1 -----------------------------------------
DROP POLICY IF EXISTS "Equipe interna gerencia projetos"        ON public.projetos;
DROP POLICY IF EXISTS "Equipe interna gerencia pastas"          ON public.pastas_links;
DROP POLICY IF EXISTS "Equipe interna gerencia itens de pasta"  ON public.pastas_links_itens;
DROP POLICY IF EXISTS "Checklist herda a visibilidade da tarefa" ON public.tarefa_checklist_itens;
DROP POLICY IF EXISTS "Equipe interna ou a propria empresa"      ON public.clientes;
DROP POLICY IF EXISTS "Equipe interna le ideias"                 ON public.ideias;
DROP POLICY IF EXISTS "Equipe interna le planos"                 ON public.configuracoes_planos;

-- --- Policies nomeadas da parte 2 -----------------------------------------
DROP POLICY IF EXISTS "Comentario herda a visibilidade da tarefa" ON public.comentarios_tarefa;

-- --- Policies da parte 3, no bucket contratos -----------------------------
DROP POLICY IF EXISTS "Contratos: equipe interna le"    ON storage.objects;
DROP POLICY IF EXISTS "Contratos: equipe interna envia" ON storage.objects;
DROP POLICY IF EXISTS "Contratos: gestao atualiza"      ON storage.objects;
DROP POLICY IF EXISTS "Contratos: gestao exclui"        ON storage.objects;

-- ###########################################################################
-- ##  2) Restaura as policies que as migrations SUBSTITUÍRAM
-- ###########################################################################

-- --- [INFERIDO] tarefas: voltar de FOR ALL para FOR SELECT ----------------
--
-- Definição conforme 20260910120000_tarefas_de_admin_so_para_admins.sql.
-- A parte 1 recriou esta policy como FOR ALL; aqui ela volta a cobrir só
-- SELECT. ATENÇÃO: isso REABRE o buraco de UPDATE/DELETE de tarefa de Admin
-- por não-admin. É o estado anterior, e é por isso que é rollback.
DROP POLICY IF EXISTS "Tarefas de Admin so para Admins" ON public.tarefas;
CREATE POLICY "Tarefas de Admin so para Admins" ON public.tarefas
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR NOT public.tarefa_de_admin(id)
  );

-- --- [INFERIDO] perfis_usuarios -------------------------------------------
-- Definição conforme 20260818162613_portal_demandas_externas.sql.
-- Reabre a leitura de TODA a equipe para o cargo Cliente.
DROP POLICY IF EXISTS "Autenticados podem ver perfis" ON public.perfis_usuarios;
CREATE POLICY "Autenticados podem ver perfis" ON public.perfis_usuarios
  FOR SELECT TO authenticated
  USING (public.tem_perfil(auth.uid()));

-- --- [INFERIDO] aniversariantes -------------------------------------------
-- Definição conforme 20261001120000_aniversariantes.sql.
DROP POLICY IF EXISTS "Equipe ve aniversariantes" ON public.aniversariantes;
CREATE POLICY "Equipe ve aniversariantes" ON public.aniversariantes
  FOR SELECT TO authenticated
  USING (public.tem_perfil(auth.uid()));

-- --- [EXATO] storage.objects, bucket aniversariantes ----------------------
-- pg_policies ao vivo: SELECT, {authenticated}, qual (bucket_id =
-- 'aniversariantes'::text), with_check null.
DROP POLICY IF EXISTS "Aniversariantes: leitura autenticada" ON storage.objects;
CREATE POLICY "Aniversariantes: leitura autenticada"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'aniversariantes'::text);

-- --- [EXATO] storage.objects, bucket contratos ----------------------------
-- As quatro, do pg_policies ao vivo. Reabre o bucket para QUALQUER
-- authenticated, incluindo o cargo Cliente, nas quatro operações.
-- Repare que a de UPDATE tinha with_check null: é assim que estava.
CREATE POLICY "Autenticados leem contratos"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'contratos'::text);

CREATE POLICY "Autenticados enviam contratos"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'contratos'::text);

CREATE POLICY "Autenticados atualizam contratos"
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'contratos'::text);

CREATE POLICY "Autenticados excluem contratos"
  ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'contratos'::text);

-- ###########################################################################
-- ##  3) Recria as policies ABERTAS que a parte 1 removeu
-- ##
-- ##  [NOME NOVO] — o comportamento é o mesmo, o nome não.
-- ##
-- ##  A parte 1 as encontrou por condição (PERMISSIVE, authenticated, qual e
-- ##  with_check literalmente 'true'), então os nomes originais nunca foram
-- ##  registrados. O cmd de cada uma vem do levantamento que você fez:
-- ##    configuracoes_planos    SELECT true
-- ##    ideias                  SELECT true
-- ##    pastas_links            ALL true/true
-- ##    pastas_links_itens      ALL true/true
-- ##    projetos                ALL true/true
-- ##    tarefa_checklist_itens  ALL true/true
-- ###########################################################################

CREATE POLICY "Autenticados leem planos (restaurada)" ON public.configuracoes_planos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados leem ideias (restaurada)" ON public.ideias
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados gerenciam pastas (restaurada)" ON public.pastas_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Autenticados gerenciam itens de pasta (restaurada)" ON public.pastas_links_itens
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Autenticados gerenciam projetos (restaurada)" ON public.projetos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Autenticados gerenciam checklist (restaurada)" ON public.tarefa_checklist_itens
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ###########################################################################
-- ##  4) Desfaz as alterações de schema
-- ###########################################################################

-- --- DEFAULT de criado_por ------------------------------------------------
-- A parte 1 fez SET DEFAULT auth.uid(). Antes disso não havia default nenhum
-- registrado nas migrations locais, e as tabelas não têm migration local, então
-- DROP DEFAULT é a melhor reconstrução possível. Se o snapshot mostrar outro
-- valor, use o do snapshot.
ALTER TABLE public.projetos     ALTER COLUMN criado_por DROP DEFAULT;
ALTER TABLE public.pastas_links ALTER COLUMN criado_por DROP DEFAULT;

-- --- ENABLE ROW LEVEL SECURITY: de propósito NÃO é desfeito ---------------
--
-- As migrations rodam ALTER TABLE ... ENABLE ROW LEVEL SECURITY em 18 tabelas,
-- como rede de segurança. Este rollback NÃO desliga nenhuma, por dois motivos:
--
--   1. Não sabemos quais já estavam ligadas. Todas as 18 tinham policies, e
--      policy sem RLS ligado não faz efeito nenhum, então quase certamente
--      todas já estavam ligadas e o ENABLE foi no-op.
--   2. Se alguma estivesse DESLIGADA e eu a desligasse aqui "de volta", o
--      risco seria assimétrico: deixar ligada mantém as policies valendo (o
--      que é o normal do projeto), enquanto desligar erraria para o lado de
--      expor a tabela inteira.
--
-- Se o app quebrar e a suspeita for exatamente isto — uma tabela que antes
-- ignorava RLS e agora não ignora mais — o snapshot capturou o estado real de
-- cada uma e tem o ALTER certo. Esta é a única diferença conhecida entre este
-- rollback e o estado byte-a-byte anterior.

-- --- Índices --------------------------------------------------------------
-- Criados com IF NOT EXISTS, então provavelmente não existiam antes. Se algum
-- já existia, este DROP o remove indevidamente — perda de performance, não de
-- dado nem de segurança, e recriar é um comando. O snapshot sabe a diferença.
DROP INDEX IF EXISTS public.idx_pastas_links_itens_pasta_id;
DROP INDEX IF EXISTS public.idx_tarefa_checklist_itens_tarefa_id;
DROP INDEX IF EXISTS public.idx_comentarios_tarefa_tarefa_id;

-- --- Funções --------------------------------------------------------------
-- Depois das policies de propósito: não dá para dropar função que uma policy
-- ainda referencia. Se algum destes DROP falhar, é porque sobrou policy
-- usando a função — veja a verificação da seção 5.
DROP FUNCTION IF EXISTS public.eh_equipe_interna(uuid);
DROP FUNCTION IF EXISTS public.meu_cliente_id();

-- ###########################################################################
-- ##  5) Verificação: o rollback tem que ter limpado tudo
-- ###########################################################################
DO $do$
DECLARE
  n int;
  r record;
BEGIN
  -- Nenhuma policy pode continuar citando as funções da parte 1.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE coalesce(qual, '') LIKE '%eh_equipe_interna%'
      OR coalesce(with_check, '') LIKE '%eh_equipe_interna%'
      OR coalesce(qual, '') LIKE '%meu_cliente_id%'
      OR coalesce(with_check, '') LIKE '%meu_cliente_id%';
  IF n <> 0 THEN
    FOR r IN
      SELECT schemaname, tablename, policyname FROM pg_policies
       WHERE coalesce(qual, '') LIKE '%eh_equipe_interna%'
          OR coalesce(with_check, '') LIKE '%eh_equipe_interna%'
          OR coalesce(qual, '') LIKE '%meu_cliente_id%'
          OR coalesce(with_check, '') LIKE '%meu_cliente_id%'
    LOOP
      RAISE WARNING 'Sobrou: %.% -> "%"', r.schemaname, r.tablename, r.policyname;
    END LOOP;
    RAISE EXCEPTION
      'ROLLBACK INCOMPLETO: % policy(s) ainda citam eh_equipe_interna ou meu_cliente_id.', n;
  END IF;

  -- As funções têm que ter saído.
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETO: public.eh_equipe_interna(uuid) ainda existe.';
  END IF;
  IF to_regprocedure('public.meu_cliente_id()') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETO: public.meu_cliente_id() ainda existe.';
  END IF;

  -- O bucket contratos tem que estar com as quatro antigas de volta.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('Autenticados leem contratos',
                        'Autenticados enviam contratos',
                        'Autenticados atualizam contratos',
                        'Autenticados excluem contratos');
  IF n <> 4 THEN
    RAISE EXCEPTION
      'ROLLBACK INCOMPLETO: esperava as 4 policies antigas de contratos, achei %.', n;
  END IF;

  -- tarefas tem que ter voltado a FOR SELECT.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'tarefas'
     AND policyname = 'Tarefas de Admin so para Admins'
     AND cmd = 'SELECT';
  IF n <> 1 THEN
    RAISE EXCEPTION
      'ROLLBACK INCOMPLETO: "Tarefas de Admin so para Admins" nao voltou para FOR SELECT.';
  END IF;

  RAISE NOTICE 'Rollback verificado: nada das tres migrations sobrou.';
END
$do$;

COMMIT;

SELECT 'ROLLBACK APLICADO' AS resultado,
       'As 3 migrations de RLS foram desfeitas. Confira pg_policies e teste o app.' AS proximo_passo,
       'ATENCAO: o estado anterior inclui os furos originais - Cliente lendo contratos, perfis da equipe e precos de plano.' AS lembrete;

-- ###########################################################################
-- ##  DEPOIS DE RODAR ISTO
-- ##
-- ##  1. O banco volta ao comportamento de antes, COM os furos de segurança
-- ##     que as migrations fechavam. Não é um estado para ficar: é para o app
-- ##     voltar a funcionar enquanto se descobre o que quebrou.
-- ##
-- ##  2. As migrations continuam registradas como aplicadas na tabela de
-- ##     histórico do Supabase. Para reaplicar depois de corrigir, ou use
-- ##     `supabase migration repair` para desmarcar, ou crie uma parte 4 com
-- ##     a correção. NÃO basta rodar `db push` de novo: ele vai achar que já
-- ##     aplicou e não fará nada.
-- ##
-- ##  3. Me diga O QUE quebrou e com qual cargo de usuário. Os suspeitos mais
-- ##     prováveis, em ordem:
-- ##       - alguma tela interna que lê `comentarios_tarefa` de tarefa que o
-- ##         usuário não enxerga (a herança da parte 2 aperta isso também para
-- ##         usuário interno, não só para Cliente);
-- ##       - algum fluxo do Cliente que leia `perfis_usuarios` de terceiro,
-- ##         além da própria linha;
-- ##       - upload de contrato por quem não é equipe interna.
-- ###########################################################################
