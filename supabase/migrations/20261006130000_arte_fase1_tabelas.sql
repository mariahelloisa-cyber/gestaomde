-- Módulo de demandas de ARTE — Fase 1: tabelas, regras e RLS.
--
-- Sem IA e sem UI nesta fase. A estrutura de jobs/gerações já nasce pronta
-- para a OpenAI Image API, mas nada aqui chama serviço externo.
--
-- Conferido em produção antes de escrever (2026-10-06, via db query --linked):
--   - pg_policies de demandas_externas: "Admins leem demandas" (SELECT,
--     is_admin), "Responsavel ou admin atualizam/excluem demandas" e
--     "demandas_externas_admin_insert". Nenhuma RESTRICTIVE. Esta migration
--     só ACRESCENTA uma policy de SELECT para demandas de arte; nenhuma das
--     quatro é tocada.
--   - Nenhuma tabela art_* / ai_* / brand_assets existe.
--   - eh_equipe_interna(uuid), is_admin(uuid) e tem_perfil(uuid) existem e são
--     SECURITY DEFINER.
--   - Os defaults do schema public dão ALL (inclusive TRUNCATE) a anon e
--     authenticated em toda tabela nova. Por isso aqui é REVOKE ALL e GRANT
--     explícito, coluna a coluna onde a escrita é parcial.
--
-- MODELO DE ACESSO
--   Toda escrita do SOLICITANTE externo passa por server function com service
--   role (mesmo padrão de createDemandaExterna). Ele só tem SELECT nas próprias
--   linhas de art_requests e art_request_files, e NADA em ai_generations: a
--   arte só chega a ele por link assinado gerado no servidor depois da
--   aprovação.
--
--   A equipe interna ATIVA (eh_equipe_interna) lê tudo do módulo e faz as
--   ações de revisão com o próprio JWT, então RLS e as regras abaixo valem
--   para ela também. Cada ação registra quem e quando — por trigger, não por
--   confiança no payload.
--
-- RE-EXECUTÁVEL: IF NOT EXISTS / DROP ... IF EXISTS em tudo, como as
-- migrations recentes do projeto.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Guarda: dependências que precisam existir.
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF to_regprocedure('public.eh_equipe_interna(uuid)') IS NULL THEN
    RAISE EXCEPTION 'public.eh_equipe_interna(uuid) nao existe. Aplique 20261002170000 e 20261002210000 antes.';
  END IF;
  IF to_regclass('public.demandas_externas') IS NULL
     OR to_regclass('public.clientes') IS NULL
     OR to_regclass('public.perfis_usuarios') IS NULL THEN
    RAISE EXCEPTION 'Tabelas base (demandas_externas, clientes, perfis_usuarios) ausentes.';
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 1) demandas_externas.tipo
--
--    ADD COLUMN com DEFAULT constante é só metadado no Postgres 11+: não
--    reescreve a tabela. Toda demanda existente vira 'geral', e o insert de
--    createDemandaExterna (que não manda tipo) continua caindo em 'geral'.
-- ---------------------------------------------------------------------------
ALTER TABLE public.demandas_externas
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'geral';

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.demandas_externas'::regclass
       AND conname = 'demandas_externas_tipo_check'
  ) THEN
    ALTER TABLE public.demandas_externas
      ADD CONSTRAINT demandas_externas_tipo_check CHECK (tipo IN ('geral', 'arte'));
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS demandas_externas_tipo_arte_idx
  ON public.demandas_externas (criado_em DESC) WHERE tipo = 'arte';

-- O tipo é fixo depois de criada: trocar 'arte' por 'geral' tiraria a demanda
-- da vista da equipe e deixaria um art_request apontando para demanda geral.
CREATE OR REPLACE FUNCTION public.tg_demandas_externas_tipo_fixo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    RAISE EXCEPTION 'O tipo da demanda nao pode ser alterado depois de criada.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS demandas_externas_tipo_fixo ON public.demandas_externas;
CREATE TRIGGER demandas_externas_tipo_fixo
  BEFORE UPDATE OF tipo ON public.demandas_externas
  FOR EACH ROW EXECUTE FUNCTION public.tg_demandas_externas_tipo_fixo();

-- Demandas de ARTE ficam visíveis para toda a equipe interna ativa (decisão
-- 2026-10-06). PERMISSIVE: soma (OR) com "Admins leem demandas", então
-- demandas gerais continuam só para Admin/Supervisor, exatamente como hoje.
DROP POLICY IF EXISTS "Equipe interna le demandas de arte" ON public.demandas_externas;
CREATE POLICY "Equipe interna le demandas de arte" ON public.demandas_externas
  FOR SELECT TO authenticated
  USING (tipo = 'arte' AND public.eh_equipe_interna((select auth.uid())));

-- ---------------------------------------------------------------------------
-- 2) art_requests — dados específicos da demanda de arte (1:1 com a demanda).
--
--    Nasce como 'rascunho' sem demanda_id (para os uploads terem onde se
--    pendurar) e ganha demanda_id quando o solicitante envia.
--
--    Status:
--      rascunho -> enviada -> aceita -> em_geracao -> aguardando_revisao
--        -> concluida | ajustes (-> em_geracao) | recusada
--      cancelada: desistência antes de concluir.
--    Para o solicitante, em_geracao/aguardando_revisao/ajustes aparecem todos
--    como "Em produção" (mapeamento na aplicação).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.art_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demanda_id uuid UNIQUE REFERENCES public.demandas_externas(id) ON DELETE CASCADE,
  solicitante_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- "empresa" do formulário. SET NULL, e não RESTRICT, para não travar a
  -- exclusão de cliente que já existe no CRM.
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  tipo text NOT NULL,
  status text NOT NULL DEFAULT 'rascunho',
  briefing text,
  -- Campos específicos de cada tipo (nome, cargo, tipo_cargo, funcao,
  -- beneficios, aviso, descricao_data...). Validados por zod no servidor; o
  -- que precisa de filtro/ordenação foi promovido a coluna.
  campos jsonb NOT NULL DEFAULT '{}'::jsonb,
  largura_px int NOT NULL,
  altura_px int NOT NULL,
  -- Só panfleto: {"largura_mm":150,"altura_mm":210,"personalizado":false}
  medida_impressao jsonb,
  qtd_slides int NOT NULL DEFAULT 1,
  data_comemorativa date,
  -- Teto de gerações por IA (jobs com origem 'ia'). Ver tg_ai_generation_jobs.
  max_geracoes int NOT NULL DEFAULT 5,
  responsavel_id uuid REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL,
  -- Job cujas imagens foram aprovadas e entregues. FK adicionada depois que
  -- ai_generation_jobs existir.
  job_aprovado_id uuid,
  -- Preenchidos SÓ por trigger (sem GRANT de coluna para authenticated).
  aprovado_por uuid REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL,
  aprovado_em timestamptz,
  status_alterado_por uuid REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL,
  status_alterado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT art_requests_tipo_check CHECK (tipo IN (
    'foto_perfil', 'panfleto', 'feed', 'feed_data_comemorativa',
    'carrossel', 'vaga_emprego', 'aviso', 'stories')),
  CONSTRAINT art_requests_status_check CHECK (status IN (
    'rascunho', 'enviada', 'aceita', 'em_geracao', 'aguardando_revisao',
    'ajustes', 'concluida', 'recusada', 'cancelada')),
  CONSTRAINT art_requests_briefing_tamanho CHECK (briefing IS NULL OR char_length(briefing) <= 5000),
  CONSTRAINT art_requests_campos_objeto CHECK (jsonb_typeof(campos) = 'object'),
  CONSTRAINT art_requests_demanda_obrigatoria CHECK (
    demanda_id IS NOT NULL OR status IN ('rascunho', 'cancelada')),
  -- Tamanhos oficiais. Panfleto é o único livre (padrão 15x21cm ou
  -- personalizado); na primeira versão sai em PNG.
  CONSTRAINT art_requests_dimensoes CHECK (
    CASE tipo
      WHEN 'foto_perfil' THEN largura_px = 1080 AND altura_px = 1080
      WHEN 'stories'     THEN largura_px = 1080 AND altura_px = 1920
      WHEN 'panfleto'    THEN largura_px BETWEEN 300 AND 6000 AND altura_px BETWEEN 300 AND 6000
      ELSE                    largura_px = 1080 AND altura_px = 1440
    END),
  CONSTRAINT art_requests_slides CHECK (
    CASE WHEN tipo = 'carrossel' THEN qtd_slides BETWEEN 2 AND 10 ELSE qtd_slides = 1 END),
  CONSTRAINT art_requests_medida_impressao CHECK (
    medida_impressao IS NULL OR (tipo = 'panfleto' AND jsonb_typeof(medida_impressao) = 'object')),
  CONSTRAINT art_requests_max_geracoes CHECK (max_geracoes BETWEEN 0 AND 20)
);

CREATE INDEX IF NOT EXISTS art_requests_solicitante_idx ON public.art_requests (solicitante_user_id);
CREATE INDEX IF NOT EXISTS art_requests_status_idx ON public.art_requests (status, criado_em DESC);
CREATE INDEX IF NOT EXISTS art_requests_cliente_idx ON public.art_requests (cliente_id);
CREATE INDEX IF NOT EXISTS art_requests_responsavel_idx ON public.art_requests (responsavel_id);

-- ---------------------------------------------------------------------------
-- 3) art_request_files — fotos, referências e elementos enviados.
--
--    Bucket é sempre 'art-request-files'. Path obrigatório:
--      {solicitante_user_id}/{art_request_id}/{categoria}/{arquivo}
--    imposto por trigger, para o path no storage nunca divergir da linha que
--    dá acesso a ele.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.art_request_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  art_request_id uuid NOT NULL REFERENCES public.art_requests(id) ON DELETE CASCADE,
  categoria text NOT NULL,
  path text NOT NULL UNIQUE,
  nome_arquivo text NOT NULL,
  mime_type text NOT NULL,
  tamanho_bytes bigint,
  largura int,
  altura int,
  -- false enquanto só existe a URL assinada de upload; o servidor confere o
  -- objeto no storage e marca true. Rascunho com false velho = lixo a limpar.
  confirmado boolean NOT NULL DEFAULT false,
  confirmado_em timestamptz,
  enviado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT art_request_files_categoria_check CHECK (
    categoria IN ('foto_pessoa', 'referencia', 'elemento_obrigatorio')),
  CONSTRAINT art_request_files_nome_tamanho CHECK (char_length(nome_arquivo) BETWEEN 1 AND 255),
  CONSTRAINT art_request_files_mime_check CHECK (
    mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT art_request_files_bytes_check CHECK (
    tamanho_bytes IS NULL OR tamanho_bytes BETWEEN 1 AND 15728640)
);

CREATE INDEX IF NOT EXISTS art_request_files_request_idx ON public.art_request_files (art_request_id);

-- ---------------------------------------------------------------------------
-- 4) ai_generation_jobs — cada pedido de geração (por IA ou upload manual).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  art_request_id uuid NOT NULL REFERENCES public.art_requests(id) ON DELETE CASCADE,
  -- 'manual': membro sobe a arte pronta (Fase 3, antes da IA). Não conta no teto.
  origem text NOT NULL DEFAULT 'ia',
  status text NOT NULL DEFAULT 'na_fila',
  qtd_variacoes int NOT NULL DEFAULT 1,
  instrucoes_ajuste text,
  solicitado_por uuid REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL,
  cancelado_por uuid REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL,
  -- Preenchidos pelo processador (service role), nunca pelo navegador.
  modelo text,
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb,
  prompt_final text,
  prompt_versao text,
  -- ids de art_request_files, art_references e brand_assets usados no prompt.
  insumos jsonb NOT NULL DEFAULT '{}'::jsonb,
  openai_response_id text,
  tentativas int NOT NULL DEFAULT 0,
  max_tentativas int NOT NULL DEFAULT 3,
  -- Lease: o processador reserva o job até este instante, para dois disparos
  -- do cron não processarem o mesmo job.
  lease_ate timestamptz,
  erro text,
  custo_estimado_usd numeric(10, 4),
  uso jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  concluido_em timestamptz,

  CONSTRAINT ai_generation_jobs_origem_check CHECK (origem IN ('ia', 'manual')),
  CONSTRAINT ai_generation_jobs_status_check CHECK (
    status IN ('na_fila', 'processando', 'concluido', 'falhou', 'cancelado')),
  CONSTRAINT ai_generation_jobs_variacoes_check CHECK (qtd_variacoes BETWEEN 1 AND 3),
  CONSTRAINT ai_generation_jobs_ajuste_tamanho CHECK (
    instrucoes_ajuste IS NULL OR char_length(instrucoes_ajuste) <= 2000),
  CONSTRAINT ai_generation_jobs_tentativas_check CHECK (tentativas >= 0 AND max_tentativas BETWEEN 1 AND 10)
);

CREATE INDEX IF NOT EXISTS ai_generation_jobs_request_idx ON public.ai_generation_jobs (art_request_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ai_generation_jobs_fila_idx ON public.ai_generation_jobs (criado_em) WHERE status = 'na_fila';
-- No máximo um job ativo por demanda.
CREATE UNIQUE INDEX IF NOT EXISTS ai_generation_jobs_um_ativo_idx
  ON public.ai_generation_jobs (art_request_id) WHERE status IN ('na_fila', 'processando');

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.art_requests'::regclass
       AND conname = 'art_requests_job_aprovado_fk'
  ) THEN
    ALTER TABLE public.art_requests
      ADD CONSTRAINT art_requests_job_aprovado_fk
      FOREIGN KEY (job_aprovado_id) REFERENCES public.ai_generation_jobs(id) ON DELETE SET NULL;
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 5) ai_generations — cada imagem produzida (variação e/ou slide).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.ai_generation_jobs(id) ON DELETE CASCADE,
  art_request_id uuid NOT NULL REFERENCES public.art_requests(id) ON DELETE CASCADE,
  slide_index int NOT NULL DEFAULT 1,
  variacao int NOT NULL DEFAULT 1,
  -- Arquivo bruto em 'ai-generated-arts' (só equipe interna).
  path text NOT NULL UNIQUE,
  -- Cópia em 'approved-arts', preenchida só na aprovação. É o único arquivo
  -- que o solicitante chega a baixar.
  path_aprovado text UNIQUE,
  largura int,
  altura int,
  mime_type text NOT NULL DEFAULT 'image/png',
  revised_prompt text,
  status text NOT NULL DEFAULT 'gerada',
  status_alterado_por uuid REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL,
  status_alterado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_generations_slide_check CHECK (slide_index BETWEEN 1 AND 10),
  CONSTRAINT ai_generations_variacao_check CHECK (variacao BETWEEN 1 AND 3),
  CONSTRAINT ai_generations_status_check CHECK (
    status IN ('gerada', 'aprovada', 'recusada', 'descartada')),
  CONSTRAINT ai_generations_mime_check CHECK (
    mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT ai_generations_unica UNIQUE (job_id, slide_index, variacao)
);

CREATE INDEX IF NOT EXISTS ai_generations_request_idx ON public.ai_generations (art_request_id);

-- ---------------------------------------------------------------------------
-- 6) ai_generation_reviews — histórico append-only das decisões.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_generation_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  art_request_id uuid NOT NULL REFERENCES public.art_requests(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.ai_generation_jobs(id) ON DELETE CASCADE,
  decisao text NOT NULL,
  -- Variações/slides escolhidos (aprovação) ou apontados (recusa/ajuste).
  generation_ids uuid[] NOT NULL DEFAULT '{}',
  comentario text,
  -- Sempre auth.uid() quando vem com JWT (trigger força).
  revisor_id uuid REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_generation_reviews_decisao_check CHECK (
    decisao IN ('aprovada', 'recusada', 'ajuste_solicitado')),
  CONSTRAINT ai_generation_reviews_aprovada_tem_imagem CHECK (
    decisao <> 'aprovada' OR cardinality(generation_ids) > 0),
  CONSTRAINT ai_generation_reviews_ajuste_tem_comentario CHECK (
    decisao <> 'ajuste_solicitado' OR char_length(btrim(coalesce(comentario, ''))) > 0),
  CONSTRAINT ai_generation_reviews_comentario_tamanho CHECK (
    comentario IS NULL OR char_length(comentario) <= 2000)
);

CREATE INDEX IF NOT EXISTS ai_generation_reviews_request_idx ON public.ai_generation_reviews (art_request_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ai_generation_reviews_job_idx ON public.ai_generation_reviews (job_id);

-- ---------------------------------------------------------------------------
-- 7) art_references — banco de referências, busca por tags/categoria.
--
--    Embedding: NÃO implementado. `descricao` é o texto-fonte previsto; quando
--    for a hora, basta
--      CREATE EXTENSION IF NOT EXISTS vector;
--      ALTER TABLE public.art_references ADD COLUMN embedding vector(<dim>);
--    sem mexer no resto.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.art_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descricao text,
  tipos_arte text[] NOT NULL DEFAULT '{}',
  categoria text,
  tags text[] NOT NULL DEFAULT '{}',
  -- NULL = referência global da agência. CASCADE: referência de um cliente
  -- não pode virar global quando ele sai.
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE CASCADE,
  path text NOT NULL UNIQUE,
  mime_type text NOT NULL DEFAULT 'image/png',
  largura int,
  altura int,
  ativo boolean NOT NULL DEFAULT true,
  metadados jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_por uuid REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT art_references_titulo_tamanho CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 200),
  CONSTRAINT art_references_descricao_tamanho CHECK (descricao IS NULL OR char_length(descricao) <= 2000),
  CONSTRAINT art_references_tipos_check CHECK (tipos_arte <@ ARRAY[
    'foto_perfil', 'panfleto', 'feed', 'feed_data_comemorativa',
    'carrossel', 'vaga_emprego', 'aviso', 'stories']::text[]),
  CONSTRAINT art_references_mime_check CHECK (
    mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT art_references_metadados_objeto CHECK (jsonb_typeof(metadados) = 'object')
);

CREATE INDEX IF NOT EXISTS art_references_tags_idx ON public.art_references USING gin (tags);
CREATE INDEX IF NOT EXISTS art_references_tipos_idx ON public.art_references USING gin (tipos_arte);
CREATE INDEX IF NOT EXISTS art_references_cliente_idx ON public.art_references (cliente_id);

-- ---------------------------------------------------------------------------
-- 8) brand_assets — identidade visual por cliente (ou da agência, se NULL).
--
--    Molduras da foto de perfil ficam aqui com tipo 'moldura_cargo' e
--    valor = {"tipo_cargo": "...", "cor": "#RRGGBB"}. A lista oficial de
--    cargos/cores entra depois como dado, sem migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brand_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  nome text NOT NULL,
  -- Arquivo em 'brand-assets'. NULL quando o asset é só valor (paleta, cor).
  path text UNIQUE,
  mime_type text,
  valor jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT brand_assets_tipo_check CHECK (tipo IN (
    'logo', 'logo_negativo', 'paleta', 'fonte', 'modelo_base',
    'moldura_cargo', 'manual', 'outro')),
  CONSTRAINT brand_assets_nome_tamanho CHECK (char_length(btrim(nome)) BETWEEN 1 AND 200),
  CONSTRAINT brand_assets_valor_objeto CHECK (jsonb_typeof(valor) = 'object'),
  CONSTRAINT brand_assets_tem_conteudo CHECK (path IS NOT NULL OR valor <> '{}'::jsonb),
  CONSTRAINT brand_assets_moldura_formato CHECK (
    tipo <> 'moldura_cargo' OR (
      char_length(btrim(coalesce(valor->>'tipo_cargo', ''))) > 0
      AND coalesce(valor->>'cor', '') ~ '^#[0-9A-Fa-f]{6}$'))
);

CREATE INDEX IF NOT EXISTS brand_assets_cliente_idx ON public.brand_assets (cliente_id, tipo);
-- Uma moldura ativa por tipo de cargo (por cliente, ou da agência).
CREATE UNIQUE INDEX IF NOT EXISTS brand_assets_moldura_unica_idx
  ON public.brand_assets (
    coalesce(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(valor->>'tipo_cargo')))
  WHERE tipo = 'moldura_cargo' AND ativo;

-- ---------------------------------------------------------------------------
-- 9) Triggers de regra e auditoria.
--
--    SECURITY DEFINER com search_path fixo: precisam ler linhas que o papel
--    de quem dispara pode não enxergar (ex.: a demanda, para o solicitante).
--    auth.uid() continua sendo o usuário do JWT — ele vem de GUC, não do papel.
-- ---------------------------------------------------------------------------

-- 9.1) art_requests
CREATE OR REPLACE FUNCTION public.tg_art_requests_regras()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_dem record;
  v_revisor uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Imutáveis. Também protege contra bug no servidor (service role).
    IF NEW.solicitante_user_id IS DISTINCT FROM OLD.solicitante_user_id
       AND NEW.solicitante_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'solicitante_user_id nao pode ser alterado.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tipo IS DISTINCT FROM OLD.tipo THEN
      RAISE EXCEPTION 'tipo da arte nao pode ser alterado.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.demanda_id IS NOT NULL AND NEW.demanda_id IS DISTINCT FROM OLD.demanda_id THEN
      RAISE EXCEPTION 'demanda_id nao pode ser trocado depois de vinculado.' USING ERRCODE = 'check_violation';
    END IF;
    NEW.criado_em := OLD.criado_em;
    NEW.atualizado_em := now();
  END IF;

  -- Vínculo com a demanda: tem que ser do tipo 'arte' e do mesmo solicitante.
  IF NEW.demanda_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.demanda_id IS DISTINCT FROM OLD.demanda_id) THEN
    SELECT tipo, solicitante_user_id INTO v_dem
      FROM public.demandas_externas WHERE id = NEW.demanda_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Demanda % nao existe.', NEW.demanda_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_dem.tipo <> 'arte' THEN
      RAISE EXCEPTION 'A demanda vinculada precisa ser do tipo arte.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dem.solicitante_user_id IS DISTINCT FROM NEW.solicitante_user_id THEN
      RAISE EXCEPTION 'A demanda vinculada e de outro solicitante.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- job_aprovado_id tem que ser um job desta mesma demanda.
  IF NEW.job_aprovado_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ai_generation_jobs
                      WHERE id = NEW.job_aprovado_id AND art_request_id = NEW.id) THEN
    RAISE EXCEPTION 'job_aprovado_id nao pertence a esta demanda de arte.' USING ERRCODE = 'check_violation';
  END IF;

  -- Auditoria de status: quem e quando. Com JWT, é sempre o usuário do JWT.
  -- Via service role, vale o que o servidor informou nesta operação; se ele
  -- não informou, fica NULL em vez de herdar o autor anterior.
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_alterado_em := now();
    IF v_uid IS NOT NULL THEN
      NEW.status_alterado_por := v_uid;
    ELSIF TG_OP = 'UPDATE' AND NEW.status_alterado_por IS NOT DISTINCT FROM OLD.status_alterado_por THEN
      NEW.status_alterado_por := NULL;
    END IF;
  END IF;
  -- Fora da troca de status, as colunas de auditoria não são reescritas aqui:
  -- authenticated não tem GRANT nelas, e o ON DELETE SET NULL das FKs precisa
  -- conseguir zerá-las quando um perfil é excluído.

  -- REGRA CENTRAL: só conclui com um job aprovado em revisão registrada.
  -- Quem aprovou e quando saem da revisão, não do payload.
  IF NEW.status = 'concluida' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'concluida') THEN
    IF NEW.job_aprovado_id IS NULL THEN
      RAISE EXCEPTION 'Nao da para concluir sem job_aprovado_id.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT revisor_id INTO v_revisor
      FROM public.ai_generation_reviews
     WHERE job_id = NEW.job_aprovado_id AND decisao = 'aprovada'
     ORDER BY criado_em DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Nao da para concluir: o job aprovado nao tem revisao com decisao aprovada.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.aprovado_por := v_revisor;
    NEW.aprovado_em := now();
  ELSIF TG_OP = 'INSERT' THEN
    NEW.aprovado_por := NULL;
    NEW.aprovado_em := NULL;
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS art_requests_regras ON public.art_requests;
CREATE TRIGGER art_requests_regras
  BEFORE INSERT OR UPDATE ON public.art_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_art_requests_regras();

-- 9.2) art_request_files: path amarrado a solicitante/demanda/categoria.
CREATE OR REPLACE FUNCTION public.tg_art_request_files_regras()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_solicitante uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.path IS DISTINCT FROM OLD.path OR NEW.art_request_id IS DISTINCT FROM OLD.art_request_id THEN
      RAISE EXCEPTION 'path e art_request_id sao fixos.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmado AND NOT OLD.confirmado THEN
      NEW.confirmado_em := now();
    END IF;
    -- Path só é validado no INSERT: depois ele é fixo, e revalidar quebraria
    -- o SET NULL de enviado_por quando a conta do solicitante é excluída.
    RETURN NEW;
  END IF;

  SELECT solicitante_user_id INTO v_solicitante
    FROM public.art_requests WHERE id = NEW.art_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'art_request % nao existe.', NEW.art_request_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_solicitante IS NULL
     OR split_part(NEW.path, '/', 1) <> v_solicitante::text
     OR split_part(NEW.path, '/', 2) <> NEW.art_request_id::text
     OR split_part(NEW.path, '/', 3) <> NEW.categoria
     OR split_part(NEW.path, '/', 4) = ''
     OR split_part(NEW.path, '/', 5) <> ''
     OR NEW.path LIKE '%..%' THEN
    RAISE EXCEPTION 'Path invalido. Esperado {solicitante}/{art_request_id}/{categoria}/{arquivo}.'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.confirmado_em := CASE WHEN NEW.confirmado THEN now() END;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS art_request_files_regras ON public.art_request_files;
CREATE TRIGGER art_request_files_regras
  BEFORE INSERT OR UPDATE ON public.art_request_files
  FOR EACH ROW EXECUTE FUNCTION public.tg_art_request_files_regras();

-- 9.3) ai_generation_jobs: estado da demanda, teto de gerações e autoria.
CREATE OR REPLACE FUNCTION public.tg_ai_generation_jobs_regras()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
  v_usadas int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- FOR UPDATE serializa inserts concorrentes na mesma demanda: sem isso,
    -- dois cliques simultâneos contariam 4 e passariam os dois do teto 5.
    SELECT status, max_geracoes INTO v_req
      FROM public.art_requests WHERE id = NEW.art_request_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'art_request % nao existe.', NEW.art_request_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_req.status NOT IN ('aceita', 'em_geracao', 'aguardando_revisao', 'ajustes') THEN
      RAISE EXCEPTION 'So da para gerar arte de demanda aceita (status atual: %).', v_req.status
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.origem = 'ia' THEN
      SELECT count(*) INTO v_usadas
        FROM public.ai_generation_jobs
       WHERE art_request_id = NEW.art_request_id
         AND origem = 'ia'
         AND status NOT IN ('falhou', 'cancelado');
      IF v_usadas >= v_req.max_geracoes THEN
        RAISE EXCEPTION 'Limite de % geracoes por IA atingido para esta demanda.', v_req.max_geracoes
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF v_uid IS NOT NULL THEN
      NEW.solicitado_por := v_uid;
    END IF;
    IF NEW.solicitado_por IS NULL THEN
      RAISE EXCEPTION 'solicitado_por e obrigatorio.' USING ERRCODE = 'not_null_violation';
    END IF;
    NEW.criado_em := now();
    NEW.cancelado_por := NULL;
  ELSE
    -- solicitado_por pode virar NULL (ON DELETE SET NULL do perfil), nunca
    -- outro usuário.
    IF NEW.art_request_id IS DISTINCT FROM OLD.art_request_id
       OR NEW.origem IS DISTINCT FROM OLD.origem
       OR (NEW.solicitado_por IS DISTINCT FROM OLD.solicitado_por AND NEW.solicitado_por IS NOT NULL) THEN
      RAISE EXCEPTION 'art_request_id, origem e solicitado_por sao fixos.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('concluido', 'falhou', 'cancelado') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Job ja encerrado (%).', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'cancelado' AND OLD.status <> 'cancelado' THEN
      NEW.cancelado_por := coalesce(v_uid, NEW.cancelado_por);
    END IF;
    IF NEW.status IN ('concluido', 'falhou', 'cancelado') AND NEW.concluido_em IS NULL THEN
      NEW.concluido_em := now();
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS ai_generation_jobs_regras ON public.ai_generation_jobs;
CREATE TRIGGER ai_generation_jobs_regras
  BEFORE INSERT OR UPDATE ON public.ai_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_ai_generation_jobs_regras();

-- 9.4) ai_generations: coerência com o job e autoria de mudança de status.
CREATE OR REPLACE FUNCTION public.tg_ai_generations_regras()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ai_generation_jobs
                    WHERE id = NEW.job_id AND art_request_id = NEW.art_request_id) THEN
      RAISE EXCEPTION 'job_id nao pertence a art_request_id.' USING ERRCODE = 'check_violation';
    END IF;
    IF split_part(NEW.path, '/', 1) <> NEW.art_request_id::text
       OR split_part(NEW.path, '/', 2) <> NEW.job_id::text THEN
      RAISE EXCEPTION 'Path invalido. Esperado {art_request_id}/{job_id}/{arquivo}.' USING ERRCODE = 'check_violation';
    END IF;
    NEW.status_alterado_por := NULL;
    NEW.status_alterado_em := NULL;
  ELSE
    IF NEW.job_id IS DISTINCT FROM OLD.job_id
       OR NEW.art_request_id IS DISTINCT FROM OLD.art_request_id
       OR NEW.path IS DISTINCT FROM OLD.path THEN
      RAISE EXCEPTION 'job_id, art_request_id e path sao fixos.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.status_alterado_em := now();
      IF v_uid IS NOT NULL THEN
        NEW.status_alterado_por := v_uid;
      ELSIF NEW.status_alterado_por IS NOT DISTINCT FROM OLD.status_alterado_por THEN
        NEW.status_alterado_por := NULL;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS ai_generations_regras ON public.ai_generations;
CREATE TRIGGER ai_generations_regras
  BEFORE INSERT OR UPDATE ON public.ai_generations
  FOR EACH ROW EXECUTE FUNCTION public.tg_ai_generations_regras();

-- 9.5) ai_generation_reviews: autoria forçada, coerência, append-only.
CREATE OR REPLACE FUNCTION public.tg_ai_generation_reviews_regras()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_fora int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Única mudança aceita: revisor_id virar NULL pelo ON DELETE SET NULL
    -- quando o perfil é excluído. Fora isso, histórico não se edita.
    IF NEW.revisor_id IS NULL
       AND (NEW.id, NEW.art_request_id, NEW.job_id, NEW.decisao, NEW.generation_ids,
            NEW.comentario, NEW.criado_em)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.art_request_id, OLD.job_id, OLD.decisao, OLD.generation_ids,
            OLD.comentario, OLD.criado_em) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Revisoes sao historico: nao podem ser editadas.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ai_generation_jobs
                  WHERE id = NEW.job_id AND art_request_id = NEW.art_request_id) THEN
    RAISE EXCEPTION 'job_id nao pertence a art_request_id.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_fora
    FROM unnest(NEW.generation_ids) AS g(id)
   WHERE NOT EXISTS (SELECT 1 FROM public.ai_generations x
                      WHERE x.id = g.id AND x.job_id = NEW.job_id);
  IF v_fora > 0 THEN
    RAISE EXCEPTION 'generation_ids contem imagem que nao e deste job.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_uid IS NOT NULL THEN
    NEW.revisor_id := v_uid;
  END IF;
  IF NEW.revisor_id IS NULL THEN
    RAISE EXCEPTION 'revisor_id e obrigatorio.' USING ERRCODE = 'not_null_violation';
  END IF;
  NEW.criado_em := now();
  RETURN NEW;
END
$fn$;

-- Só INSERT e UPDATE: um BEFORE DELETE bloquearia o CASCADE quando a demanda
-- é apagada. DELETE já não tem GRANT para authenticated.
DROP TRIGGER IF EXISTS ai_generation_reviews_regras ON public.ai_generation_reviews;
CREATE TRIGGER ai_generation_reviews_regras
  BEFORE INSERT OR UPDATE ON public.ai_generation_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_ai_generation_reviews_regras();

-- 9.6) art_references e brand_assets: autoria, atualizado_em, tags normalizadas.
CREATE OR REPLACE FUNCTION public.tg_arte_acervo_regras()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL THEN
      NEW.criado_por := v_uid;
    END IF;
    NEW.criado_em := now();
  ELSE
    -- criado_por só pode virar NULL (ON DELETE SET NULL), nunca outra pessoa.
    IF NEW.criado_por IS NOT NULL THEN
      NEW.criado_por := OLD.criado_por;
    END IF;
    NEW.criado_em := OLD.criado_em;
  END IF;
  NEW.atualizado_em := now();

  -- Tags em minúsculas, sem espaços nas pontas e sem repetição, para a busca
  -- por tag (operadores && e @>) não depender de como cada pessoa digitou.
  IF TG_TABLE_NAME = 'art_references' THEN
    NEW.tags := coalesce(
      ARRAY(SELECT DISTINCT lower(btrim(t)) FROM unnest(NEW.tags) AS t
             WHERE btrim(coalesce(t, '')) <> '' ORDER BY 1),
      '{}');
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS art_references_regras ON public.art_references;
CREATE TRIGGER art_references_regras
  BEFORE INSERT OR UPDATE ON public.art_references
  FOR EACH ROW EXECUTE FUNCTION public.tg_arte_acervo_regras();

DROP TRIGGER IF EXISTS brand_assets_regras ON public.brand_assets;
CREATE TRIGGER brand_assets_regras
  BEFORE INSERT OR UPDATE ON public.brand_assets
  FOR EACH ROW EXECUTE FUNCTION public.tg_arte_acervo_regras();

-- Funções de trigger não são chamáveis por RPC, mas fecho EXECUTE mesmo assim,
-- como em 20261006120000.
REVOKE EXECUTE ON FUNCTION public.tg_demandas_externas_tipo_fixo() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_art_requests_regras() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_art_request_files_regras() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_ai_generation_jobs_regras() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_ai_generations_regras() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_ai_generation_reviews_regras() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_arte_acervo_regras() FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10) GRANTs. Ponto de partida: nada para anon e authenticated.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.art_requests, public.art_request_files, public.ai_generation_jobs,
  public.ai_generations, public.ai_generation_reviews, public.art_references,
  public.brand_assets
FROM anon, authenticated;

GRANT ALL ON TABLE
  public.art_requests, public.art_request_files, public.ai_generation_jobs,
  public.ai_generations, public.ai_generation_reviews, public.art_references,
  public.brand_assets
TO service_role;

GRANT SELECT ON TABLE
  public.art_requests, public.art_request_files, public.ai_generation_jobs,
  public.ai_generations, public.ai_generation_reviews, public.art_references,
  public.brand_assets
TO authenticated;

-- Equipe interna: só o que a revisão precisa mudar com o próprio JWT.
-- aprovado_*, status_alterado_*, solicitante e afins ficam fora de propósito.
GRANT UPDATE (status, responsavel_id, job_aprovado_id) ON public.art_requests TO authenticated;
GRANT INSERT (art_request_id, qtd_variacoes, instrucoes_ajuste) ON public.ai_generation_jobs TO authenticated;
GRANT UPDATE (status) ON public.ai_generation_jobs TO authenticated;
GRANT UPDATE (status) ON public.ai_generations TO authenticated;
GRANT INSERT (art_request_id, job_id, decisao, generation_ids, comentario) ON public.ai_generation_reviews TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.art_references, public.brand_assets TO authenticated;

-- ---------------------------------------------------------------------------
-- 11) RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE public.art_requests          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.art_request_files     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generation_jobs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generation_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.art_references        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_assets          ENABLE ROW LEVEL SECURITY;

-- 11.1) art_requests: solicitante vê as próprias; equipe vê e atualiza todas.
DROP POLICY IF EXISTS "Arte: solicitante le as proprias" ON public.art_requests;
CREATE POLICY "Arte: solicitante le as proprias" ON public.art_requests
  FOR SELECT TO authenticated
  USING (solicitante_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Arte: equipe interna le" ON public.art_requests;
CREATE POLICY "Arte: equipe interna le" ON public.art_requests
  FOR SELECT TO authenticated
  USING (public.eh_equipe_interna((select auth.uid())));

DROP POLICY IF EXISTS "Arte: equipe interna atualiza" ON public.art_requests;
CREATE POLICY "Arte: equipe interna atualiza" ON public.art_requests
  FOR UPDATE TO authenticated
  USING (public.eh_equipe_interna((select auth.uid())))
  WITH CHECK (public.eh_equipe_interna((select auth.uid())));

-- 11.2) art_request_files: herda de art_requests.
DROP POLICY IF EXISTS "Arte arquivos: solicitante le os proprios" ON public.art_request_files;
CREATE POLICY "Arte arquivos: solicitante le os proprios" ON public.art_request_files
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.art_requests r
     WHERE r.id = art_request_files.art_request_id
       AND r.solicitante_user_id = (select auth.uid())));

DROP POLICY IF EXISTS "Arte arquivos: equipe interna le" ON public.art_request_files;
CREATE POLICY "Arte arquivos: equipe interna le" ON public.art_request_files
  FOR SELECT TO authenticated
  USING (public.eh_equipe_interna((select auth.uid())));

-- 11.3) Tabelas só da equipe: PERMISSIVE por comando + RESTRICTIVE que exige
--       equipe interna em tudo (mesmo padrão "Exige equipe interna" de
--       20261002180000). O RESTRICTIVE garante que o solicitante externo nunca
--       lê ai_generations, mesmo que alguém crie depois uma permissiva aberta.
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_generation_jobs', 'ai_generations', 'ai_generation_reviews',
    'art_references', 'brand_assets'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Exige equipe interna" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Exige equipe interna" ON public.%I'
      ' AS RESTRICTIVE FOR ALL TO authenticated'
      ' USING (public.eh_equipe_interna((select auth.uid())))'
      ' WITH CHECK (public.eh_equipe_interna((select auth.uid())))', t);

    EXECUTE format('DROP POLICY IF EXISTS "Equipe interna le" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Equipe interna le" ON public.%I'
      ' FOR SELECT TO authenticated'
      ' USING (public.eh_equipe_interna((select auth.uid())))', t);
  END LOOP;
END
$do$;

-- Jobs: membro cria (em seu nome) e só pode CANCELAR job ativo. O resto do
-- ciclo (processando/concluido/falhou) é do processador, via service role.
DROP POLICY IF EXISTS "Equipe interna cria job" ON public.ai_generation_jobs;
CREATE POLICY "Equipe interna cria job" ON public.ai_generation_jobs
  FOR INSERT TO authenticated
  WITH CHECK (solicitado_por = (select auth.uid()));

DROP POLICY IF EXISTS "Equipe interna cancela job ativo" ON public.ai_generation_jobs;
CREATE POLICY "Equipe interna cancela job ativo" ON public.ai_generation_jobs
  FOR UPDATE TO authenticated
  USING (status IN ('na_fila', 'processando'))
  WITH CHECK (status = 'cancelado');

DROP POLICY IF EXISTS "Equipe interna marca geracao" ON public.ai_generations;
CREATE POLICY "Equipe interna marca geracao" ON public.ai_generations
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Equipe interna registra revisao" ON public.ai_generation_reviews;
CREATE POLICY "Equipe interna registra revisao" ON public.ai_generation_reviews
  FOR INSERT TO authenticated
  WITH CHECK (revisor_id = (select auth.uid()));

DROP POLICY IF EXISTS "Equipe interna gerencia referencias" ON public.art_references;
CREATE POLICY "Equipe interna gerencia referencias" ON public.art_references
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Equipe interna gerencia brand assets" ON public.brand_assets;
CREATE POLICY "Equipe interna gerencia brand assets" ON public.brand_assets
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
-- (Os USING(true) acima são seguros: o RESTRICTIVE "Exige equipe interna"
--  entra com AND em todo comando dessas tabelas.)

-- ---------------------------------------------------------------------------
-- 12) Verificação: RLS ligada e o RESTRICTIVE presente onde tem que estar.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'art_requests', 'art_request_files', 'ai_generation_jobs', 'ai_generations',
    'ai_generation_reviews', 'art_references', 'brand_assets'
  ]
  LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', t)::regclass) THEN
      RAISE EXCEPTION 'RLS desligada em %', t;
    END IF;
    IF has_table_privilege('anon', format('public.%I', t), 'SELECT') THEN
      RAISE EXCEPTION 'anon ainda tem SELECT em %', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'ai_generation_jobs', 'ai_generations', 'ai_generation_reviews',
    'art_references', 'brand_assets'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = t
                      AND policyname = 'Exige equipe interna'
                      AND permissive = 'RESTRICTIVE') THEN
      RAISE EXCEPTION 'RESTRICTIVE ausente em %', t;
    END IF;
  END LOOP;

  RAISE NOTICE 'Arte fase 1: tabelas, triggers e RLS ok.';
END
$do$;

COMMIT;

-- ---------------------------------------------------------------------------
-- NOTAS
--
-- (A) O QUE NÃO MUDOU NO FLUXO ATUAL
--     As quatro policies de demandas_externas ficaram intactas. Demanda geral
--     segue invisível para Membro e visível para Admin/Supervisor. O único
--     acréscimo em demandas_externas é a coluna `tipo` (default 'geral'), o
--     trigger que a deixa fixa e a policy de SELECT para tipo = 'arte'.
--     createDemandaExterna, aceitar/recusar/transferir não leem nem gravam
--     `tipo`, então seguem funcionando sem alteração de código.
--
-- (B) MEMBRO VÊ, MAS NÃO ACEITA, DEMANDA DE ARTE (ainda)
--     A policy de UPDATE em demandas_externas continua "responsável ou admin".
--     Então um Membro comum vê a demanda de arte mas não consegue rodar
--     aceitarDemanda com o próprio JWT. Isso é decisão da Fase 2: ou abrimos
--     UPDATE para tipo = 'arte' + equipe interna, ou o aceite de arte vira
--     server function própria.
--
-- (C) TETO DE GERAÇÕES
--     Conta jobs com origem 'ia' que não falharam nem foram cancelados. Job
--     'manual' (upload pela equipe) não conta. Ajustável por demanda em
--     art_requests.max_geracoes (só service role escreve essa coluna).
--
-- (D) "NUNCA ENTREGAR SEM APROVAÇÃO" NO BANCO
--     art_requests só vai para 'concluida' com job_aprovado_id apontando para
--     um job desta demanda que tenha revisão 'aprovada'. aprovado_por vem do
--     revisor_id dessa revisão, e revisor_id é sempre o auth.uid() de quem
--     inseriu. O download em si continua sendo gate da server function.
-- ---------------------------------------------------------------------------
