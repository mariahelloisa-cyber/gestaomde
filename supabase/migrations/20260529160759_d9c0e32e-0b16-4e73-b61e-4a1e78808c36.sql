
ALTER TABLE public.tarefas DROP CONSTRAINT IF EXISTS tarefas_cliente_id_fkey;
ALTER TABLE public.tarefas
  ADD CONSTRAINT tarefas_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;

ALTER TABLE public.financeiro_transacoes DROP CONSTRAINT IF EXISTS financeiro_transacoes_cliente_id_fkey;
ALTER TABLE public.financeiro_transacoes
  ADD CONSTRAINT financeiro_transacoes_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;
