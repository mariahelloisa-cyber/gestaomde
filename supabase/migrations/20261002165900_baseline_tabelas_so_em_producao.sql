-- BASELINE: tabelas que existiam só em produção, criadas fora das migrations.
--
-- projetos, ideias, pastas_links, pastas_links_itens e tarefa_checklist_itens
-- foram criadas pelo painel do Supabase e nunca entraram no repositório. Sem
-- este arquivo, um banco novo montado a partir das migrations quebra em
-- 20261002170000_rls_endurecer_tabelas_abertas.sql, que faz ALTER TABLE nelas.
--
-- Transcrito de supabase/tests/inventario_tabelas_sem_migration.sql rodado em
-- produção em 2026-10-06. O timestamp fica um minuto antes de 20261002170000
-- de propósito: é a primeira migration que depende dessas tabelas.
--
-- EM PRODUÇÃO ESTE ARQUIVO NÃO DEVE RODAR. Tudo aqui já existe lá. Marque como
-- aplicado sem executar:
--
--   supabase migration repair --status applied 20261002165900
--
-- Mesmo assim, é idempotente (IF NOT EXISTS / DROP IF EXISTS + CREATE com a
-- mesma definição), então rodar por engano com --include-all não muda nada.
--
-- O que NÃO está aqui, porque 20261002170000 já faz:
--   - ENABLE ROW LEVEL SECURITY nas cinco (repetido abaixo só para nenhuma
--     tabela existir nem por um instante sem RLS num banco novo);
--   - RESTRICTIVE "Exige equipe interna";
--   - permissivas "Equipe interna gerencia projetos/pastas/itens de pasta",
--     "Checklist herda a visibilidade da tarefa" e "Equipe interna le ideias";
--   - DEFAULT auth.uid() em projetos.criado_por e pastas_links.criado_por;
--   - idx_pastas_links_itens_pasta_id e idx_tarefa_checklist_itens_tarefa_id.
--
-- Também NÃO estão aqui, de propósito: idx_pastas_links_itens_pasta e
-- idx_checklist_tarefa, duplicatas exatas dos dois índices acima. Existem só
-- em produção e 20261006120000_limpeza_tabelas_baseline.sql os remove.

-- ---------------------------------------------------------------------------
-- 1) Tabelas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projetos (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  nome       text        NOT NULL,
  criado_por uuid,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projetos_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ideias (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  titulo       text        NOT NULL,
  descricao    text,
  criado_por   uuid        NOT NULL,
  status       text        NOT NULL DEFAULT 'pendente'::text,
  pontos       integer,
  avaliado_por uuid,
  avaliado_em  timestamptz,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ideias_pkey PRIMARY KEY (id),
  CONSTRAINT ideias_criado_por_fkey FOREIGN KEY (criado_por)
    REFERENCES public.perfis_usuarios(id) ON DELETE CASCADE,
  CONSTRAINT ideias_avaliado_por_fkey FOREIGN KEY (avaliado_por)
    REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.pastas_links (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  nome       text        NOT NULL,
  comentario text,
  criado_por uuid,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pastas_links_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.pastas_links_itens (
  id        uuid        NOT NULL DEFAULT gen_random_uuid(),
  pasta_id  uuid        NOT NULL,
  url       text        NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pastas_links_itens_pkey PRIMARY KEY (id),
  CONSTRAINT pastas_links_itens_pasta_id_fkey FOREIGN KEY (pasta_id)
    REFERENCES public.pastas_links(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.tarefa_checklist_itens (
  id        uuid        NOT NULL DEFAULT gen_random_uuid(),
  tarefa_id uuid        NOT NULL,
  texto     text        NOT NULL,
  concluido boolean     NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tarefa_checklist_itens_pkey PRIMARY KEY (id),
  CONSTRAINT tarefa_checklist_itens_tarefa_id_fkey FOREIGN KEY (tarefa_id)
    REFERENCES public.tarefas(id) ON DELETE CASCADE
);

ALTER TABLE public.projetos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideias                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pastas_links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pastas_links_itens     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarefa_checklist_itens ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2) Índice que só existe em produção e não é duplicata
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ideias_criado_por
  ON public.ideias USING btree (criado_por);

-- ---------------------------------------------------------------------------
-- 3) Policies de produção que nenhuma migration cria
--
--    As três de `ideias` têm condição real e por isso sobrevivem ao passo 3
--    de 20261002170000, que só remove policy com `true` nos dois lados.
--    Expressões copiadas como estão em pg_policies.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Autenticados criam a propria ideia" ON public.ideias;
CREATE POLICY "Autenticados criam a propria ideia" ON public.ideias
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = criado_por);

DROP POLICY IF EXISTS "Admins avaliam ideias" ON public.ideias;
CREATE POLICY "Admins avaliam ideias" ON public.ideias
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admin ou autor (pendente) excluem ideias" ON public.ideias;
CREATE POLICY "Admin ou autor (pendente) excluem ideias" ON public.ideias
  FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (auth.uid() = criado_por AND status = 'pendente'::text)
  );

-- Mesmo padrão de 20260818165500_fix_tarefas_rls_gap.sql. Redundante com
-- "Exige equipe interna" (equipe interna é subconjunto de quem tem perfil),
-- mas existe em produção e fica documentado aqui.
DROP POLICY IF EXISTS "Exige perfil interno" ON public.projetos;
CREATE POLICY "Exige perfil interno" ON public.projetos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

-- ---------------------------------------------------------------------------
-- 4) E-mail de nova ideia
--
--    Copiado de pg_get_functiondef em produção (2026-10-06). Mesmo desenho de
--    notificar_designacao_email (20260602130006): lê o segredo em
--    configuracoes_sistema e chama /api/public/hooks/email-ideia via pg_net.
--    Sem segredo configurado, não faz nada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notificar_nova_ideia_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_url    text := 'https://xn--gestomde-uza.tec.br/api/public/hooks/email-ideia';
  v_secret text;
BEGIN
  SELECT valor INTO v_secret
  FROM public.configuracoes_sistema
  WHERE chave = 'email_webhook_secret';

  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object('ideia_id', NEW.id)
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notificar_nova_ideia_email ON public.ideias;
CREATE TRIGGER trg_notificar_nova_ideia_email
  AFTER INSERT ON public.ideias
  FOR EACH ROW EXECUTE FUNCTION public.notificar_nova_ideia_email();
