-- Checklist de itens dentro de cada tarefa. Qualquer autenticado pode
-- adicionar, marcar/desmarcar ou excluir itens (mesmo padrão de tarefas).

CREATE TABLE public.tarefa_checklist_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id uuid NOT NULL REFERENCES public.tarefas(id) ON DELETE CASCADE,
  texto text NOT NULL,
  concluido boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checklist_tarefa ON public.tarefa_checklist_itens(tarefa_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tarefa_checklist_itens TO authenticated;
GRANT ALL ON public.tarefa_checklist_itens TO service_role;
ALTER TABLE public.tarefa_checklist_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados gerenciam checklist"
  ON public.tarefa_checklist_itens FOR ALL TO authenticated USING (true) WITH CHECK (true);
