-- INVENTÁRIO: tabelas que o código usa mas nenhuma migration cria.
--
-- projetos, ideias, contratos, pastas_links, pastas_links_itens e
-- tarefa_checklist_itens existem só em produção (criadas fora das migrations).
-- Este relatório mostra o que elas são de verdade, para virar migration.
--
-- Rode no SQL Editor. É SÓ LEITURA: nenhum INSERT, UPDATE, DELETE, CREATE ou
-- DROP. Uma única consulta, porque o SQL Editor só mostra o último resultado.
--
-- Uma linha por item, ordenada por tabela e seção. O que olhar primeiro:
--   1. secao '1-tabela': rls_ativo = false é acesso livre para quem tem a
--      chave pública. Tabela 'NAO EXISTE' é código lendo tabela inexistente.
--   2. secao '5-policy': qualquer policy com using/check = 'true' ou com
--      papel 'anon' / 'public' merece revisão.
--   3. secao '7-grant': grants para anon são o que o RLS precisa barrar.

WITH alvo(tbl) AS (
  VALUES ('projetos'), ('ideias'), ('contratos'), ('pastas_links'),
         ('pastas_links_itens'), ('tarefa_checklist_itens')
),

tabela AS (
  SELECT a.tbl,
         '1-tabela'::text AS secao,
         0 AS ordem,
         CASE WHEN c.oid IS NULL THEN 'NAO EXISTE' ELSE 'existe' END AS item,
         CASE WHEN c.oid IS NULL THEN ''
              ELSE 'rls_ativo = ' || c.relrowsecurity
                   || ' | rls_forcado = ' || c.relforcerowsecurity
                   || ' | linhas ~ ' || greatest(c.reltuples, 0)::bigint
         END AS detalhe
  FROM alvo a
  LEFT JOIN pg_class c
    ON c.relname = a.tbl
   AND c.relnamespace = 'public'::regnamespace
   AND c.relkind = 'r'
),

colunas AS (
  SELECT c.table_name::text, '2-coluna', c.ordinal_position::int,
         c.column_name::text,
         format_type(at.atttypid, at.atttypmod)
           || CASE WHEN c.is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END
           || COALESCE(' DEFAULT ' || c.column_default, '')
  FROM information_schema.columns c
  JOIN pg_attribute at
    ON at.attrelid = ('public.' || quote_ident(c.table_name))::regclass
   AND at.attname = c.column_name
  WHERE c.table_schema = 'public'
    AND c.table_name IN (SELECT tbl FROM alvo)
),

restricoes AS (
  SELECT cl.relname::text, '3-constraint', 0,
         con.conname::text,
         pg_get_constraintdef(con.oid)
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid
  WHERE cl.relnamespace = 'public'::regnamespace
    AND cl.relname IN (SELECT tbl FROM alvo)
),

indices AS (
  SELECT tablename::text, '4-indice', 0, indexname::text, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN (SELECT tbl FROM alvo)
),

policies AS (
  SELECT tablename::text, '5-policy', 0,
         policyname::text,
         cmd || ' | ' || permissive || ' | papeis = ' || array_to_string(roles, ',')
           || ' | using = ' || COALESCE(qual, '-')
           || ' | check = ' || COALESCE(with_check, '-')
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (SELECT tbl FROM alvo)
),

gatilhos AS (
  SELECT cl.relname::text, '6-trigger', 0,
         t.tgname::text,
         pg_get_triggerdef(t.oid)
  FROM pg_trigger t
  JOIN pg_class cl ON cl.oid = t.tgrelid
  WHERE NOT t.tgisinternal
    AND cl.relnamespace = 'public'::regnamespace
    AND cl.relname IN (SELECT tbl FROM alvo)
),

grants AS (
  SELECT table_name::text, '7-grant', 0,
         grantee::text,
         string_agg(privilege_type, ', ' ORDER BY privilege_type)
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN (SELECT tbl FROM alvo)
    AND grantee IN ('anon', 'authenticated', 'public', 'PUBLIC')
  GROUP BY table_name, grantee
)

SELECT tbl AS tabela, secao, item, detalhe
FROM (
  SELECT * FROM tabela
  UNION ALL SELECT * FROM colunas
  UNION ALL SELECT * FROM restricoes
  UNION ALL SELECT * FROM indices
  UNION ALL SELECT * FROM policies
  UNION ALL SELECT * FROM gatilhos
  UNION ALL SELECT * FROM grants
) r
ORDER BY tabela, secao, ordem, item;
