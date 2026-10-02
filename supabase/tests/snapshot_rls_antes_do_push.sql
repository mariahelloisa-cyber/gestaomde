-- SNAPSHOT do RLS, para rodar ANTES do `supabase db push`.
--
-- Isto não é um teste nem uma migration: é um GERADOR. Ele lê o estado atual e
-- devolve, numa coluna de texto, o script SQL que restaura exatamente esse
-- estado. Copie a coluna inteira, salve num arquivo, e esse arquivo é o seu
-- rollback EXATO — com os nomes de policy verdadeiros, as condições
-- verdadeiras, o estado de RLS verdadeiro e os defaults verdadeiros.
--
-- POR QUE ISTO EXISTE
--   O rollback_rls.sql escrito à mão restaura o COMPORTAMENTO, mas não tem como
--   restaurar o que ninguém capturou: os NOMES das policies abertas que a
--   parte 1 remove (ela as encontra por condição, justamente porque os nomes
--   divergiram entre migrations e produção neste projeto), nem o estado de RLS
--   de cada tabela antes da mudança. Este snapshot captura tudo isso.
--
-- COMO USAR
--   1. Rode este arquivo no SQL Editor ANTES do push.
--   2. Copie a coluna `script_de_rollback` inteira (são várias linhas).
--   3. Salve como supabase/tests/rollback_rls_exato_<data>.sql.
--   4. Guarde. Se o app quebrar depois do push, cole esse arquivo no SQL
--      Editor, envolto em BEGIN; ... COMMIT;.
--
-- É só leitura: não altera nada e não precisa de transação.

WITH alvo(sch, tbl) AS (
  VALUES
    -- tocadas pela parte 1
    ('public', 'configuracoes_planos'),
    ('public', 'pastas_links'),
    ('public', 'pastas_links_itens'),
    ('public', 'tarefa_checklist_itens'),
    ('public', 'ideias'),
    ('public', 'projetos'),
    ('public', 'tarefas'),
    ('public', 'tarefa_responsaveis'),
    ('public', 'clientes'),
    -- tocadas pela parte 2
    ('public', 'comentarios_tarefa'),
    ('public', 'perfis_usuarios'),
    ('public', 'organograma_nos'),
    ('public', 'compartilhamentos'),
    ('public', 'murais'),
    ('public', 'mural_quadros'),
    ('public', 'mural_itens'),
    ('public', 'aniversariantes'),
    ('public', 'aniversariante_visualizacoes'),
    -- tocada pelas partes 2 e 3
    ('storage', 'objects')
),

partes AS (

  -- =====================================================================
  -- 0) Cabeçalho
  -- =====================================================================
  SELECT 0 AS secao, '' AS ord,
         '-- ROLLBACK EXATO do RLS, gerado em ' || now()::text AS linha
  UNION ALL
  SELECT 0, ' a',
         '-- Gerado por supabase/tests/snapshot_rls_antes_do_push.sql'
  UNION ALL
  SELECT 0, ' b',
         '-- Cole no SQL Editor envolto em BEGIN; ... COMMIT;'
  UNION ALL
  SELECT 0, ' c', ''

  -- =====================================================================
  -- 1) Remove TODA policy que exista nas tabelas-alvo no momento do
  --    rollback. Assim o estado final não depende do que a migration criou.
  -- =====================================================================
  UNION ALL
  SELECT 1, '', '-- 1) Limpa as policies atuais das tabelas-alvo'
  UNION ALL
  SELECT 1, p.schemaname || '.' || p.tablename || '.' || p.policyname,
         format('DROP POLICY IF EXISTS %I ON %I.%I;',
                p.policyname, p.schemaname, p.tablename)
    FROM pg_policies p
    JOIN alvo a ON a.sch = p.schemaname AND a.tbl = p.tablename
  UNION ALL
  SELECT 1, 'zz', ''

  -- =====================================================================
  -- 2) Recria as policies EXATAMENTE como estão agora.
  -- =====================================================================
  UNION ALL
  SELECT 2, '', '-- 2) Recria as policies como estavam antes do push'
  UNION ALL
  SELECT 2, p.schemaname || '.' || p.tablename || '.' || p.policyname,
         format(
           'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
           p.policyname, p.schemaname, p.tablename,
           p.permissive,
           p.cmd,
           (SELECT string_agg(
                     CASE WHEN r = 'public' THEN 'public' ELSE quote_ident(r) END,
                     ', ' ORDER BY r)
                FROM unnest(p.roles) AS r),
           CASE WHEN p.qual IS NULL THEN ''
                ELSE ' USING (' || p.qual || ')' END,
           CASE WHEN p.with_check IS NULL THEN ''
                ELSE ' WITH CHECK (' || p.with_check || ')' END)
    FROM pg_policies p
    JOIN alvo a ON a.sch = p.schemaname AND a.tbl = p.tablename
  UNION ALL
  SELECT 2, 'zz', ''

  -- =====================================================================
  -- 3) Estado do RLS por tabela, como está agora.
  -- =====================================================================
  UNION ALL
  SELECT 3, '', '-- 3) Estado de ROW LEVEL SECURITY por tabela'
  UNION ALL
  SELECT 3, a.sch || '.' || a.tbl,
         format('ALTER TABLE %I.%I %s ROW LEVEL SECURITY;',
                a.sch, a.tbl,
                CASE WHEN c.relrowsecurity THEN 'ENABLE' ELSE 'DISABLE' END)
    FROM alvo a
    JOIN pg_namespace n ON n.nspname = a.sch
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = a.tbl
  UNION ALL
  SELECT 3, 'zz', ''

  -- =====================================================================
  -- 4) DEFAULT das colunas que a parte 1 altera.
  -- =====================================================================
  UNION ALL
  SELECT 4, '', '-- 4) DEFAULT de criado_por'
  UNION ALL
  SELECT 4, c.table_name || '.' || c.column_name,
         format('ALTER TABLE public.%I ALTER COLUMN %I %s;',
                c.table_name, c.column_name,
                CASE WHEN c.column_default IS NULL
                     THEN 'DROP DEFAULT'
                     ELSE 'SET DEFAULT ' || c.column_default END)
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.column_name = 'criado_por'
     AND c.table_name IN ('projetos', 'pastas_links')
  UNION ALL
  SELECT 4, 'zz', ''

  -- =====================================================================
  -- 5) Índices que a migration cria: emite DROP só para os que NÃO
  --    existem hoje, porque esses serão criados pelo push.
  -- =====================================================================
  UNION ALL
  SELECT 5, '', '-- 5) Indices criados pelo push (so os que nao existiam antes)'
  UNION ALL
  SELECT 5, v.i, format('DROP INDEX IF EXISTS public.%I;', v.i)
    FROM (VALUES
            ('idx_pastas_links_itens_pasta_id'),
            ('idx_tarefa_checklist_itens_tarefa_id'),
            ('idx_comentarios_tarefa_tarefa_id')
         ) AS v(i)
   WHERE to_regclass('public.' || v.i) IS NULL
  UNION ALL
  SELECT 5, 'zz', ''

  -- =====================================================================
  -- 6) Funções criadas pelo push: emite DROP só para as que NÃO existem
  --    hoje. Vem depois das policies de propósito — não dá para dropar
  --    função que uma policy ainda referencia.
  -- =====================================================================
  UNION ALL
  SELECT 6, '', '-- 6) Funcoes criadas pelo push (so as que nao existiam antes)'
  UNION ALL
  SELECT 6, v.f, format('DROP FUNCTION IF EXISTS %s;', v.f)
    FROM (VALUES
            ('public.eh_equipe_interna(uuid)'),
            ('public.meu_cliente_id()')
         ) AS v(f)
   WHERE to_regprocedure(v.f) IS NULL
  UNION ALL
  SELECT 6, 'zz', ''

  -- =====================================================================
  -- 7) Resumo do que foi capturado, como comentário.
  -- =====================================================================
  UNION ALL
  SELECT 7, '',
         format('-- Capturadas %s policies em %s tabelas-alvo.',
                (SELECT count(*) FROM pg_policies p
                  JOIN alvo a ON a.sch = p.schemaname AND a.tbl = p.tablename),
                (SELECT count(*) FROM alvo))
)

SELECT linha AS script_de_rollback
  FROM partes
 ORDER BY secao, ord;
