-- ROLLBACK de 20261002200000_remove_acesso_cliente.sql.
--
-- Desfaz SÓ a parte 4. As partes 1 a 3 (20261002170000/180000/190000) ficam
-- aplicadas — para desfazer aquelas, use rollback_rls.sql, e rode ESTE antes.
--
-- Roda em uma transação e termina em COMMIT. Se qualquer passo falhar, nada é
-- aplicado.
--
-- Nível de confiança: [EXATO]. Diferente do rollback_rls.sql, aqui eu tenho as
-- definições anteriores com certeza — são as das partes 1 e 2, que estão
-- versionadas em git e foram as aplicadas em produção:
--   clientes         "Equipe interna ou a propria empresa"  (20261002170000)
--   perfis_usuarios  "Autenticados podem ver perfis"        (20261002180000)
--   public.meu_cliente_id()                                 (20261002170000)
--
-- ===========================================================================
-- !! O QUE ESTE ROLLBACK REABRE
-- !!
-- !! O cargo Cliente volta a ler a linha da própria empresa em `clientes` e a
-- !! própria linha em `perfis_usuarios` — e, com isso, volta a CONSEGUIR
-- !! ENTRAR no sistema e a ver o portal.
-- !!
-- !! Se as contas Cliente foram inativadas (status = 'inativo'), elas seguem
-- !! bloqueadas pelo app mesmo depois deste rollback, com a mensagem "Sua
-- !! conta foi desativada". Para reabrir de fato o acesso, reative também:
-- !!   UPDATE public.perfis_usuarios SET status = 'ativo'
-- !!    WHERE cargo::text = 'Cliente';
-- !! Decida isso de propósito, não por acidente.
-- ===========================================================================
--
-- LOCK: mexe em policy de clientes e perfis_usuarios, então o app inteiro fica
-- esperando enquanto a transação estiver aberta (_authenticated.tsx lê
-- perfis_usuarios em todo acesso). É rápido. Não deixe a aba aberta.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Pré-condição: as partes 1 a 3 têm que estar aplicadas, porque as
--    definições restauradas dependem de eh_equipe_interna().
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'public.eh_equipe_interna(uuid) nao existe: as partes 1 a 3 precisam '
      'estar aplicadas para este rollback fazer sentido.';
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 2) Recria meu_cliente_id(), igual a 20261002170000.
--    Vem ANTES das policies: a de `clientes` referencia esta função.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meu_cliente_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p.cliente_id
    FROM public.perfis_usuarios p
   WHERE p.id = auth.uid()
   LIMIT 1
$fn$;

REVOKE EXECUTE ON FUNCTION public.meu_cliente_id() FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.meu_cliente_id() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) clientes: volta o carve-out, sai o RESTRICTIVE simétrico.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Exige equipe interna" ON public.clientes;

DROP POLICY IF EXISTS "Equipe interna ou a propria empresa" ON public.clientes;
CREATE POLICY "Equipe interna ou a propria empresa" ON public.clientes
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.eh_equipe_interna((select auth.uid()))
    OR id = (select public.meu_cliente_id())
  )
  WITH CHECK (
    public.eh_equipe_interna((select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 4) perfis_usuarios: volta o braço do carve-out, sai o RESTRICTIVE.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Exige equipe interna" ON public.perfis_usuarios;

DROP POLICY IF EXISTS "Autenticados podem ver perfis" ON public.perfis_usuarios;
CREATE POLICY "Autenticados podem ver perfis" ON public.perfis_usuarios
  FOR SELECT TO authenticated
  USING (
    public.eh_equipe_interna((select auth.uid()))
    OR id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 5) Verificação
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  t text;
  n int;
BEGIN
  -- O RESTRICTIVE simétrico tem que ter saído das duas.
  FOREACH t IN ARRAY ARRAY['clientes', 'perfis_usuarios']
  LOOP
    SELECT count(*) INTO n
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t
       AND policyname = 'Exige equipe interna';
    IF n <> 0 THEN
      RAISE EXCEPTION
        'ROLLBACK INCOMPLETO: % ainda tem a RESTRICTIVE "Exige equipe interna".', t;
    END IF;

    -- E o "Exige perfil interno" antigo tem que continuar lá.
    SELECT count(*) INTO n
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t
       AND permissive = 'RESTRICTIVE'
       AND policyname = 'Exige perfil interno';
    IF n <> 1 THEN
      RAISE EXCEPTION
        'ROLLBACK INCOMPLETO: % perdeu a RESTRICTIVE "Exige perfil interno".', t;
    END IF;
  END LOOP;

  -- O carve-out tem que estar de volta nas duas pontas.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'clientes'
     AND policyname = 'Equipe interna ou a propria empresa'
     AND qual LIKE '%meu_cliente_id%';
  IF n <> 1 THEN
    RAISE EXCEPTION
      'ROLLBACK INCOMPLETO: o carve-out de clientes nao voltou com meu_cliente_id.';
  END IF;

  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'perfis_usuarios'
     AND policyname = 'Autenticados podem ver perfis'
     AND qual LIKE '%OR%';
  IF n <> 1 THEN
    RAISE EXCEPTION
      'ROLLBACK INCOMPLETO: a permissiva de perfis_usuarios nao voltou com o braco de carve-out.';
  END IF;

  IF to_regprocedure('public.meu_cliente_id()') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETO: meu_cliente_id() nao foi recriada.';
  END IF;

  RAISE NOTICE 'Rollback da parte 4 aplicado: carve-out do Cliente restaurado.';
END
$do$;

COMMIT;

SELECT 'ROLLBACK APLICADO' AS resultado,
       'A parte 4 foi desfeita; as partes 1 a 3 seguem aplicadas.' AS estado,
       'O cargo Cliente volta a ler a propria empresa e o proprio perfil, e a conseguir entrar. Se as contas estao inativas, continuam bloqueadas pelo app.' AS lembrete;

-- ---------------------------------------------------------------------------
-- DEPOIS DE RODAR ISTO
--
--   1. A migration 20261002200000 continua registrada como aplicada no
--      histórico do Supabase. Para reaplicar depois de corrigir, use
--      `supabase migration repair` para desmarcar, ou crie uma parte 5. Rodar
--      `db push` de novo não faz nada: ele acha que já aplicou.
--
--   2. Se o motivo do rollback foi o app quebrar, me diga O QUE quebrou e com
--      qual cargo. Os suspeitos, em ordem:
--        - alguma tela interna que leia perfil de um usuário com cargo
--          Cliente (a permissiva nova só devolve equipe interna, então um
--          JOIN que espere achar o perfil do Cliente volta vazio);
--        - algo que dependa de `clientes` por um caminho com JWT de Cliente;
--        - conta Cliente em loop de login, que é o esperado e se resolve
--          inativando a conta, não com rollback.
-- ---------------------------------------------------------------------------
