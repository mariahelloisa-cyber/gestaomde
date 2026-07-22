-- Reverte a exclusão automática de tarefas concluídas há mais de 7 dias.
-- Agora elas só saem do Kanban e passam a aparecer na aba "Finalizados"
-- (calculado no app a partir de concluido_em, sem apagar nada).

DO $$
BEGIN
  PERFORM cron.unschedule('excluir-tarefas-concluidas-antigas');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
