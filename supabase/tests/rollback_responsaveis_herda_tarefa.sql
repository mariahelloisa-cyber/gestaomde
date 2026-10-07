-- ROLLBACK de 20261007140000_tarefa_responsaveis_herda_tarefa.sql.
--
-- Remove as três RESTRICTIVE de escrita em tarefa_responsaveis.
-- Nível de confiança: [EXATO] — a migration só CRIOU essas três policies.
-- "Exige equipe interna" NÃO é removida: ela já existia (parte 2), e a
-- migration só a criaria se tivesse sumido.
--
-- ===========================================================================
-- !! O QUE ISTO REABRE
-- !!
-- !! Membro volta a conseguir inserir responsável, pelo REST com o próprio
-- !! JWT, em tarefa que não vê (tarefa de Admin, lembrete pessoal de outra
-- !! pessoa) — e o trigger de designação manda e-mail para quem ele escolher.
-- !!
-- !! O conector MCP continua protegido pelo próprio código (lê a tarefa pelo
-- !! RLS antes de escrever), mas o banco deixa de ser a barreira.
-- !! Só rode isto se a migration tiver quebrado um fluxo concreto do app.
-- ===========================================================================

BEGIN;

DROP POLICY IF EXISTS "Inserir responsavel exige ver a tarefa" ON public.tarefa_responsaveis;
DROP POLICY IF EXISTS "Alterar responsavel exige ver a tarefa" ON public.tarefa_responsaveis;
DROP POLICY IF EXISTS "Remover responsavel exige ver a tarefa" ON public.tarefa_responsaveis;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'tarefa_responsaveis'
                AND policyname LIKE '%exige ver a tarefa') THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETO: ainda ha policy "exige ver a tarefa".';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'tarefa_responsaveis'
                    AND policyname = 'Exige equipe interna') THEN
    RAISE EXCEPTION 'Exige equipe interna sumiu: nao era para este rollback mexer nela.';
  END IF;
  RAISE NOTICE 'As 3 policies de escrita foram removidas.';
END
$do$;

COMMIT;

SELECT 'ROLLBACK APLICADO' AS resultado,
       'tarefa_responsaveis voltou as policies anteriores a 20261007140000.' AS estado,
       'A migration continua marcada como aplicada: use supabase migration repair --status reverted 20261007140000 para desmarcar.' AS lembrete;
