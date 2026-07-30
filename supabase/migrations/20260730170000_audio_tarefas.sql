-- Quando uma demanda com áudio é aceita, o áudio precisa acompanhar a tarefa
-- criada (hoje ele fica só na demanda). Guarda a mesma referência de storage
-- ({path, nome_arquivo, duracao_seg}) usada em demandas_externas.audio.
ALTER TABLE public.tarefas ADD COLUMN audio jsonb;
