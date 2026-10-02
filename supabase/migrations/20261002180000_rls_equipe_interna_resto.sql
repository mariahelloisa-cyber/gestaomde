-- Parte 2 do corte "equipe interna vs. Cliente". Aplicar JUNTO com
-- 20261002170000_rls_endurecer_tabelas_abertas.sql, que cria
-- eh_equipe_interna() e meu_cliente_id() — esta migration depende das duas.
--
-- Cobre as tabelas que ficaram de fora da parte 1 e cujo único corte era
-- tem_perfil(), que aceita o cargo Cliente.
--
-- Furos REAIS que esta migration fecha (as demais tabelas já estavam
-- protegidas por condição de dono ou de cargo; ver a nota (E) no fim):
--   comentarios_tarefa  -> hoje o Cliente lê TODO comentário de TODA tarefa
--   perfis_usuarios     -> hoje o Cliente lê nome/e-mail/cargo de TODA a equipe
--   aniversariantes     -> hoje o Cliente lê a lista de aniversariantes
--
-- E, de quebra, fecha para a equipe interna um vazamento que espelha o do
-- checklist: hoje qualquer membro lê comentário de tarefa de Admin e de
-- lembrete pessoal de outro. Ver nota (C).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Pré-condição explícita: as funções da parte 1 têm que existir.
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Aplique 20261002170000_rls_endurecer_tabelas_abertas.sql primeiro: '
      'public.eh_equipe_interna(uuid) nao existe.';
  END IF;
  IF to_regprocedure('public.meu_cliente_id()') IS NULL THEN
    RAISE EXCEPTION
      'Aplique 20261002170000_rls_endurecer_tabelas_abertas.sql primeiro: '
      'public.meu_cliente_id() nao existe.';
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 2) Rede de segurança: RLS ligado.
-- ---------------------------------------------------------------------------
ALTER TABLE public.comentarios_tarefa           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfis_usuarios              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organograma_nos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compartilhamentos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.murais                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mural_quadros                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mural_itens                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aniversariantes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aniversariante_visualizacoes ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3) RESTRICTIVE "Exige equipe interna" nas tabelas sem fluxo de Cliente.
--
--    `perfis_usuarios` NÃO entra: fechar em bloco desloga o Cliente. Ver
--    passo 5 e a nota (A).
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'comentarios_tarefa', 'organograma_nos', 'compartilhamentos',
    'murais', 'mural_quadros', 'mural_itens',
    'aniversariantes', 'aniversariante_visualizacoes'
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
-- 4) comentarios_tarefa: herda a visibilidade da tarefa-mãe.
--
--    Entra como RESTRICTIVE, não como substituição da permissiva de SELECT.
--    Dois motivos: combina com AND sobre as policies de autor que já existem
--    ("Autenticados criam comentarios", "Autor edita comentario", "Autor
--    exclui comentario") sem precisar tocá-las, e por ser FOR ALL também fecha
--    o INSERT — hoje dá para comentar numa tarefa que você não enxerga.
--
--    FK confirmada em src/integrations/supabase/types.ts:
--    comentarios_tarefa_tarefa_id_fkey (tarefa_id) -> tarefas(id).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Comentario herda a visibilidade da tarefa"
  ON public.comentarios_tarefa;
CREATE POLICY "Comentario herda a visibilidade da tarefa"
  ON public.comentarios_tarefa
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.id = comentarios_tarefa.tarefa_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.id = comentarios_tarefa.tarefa_id
    )
  );

CREATE INDEX IF NOT EXISTS idx_comentarios_tarefa_tarefa_id
  ON public.comentarios_tarefa (tarefa_id);

-- ---------------------------------------------------------------------------
-- 5) perfis_usuarios: equipe interna lê todos; Cliente lê só a própria linha.
--
--    A policy de SELECT em vigor é "Autenticados podem ver perfis" com
--    USING (tem_perfil(auth.uid())) — ou seja, hoje o Cliente lê a equipe
--    inteira. Substituo a condição mantendo o nome, porque este nome está
--    documentado em 20260818162613 e é estável.
--
--    O RESTRICTIVE "Exige perfil interno" (tem_perfil) continua intacto: é ele
--    que barra conta sem perfil e sustenta o fluxo invite-only. Não acrescento
--    "Exige equipe interna" aqui — ver nota (A).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Autenticados podem ver perfis" ON public.perfis_usuarios;
CREATE POLICY "Autenticados podem ver perfis" ON public.perfis_usuarios
  FOR SELECT TO authenticated
  USING (
    public.eh_equipe_interna((select auth.uid()))
    OR id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 6) aniversariantes: a permissiva de SELECT usava tem_perfil. Troco por
--    eh_equipe_interna para a intenção ficar legível na própria policy, além
--    do RESTRICTIVE do passo 3. As de escrita (is_admin) não foram tocadas.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Equipe ve aniversariantes" ON public.aniversariantes;
CREATE POLICY "Equipe ve aniversariantes" ON public.aniversariantes
  FOR SELECT TO authenticated
  USING (public.eh_equipe_interna((select auth.uid())));

-- ---------------------------------------------------------------------------
-- 7) storage.objects do bucket 'aniversariantes'.
--
--    Fechar só a tabela `aniversariantes` não bastava: a policy de storage
--    criada em 20261001120000:165 libera o bucket para QUALQUER authenticated,
--    sem corte de cargo. Um Cliente que soubesse o caminho do arquivo baixaria
--    a imagem direto do Storage, driblando o RLS da tabela.
--
--    Só o SELECT muda. As de INSERT e UPDATE do bucket já exigem is_admin(),
--    que é interno por construção.
--
--    Mexer em policy de storage.objects funciona neste projeto: a própria
--    20261001120000 e a 20260529150403 fazem isso e foram aplicadas.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Aniversariantes: leitura autenticada" ON storage.objects;
CREATE POLICY "Aniversariantes: leitura autenticada"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'aniversariantes'
    AND public.eh_equipe_interna((select auth.uid()))
  );

COMMIT;

-- ---------------------------------------------------------------------------
-- NOTAS
--
-- (A) POR QUE perfis_usuarios NÃO LEVOU O RESTRICTIVE EM BLOCO
--
--     Fechar perfis_usuarios para "só equipe interna" não esconderia dado do
--     Cliente: ela o DESLOGARIA, com toast de "Acesso negado". Os três pontos
--     que leem a própria linha com o JWT do Cliente:
--
--       src/routes/_authenticated.tsx:24   .from("perfis_usuarios")
--                                          .select("id, status").eq("id", user.id)
--         -> se vier null, faz supabase.auth.signOut() e manda para /login
--            com "Acesso negado: Você precisa de um convite da agência".
--            Roda no NAVEGADOR, com o client do usuário, para TODO usuário
--            autenticado — inclusive Cliente.
--
--       src/routes/auth/callback.tsx:23    mesma consulta, mesmo signOut
--         -> quebraria o login do Cliente logo depois do magic link.
--
--       src/lib/data.functions.ts:651      getMyPortalContext, requireSupabaseAuth
--         -> lê a própria linha + join clientes:cliente_id(...)
--
--     A policy do passo 5 atende os três (`id = (select auth.uid())`) e ainda
--     tira do Cliente a lista da equipe. O código interno já ignora perfil de
--     Cliente ao montar a equipe (data.functions.ts:120 e
--     painel-publico.functions.ts:88 filtram cargo <> 'Cliente'), então nada
--     muda para quem é de dentro.
--
-- (B) compartilhamentos: o que é, e por que nenhum fluxo externo depende de JWT
--
--     É a tabela de links públicos de compartilhamento (20260916120000): um
--     `token` uuid único aponta para uma tarefa (tipo='tarefa') ou para uma
--     coluna do Kanban com os filtros ativos (tipo='coluna', com status,
--     cliente_id, membro_id), mais expira_em, revogado_em, acessos e
--     ultimo_acesso_em.
--
--     CONFIRMADO: o lado externo NÃO usa JWT. As rotas públicas
--     /compartilhado/$token e /painel-publico/$token resolvem o token em
--     src/lib/compartilhamento.functions.ts e src/lib/painel-publico.functions.ts,
--     e as duas importam src/integrations/supabase/client.server.ts, que é a
--     service role — RLS ignorado. Não existe nenhuma policy `TO anon` em todo
--     o projeto (grep "TO anon" nas migrations: zero).
--
--     As permissivas dessa tabela já checavam cargo IN ('Admin','Supervisor',
--     'Membro'), então aqui o RESTRICTIVE é só cinto e suspensório.
--
-- (C) comentarios_tarefa aperta TAMBÉM para a equipe interna
--
--     Hoje a permissiva de SELECT é só tem_perfil(), então qualquer membro lê
--     comentário de tarefa de Admin e de lembrete pessoal de outra pessoa —
--     o mesmo vazamento que o checklist tinha. Com a herança do passo 4, o
--     comentário só aparece se a tarefa aparecer. É um aperto desejado, mas é
--     mudança de comportamento para usuário interno, não só para Cliente.
--
-- (D) AS OUTRAS POLICIES DE storage.objects CONTINUAM ABERTAS PARA O CLIENTE
--
--     O passo 7 fecha só o bucket 'aniversariantes'. Todas as policies de
--     storage.objects deste projeto são por bucket (nenhuma é USING(true)), e
--     estas três seguem liberadas para qualquer authenticated, logo também
--     para o cargo Cliente:
--
--       'contratos'          20260529150403: SELECT, INSERT, UPDATE e DELETE
--                            TO authenticated USING (bucket_id = 'contratos')
--                            -> contrato assinado de TODOS os clientes, e o
--                               Cliente pode até APAGAR. É o pior dos três.
--       'treinamentos-pdfs'  estado INCERTO, precisa de pg_policies ao vivo.
--                            20260611133744 criou "Auth pode ler pdfs de
--                            treinamentos" (SELECT TO authenticated, aberta).
--                            20260615114822 tentou substituir por uma versão
--                            escopada por plano, mas os DROP POLICY IF EXISTS
--                            dela usam os nomes "treinamentos pdfs select
--                            authenticated" e "treinamentos-pdfs select
--                            authenticated" — nenhum dos dois é o nome que
--                            20260611133744 criou. Ou seja, a aberta pode ter
--                            sobrevivido ao lado da nova, e permissivas se
--                            somam com OR. Complica mais: a nova faz subquery
--                            em public.treinamentos, que NÃO existe em
--                            produção. Confira os dois nomes em pg_policies
--                            antes de concluir qualquer coisa.
--       'demandas-anexos'    20260603150020 + 20260611142617: SELECT e INSERT
--                            sem TO, ou seja valendo até para anon — isso é
--                            INTENCIONAL, o portal público de demandas precisa.
--
--     Não incluí porque você pediu só o bucket de aniversariantes. O de
--     'contratos' eu trataria com urgência: diga e eu monto a parte 3.
--
-- (E) POR QUE AS OUTRAS TABELAS DA LISTA NÃO ERAM FURO
--
--     Pedi atenção a elas e o RESTRICTIVE entrou como defesa, mas vale
--     registrar que nenhuma vazava hoje:
--       organograma_nos      permissivas já exigem cargo IN ('Admin','Supervisor','Membro')
--       compartilhamentos    idem
--       murais               "Dono gerencia seus murais": usuario_id = auth.uid()
--       mural_quadros        "Dono ...": usuario_id = auth.uid()
--       mural_itens          "Dono ...": usuario_id = auth.uid()
--       aniversariante_visualizacoes  "Dono ...": usuario_id = auth.uid()
--     Nas de dono, um Cliente só veria o mural dele próprio — que ele nunca
--     cria, porque não tem a tela. O RESTRICTIVE agora garante isso por
--     construção, e não por ausência de UI.
--
-- (F) DEPOIS DAS PARTES 1 E 2, NÃO SOBRA TABELA CORTADA SÓ POR tem_perfil()
--
--     Varri todas as policies das migrations. As tabelas que ainda não foram
--     citadas acima já têm corte mais forte que tem_perfil, então o cargo
--     Cliente não as alcança:
--       financeiro_transacoes   is_admin  (20260611142617 trocou o USING(true))
--       convites                is_admin  (20260529132522)
--       configuracoes_sistema   is_admin  (20260602124315)
--       email_logs              is_admin  (20260611142617 trocou o USING(true))
--       demandas_externas       is_admin no SELECT (20260622111443);
--                               UPDATE/DELETE responsavel_id OU is_admin
--       demandas_externas_usuarios  auth.uid() = id (só a própria linha)
--
--     Ou seja, a lista de tem_perfil em policy fica zerada depois destas duas
--     migrations. tem_perfil() continua existindo e continua útil como
--     "é convidado da agência" — é o que sustenta o invite-only em
--     perfis_usuarios. O que muda é que ela deixa de ser usada como se fosse
--     "é da equipe interna".
-- ---------------------------------------------------------------------------
