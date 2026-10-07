-- Escrita em tarefa_responsaveis passa a exigir que a TAREFA seja visível.
--
-- O FURO
--   As policies de tarefa_responsaveis eram:
--     PERMISSIVE  ALL     "Autenticados gerenciam responsaveis"  tem_perfil
--     RESTRICTIVE ALL     "Exige equipe interna"
--     RESTRICTIVE ALL     "Exige perfil interno"
--     RESTRICTIVE SELECT  "Responsaveis de tarefa de Admin so para Admins"
--   Nenhuma olhava a tarefa na ESCRITA. Então um Membro conseguia, pelo REST
--   com o próprio JWT, inserir responsável numa tarefa que ele não vê: tarefa
--   de Admin, lembrete pessoal de outra pessoa — e o trigger de designação
--   mandava e-mail para quem ele escolhesse.
--
-- A CORREÇÃO
--   Três RESTRICTIVE, uma por comando de escrita, com o mesmo predicado de
--   comentarios_tarefa e tarefa_checklist_itens: EXISTS em tarefas. O EXISTS
--   roda sob o RLS de tarefas, então "visível" significa exatamente o que o
--   usuário enxerga (tarefa de Admin só para is_admin, lembrete pessoal só do
--   autor). O SELECT fica como está, de propósito: não é o furo, e mexer nele
--   mudaria o que o app e o MCP leem.
--
--   TO public, e não só authenticated: RESTRICTIVE só vale para os papéis
--   listados, e não há motivo para deixar anon de fora da regra.
--   service_role tem BYPASSRLS e não é afetado (email-daily, painel público).
--
-- OS FLUXOS DO APP CONTINUAM FUNCIONANDO (todos conferidos, e o ensaio prova)
--   createTarefa, aceitarDemanda, aceitarDemandaArte: inserem responsáveis
--     numa tarefa que o próprio usuário acabou de criar.
--   updateTarefa: apaga e insere responsáveis numa tarefa que o usuário vê.
--   deleteTarefa: apaga responsáveis antes da tarefa, que o usuário vê.
--
--   O caso delicado é o Membro que designa um Admin. A tarefa vira "de Admin"
--   (tarefa_de_admin) e some para ele no meio da operação. Isso NÃO quebra o
--   app porque ele insere todos os responsáveis num INSERT só: o WITH CHECK de
--   cada linha não enxerga as linhas inseridas pelo mesmo comando. Um SEGUNDO
--   INSERT, depois que o Admin entrou, é barrado — o conector MCP também
--   insere tudo de uma vez por isso.
--
-- Ensaio: supabase/tests/ensaio_responsaveis_herda_tarefa.sql
-- Rollback: supabase/tests/rollback_responsaveis_herda_tarefa.sql

BEGIN;

DO $do$
BEGIN
  IF to_regclass('public.tarefa_responsaveis') IS NULL OR to_regclass('public.tarefas') IS NULL THEN
    RAISE EXCEPTION 'tarefas/tarefa_responsaveis nao existem.';
  END IF;
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL THEN
    RAISE EXCEPTION 'eh_equipe_interna ausente: aplique as partes 1–5 antes.';
  END IF;
END
$do$;

-- "Exige equipe interna" já existe em produção (parte 2). Criada aqui só se
-- tiver sumido, para a migration não depender disso.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'tarefa_responsaveis'
       AND policyname = 'Exige equipe interna'
  ) THEN
    CREATE POLICY "Exige equipe interna" ON public.tarefa_responsaveis
      AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.eh_equipe_interna((SELECT auth.uid())))
      WITH CHECK (public.eh_equipe_interna((SELECT auth.uid())));
    RAISE NOTICE 'Exige equipe interna criada (nao existia).';
  END IF;
END
$do$;

DROP POLICY IF EXISTS "Inserir responsavel exige ver a tarefa" ON public.tarefa_responsaveis;
DROP POLICY IF EXISTS "Alterar responsavel exige ver a tarefa" ON public.tarefa_responsaveis;
DROP POLICY IF EXISTS "Remover responsavel exige ver a tarefa" ON public.tarefa_responsaveis;

CREATE POLICY "Inserir responsavel exige ver a tarefa" ON public.tarefa_responsaveis
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_responsaveis.tarefa_id));

CREATE POLICY "Alterar responsavel exige ver a tarefa" ON public.tarefa_responsaveis
  AS RESTRICTIVE FOR UPDATE TO public
  USING (EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_responsaveis.tarefa_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_responsaveis.tarefa_id));

CREATE POLICY "Remover responsavel exige ver a tarefa" ON public.tarefa_responsaveis
  AS RESTRICTIVE FOR DELETE TO public
  USING (EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_responsaveis.tarefa_id));

DO $do$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'tarefa_responsaveis'
     AND permissive = 'RESTRICTIVE'
     AND policyname IN ('Inserir responsavel exige ver a tarefa',
                        'Alterar responsavel exige ver a tarefa',
                        'Remover responsavel exige ver a tarefa');
  IF n <> 3 THEN
    RAISE EXCEPTION 'esperava 3 policies novas RESTRICTIVE, ha %', n;
  END IF;
END
$do$;

COMMIT;
