-- Tarefas com Admin entre os responsáveis passam a aparecer na aba "Tarefas"
-- junto com as demais, porém apenas para quem também é Admin.
--
-- O filtro equivalente já existe no front (KanbanView/TarefasHeader/
-- CalendarView/tasks-store), mas sozinho ele é só cosmético: a policy de SELECT
-- de public.tarefas libera qualquer linha com tipo = 'tarefa' para todo perfil
-- interno, então um Membro ainda leria essas tarefas via REST. Esta migration
-- fecha isso no banco.

-- "É uma tarefa de Admin?" — SECURITY DEFINER para não recair na RLS de
-- tarefa_responsaveis / perfis_usuarios ao ser chamada de dentro da policy.
CREATE OR REPLACE FUNCTION public.tarefa_de_admin(_tarefa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tarefa_responsaveis tr
    JOIN public.perfis_usuarios p ON p.id = tr.usuario_id
    WHERE tr.tarefa_id = _tarefa_id AND p.cargo = 'Admin'
  )
$$;

REVOKE EXECUTE ON FUNCTION public.tarefa_de_admin(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.tarefa_de_admin(uuid) TO authenticated;

-- RESTRICTIVE (combina com AND sobre todas as permissivas, atuais e futuras):
-- é o mesmo padrão de "Exige perfil interno", e evita depender dos nomes exatos
-- das policies permissivas já existentes — que historicamente divergiram entre
-- as migrations locais e o que está de fato em produção.
--
-- Só restringe SELECT: quem já podia editar/excluir continua podendo, e o
-- responsável Admin obviamente enxerga a própria tarefa via is_admin().
DROP POLICY IF EXISTS "Tarefas de Admin so para Admins" ON public.tarefas;
CREATE POLICY "Tarefas de Admin so para Admins" ON public.tarefas
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR NOT public.tarefa_de_admin(id)
  );

-- tarefa_responsaveis vaza a mesma informação (quem está em qual tarefa), então
-- recebe o mesmo corte — senão dá para reconstruir a lista por fora.
DROP POLICY IF EXISTS "Responsaveis de tarefa de Admin so para Admins" ON public.tarefa_responsaveis;
CREATE POLICY "Responsaveis de tarefa de Admin so para Admins" ON public.tarefa_responsaveis
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR NOT public.tarefa_de_admin(tarefa_id)
  );

-- Índice para o EXISTS acima não virar seq scan a cada linha avaliada.
CREATE INDEX IF NOT EXISTS idx_tarefa_responsaveis_tarefa
  ON public.tarefa_responsaveis(tarefa_id);
