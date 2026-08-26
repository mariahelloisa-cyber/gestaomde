CREATE TABLE public.organograma_nos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(trim(nome)) > 0),
  parent_id uuid references public.organograma_nos(id) on delete cascade,
  criado_por uuid references public.perfis_usuarios(id) on delete set null,
  criado_em timestamptz not null default now()
);

CREATE INDEX organograma_nos_parent_id_idx ON public.organograma_nos (parent_id);

-- Garante uma única raiz (parent_id IS NULL)
CREATE UNIQUE INDEX organograma_nos_raiz_unica
  ON public.organograma_nos ((parent_id IS NULL)) WHERE parent_id IS NULL;

ALTER TABLE public.organograma_nos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Equipe ve organograma" ON public.organograma_nos
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.perfis_usuarios
    WHERE id = auth.uid() AND cargo IN ('Admin','Supervisor','Membro')
  ));

CREATE POLICY "Admin/Supervisor criam organograma" ON public.organograma_nos
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.perfis_usuarios
    WHERE id = auth.uid() AND cargo IN ('Admin','Supervisor')
  ));

CREATE POLICY "Admin/Supervisor atualizam organograma" ON public.organograma_nos
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.perfis_usuarios
    WHERE id = auth.uid() AND cargo IN ('Admin','Supervisor')
  ));

CREATE POLICY "Admin/Supervisor excluem organograma" ON public.organograma_nos
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.perfis_usuarios
    WHERE id = auth.uid() AND cargo IN ('Admin','Supervisor')
  ));

-- Cinto e suspensório: fecha a tabela para contas sem perfil interno (ex: 'demandante'),
-- mesmo padrão usado em 20260818165500_fix_tarefas_rls_gap.sql.
CREATE POLICY "Exige perfil interno" ON public.organograma_nos
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));
