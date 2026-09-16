CREATE TABLE public.compartilhamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('tarefa', 'coluna')),
  -- tipo='tarefa'
  tarefa_id uuid REFERENCES public.tarefas(id) ON DELETE CASCADE,
  -- tipo='coluna': status da coluna + os filtros que estavam ativos na tela
  status text CHECK (status IN ('Pendente', 'Em Progresso', 'Em Análise', 'Concluído')),
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE CASCADE,
  membro_id uuid REFERENCES public.perfis_usuarios(id) ON DELETE CASCADE,
  criado_por uuid REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz,
  revogado_em timestamptz,
  acessos integer NOT NULL DEFAULT 0,
  ultimo_acesso_em timestamptz,
  CONSTRAINT compartilhamentos_alvo_valido CHECK (
    (tipo = 'tarefa' AND tarefa_id IS NOT NULL)
    OR (tipo = 'coluna' AND status IS NOT NULL)
  )
);

CREATE INDEX compartilhamentos_token_idx ON public.compartilhamentos (token);
CREATE INDEX compartilhamentos_tarefa_id_idx ON public.compartilhamentos (tarefa_id);
CREATE INDEX compartilhamentos_criado_por_idx ON public.compartilhamentos (criado_por);

GRANT ALL ON public.compartilhamentos TO service_role;
ALTER TABLE public.compartilhamentos ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário interno logado pode criar e enxergar os links da equipe:
-- o link não expõe nada além do que essa pessoa já vê no app.
CREATE POLICY "Equipe ve compartilhamentos" ON public.compartilhamentos
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.perfis_usuarios
    WHERE id = auth.uid() AND cargo IN ('Admin', 'Supervisor', 'Membro')
  ));

CREATE POLICY "Equipe cria compartilhamentos" ON public.compartilhamentos
  FOR INSERT TO authenticated
  WITH CHECK (
    criado_por = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.perfis_usuarios
      WHERE id = auth.uid() AND cargo IN ('Admin', 'Supervisor', 'Membro')
    )
  );

-- Revogar é um UPDATE em revogado_em. Autor revoga o próprio link;
-- Admin e Supervisor revogam qualquer um.
CREATE POLICY "Autor ou gestao revoga compartilhamentos" ON public.compartilhamentos
  FOR UPDATE TO authenticated
  USING (
    criado_por = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.perfis_usuarios
      WHERE id = auth.uid() AND cargo IN ('Admin', 'Supervisor')
    )
  )
  WITH CHECK (
    criado_por = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.perfis_usuarios
      WHERE id = auth.uid() AND cargo IN ('Admin', 'Supervisor')
    )
  );

-- Cinto e suspensório: fecha a tabela para contas sem perfil interno
-- (ex: 'demandante'), mesmo padrão de 20260818165500_fix_tarefas_rls_gap.sql.
CREATE POLICY "Exige perfil interno" ON public.compartilhamentos
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));
