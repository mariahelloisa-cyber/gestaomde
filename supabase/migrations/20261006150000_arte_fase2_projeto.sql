-- Módulo de demandas de ARTE — Fase 2: "empresa" do formulário = projeto.
--
-- No CRM, as empresas atendidas ficam em public.projetos (11 em produção em
-- 2026-10-06); public.clientes está vazia. A Fase 1 tinha ligado
-- art_requests.cliente_id a clientes. Esta migration só ACRESCENTA
-- art_requests.projeto_id. Nada da Fase 1 muda:
--   - cliente_id continua lá, nullable e sem uso (não removo para não mexer em
--     schema aplicado sem necessidade);
--   - nenhuma policy, trigger ou GRANT é alterado. O GRANT de SELECT de
--     art_requests é de tabela, então já cobre a coluna nova; e projeto_id
--     fica FORA do GRANT UPDATE de coluna — só o servidor (service role) grava.
--
-- ON DELETE SET NULL, igual a tarefas.projeto_id: excluir um projeto no CRM
-- não pode travar nem apagar demandas de arte.
--
-- RE-EXECUTÁVEL.

BEGIN;

DO $do$
BEGIN
  IF to_regclass('public.art_requests') IS NULL OR to_regclass('public.projetos') IS NULL THEN
    RAISE EXCEPTION 'Aplique 20261006130000_arte_fase1_tabelas.sql antes (art_requests/projetos ausentes).';
  END IF;
END
$do$;

ALTER TABLE public.art_requests
  ADD COLUMN IF NOT EXISTS projeto_id uuid;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.art_requests'::regclass
       AND conname = 'art_requests_projeto_id_fkey'
  ) THEN
    ALTER TABLE public.art_requests
      ADD CONSTRAINT art_requests_projeto_id_fkey
      FOREIGN KEY (projeto_id) REFERENCES public.projetos(id) ON DELETE SET NULL;
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS art_requests_projeto_idx ON public.art_requests (projeto_id);

COMMENT ON COLUMN public.art_requests.projeto_id IS
  'Empresa/projeto da arte (select "Empresa" do formulário). Gravado só pelo servidor.';
COMMENT ON COLUMN public.art_requests.cliente_id IS
  'Sem uso desde a Fase 2: a empresa da arte é projeto_id. Mantido por compatibilidade.';

DO $do$
BEGIN
  IF has_column_privilege('authenticated', 'public.art_requests', 'projeto_id', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated nao deveria poder atualizar art_requests.projeto_id';
  END IF;
  RAISE NOTICE 'art_requests.projeto_id criado (FK projetos, ON DELETE SET NULL).';
END
$do$;

COMMIT;
