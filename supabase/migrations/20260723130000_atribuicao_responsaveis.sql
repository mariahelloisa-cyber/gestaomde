-- Data em que cada responsável foi atribuído a uma tarefa. Necessária para medir
-- produtividade por período ("tarefas atribuídas no período"), diferenciando de
-- "tarefas concluídas no período" (que já usa tarefas.concluido_em).
ALTER TABLE public.tarefa_responsaveis
  ADD COLUMN criado_em timestamptz NOT NULL DEFAULT now();

-- Backfill: não há como saber a data exata em que cada atribuição existente
-- aconteceu (a tabela nunca guardou isso). Usamos a data de criação da tarefa
-- como melhor aproximação — é o valor real mais próximo disponível, não uma
-- data inventada. Só é impreciso para tarefas cujo responsável foi alterado
-- depois da criação (nesse caso a data refletirá a criação da tarefa, não a
-- troca de responsável).
UPDATE public.tarefa_responsaveis tr
SET criado_em = t.data_criacao
FROM public.tarefas t
WHERE tr.tarefa_id = t.id;
