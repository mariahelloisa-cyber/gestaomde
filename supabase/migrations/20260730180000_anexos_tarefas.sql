-- Mesmo bug do áudio: anexos (PDFs, imagens etc.) de uma demanda aceita
-- também não acompanhavam a tarefa criada. Guarda a mesma referência de
-- storage ({path, nome_arquivo}[]) usada em demandas_externas.anexos.
ALTER TABLE public.tarefas ADD COLUMN anexos jsonb NOT NULL DEFAULT '[]'::jsonb;
