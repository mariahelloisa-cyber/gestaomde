-- Encerra o acesso do cargo Cliente ao sistema.
--
-- Parte 4 da série, depois de 20261002170000, 20261002180000 e 20261002190000,
-- que já estão aplicadas. Aquelas deixavam DOIS carve-outs de propósito, para o
-- portal do Cliente continuar funcionando:
--
--   clientes         policy "Equipe interna ou a propria empresa", cujo USING
--                    tinha o braço `id = meu_cliente_id()` — o Cliente lia a
--                    linha da própria empresa.
--   perfis_usuarios  policy "Autenticados podem ver perfis", cujo USING tinha
--                    o braço `OR id = (select auth.uid())` — o Cliente lia a
--                    própria linha, e por isso não era deslogado.
--
-- Decisão nova: o Cliente não acessa mais nada. Esta migration remove os dois
-- carve-outs, põe as duas tabelas no mesmo RESTRICTIVE das demais e apaga a
-- função meu_cliente_id(), que existia só para sustentar o primeiro.
--
-- ===========================================================================
-- !! PRÉ-REQUISITO OPERACIONAL: inative as contas Cliente ANTES
-- !!
-- !! Sem ler a própria linha de perfis_usuarios, o Cliente é DESLOGADO no
-- !! login por src/routes/_authenticated.tsx:24, com a mensagem errada
-- !! ("Acesso negado: Você precisa de um convite da agência") e em loop de
-- !! login -> logout. Com status = 'inativo' o app usa a mensagem certa
-- !! ("Sua conta foi desativada. Fale com um administrador da agência."):
-- !!
-- !!   UPDATE public.perfis_usuarios
-- !!      SET status = 'inativo'
-- !!    WHERE cargo::text = 'Cliente' AND status <> 'inativo';
-- ===========================================================================
--
-- O enum public.cargo_usuario NÃO é alterado: 'Cliente' continua existindo
-- como valor. Remover valor de enum exige recriar o tipo e todas as colunas
-- que o usam, e não há ganho nenhum nisso aqui.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Guarda de ordem: as partes 1 a 3 têm que estar aplicadas.
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Aplique 20261002170000_rls_endurecer_tabelas_abertas.sql primeiro: '
      'public.eh_equipe_interna(uuid) nao existe.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'comentarios_tarefa'
       AND policyname = 'Exige equipe interna'
  ) THEN
    RAISE EXCEPTION
      'Aplique 20261002180000_rls_equipe_interna_resto.sql primeiro: '
      'comentarios_tarefa nao tem a RESTRICTIVE "Exige equipe interna".';
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 2) clientes: troca o carve-out pelo RESTRICTIVE padrão.
--
--    A policy antiga era assimétrica de propósito (USING deixava ler a própria
--    empresa, WITH CHECK não deixava escrever). A nova é simétrica, igual às
--    outras 16 tabelas da série.
--
--    O RESTRICTIVE "Exige perfil interno", de 20260818165500, continua
--    intacto: ele barra conta sem perfil, e os dois se somam com AND.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Equipe interna ou a propria empresa" ON public.clientes;

DROP POLICY IF EXISTS "Exige equipe interna" ON public.clientes;
CREATE POLICY "Exige equipe interna" ON public.clientes
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.eh_equipe_interna((select auth.uid())))
  WITH CHECK (public.eh_equipe_interna((select auth.uid())));

-- ---------------------------------------------------------------------------
-- 3) perfis_usuarios: tira o braço do carve-out e acrescenta o RESTRICTIVE.
--
--    Duas mudanças, e as duas importam:
--
--    a) A permissiva perde o `OR id = (select auth.uid())`. Só o RESTRICTIVE
--       já bastaria para barrar o Cliente, mas deixar o braço morto na
--       permissiva é uma armadilha: quem remover o RESTRICTIVE depois reabre o
--       acesso sem perceber.
--
--    b) Entra o RESTRICTIVE, pelo mesmo cinto e suspensório das outras.
--
--    O RESTRICTIVE "Exige perfil interno" também continua intacto aqui, e é
--    ele que sustenta o invite-only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Autenticados podem ver perfis" ON public.perfis_usuarios;
CREATE POLICY "Autenticados podem ver perfis" ON public.perfis_usuarios
  FOR SELECT TO authenticated
  USING (public.eh_equipe_interna((select auth.uid())));

DROP POLICY IF EXISTS "Exige equipe interna" ON public.perfis_usuarios;
CREATE POLICY "Exige equipe interna" ON public.perfis_usuarios
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.eh_equipe_interna((select auth.uid())))
  WITH CHECK (public.eh_equipe_interna((select auth.uid())));

-- ---------------------------------------------------------------------------
-- 4) meu_cliente_id(): perdeu o propósito.
--
--    Depois dos passos 2 e 3 nenhuma policy a referencia. O DROP vem no fim
--    de propósito: não dá para apagar função que uma policy ainda usa.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE coalesce(qual, '')       LIKE '%meu_cliente_id%'
        OR coalesce(with_check, '') LIKE '%meu_cliente_id%'
  LOOP
    RAISE WARNING 'Ainda referencia meu_cliente_id: %.% -> "%"',
      r.schemaname, r.tablename, r.policyname;
    n := n + 1;
  END LOOP;

  IF n > 0 THEN
    RAISE EXCEPTION
      '% policy(s) ainda usam meu_cliente_id(); nao e seguro apaga-la.', n;
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.meu_cliente_id();

-- ---------------------------------------------------------------------------
-- 5) Verificação do estado final.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  t text;
  n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['clientes', 'perfis_usuarios']
  LOOP
    SELECT count(*) INTO n
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t
       AND permissive = 'RESTRICTIVE'
       AND policyname = 'Exige equipe interna';
    IF n <> 1 THEN
      RAISE EXCEPTION
        '%: esperava 1 RESTRICTIVE "Exige equipe interna", achei %.', t, n;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE policyname = 'Equipe interna ou a propria empresa') THEN
    RAISE EXCEPTION 'o carve-out "Equipe interna ou a propria empresa" nao saiu.';
  END IF;

  IF to_regprocedure('public.meu_cliente_id()') IS NOT NULL THEN
    RAISE EXCEPTION 'public.meu_cliente_id() nao saiu.';
  END IF;

  -- Nenhuma policy pode mais mencionar a leitura da propria linha como
  -- excecao em perfis_usuarios.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'perfis_usuarios'
       AND policyname = 'Autenticados podem ver perfis'
       AND qual LIKE '%auth.uid()%'
       AND qual LIKE '%OR%'
  ) THEN
    RAISE EXCEPTION
      'a permissiva de perfis_usuarios ainda tem o braco de carve-out.';
  END IF;

  RAISE NOTICE 'Acesso do cargo Cliente encerrado: clientes e perfis_usuarios fechados.';
END
$do$;

COMMIT;

-- ---------------------------------------------------------------------------
-- NOTAS
--
-- (A) O QUE ACONTECE COM QUEM TEM CARGO Cliente
--
--     Ele não lê mais nada, inclusive a própria linha de perfis_usuarios e a
--     própria empresa em clientes. Em consequência, é deslogado no login.
--     Nenhum dado interno vaza nesse caminho: _authenticated.tsx só libera o
--     <Outlet /> depois da checagem passar, então ele nunca renderiza o
--     dashboard.
--
-- (B) CÓDIGO DO PORTAL QUE VIRA MORTO
--
--     src/components/portal/ClientPortal.tsx
--     src/routes/_authenticated/index.tsx       branch cargo === 'Cliente'
--     src/components/layout/InviteDialog.tsx    opção "Cliente" no convite
--     src/lib/data.functions.ts                 'Cliente' no enum do convite
--
--     Não é falha de segurança, mas convidar alguém como Cliente passa a criar
--     conta que não consegue entrar. A limpeza é mudança de frontend, feita
--     separadamente desta migration.
--
-- (C) getMyPortalContext CONTINUA FUNCIONANDO PARA QUEM É DE DENTRO
--
--     src/lib/data.functions.ts:645 lê a própria linha de perfis_usuarios mais
--     o join clientes:cliente_id(...). Usuário interno passa nas duas policies,
--     e o cliente_id dele é NULL, então o join devolve null sem erro. Era o
--     Cliente que dependia do carve-out, e ele não chega mais lá.
-- ---------------------------------------------------------------------------
