-- Parte 3: policies de storage.objects. Aplicar DEPOIS de
-- 20261002170000 (cria eh_equipe_interna) e 20261002180000 (fecha o bucket
-- 'aniversariantes'). A guarda abaixo recusa rodar fora de ordem.
--
-- Escopo: bucket 'contratos' e limpeza do 'treinamentos-pdfs'. O bucket
-- 'aniversariantes' já foi tratado na parte 2 e não é tocado aqui.
--
-- DECISÃO [B] para 'contratos':
--   equipe interna (Admin/Membro/Supervisor) LÊ e SOBE;
--   só is_admin (Admin/Supervisor) ATUALIZA e APAGA;
--   cargo Cliente e conta sem perfil: nada.
--
-- Hoje as quatro operações do bucket 'contratos' estão abertas para QUALQUER
-- authenticated, confirmado no pg_policies ao vivo. Ou seja: um usuário com
-- cargo Cliente lê o contrato assinado de todos os clientes da agência e pode
-- APAGAR. É o furo mais grave da série.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Guarda de ordem: exige as partes 1 e 2.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2) Bucket 'contratos'.
--
--    Impacto no app, conferido linha por linha: o bucket é tocado em UM lugar
--    só, src/components/dashboard/AddClientDialog.tsx:73, que faz
--    `supabase.storage.from("contratos").upload(...)` com o client do NAVEGADOR
--    — JWT do usuário, não service role. É um upload, feito por quem cadastra
--    cliente em ClientsView. Como a policy de `public.clientes` permite
--    INSERT a qualquer usuário interno, quem cadastra cliente hoje é a equipe
--    interna inteira; manter o INSERT do bucket para a equipe interna preserva
--    exatamente esse fluxo.
--
--    LEITURA: nenhum código do app lê este bucket. Não há createSignedUrl nem
--    download apontando para 'contratos' em nenhum lugar de src/ — `contrato_url`
--    é gravado em public.clientes e nunca servido. Então restringir o SELECT à
--    equipe interna não quebra tela nenhuma; só prepara o terreno para quando
--    alguém for implementar o download.
--
--    Os nomes antigos vêm do pg_policies ao vivo, então o DROP é por nome
--    mesmo, sem adivinhação.
-- ---------------------------------------------------------------------------
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

-- A policy antiga de UPDATE tinha USING e nenhum WITH CHECK (pg_policies ao
-- vivo: with_check null). Sem WITH CHECK, um UPDATE pode mover o objeto para
-- fora do bucket ou renomeá-lo sem que a condição seja reavaliada no valor
-- novo. As duas pontas agora estão cobertas.
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

-- ---------------------------------------------------------------------------
-- 3) Bucket 'treinamentos-pdfs': o recurso inteiro já não existe.
--
--    Três consultas ao vivo, todas negativas:
--      pg_policies de storage.objects  -> nenhuma policy cita o bucket. Nem a
--        aberta de 20260611133744 ("Auth pode ler pdfs de treinamentos"), nem
--        a escopada por plano de 20260615114822
--        ("treinamentos_pdfs_select_by_plan").
--      to_regclass('public.treinamentos') -> null, a tabela não existe.
--      storage.buckets -> só 'aniversariantes', 'contratos' e 'demandas-anexos'.
--        O BUCKET 'treinamentos-pdfs' TAMBÉM NÃO EXISTE.
--
--    E "treinamentos" não aparece em nenhum arquivo de src/. Ou seja: tabela,
--    bucket, policies e frontend, tudo removido. A explicação que fecha com
--    isso é um DROP TABLE public.treinamentos CASCADE levando a policy que
--    fazia subquery nela, mais a remoção do bucket e da policy aberta.
--
--    Não há nada para fechar nem para consertar. Sem bucket não há objeto
--    (storage.objects.bucket_id é FK para storage.buckets), e sem policy o
--    acesso seria negado por padrão de qualquer forma.
--
--    Por isso NÃO criei policy de leitura: criar uma significaria recriar
--    acesso a um recurso que não existe. Se o recurso voltar, o bloco da nota
--    (D) está pronto.
--
--    O sweep abaixo é defensivo e hoje não remove nada: pega, por CONDIÇÃO e
--    não por nome, qualquer policy de storage.objects que volte a citar o
--    bucket. Serve para o caso de uma das antigas reaparecer num restore.
-- ---------------------------------------------------------------------------
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

COMMIT;

-- ---------------------------------------------------------------------------
-- NOTAS
--
-- (A) OS OUTROS BUCKETS DO pg_policies AO VIVO: NENHUM OUTRO ESTÁ ABERTO
--
--     storage.buckets ao vivo tem TRÊS buckets, e os três são privados
--     (public = false):
--
--       id                public  file_size_limit  allowed_mime_types
--       aniversariantes   false   null             null
--       contratos         false   null             null
--       demandas-anexos   false   104857600        null
--
--     Nenhum é public = true, então não há bucket servindo arquivo por URL
--     aberta. Confirmado pelo outro lado também: `getPublicUrl` não aparece
--     NENHUMA vez em src/ — todo acesso a arquivo no app é via
--     createSignedUrl (com service role) ou download autenticado. E o código
--     referencia exatamente esses três buckets, nenhum outro.
--
--     Depois das partes 2 e 3, o quadro de policies fica:
--
--       aniversariantes   SELECT -> equipe interna (parte 2)
--                         INSERT/UPDATE/DELETE -> is_admin (já estava)
--       contratos         SELECT/INSERT -> equipe interna (parte 3)
--                         UPDATE/DELETE -> is_admin (parte 3)
--       demandas-anexos   SELECT -> is_admin(uid) OR owner = uid   [fechado]
--                         UPDATE/DELETE -> is_admin               [fechado]
--                         INSERT -> {anon,authenticated}, só bucket_id  [ABERTO
--                                   DE PROPÓSITO, ver (B)]
--
--     Nenhuma policy da lista é USING(true): todas são escopadas por bucket.
--     Então não havia bucket aberto por acidente além do 'contratos', que esta
--     migration fecha.
--
-- (B) `demandas-anexos` INSERT ABERTO PARA anon: intencional, mas é um risco
--     que vale conhecer
--
--     "Demandas anexos: upload publico" permite INSERT a {anon,authenticated}
--     com a única condição `bucket_id = 'demandas-anexos'`. É o que faz o
--     portal público /demandas/nova funcionar, então NÃO mexi. Mas isso
--     significa que qualquer pessoa na internet, sem login, pode subir arquivo
--     nesse bucket à vontade — enchimento de storage e hospedagem de conteúdo
--     arbitrário. O SELECT é fechado (is_admin ou dono), então não dá para ler
--     de volta, o que limita o uso como CDN, mas não limita o enchimento.
--
--     Mitigação fica fora de RLS, e o storage.buckets ao vivo mostra que parte
--     dela JÁ existe: file_size_limit = 104857600, ou seja 100 MB por arquivo.
--     É o único dos três buckets com limite. O que falta:
--       - allowed_mime_types está null, logo aceita qualquer tipo, inclusive
--         executável e HTML;
--       - 100 MB por arquivo, sem login e sem limite de quantidade, ainda
--         permite enchimento rápido do storage;
--       - não há rate limit na rota /demandas/nova.
--     ADIADO de propósito para depois do MCP, por decisão sua. Não mexi.
--
-- (C) COMO VERIFICAR O UPDATE E O DELETE DESTE BUCKET
--
--     Não dá para exercitar por SQL. O Supabase tem um trigger
--     storage.protect_delete() que levanta 42501 ("Direct deletion from
--     storage tables is not allowed. Use the Storage API instead.") em
--     qualquer DELETE direto em storage.objects, antes de a semântica de RLS
--     aparecer. E não dá para desligar o trigger: a tabela pertence a
--     supabase_storage_admin, não ao postgres.
--
--     Isso NÃO torna as policies de UPDATE/DELETE inúteis: o caminho real do
--     app é a Storage API, que aplica RLS como `authenticated`. O que fica
--     impossível é a prova por SQL.
--
--     O ensaio cobre isso de duas formas: SELECT e INSERT são exercitados de
--     verdade (com RLS valendo), e UPDATE/DELETE são conferidos
--     declarativamente em pg_policies — existência, cmd correto e is_admin nas
--     duas pontas. Para prova de ponta a ponta do delete, só pela Storage API,
--     com um usuário Membro de teste.
--
-- (D) PARA DESTRAVAR 'treinamentos-pdfs', SE O RECURSO VOLTAR
--
--     CREATE POLICY "Treinamentos: equipe interna le"
--       ON storage.objects
--       FOR SELECT TO authenticated
--       USING (
--         bucket_id = 'treinamentos-pdfs'
--         AND public.eh_equipe_interna((select auth.uid()))
--       );
--
--     Não aplicado de propósito: hoje afrouxaria um bucket que está fechado e
--     cujo recurso não existe mais nem no banco nem no frontend.
-- ---------------------------------------------------------------------------
