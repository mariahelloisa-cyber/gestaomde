-- ROLLBACK de 20261002210000_eh_equipe_interna_exige_ativo.sql.
--
-- Devolve eh_equipe_interna() à definição anterior, que olha SÓ o cargo.
-- Nível de confiança: [EXATO] — a definição anterior está versionada em git,
-- em 20261002170000_rls_endurecer_tabelas_abertas.sql.
--
-- ===========================================================================
-- !! O QUE ISTO REABRE
-- !!
-- !! Membro inativado volta a passar em TODAS as policies que dependem de
-- !! eh_equipe_interna. Ou seja, "inativar membro" volta a ser só barreira de
-- !! frontend: qualquer JWT ainda válido (conector MCP, aba aberta, curl com o
-- !! token do navegador) volta a ler o CRM inteiro.
-- !!
-- !! Só rode isto se a migration tiver quebrado algo concreto. "Inativo
-- !! perdendo acesso" é o comportamento desejado, não um defeito.
-- ===========================================================================

BEGIN;

DO $do$
BEGIN
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL THEN
    RAISE EXCEPTION 'public.eh_equipe_interna(uuid) nao existe: nada a reverter.';
  END IF;
END
$do$;

-- Definição de 20261002170000, sem o corte de status.
CREATE OR REPLACE FUNCTION public.eh_equipe_interna(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis_usuarios
     WHERE id = _user_id
       AND cargo::text IN ('Admin', 'Membro', 'Supervisor')
  )
$fn$;

COMMENT ON FUNCTION public.eh_equipe_interna(uuid) IS
  'true para cargo Admin, Membro ou Supervisor. Diferente de tem_perfil(), '
  'que também aceita o cargo Cliente. Use esta em policy de dado interno.';

DO $do$
DECLARE corpo text;
BEGIN
  SELECT prosrc INTO corpo
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'eh_equipe_interna';

  IF corpo LIKE '%status%' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETO: a funcao ainda tem o corte de status.';
  END IF;
  IF corpo NOT LIKE '%Supervisor%' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETO: a funcao perdeu o corte de cargo.';
  END IF;

  RAISE NOTICE 'eh_equipe_interna voltou a olhar so o cargo.';
END
$do$;

COMMIT;

SELECT 'ROLLBACK APLICADO' AS resultado,
       'eh_equipe_interna voltou a definicao de 20261002170000.' AS estado,
       'ATENCAO: membro inativado volta a ter acesso a dado por qualquer JWT valido. Considere revogar os grants OAuth do MCP a mao.' AS lembrete;

-- ---------------------------------------------------------------------------
-- DEPOIS DE RODAR ISTO
--
--   1. A migration 20261002210000 continua marcada como aplicada no histórico
--      do Supabase. Para reaplicar, use `supabase migration repair` para
--      desmarcar, ou crie uma parte 6.
--
--   2. O Worker do MCP continua reconferindo a elegibilidade a cada refresh,
--      e a checagem dele inclui perfis_usuarios.status separadamente da
--      função. Então o conector MCP segue barrando inativo mesmo depois deste
--      rollback — o que volta a ficar aberto são os outros portadores de JWT.
-- ---------------------------------------------------------------------------
