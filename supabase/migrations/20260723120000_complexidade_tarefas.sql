-- Nível de complexidade da tarefa (Fácil/Média/Difícil), independente da prioridade.
CREATE TYPE public.complexidade_tarefa AS ENUM ('Fácil', 'Média', 'Difícil');

ALTER TABLE public.tarefas
  ADD COLUMN complexidade public.complexidade_tarefa NOT NULL DEFAULT 'Média';
