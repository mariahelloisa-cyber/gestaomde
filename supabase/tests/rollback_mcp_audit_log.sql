-- ROLLBACK de 20261007130000_mcp_audit_log.sql.
--
-- Remove a tabela mcp_audit_log e a função do trigger.
-- Nível de confiança: [EXATO] — a migration só CRIA objetos novos; nada
-- existente foi alterado, então não há definição anterior a restaurar.
--
-- ===========================================================================
-- !! O QUE ISTO APAGA
-- !!
-- !! TODO o histórico de auditoria do conector MCP. Não há como recuperar.
-- !! Só faz sentido ANTES de liberar as ferramentas de escrita. Depois disso,
-- !! exporte a tabela antes (json_agg via `db query --linked`).
-- !!
-- !! E com a tabela fora, o Worker com crm:write passa a falhar ao auditar:
-- !! tire `crm:write` de ESCOPOS_SUPORTADOS e faça deploy ANTES de rodar isto.
-- ===========================================================================

BEGIN;

DO $do$
BEGIN
  IF to_regclass('public.mcp_audit_log') IS NULL THEN
    RAISE EXCEPTION 'public.mcp_audit_log nao existe: nada a reverter.';
  END IF;
END
$do$;

-- DROP TABLE leva junto índices, policies e os dois triggers. O trigger de
-- TRUNCATE não dispara em DROP.
DROP TABLE public.mcp_audit_log;
DROP FUNCTION public.mcp_audit_log_imutavel();

DO $do$
BEGIN
  IF to_regclass('public.mcp_audit_log') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETO: a tabela continua la.';
  END IF;
  IF to_regprocedure('public.mcp_audit_log_imutavel()') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETO: a funcao do trigger continua la.';
  END IF;
  RAISE NOTICE 'mcp_audit_log removida.';
END
$do$;

COMMIT;

SELECT 'ROLLBACK APLICADO' AS resultado,
       'mcp_audit_log e mcp_audit_log_imutavel() removidas.' AS estado,
       'A migration 20261007130000 continua marcada como aplicada: use supabase migration repair --status reverted 20261007130000 para desmarcar.' AS lembrete;
