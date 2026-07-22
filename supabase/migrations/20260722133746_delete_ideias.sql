-- Permite excluir ideias: Admin pode apagar qualquer uma; o autor só pode
-- apagar a própria enquanto ainda estiver pendente (não avaliada).

GRANT DELETE ON public.ideias TO authenticated;

CREATE POLICY "Admin ou autor (pendente) excluem ideias"
  ON public.ideias FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (auth.uid() = criado_por AND status = 'pendente')
  );
