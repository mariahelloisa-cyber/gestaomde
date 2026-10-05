-- eh_equipe_interna() passa a exigir conta ATIVA, não só cargo interno.
--
-- Parte 5 da série. O furo que ela fecha é maior do que parece:
--
--   A função só olhava `cargo IN ('Admin','Membro','Supervisor')`. Então um
--   membro INATIVADO continuava passando em TODAS as ~20 policies RESTRICTIVE
--   que dependem dela. O app o barrava em src/routes/_authenticated.tsx, que
--   checa perfis_usuarios.status — mas isso é barreira de FRONTEND. Qualquer
--   portador de um JWT ainda válido (o conector MCP, um curl com o token do
--   navegador, uma aba aberta antes da inativação) seguia lendo o CRM inteiro.
--
--   Ou seja: "inativar membro" nunca revogou acesso a dado, só esconder a UI.
--
-- Depois desta migration, inativar passa a cortar o acesso no banco, que é
-- onde tem efeito.
--
-- VALORES DE status
--   O app só produz dois valores, e isso é imposto por zod em
--   src/lib/data.functions.ts:755 — `z.enum(["ativo", "inativo"])` no
--   setMemberStatus. O default da coluna é 'ativo'
--   (20260529155105 e 20260529160522 inserem 'ativo').
--
--   A coluna é text sem CHECK, então um valor inesperado inserido à mão é
--   possível. Por isso a condição é `IS DISTINCT FROM 'inativo'` e não
--   `= 'ativo'`: valor desconhecido ou NULL NÃO tranca ninguém de fora, só o
--   'inativo' explícito tranca. Errar para o lado de não derrubar a equipe.
--
--   Confirme o que existe de verdade antes de aplicar:
--     SELECT coalesce(status,'(null)') AS status, count(*)
--       FROM public.perfis_usuarios GROUP BY 1 ORDER BY 2 DESC;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Guarda: a função tem que existir (parte 1 aplicada).
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Aplique 20261002170000_rls_endurecer_tabelas_abertas.sql primeiro: '
      'public.eh_equipe_interna(uuid) nao existe.';
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 2) Nova definição.
--
--    CREATE OR REPLACE mantém a assinatura, então as ~20 policies que
--    referenciam a função continuam válidas sem precisar ser recriadas.
--
--    Segue STABLE SECURITY DEFINER com search_path fixo e referência
--    qualificada por schema, igual antes.
-- ---------------------------------------------------------------------------
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
       AND status IS DISTINCT FROM 'inativo'
  )
$fn$;

COMMENT ON FUNCTION public.eh_equipe_interna(uuid) IS
  'true para cargo Admin, Membro ou Supervisor com conta ATIVA. Diferente de '
  'tem_perfil(), que aceita o cargo Cliente e ignora status. Use esta em '
  'policy de dado interno.';

-- ---------------------------------------------------------------------------
-- 3) Verificação: a função tem que ter o corte de status no corpo.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  corpo text;
BEGIN
  SELECT prosrc INTO corpo
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'eh_equipe_interna';

  IF corpo IS NULL THEN
    RAISE EXCEPTION 'eh_equipe_interna desapareceu.';
  END IF;
  IF corpo NOT LIKE '%status%' THEN
    RAISE EXCEPTION 'eh_equipe_interna nao ficou com o corte de status.';
  END IF;

  RAISE NOTICE 'eh_equipe_interna agora exige conta ativa.';
END
$do$;

COMMIT;

-- ---------------------------------------------------------------------------
-- NOTAS
--
-- (A) O QUE MUDA NA PRÁTICA
--
--     Inativar um membro passa a revogar, no banco, o acesso dele a tudo que
--     depende de eh_equipe_interna: tarefas, clientes, projetos, pastas,
--     checklist, comentários, ideias, planos, organograma, murais,
--     aniversariantes, compartilhamentos, perfis e os buckets 'contratos' e
--     'aniversariantes' do storage.
--
--     Nada muda para quem está ativo.
--
-- (B) ISTO NÃO É SÓ PARA O MCP
--
--     O conector MCP foi o que expôs o problema, mas o furo valia para
--     qualquer JWT: o token do navegador de uma sessão aberta antes da
--     inativação continuava funcionando até expirar. O MCP agravava porque o
--     grant dura semanas, não minutos.
--
-- (C) tem_perfil() NÃO foi alterada
--
--     Ela continua significando "é convidado da agência", sem olhar cargo nem
--     status, e é o que sustenta o invite-only em perfis_usuarios. Mexer nela
--     mudaria o comportamento do RESTRICTIVE "Exige perfil interno" em 15
--     tabelas, sem necessidade: onde importa, o "Exige equipe interna" já
--     combina por AND.
--
-- (D) O LADO DO MCP
--
--     Esta migration corta o acesso a DADO. Ela não revoga o grant OAuth: o
--     token MCP continua existindo e as ferramentas passam a responder vazio
--     ou erro de permissão. O tokenExchangeCallback do Worker reconfere a
--     elegibilidade a cada refresh e chama revokeGrant quando o usuário deixa
--     de ser elegível, o que derruba o grant de vez. As duas coisas são
--     necessárias: uma fecha o dado, a outra encerra a credencial.
-- ---------------------------------------------------------------------------
