-- Remove the "Em Análise" status: reassign existing tasks to "Pendente" and
-- recreate the enum without it (Postgres has no ALTER TYPE ... DROP VALUE).

UPDATE public.tarefas SET status = 'Pendente' WHERE status = 'Em Análise';

ALTER TYPE public.status_tarefa RENAME TO status_tarefa_old;

CREATE TYPE public.status_tarefa AS ENUM ('Pendente', 'Em Progresso', 'Concluído');

ALTER TABLE public.tarefas
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.status_tarefa USING status::text::public.status_tarefa,
  ALTER COLUMN status SET DEFAULT 'Pendente';

DROP TYPE public.status_tarefa_old;
