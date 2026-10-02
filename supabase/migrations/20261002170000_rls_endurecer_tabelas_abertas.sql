-- Endurece o RLS separando EQUIPE INTERNA de CLIENTE.
--
-- O problema de fundo: `tem_perfil()` só checa se existe linha em
-- perfis_usuarios, sem olhar cargo. Como o cargo 'Cliente' TEM perfil, todo
-- RESTRICTIVE "Exige perfil interno" espalhado pelo projeto deixa o cliente
-- externo passar. Esta migration cria `eh_equipe_interna()` e usa essa função
-- para fechar o que é interno.
--
-- Motivação prática: o app acessa várias dessas tabelas com a service role
-- (RLS ignorado) e autoriza no código. O servidor MCP usa sempre o JWT do
-- usuário, então para ele o RLS é o único portão.
--
-- DECISÕES tomadas (não são suposições):
--   - projetos, pastas_links, pastas_links_itens: toda a equipe interna lê,
--     edita e exclui, como já é hoje. Sem noção de dono.
--   - Supervisor segue contando como admin (is_admin já inclui Supervisor).
--   - Cliente não lê preços de plano.
--   - Nada de policy nova em tarefa_responsaveis para "só admin atribui admin".
--
-- !! LEIA A NOTA (A) NO FIM ANTES DE APLICAR: `clientes` recebeu tratamento
-- !! diferente do pedido, porque o RESTRICTIVE puro quebraria o portal do
-- !! Cliente. É o único ponto que foge do combinado e precisa do seu aval.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) eh_equipe_interna(): quem é da agência, por cargo.
--
--    Cargos reais do enum public.cargo_usuario, na ordem em que entraram:
--      'Admin'      (inicial)                      -> INTERNO
--      'Membro'     (inicial)                      -> INTERNO
--      'Cliente'    (20260611131432, ADD VALUE)    -> EXTERNO
--      'Supervisor' (20260619145640, ADD VALUE)    -> INTERNO
--
--    Comparo com cargo::text em vez do literal do enum, igual is_admin() faz,
--    para não depender da resolução do tipo.
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
  )
$fn$;

REVOKE EXECUTE ON FUNCTION public.eh_equipe_interna(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.eh_equipe_interna(uuid) TO authenticated;

COMMENT ON FUNCTION public.eh_equipe_interna(uuid) IS
  'true para cargo Admin, Membro ou Supervisor. Diferente de tem_perfil(), '
  'que também aceita o cargo Cliente. Use esta em policy de dado interno.';

-- Qual empresa é a do usuário logado. SECURITY DEFINER de propósito: usada na
-- policy de `clientes`, ela não pode depender do RLS de perfis_usuarios, senão
-- apertar perfis_usuarios no futuro cegaria o portal do Cliente de novo. Mesmo
-- padrão de get_meu_plano(), que já existe no projeto.
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
-- 2) Rede de segurança: garante que o RLS está de fato ligado.
--    Policy sem RLS habilitado não protege nada, e isso não aparece em
--    pg_policies.
-- ---------------------------------------------------------------------------
ALTER TABLE public.configuracoes_planos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pastas_links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pastas_links_itens     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarefa_checklist_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideias                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projetos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarefas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarefa_responsaveis    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes               ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3) Remove as policies abertas SEM depender do nome delas.
--
--    Cinco das seis tabelas abertas (pastas_links, pastas_links_itens,
--    projetos, tarefa_checklist_itens, ideias) não têm migration local
--    nenhuma: existem só em produção. Não há nome confiável para dar DROP. O
--    seletor abaixo é por CONDIÇÃO: só remove policy PERMISSIVE, do role
--    `authenticated`, cuja condição é literalmente `true` nos dois lados.
--    Policy com condição real (ex. a de INSERT de `ideias`, que checa
--    criado_por) não casa e fica intacta.
--
--    Recriar o equivalente aberto logo depois pode parecer inútil, mas não é:
--    assim as permissivas passam a ter nome conhecido e documentado, e quem
--    barra o Cliente é o RESTRICTIVE do passo 4.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY (ARRAY[
             'configuracoes_planos', 'pastas_links', 'pastas_links_itens',
             'tarefa_checklist_itens', 'ideias', 'projetos'
           ])
       AND permissive = 'PERMISSIVE'
       AND 'authenticated' = ANY (roles)
       AND coalesce(qual, 'true') = 'true'
       AND coalesce(with_check, 'true') = 'true'
     ORDER BY tablename, policyname
  LOOP
    RAISE NOTICE 'Removendo policy aberta: %.% -> "%" (%)',
      r.schemaname, r.tablename, r.policyname, r.cmd;
    EXECUTE format('DROP POLICY %I ON %I.%I',
                   r.policyname, r.schemaname, r.tablename);
    n := n + 1;
  END LOOP;

  RAISE NOTICE '% policy(s) aberta(s) removida(s).', n;

  IF n = 0 THEN
    RAISE WARNING 'Nenhuma policy aberta encontrada: confirme em pg_policies se o estado do banco e o esperado antes de seguir.';
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 4) RESTRICTIVE "Exige equipe interna".
--
--    RESTRICTIVE combina com AND sobre TODAS as permissivas, atuais e
--    futuras. É o que impede drift de nome de reabrir acesso, e é o que agora
--    barra tanto conta sem perfil (demandante do portal externo) quanto o
--    cargo Cliente.
--
--    `clientes` NÃO entra nesta lista: ver passo 7 e a nota (A).
--
--    O RESTRICTIVE "Exige perfil interno" que já existe em tarefas,
--    tarefa_responsaveis, clientes, comentarios_tarefa e perfis_usuarios foi
--    MANTIDO de propósito. Não removi nada. Os dois se somam com AND, e como
--    equipe interna é subconjunto de quem tem perfil, o resultado é
--    exatamente "equipe interna" — o antigo fica redundante, não conflitante.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'configuracoes_planos', 'pastas_links', 'pastas_links_itens',
    'tarefa_checklist_itens', 'ideias', 'projetos',
    'tarefas', 'tarefa_responsaveis'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Exige equipe interna" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Exige equipe interna" ON public.%I'
      ' AS RESTRICTIVE FOR ALL TO authenticated'
      ' USING (public.eh_equipe_interna((select auth.uid())))'
      ' WITH CHECK (public.eh_equipe_interna((select auth.uid())))', t);
    RAISE NOTICE 'RESTRICTIVE "Exige equipe interna" aplicada em public.%', t;
  END LOOP;
END
$do$;

-- ---------------------------------------------------------------------------
-- 5) projetos, pastas_links, pastas_links_itens: equipe interna gerencia
--    tudo, sem noção de dono. Mesma liberdade de hoje, só sem o Cliente.
--
--    criado_por continua existindo para rastreabilidade e ganha DEFAULT
--    (select auth.uid()). Nenhuma policy olha essa coluna, então linha
--    legada com criado_por NULL não perde nada.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Equipe interna gerencia projetos" ON public.projetos;
CREATE POLICY "Equipe interna gerencia projetos" ON public.projetos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Equipe interna gerencia pastas" ON public.pastas_links;
CREATE POLICY "Equipe interna gerencia pastas" ON public.pastas_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Equipe interna gerencia itens de pasta"
  ON public.pastas_links_itens;
CREATE POLICY "Equipe interna gerencia itens de pasta" ON public.pastas_links_itens
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Sem `(select ...)` aqui: Postgres não aceita subquery em expressão de
-- DEFAULT ("cannot use subquery in DEFAULT expression"). O idioma
-- `(select auth.uid())` existe para policy, onde vira InitPlan e é avaliado uma
-- vez por query; em DEFAULT não há esse ganho e a forma com subquery nem
-- compila.
ALTER TABLE public.projetos
  ALTER COLUMN criado_por SET DEFAULT auth.uid();
ALTER TABLE public.pastas_links
  ALTER COLUMN criado_por SET DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_pastas_links_itens_pasta_id
  ON public.pastas_links_itens (pasta_id);

-- ---------------------------------------------------------------------------
-- 6) tarefa_checklist_itens: herda a visibilidade da tarefa-mãe.
--
--    A subquery é avaliada COM o RLS de `public.tarefas`, porque a policy roda
--    como o usuário chamador (não é SECURITY DEFINER). Então o item só aparece
--    se a tarefa aparece — incluindo os cortes de lembrete pessoal e de tarefa
--    de Admin, sem repetir nenhum deles aqui.
--
--    FK confirmada em src/integrations/supabase/types.ts:
--    tarefa_checklist_itens_tarefa_id_fkey (tarefa_id) -> tarefas(id).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Checklist herda a visibilidade da tarefa"
  ON public.tarefa_checklist_itens;
CREATE POLICY "Checklist herda a visibilidade da tarefa"
  ON public.tarefa_checklist_itens
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.id = tarefa_checklist_itens.tarefa_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.id = tarefa_checklist_itens.tarefa_id
    )
  );

CREATE INDEX IF NOT EXISTS idx_tarefa_checklist_itens_tarefa_id
  ON public.tarefa_checklist_itens (tarefa_id);

-- ---------------------------------------------------------------------------
-- 7) clientes: equipe interna vê tudo; o Cliente vê SÓ a própria empresa.
--
--    Aqui é o desvio do pedido. Ver nota (A).
--
--    O RESTRICTIVE antigo "Exige perfil interno" continua em clientes e segue
--    barrando conta sem perfil. Este novo RESTRICTIVE acrescenta o corte por
--    cargo sem cegar o portal.
-- ---------------------------------------------------------------------------
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
-- 8) ideias e configuracoes_planos: leitura segue aberta, e quem fecha para o
--    Cliente é o RESTRICTIVE do passo 4. As policies de escrita que já
--    existem em `ideias` NÃO foram tocadas.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Equipe interna le ideias" ON public.ideias;
CREATE POLICY "Equipe interna le ideias" ON public.ideias
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Equipe interna le planos" ON public.configuracoes_planos;
CREATE POLICY "Equipe interna le planos" ON public.configuracoes_planos
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 9) tarefas: "Tarefas de Admin so para Admins" passa de SELECT para ALL.
--
--    Hoje a policy só cobre SELECT, então um não-admin que souber o id de uma
--    tarefa de Admin consegue UPDATE e DELETE nela: a permissiva de UPDATE
--    aceita `escopo = 'geral'`, e nenhuma restritiva barra escrita. É esse o
--    buraco que o FOR ALL fecha.
--
--    Sobre INSERT: `tarefa_de_admin(id)` olha tarefa_responsaveis, e no INSERT
--    da tarefa ainda não existe responsável (a FK obriga a tarefa a vir
--    primeiro). A função devolve false, `NOT false` é true, e o WITH CHECK
--    passa SEMPRE. O braço de INSERT é VÁCUO: não quebra nada, e também não
--    protege nada. É inerente a uma condição que depende de linha filha.
--
--    is_admin() inclui Supervisor — decisão confirmada, mantido.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Tarefas de Admin so para Admins" ON public.tarefas;
CREATE POLICY "Tarefas de Admin so para Admins" ON public.tarefas
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_admin((select auth.uid()))
    OR NOT public.tarefa_de_admin(id)
  )
  WITH CHECK (
    public.is_admin((select auth.uid()))
    OR NOT public.tarefa_de_admin(id)
  );

COMMIT;

-- ---------------------------------------------------------------------------
-- NOTAS
--
-- (A) POR QUE `clientes` NÃO LEVOU O RESTRICTIVE PURO  <<< PRECISA DO SEU OK
--
--     Um RESTRICTIVE "Exige equipe interna" em `clientes` quebraria o portal
--     do Cliente, em silêncio. O caminho exato:
--
--       src/routes/_authenticated/index.tsx:59  cargo === 'Cliente' -> <ClientPortal/>
--       src/components/portal/ClientPortal.tsx:52  <PortalHome cliente={ctx?.cliente_nome} plano={ctx?.plano}/>
--       src/lib/data.functions.ts:645  getMyPortalContext, middleware requireSupabaseAuth
--       src/lib/data.functions.ts:651  .select("nome, email, cargo, cliente_id,
--                                       clientes:cliente_id(nome_empresa, plano)")
--
--     Esse `clientes:cliente_id(...)` é join embutido do PostgREST, executado
--     com o JWT do próprio Cliente — não com a service role. Fechando
--     `clientes` para ele, o join devolve null, `cliente_nome` e `plano` ficam
--     null, e o PortalHome só renderiza o card "Sua empresa" quando
--     `cliente` é truthy (ClientPortal.tsx:81). Resultado: o card desaparece
--     sem erro nenhum. O portal fica só com "Olá, Nome!".
--
--     A policy do passo 7 resolve os dois lados: o Cliente passa a ler
--     exclusivamente a linha da própria empresa (hoje ele lê a lista INTEIRA
--     de clientes da agência, com e-mail, documento, endereço e plano de todo
--     mundo — essa é a correção que importa), e o portal continua funcionando.
--     O WITH CHECK não tem a cláusula do cliente_id de propósito: ler a
--     própria empresa, sim; escrever nela, não.
--
--     Se preferir fechar de vez e aceitar perder o card, troque o passo 7 por:
--
--       CREATE POLICY "Exige equipe interna" ON public.clientes
--         AS RESTRICTIVE FOR ALL TO authenticated
--         USING (public.eh_equipe_interna((select auth.uid())))
--         WITH CHECK (public.eh_equipe_interna((select auth.uid())));
--
-- (B) O QUE O CLIENTE AINDA LÊ DEPOIS DESTA MIGRATION
--
--     `perfis_usuarios` tem "Autenticados podem ver perfis" FOR SELECT com
--     USING (tem_perfil(auth.uid())) desde 20260818162613 — não é USING(true),
--     mas dá no mesmo para o Cliente, que tem perfil. Então ele lê nome,
--     e-mail e cargo de TODA a equipe.
--
--     Isso, mais comentarios_tarefa e aniversariantes, está tratado na parte 2:
--     20261002180000_rls_equipe_interna_resto.sql, que deve ser aplicada junto
--     com esta.
--
-- (C) search_path das funções existentes: nada a fazer
--     As três já são SECURITY DEFINER com search_path fixo e todas as
--     referências internas qualificadas por schema:
--       tem_perfil(uuid)       STABLE SECURITY DEFINER SET search_path = public
--       is_admin(uuid)         STABLE SECURITY DEFINER SET search_path TO 'public'
--       tarefa_de_admin(uuid)  STABLE SECURITY DEFINER SET search_path = public
--     A nova eh_equipe_interna() segue o mesmo padrão.
--
-- (D) tem_perfil() continua em uso em OUTRAS tabelas, com o mesmo furo
--     Além das que esta migration cobre, tem_perfil() é o único corte em:
--       comentarios_tarefa, perfis_usuarios   (20260818162613 / 20260818165500)
--       organograma_nos                        (20260825162449)
--       compartilhamentos                      (20260916120000)
--       mural_quadros, mural_itens             (20260929120000)
--       murais                                 (20261002120000)
--       aniversariantes, aniversariante_visualizacoes (20261001120000)
--     Em todas elas o cargo Cliente passa hoje. Se a intenção é que Cliente
--     não veja organograma, mural e aniversariantes, isso é uma segunda
--     migration trocando tem_perfil por eh_equipe_interna — me diga e eu monto.
-- ---------------------------------------------------------------------------
