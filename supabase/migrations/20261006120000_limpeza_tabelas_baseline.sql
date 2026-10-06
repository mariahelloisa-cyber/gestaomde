-- LIMPEZA das tabelas que vieram de produção em
-- 20261002165900_baseline_tabelas_so_em_producao.sql.
--
-- Diferente do baseline, ESTA migration muda produção e deve rodar com o
-- `supabase db push` normal. As duas mudanças são pequenas e reversíveis.

-- ---------------------------------------------------------------------------
-- 1) Índices duplicados
--
--    Cada par indexa exatamente a mesma coluna com btree. Ficam os nomes que
--    20261002170000 cria (sufixo _id); saem os que só existiam em produção.
--    Leitura não muda; escrita deixa de manter um índice inútil.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_pastas_links_itens_pasta;   -- = idx_pastas_links_itens_pasta_id
DROP INDEX IF EXISTS public.idx_checklist_tarefa;           -- = idx_tarefa_checklist_itens_tarefa_id

-- Garantia: se por algum motivo o índice que fica não existir, recria.
CREATE INDEX IF NOT EXISTS idx_pastas_links_itens_pasta_id
  ON public.pastas_links_itens (pasta_id);
CREATE INDEX IF NOT EXISTS idx_tarefa_checklist_itens_tarefa_id
  ON public.tarefa_checklist_itens (tarefa_id);

-- ---------------------------------------------------------------------------
-- 2) notificar_nova_ideia_email não é chamável de fora
--
--    Mesmo REVOKE que notificar_designacao_email recebeu em 20260602130006.
--    O trigger continua funcionando: trigger não depende de EXECUTE de quem
--    insere.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.notificar_nova_ideia_email()
  FROM PUBLIC, anon, authenticated;
