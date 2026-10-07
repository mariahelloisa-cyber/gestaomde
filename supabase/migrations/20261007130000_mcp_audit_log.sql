-- Log de auditoria das ferramentas de ESCRITA do conector MCP. Append-only.
--
-- O Worker do MCP (gestaomde-main/mcp-server) grava aqui com o JWT do
-- próprio usuário, depois de cada tentativa de escrita, com o resultado.
-- Nada de service role: cada um só insere a própria linha.
--
--   INSERT  só a própria linha, só equipe interna ativa, e só nas colunas
--           de conteúdo — id, criado_em e user_id vêm dos defaults.
--   SELECT  só is_admin() (Admin e Supervisor).
--   UPDATE/DELETE/TRUNCATE  ninguém: sem policy, sem GRANT, e um trigger que
--           recusa para QUALQUER papel, inclusive service_role.
--
-- Limites conhecidos:
--   - Um usuário pode inserir linhas falsas SOBRE SI MESMO chamando o REST
--     direto. Não pode inserir em nome de outro, nem apagar nada.
--   - O trigger impede limpeza por retenção. Se um dia for preciso, é uma
--     migration que desliga o trigger, apaga e religa.
--
-- Ensaio: supabase/tests/ensaio_mcp_audit_log.sql
-- Rollback: supabase/tests/rollback_mcp_audit_log.sql

BEGIN;

DO $do$
BEGIN
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL
     OR to_regprocedure('public.is_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'eh_equipe_interna/is_admin ausentes: aplique as partes 1–5 antes';
  END IF;
END
$do$;

CREATE TABLE public.mcp_audit_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  criado_em    timestamptz NOT NULL DEFAULT now(),
  user_id      uuid        NOT NULL DEFAULT auth.uid(),
  ferramenta   text        NOT NULL CHECK (ferramenta ~ '^[a-z_]{1,64}$'),
  -- Sem FK de propósito: o registro tem que sobreviver à exclusão da tarefa.
  tarefa_id    uuid,
  ids_afetados uuid[]      NOT NULL DEFAULT '{}' CHECK (cardinality(ids_afetados) <= 50),
  -- Resumo: títulos cortados em 120, textos longos só como tamanho.
  argumentos   jsonb       NOT NULL DEFAULT '{}'
               CHECK (jsonb_typeof(argumentos) = 'object' AND pg_column_size(argumentos) <= 2048),
  resultado    text        NOT NULL
               CHECK (resultado IN ('ok','duplicata','sem_mudanca','parcial','negado','erro')),
  detalhe      text        CHECK (detalhe IS NULL OR length(detalhe) <= 200)
);

CREATE INDEX mcp_audit_log_user_criado_idx ON public.mcp_audit_log (user_id, criado_em DESC);
CREATE INDEX mcp_audit_log_tarefa_idx      ON public.mcp_audit_log (tarefa_id) WHERE tarefa_id IS NOT NULL;
CREATE INDEX mcp_audit_log_criado_idx      ON public.mcp_audit_log (criado_em DESC);

-- Privilégios. O Supabase concede ALL a anon/authenticated em tabela nova do
-- public; tira tudo e devolve só o necessário. INSERT por COLUNA: o cliente
-- não consegue escolher id, criado_em nem user_id (vêm dos defaults).
REVOKE ALL ON public.mcp_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mcp_audit_log TO authenticated;
GRANT INSERT (ferramenta, tarefa_id, ids_afetados, argumentos, resultado, detalhe)
  ON public.mcp_audit_log TO authenticated;

ALTER TABLE public.mcp_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Registra a propria acao" ON public.mcp_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.eh_equipe_interna((SELECT auth.uid())));

CREATE POLICY "Admins leem a auditoria" ON public.mcp_audit_log
  FOR SELECT TO authenticated
  USING (public.is_admin((SELECT auth.uid())));

-- Sem policy de UPDATE/DELETE, e sem GRANT. Além disso, um trigger barra
-- UPDATE/DELETE/TRUNCATE para QUALQUER papel, inclusive service_role.
CREATE FUNCTION public.mcp_audit_log_imutavel() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'mcp_audit_log é append-only (% recusado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_audit_log_imutavel() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_mcp_audit_log_imutavel
  BEFORE UPDATE OR DELETE ON public.mcp_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.mcp_audit_log_imutavel();
CREATE TRIGGER trg_mcp_audit_log_sem_truncate
  BEFORE TRUNCATE ON public.mcp_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.mcp_audit_log_imutavel();

COMMENT ON TABLE public.mcp_audit_log IS
  'Ações de escrita feitas pelo conector MCP. Append-only; leitura só is_admin().';

COMMIT;
