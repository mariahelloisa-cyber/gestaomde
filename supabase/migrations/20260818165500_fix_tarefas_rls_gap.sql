-- A migration de 2026-05-29 (20260529130121) já tinha substituído a policy
-- "Autenticados gerenciam tarefas" por 4 policies mais específicas (Ver/Criar/
-- Atualizar/Excluir tarefas e lembretes permitidos), todas ainda amplamente
-- abertas (praticamente "true" para qualquer tarefa do tipo 'tarefa'). A
-- migration anterior (20260818162613) recriou "Autenticados gerenciam
-- tarefas" com tem_perfil(), mas como policies permissivas se combinam com
-- OR, isso não fechou nada: a policy antiga e mais aberta continuava valendo.
-- Confirmado na prática: uma conta 'demandante' recém-criada ainda conseguia
-- ler todas as tarefas via REST.
--
-- Corrige com uma policy RESTRICTIVE: essa combina com AND sobre todas as
-- permissivas existentes (e futuras), então basta uma só para fechar
-- de vez o acesso de quem não tem perfis_usuarios — sem depender de saber
-- os nomes/condições exatos de cada policy permissiva já criada.
DROP POLICY IF EXISTS "Autenticados gerenciam tarefas" ON public.tarefas;
CREATE POLICY "Exige perfil interno" ON public.tarefas
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

-- Mesmo reforço, como cinto e suspensório, nas outras tabelas que a migration
-- anterior fechou via policy permissiva única: se alguém no futuro adicionar
-- uma nova policy permissiva mais aberta nessas tabelas (como aconteceu com
-- tarefas), a restrictive abaixo continua garantindo que só quem tem perfil
-- interno (staff/cliente) enxerga ou altera qualquer coisa.
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
