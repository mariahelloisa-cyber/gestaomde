-- Remove por completo a funcionalidade de Treinamentos: tabela, funções
-- auxiliares usadas só por ela, e os buckets de storage (com os arquivos
-- dentro deles). Ação destrutiva e irreversível, pedida explicitamente.

-- As policies de storage.objects vêm primeiro: "treinamentos_pdfs_select_by_plan"
-- referencia a tabela treinamentos dentro da condição, então a tabela não pode
-- ser dropada antes dessa policy sair do caminho.
DROP POLICY IF EXISTS "Auth pode ler pdfs de treinamentos" ON storage.objects;
DROP POLICY IF EXISTS "Admins podem enviar pdfs de treinamentos" ON storage.objects;
DROP POLICY IF EXISTS "Admins podem atualizar pdfs de treinamentos" ON storage.objects;
DROP POLICY IF EXISTS "Admins podem deletar pdfs de treinamentos" ON storage.objects;
DROP POLICY IF EXISTS "treinamentos_pdfs_select_by_plan" ON storage.objects;
DROP POLICY IF EXISTS "treinamentos_pdfs_select" ON storage.objects;
DROP POLICY IF EXISTS "treinamentos pdfs select authenticated" ON storage.objects;
DROP POLICY IF EXISTS "treinamentos-pdfs select authenticated" ON storage.objects;
DROP POLICY IF EXISTS "Capas treinamentos: leitura autenticada" ON storage.objects;
DROP POLICY IF EXISTS "Capas treinamentos: admin insere" ON storage.objects;
DROP POLICY IF EXISTS "Capas treinamentos: admin atualiza" ON storage.objects;
DROP POLICY IF EXISTS "Capas treinamentos: admin exclui" ON storage.objects;

DROP TRIGGER IF EXISTS trg_treinamentos_updated ON public.treinamentos;
DROP FUNCTION IF EXISTS public.tg_treinamentos_updated();
DROP TABLE IF EXISTS public.treinamentos;

DROP FUNCTION IF EXISTS public.is_cliente(uuid);
DROP FUNCTION IF EXISTS public.get_meu_plano();

-- Os buckets "treinamentos-pdfs" e "treinamentos-capas" (e os arquivos dentro
-- deles) precisam ser apagados pela Storage API — o Supabase bloqueia DELETE
-- direto nas tabelas storage.objects/storage.buckets via SQL. Apague-os pela
-- aba Storage do Dashboard (selecionar bucket → Delete bucket).
