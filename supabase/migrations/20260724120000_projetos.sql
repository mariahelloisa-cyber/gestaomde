-- Projetos: lista única da agência (não vinculada a um cliente específico)
-- usada para categorizar tarefas. Uma tarefa pertence a no máximo um
-- projeto; excluir o projeto apenas desvincula as tarefas (não as apaga).
CREATE TABLE public.projetos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos TO authenticated;
GRANT ALL ON public.projetos TO service_role;
ALTER TABLE public.projetos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados gerenciam projetos"
  ON public.projetos FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.tarefas
  ADD COLUMN projeto_id uuid REFERENCES public.projetos(id) ON DELETE SET NULL;

CREATE INDEX idx_tarefas_projeto ON public.tarefas(projeto_id);
