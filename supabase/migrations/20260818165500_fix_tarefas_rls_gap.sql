DROP POLICY IF EXISTS "Autenticados gerenciam tarefas" ON public.tarefas;
CREATE POLICY "Exige perfil interno" ON public.tarefas
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

CREATE POLICY "Exige perfil interno" ON public.tarefa_responsaveis
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

CREATE POLICY "Exige perfil interno" ON public.clientes
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

CREATE POLICY "Exige perfil interno" ON public.comentarios_tarefa
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

CREATE POLICY "Exige perfil interno" ON public.perfis_usuarios
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));
