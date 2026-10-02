-- VERIFICAÇÃO: produção tem tudo que 20261002120000_murais.sql cria?
--
-- Rode no SQL Editor. É SÓ LEITURA: nenhum INSERT, UPDATE, DELETE, CREATE ou
-- DROP. Não precisa de transação e não toca em dado.
--
-- Devolve um relatório com uma linha por objeto verificado. Procure por
-- qualquer `situacao` diferente de 'OK'.
--
-- A seção A é a mais urgente: o `db push` executou três DROP antes de falhar
-- (statement 0 = DROP FUNCTION excluir_mural_quadro, 1 = DROP TABLE
-- mural_itens, 2 = DROP TABLE mural_quadros; a numeração do CLI é 0-indexada e
-- o que falhou, statement 3, foi o CREATE TABLE public.murais). Se o CLI NÃO
-- envolve o arquivo numa transação, esses DROP teriam ido para valer e levado
-- os dados de mural_itens e mural_quadros. A seção A é o que prova se houve
-- perda.

WITH

-- ===========================================================================
-- Listas do que a migration cria, transcritas do arquivo
-- ===========================================================================
esp_tabela(tbl) AS (
  VALUES ('murais'), ('mural_quadros'), ('mural_itens')
),

esp_coluna(tbl, col) AS (
  VALUES
    ('murais','id'), ('murais','usuario_id'), ('murais','nome'),
    ('murais','descricao'), ('murais','cor'), ('murais','posicao'),
    ('murais','criado_em'),
    ('mural_quadros','id'), ('mural_quadros','mural_id'),
    ('mural_quadros','usuario_id'), ('mural_quadros','nome'),
    ('mural_quadros','cor'), ('mural_quadros','posicao'),
    ('mural_quadros','criado_em'),
    ('mural_itens','id'), ('mural_itens','quadro_id'),
    ('mural_itens','mural_id'), ('mural_itens','usuario_id'),
    ('mural_itens','tarefa_id'), ('mural_itens','posicao'),
    ('mural_itens','criado_em')
),

esp_indice(idx) AS (
  VALUES ('murais_usuario_idx'),
         ('mural_quadros_mural_idx'), ('mural_quadros_usuario_idx'),
         ('mural_itens_quadro_idx'), ('mural_itens_tarefa_idx')
),

esp_constraint(nome) AS (
  VALUES ('mural_quadros_id_mural_key'),
         ('mural_itens_quadro_fkey'),
         ('mural_itens_um_quadro_por_tarefa')
),

esp_funcao(sig) AS (
  VALUES ('public.mural_itens_preenche_mural()'),
         ('public.mural_tarefa_permitida(uuid)'),
         ('public.excluir_mural_quadro(uuid)'),
         ('public.excluir_mural(uuid)')
),

esp_policy(tbl, pol) AS (
  VALUES
    ('murais','Dono gerencia seus murais'),
    ('murais','Exige perfil interno'),
    ('mural_quadros','Dono ve seus quadros'),
    ('mural_quadros','Dono cria quadros'),
    ('mural_quadros','Dono edita quadros'),
    ('mural_quadros','Dono exclui quadros'),
    ('mural_quadros','Exige perfil interno'),
    ('mural_itens','Dono ve seus itens'),
    ('mural_itens','Dono adiciona itens'),
    ('mural_itens','Dono move itens'),
    ('mural_itens','Dono remove itens'),
    ('mural_itens','Exige perfil interno')
),

relatorio AS (

-- ===========================================================================
-- A) PERDA DE DADO: as tabelas existem e com quantas linhas?
-- ===========================================================================
SELECT 'A) dados' AS secao,
       'tabela ' || e.tbl AS item,
       'existir' AS esperado,
       CASE WHEN to_regclass('public.' || e.tbl) IS NULL
            THEN 'NAO EXISTE'
            ELSE 'existe' END AS producao,
       CASE WHEN to_regclass('public.' || e.tbl) IS NULL
            THEN '>>> TABELA PERDIDA <<<'
            ELSE 'OK' END AS situacao
  FROM esp_tabela e

-- A contagem usa query_to_xml de propósito, e não `count(*) FROM public.x`.
-- Referência estática a tabela inexistente é erro de PARSE, não de runtime:
-- se mural_itens tivesse sido apagada pelo DROP, o script inteiro morreria
-- antes de rodar, exatamente no caso que ele precisa detectar. Com o nome da
-- tabela dentro de uma string não há dependência em tempo de parse, e o CASE
-- garante que o ELSE não é avaliado quando a tabela não existe.
UNION ALL
SELECT 'A) dados',
       'linhas em ' || e.tbl,
       'o que havia antes (voce julga)',
       CASE WHEN to_regclass('public.' || e.tbl) IS NULL
            THEN 'TABELA AUSENTE'
            ELSE (xpath('/row/c/text()',
                        query_to_xml('SELECT count(*) AS c FROM public.'
                                     || quote_ident(e.tbl),
                                     false, true, '')))[1]::text
       END,
       CASE WHEN to_regclass('public.' || e.tbl) IS NULL
            THEN '>>> TABELA PERDIDA <<<'
            ELSE 'conferir no app' END
  FROM esp_tabela e

-- ===========================================================================
-- B) COLUNAS
-- ===========================================================================
UNION ALL
SELECT 'B) colunas',
       e.tbl || '.' || e.col,
       'existir',
       coalesce(c.data_type, 'AUSENTE'),
       CASE WHEN c.column_name IS NULL THEN '>>> FALTA <<<' ELSE 'OK' END
  FROM esp_coluna e
  LEFT JOIN information_schema.columns c
         ON c.table_schema = 'public'
        AND c.table_name = e.tbl
        AND c.column_name = e.col

-- Colunas que existem em produção e a migration NÃO cria (drift ao contrário)
UNION ALL
SELECT 'B) colunas',
       c.table_name || '.' || c.column_name,
       'nao deveria existir',
       c.data_type,
       '>>> EXTRA em producao <<<'
  FROM information_schema.columns c
  JOIN esp_tabela t ON t.tbl = c.table_name
 WHERE c.table_schema = 'public'
   AND NOT EXISTS (SELECT 1 FROM esp_coluna e
                    WHERE e.tbl = c.table_name AND e.col = c.column_name)

-- ===========================================================================
-- C) ÍNDICES
-- ===========================================================================
UNION ALL
SELECT 'C) indices',
       e.idx,
       'existir',
       CASE WHEN to_regclass('public.' || e.idx) IS NULL
            THEN 'AUSENTE' ELSE 'existe' END,
       CASE WHEN to_regclass('public.' || e.idx) IS NULL
            THEN '>>> FALTA <<<' ELSE 'OK' END
  FROM esp_indice e

-- ===========================================================================
-- D) CONSTRAINTS nomeadas
-- ===========================================================================
UNION ALL
SELECT 'D) constraints',
       e.nome,
       'existir',
       coalesce(con.contype::text, 'AUSENTE'),
       CASE WHEN con.conname IS NULL THEN '>>> FALTA <<<' ELSE 'OK' END
  FROM esp_constraint e
  -- O schema entra NA condição do join, não num LEFT JOIN depois: senão uma
  -- constraint de mesmo nome em outro schema casaria e daria um OK falso.
  LEFT JOIN pg_constraint con
         ON con.conname = e.nome
        AND con.connamespace = 'public'::regnamespace

-- Contagem de constraints por tabela, para pegar PK/FK/CHECK sem nome fixo
UNION ALL
SELECT 'D) constraints',
       'total de constraints em ' || c.relname::text,
       CASE c.relname
         WHEN 'murais'        THEN '>= 6 (1 PK, 1 FK, 3 CHECK, NOT NULLs nao contam)'
         WHEN 'mural_quadros' THEN '>= 7 (1 PK, 2 FK, 2 CHECK, 1 UNIQUE)'
         WHEN 'mural_itens'   THEN '>= 6 (1 PK, 3 FK, 1 UNIQUE)'
       END,
       count(con.oid)::text,
       'eyeball'
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN esp_tabela t ON t.tbl = c.relname
  LEFT JOIN pg_constraint con ON con.conrelid = c.oid
 GROUP BY c.relname

-- ===========================================================================
-- E) TRIGGER
-- ===========================================================================
UNION ALL
SELECT 'E) trigger',
       'mural_itens_preenche_mural_trg',
       'existir e estar habilitado',
       coalesce(
         -- tgenabled é do tipo "char" (1 byte), não text. Sem o ::text o
         -- Postgres não resolve o operador || contra um literal sem tipo.
         (SELECT CASE tg.tgenabled WHEN 'O' THEN 'habilitado'
                                   WHEN 'D' THEN 'DESABILITADO'
                                   ELSE 'estado ' || tg.tgenabled::text END
            FROM pg_trigger tg
            JOIN pg_class c ON c.oid = tg.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'mural_itens'
             AND tg.tgname = 'mural_itens_preenche_mural_trg'),
         'AUSENTE'),
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger tg
                JOIN pg_class c ON c.oid = tg.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = 'mural_itens'
                 AND tg.tgname = 'mural_itens_preenche_mural_trg'
                 AND tg.tgenabled = 'O')
            THEN 'OK' ELSE '>>> FALTA <<<' END

-- ===========================================================================
-- F) FUNÇÕES
-- ===========================================================================
UNION ALL
SELECT 'F) funcoes',
       e.sig,
       'existir',
       CASE WHEN to_regprocedure(e.sig) IS NULL
            THEN 'AUSENTE' ELSE 'existe' END,
       CASE WHEN to_regprocedure(e.sig) IS NULL
            THEN '>>> FALTA <<<' ELSE 'OK' END
  FROM esp_funcao e

-- ===========================================================================
-- G) RLS habilitado
-- ===========================================================================
UNION ALL
SELECT 'G) rls',
       'RLS em ' || c.relname::text,
       'habilitado',
       CASE WHEN c.relrowsecurity THEN 'habilitado' ELSE 'DESABILITADO' END,
       CASE WHEN c.relrowsecurity THEN 'OK' ELSE '>>> FALTA <<<' END
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN esp_tabela t ON t.tbl = c.relname

-- ===========================================================================
-- H) POLICIES
-- ===========================================================================
UNION ALL
SELECT 'H) policies',
       e.tbl || ' -> ' || e.pol,
       'existir',
       coalesce(p.cmd || ' / ' || p.permissive, 'AUSENTE'),
       CASE WHEN p.policyname IS NULL THEN '>>> FALTA <<<' ELSE 'OK' END
  FROM esp_policy e
  LEFT JOIN pg_policies p
         ON p.schemaname = 'public'
        AND p.tablename = e.tbl
        AND p.policyname = e.pol

-- Policies que existem e a migration não cria
UNION ALL
SELECT 'H) policies',
       p.tablename::text || ' -> ' || p.policyname::text,
       'nao deveria existir',
       p.cmd || ' / ' || p.permissive,
       '>>> EXTRA em producao <<<'
  FROM pg_policies p
  JOIN esp_tabela t ON t.tbl = p.tablename
 WHERE p.schemaname = 'public'
   AND NOT EXISTS (SELECT 1 FROM esp_policy e
                    WHERE e.tbl = p.tablename AND e.pol = p.policyname)

-- ===========================================================================
-- I) GRANTS
-- ===========================================================================
UNION ALL
-- has_table_privilege em vez de information_schema.role_table_grants: aquela
-- view só mostra grant em que o usuário corrente é grantor, grantee ou membro
-- do grantee, então poderia esconder linha e gerar um FALTA falso. A função
-- responde direto do catálogo.
SELECT 'I) grants',
       t.tbl || ' -> authenticated',
       'SELECT, INSERT, UPDATE, DELETE',
       concat_ws(', ',
         CASE WHEN has_table_privilege('authenticated', 'public.' || t.tbl, 'SELECT') THEN 'SELECT' END,
         CASE WHEN has_table_privilege('authenticated', 'public.' || t.tbl, 'INSERT') THEN 'INSERT' END,
         CASE WHEN has_table_privilege('authenticated', 'public.' || t.tbl, 'UPDATE') THEN 'UPDATE' END,
         CASE WHEN has_table_privilege('authenticated', 'public.' || t.tbl, 'DELETE') THEN 'DELETE' END),
       CASE WHEN has_table_privilege('authenticated', 'public.' || t.tbl, 'SELECT')
             AND has_table_privilege('authenticated', 'public.' || t.tbl, 'INSERT')
             AND has_table_privilege('authenticated', 'public.' || t.tbl, 'UPDATE')
             AND has_table_privilege('authenticated', 'public.' || t.tbl, 'DELETE')
            THEN 'OK' ELSE '>>> FALTA <<<' END
  FROM esp_tabela t
 WHERE to_regclass('public.' || t.tbl) IS NOT NULL

-- ===========================================================================
-- J) DEFAULTS das colunas, para conferir a olho
-- ===========================================================================
UNION ALL
SELECT 'J) defaults',
       c.table_name || '.' || c.column_name,
       CASE c.column_name
         WHEN 'id'         THEN 'gen_random_uuid()'
         WHEN 'usuario_id' THEN 'auth.uid()'
         WHEN 'posicao'    THEN '0'
         WHEN 'criado_em'  THEN 'now()'
         ELSE '(sem default)'
       END,
       coalesce(c.column_default, '(sem default)'),
       'eyeball'
  FROM information_schema.columns c
  JOIN esp_tabela t ON t.tbl = c.table_name
 WHERE c.table_schema = 'public'
   AND c.column_name IN ('id','usuario_id','posicao','criado_em')
)

SELECT secao, item, esperado, producao, situacao
  FROM relatorio
 ORDER BY secao, situacao DESC, item;
