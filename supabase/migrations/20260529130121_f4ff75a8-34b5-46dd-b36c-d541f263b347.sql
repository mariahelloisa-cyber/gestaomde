-- Enums para tipo e escopo
CREATE TYPE public.tipo_item AS ENUM ('tarefa', 'lembrete');
CREATE TYPE public.escopo_item AS ENUM ('geral', 'pessoal');
-- Novos campos em tarefas
ALTER TABLE public.tarefas
  ADD COLUMN tipo public.tipo_item NOT NULL DEFAULT 'tarefa',
  ADD COLUMN escopo public.escopo_item NOT NULL DEFAULT 'geral',
  ADD COLUMN criado_por uuid;
-- cliente_id passa a ser opcional (lembretes não exigem cliente)
ALTER TABLE public.tarefas ALTER COLUMN cliente_id DROP NOT NULL;
-- Índice para acelerar filtros por criador
CREATE INDEX IF NOT EXISTS idx_tarefas_criado_por ON public.tarefas(criado_por);
CREATE INDEX IF NOT EXISTS idx_tarefas_tipo_escopo ON public.tarefas(tipo, escopo);
-- Substituir a policy genérica por regras que respeitem privacidade de lembretes pessoais
DROP POLICY IF EXISTS "Autenticados gerenciam tarefas" ON public.tarefas;
-- SELECT: tarefas e lembretes gerais são visíveis a todos os autenticados;
-- lembretes pessoais somente para quem os criou
CREATE POLICY "Ver tarefas e lembretes permitidos"
ON public.tarefas
FOR SELECT
TO authenticated
USING (
  tipo = 'tarefa'
  OR escopo = 'geral'
  OR criado_por = auth.uid()
);
-- INSERT: qualquer autenticado pode criar; para lembrete pessoal o criado_por deve ser o próprio usuário
CREATE POLICY "Criar tarefas e lembretes"
ON public.tarefas
FOR INSERT
TO authenticated
WITH CHECK (
  (tipo = 'tarefa')
  OR (tipo = 'lembrete' AND escopo = 'geral')
  OR (tipo = 'lembrete' AND escopo = 'pessoal' AND criado_por = auth.uid())
);
-- UPDATE: tarefas e lembretes gerais por qualquer autenticado; lembretes pessoais apenas pelo criador
CREATE POLICY "Atualizar tarefas e lembretes permitidos"
ON public.tarefas
FOR UPDATE
TO authenticated
USING (
  tipo = 'tarefa'
  OR escopo = 'geral'
  OR criado_por = auth.uid()
)
WITH CHECK (
  tipo = 'tarefa'
  OR escopo = 'geral'
  OR criado_por = auth.uid()
);
-- DELETE: idem
CREATE POLICY "Excluir tarefas e lembretes permitidos"
ON public.tarefas
FOR DELETE
TO authenticated
USING (
  tipo = 'tarefa'
  OR escopo = 'geral'
  OR criado_por = auth.uid()
);
