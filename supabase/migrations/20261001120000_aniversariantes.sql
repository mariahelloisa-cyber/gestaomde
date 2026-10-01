-- Módulo Aniversariantes.
--
-- Cadastro mensal (nome, data COM ano, arte e mensagem), pop-up automático no
-- primeiro acesso de cada membro no dia, controle de publicação compartilhado
-- pela equipe e link público reaproveitando public.compartilhamentos.
--
-- A data é um `date` puro (sem timezone): quem decide "hoje" é a aplicação,
-- sempre em America/Sao_Paulo (ver src/lib/aniversariantes.ts). Assim o fuso do
-- servidor nunca antecipa nem atrasa um aniversário.
--
-- Este script é RE-EXECUTÁVEL: rodar de novo converge para o estado correto sem
-- apagar dado nenhum. Isso é proposital — o banco de produção já divergiu das
-- migrations locais antes, então aqui tudo é IF NOT EXISTS / DROP ... IF EXISTS.

CREATE TABLE IF NOT EXISTS public.aniversariantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 120),
  -- Com ano de propósito: o planejamento é cadastrado mês a mês e uma arte
  -- nunca é reaproveitada automaticamente no ano seguinte.
  data_comemoracao date NOT NULL,
  -- Arte/foto no bucket privado 'aniversariantes'.
  imagem_path text NOT NULL,
  imagem_nome text NOT NULL,
  imagem_tipo text NOT NULL DEFAULT 'image/jpeg',
  -- Mensagem crua: acentos, emojis e quebras de linha preservados.
  mensagem text NOT NULL CHECK (char_length(btrim(mensagem)) BETWEEN 1 AND 4000),
  -- Status de publicação no grupo do WhatsApp. É compartilhado entre a equipe e
  -- marcado à mão — nunca pelo simples clique em "Compartilhar". publicado_em é
  -- a fonte da verdade; publicado_por é informativo (vira NULL se o perfil sai).
  publicado_em timestamptz,
  publicado_por uuid REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL,
  criado_por uuid REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aniversariantes_data_idx ON public.aniversariantes (data_comemoracao);
CREATE INDEX IF NOT EXISTS aniversariantes_criado_por_idx ON public.aniversariantes (criado_por);

CREATE OR REPLACE FUNCTION public.tg_aniversariantes_updated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END
$fn$;

DROP TRIGGER IF EXISTS aniversariantes_updated ON public.aniversariantes;
CREATE TRIGGER aniversariantes_updated
  BEFORE UPDATE ON public.aniversariantes
  FOR EACH ROW EXECUTE FUNCTION public.tg_aniversariantes_updated();

-- Controle INDIVIDUAL de visualização do pop-up: uma linha por pessoa e por
-- aniversariante. Guardar por registro (e não só por data) faz o aniversariante
-- cadastrado depois aparecer no próximo acesso de quem já tinha visto o pop-up.
-- Separado de propósito do status de publicação, que é da equipe inteira.
CREATE TABLE IF NOT EXISTS public.aniversariante_visualizacoes (
  usuario_id uuid NOT NULL DEFAULT auth.uid()
    REFERENCES public.perfis_usuarios(id) ON DELETE CASCADE,
  aniversariante_id uuid NOT NULL
    REFERENCES public.aniversariantes(id) ON DELETE CASCADE,
  visto_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, aniversariante_id)
);

CREATE INDEX IF NOT EXISTS aniversariante_visualizacoes_aniversariante_idx
  ON public.aniversariante_visualizacoes (aniversariante_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.aniversariantes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aniversariante_visualizacoes TO authenticated;
GRANT ALL ON public.aniversariantes TO service_role;
GRANT ALL ON public.aniversariante_visualizacoes TO service_role;

ALTER TABLE public.aniversariantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aniversariante_visualizacoes ENABLE ROW LEVEL SECURITY;

-- Leitura: todo mundo da equipe vê os aniversariantes e o material.
DROP POLICY IF EXISTS "Equipe ve aniversariantes" ON public.aniversariantes;
CREATE POLICY "Equipe ve aniversariantes" ON public.aniversariantes
  FOR SELECT TO authenticated
  USING (public.tem_perfil(auth.uid()));

-- Gestão (cadastrar, editar, excluir): Admin e Supervisor. public.is_admin já
-- significa "Admin ou Supervisor" desde 20260619145657 — mesmo critério do
-- isAdminLike da interface.
DROP POLICY IF EXISTS "Gestao cadastra aniversariantes" ON public.aniversariantes;
CREATE POLICY "Gestao cadastra aniversariantes" ON public.aniversariantes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()) AND criado_por = auth.uid());

DROP POLICY IF EXISTS "Gestao edita aniversariantes" ON public.aniversariantes;
CREATE POLICY "Gestao edita aniversariantes" ON public.aniversariantes
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Gestao exclui aniversariantes" ON public.aniversariantes;
CREATE POLICY "Gestao exclui aniversariantes" ON public.aniversariantes
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- Cada pessoa só enxerga e grava as PRÓPRIAS visualizações: fechar o pop-up em
-- uma conta não dispensa o pop-up das outras.
DROP POLICY IF EXISTS "Dono gerencia suas visualizacoes" ON public.aniversariante_visualizacoes;
CREATE POLICY "Dono gerencia suas visualizacoes" ON public.aniversariante_visualizacoes
  FOR ALL TO authenticated
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

-- Mesmo cinto e suspensório das outras tabelas (ver 20260818165500): fecha tudo
-- para contas sem perfil interno, como as do portal de demandas.
DROP POLICY IF EXISTS "Exige perfil interno" ON public.aniversariantes;
CREATE POLICY "Exige perfil interno" ON public.aniversariantes
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

DROP POLICY IF EXISTS "Exige perfil interno" ON public.aniversariante_visualizacoes;
CREATE POLICY "Exige perfil interno" ON public.aniversariante_visualizacoes
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

-- "Marcar como publicado" é uma ação da EQUIPE, não da gestão: qualquer membro
-- que publicar no grupo precisa poder sinalizar isso (e desfazer, se marcou
-- errado). As policies de UPDATE acima são de Admin/Supervisor, então o resto
-- da equipe passa por esta função, que mexe só nas duas colunas de publicação.
CREATE OR REPLACE FUNCTION public.marcar_aniversariante_publicado(
  _id uuid,
  _publicado boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.tem_perfil(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  UPDATE public.aniversariantes
  SET publicado_em = CASE WHEN _publicado THEN now() ELSE NULL END,
      publicado_por = CASE WHEN _publicado THEN auth.uid() ELSE NULL END
  WHERE id = _id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aniversariante não encontrado.';
  END IF;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.marcar_aniversariante_publicado(uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.marcar_aniversariante_publicado(uuid, boolean) TO authenticated;

/* ---------------- Storage: bucket privado da arte ---------------- */

INSERT INTO storage.buckets (id, name, public)
VALUES ('aniversariantes', 'aniversariantes', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Aniversariantes: leitura autenticada" ON storage.objects;
CREATE POLICY "Aniversariantes: leitura autenticada"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'aniversariantes');

DROP POLICY IF EXISTS "Aniversariantes: gestao envia" ON storage.objects;
CREATE POLICY "Aniversariantes: gestao envia"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'aniversariantes' AND public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Aniversariantes: gestao atualiza" ON storage.objects;
CREATE POLICY "Aniversariantes: gestao atualiza"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'aniversariantes' AND public.is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'aniversariantes' AND public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Aniversariantes: gestao exclui" ON storage.objects;
CREATE POLICY "Aniversariantes: gestao exclui"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'aniversariantes' AND public.is_admin(auth.uid()));

/* ---------------- Link público: mesma tabela de compartilhamento ---------------- */

ALTER TABLE public.compartilhamentos
  ADD COLUMN IF NOT EXISTS aniversariante_id uuid
    REFERENCES public.aniversariantes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS compartilhamentos_aniversariante_id_idx
  ON public.compartilhamentos (aniversariante_id);

-- O CHECK de `tipo` nasceu inline (nome gerado pelo Postgres) e em produção
-- pode ter outro nome, então removemos pelo catálogo e recriamos com nome
-- explícito junto com o CHECK de alvo.
DO $mig$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public'
      AND cl.relname = 'compartilhamentos'
      AND con.contype = 'c'
      AND (
        pg_get_constraintdef(con.oid) ILIKE '%tipo%'
        OR con.conname = 'compartilhamentos_alvo_valido'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.compartilhamentos DROP CONSTRAINT %I', c);
  END LOOP;
END $mig$;

ALTER TABLE public.compartilhamentos
  ADD CONSTRAINT compartilhamentos_tipo_valido
    CHECK (tipo IN ('tarefa', 'coluna', 'aniversariante'));

ALTER TABLE public.compartilhamentos
  ADD CONSTRAINT compartilhamentos_alvo_valido CHECK (
    (tipo = 'tarefa' AND tarefa_id IS NOT NULL)
    OR (tipo = 'coluna' AND status IS NOT NULL)
    OR (tipo = 'aniversariante' AND aniversariante_id IS NOT NULL)
  );
