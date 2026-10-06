-- ENSAIO de 20261006130000_arte_fase1_tabelas.sql + 20261006140000_arte_fase1_buckets.sql.
--
--   BEGIN -> corpo das duas migrations -> fixtures -> testes -> ROLLBACK
--
-- Não grava nada. Roda no SQL Editor, em `psql -f` e em
-- `npx supabase db query --linked -f supabase/tests/ensaio_arte_fase1.sql`.
-- O corpo das migrations é IDÊNTICO aos arquivos, menos o BEGIN/COMMIT.
--
-- !! LOCK: ALTER TABLE em demandas_externas e DISABLE TRIGGER nas tabelas de
-- !! fixture seguram lock até o ROLLBACK. É questão de segundos; não deixe a
-- !! transação aberta.
--
-- SUCESSO -> uma linha com resultado = 'ENSAIO OK'.
-- FALHA   -> erro "FALHOU: ..." e nenhuma linha.

BEGIN;

-- ###########################################################################
-- ##  CORPO DE 20261006130000_arte_fase1_tabelas.sql
-- ###########################################################################
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

-- ###########################################################################
-- ##  CORPO DE 20261006140000_arte_fase1_buckets.sql
-- ###########################################################################
-- Módulo de demandas de ARTE — Fase 1: buckets privados do Storage.
--
-- DECISÃO: nenhum dos cinco buckets tem policy em storage.objects para anon
-- ou authenticated. Todo acesso passa por server function com service role:
--   - upload:   createSignedUploadUrl(path) — o servidor escolhe o path depois
--               de conferir quem é o dono; o navegador só usa a URL assinada
--               (uploadToSignedUrl) e não consegue escolher outro caminho;
--   - download: createSignedUrl(path, ttl curto) depois de conferir permissão.
--               Para o solicitante, em 'approved-arts', só com a demanda em
--               'concluida'.
-- Sem policy, a Storage API nega por padrão qualquer acesso direto com o JWT
-- do usuário. É o oposto do 'demandas-anexos', que aceita INSERT de anon (ver
-- nota B de 20261002190000) — padrão que não repetimos aqui.
--
-- Paths (impostos pelos triggers de art_request_files / ai_generations onde há
-- tabela por trás):
--   art-request-files  {solicitante_user_id}/{art_request_id}/{categoria}/{uuid}.{ext}
--   ai-generated-arts  {art_request_id}/{job_id}/s{slide:02}-v{variacao}.{ext}
--   approved-arts      {art_request_id}/{generation_id}.{ext}
--   brand-assets       {cliente_id | _agencia}/{tipo}/{uuid}.{ext}
--   art-references     {categoria | geral}/{uuid}.{ext}
--
-- Conferido em produção (2026-10-06): storage.buckets tem só 'contratos',
-- 'demandas-anexos' e 'aniversariantes', todos public = false; o papel de
-- migration (postgres) tem INSERT e UPDATE em storage.buckets.


-- ON CONFLICT DO UPDATE de propósito: se algum desses buckets já tiver sido
-- criado à mão pelo painel (público, sem limite), a migration o corrige.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('art-request-files', 'art-request-files', false, 15728640,
     ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('ai-generated-arts', 'ai-generated-arts', false, 26214400,
     ARRAY['image/png', 'image/jpeg', 'image/webp']),
  -- application/pdf já previsto para o panfleto de gráfica (fase posterior).
  ('approved-arts', 'approved-arts', false, 26214400,
     ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  ('brand-assets', 'brand-assets', false, 20971520,
     ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf',
           'font/ttf', 'font/otf', 'font/woff', 'font/woff2']),
  ('art-references', 'art-references', false, 15728640,
     ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Sweep defensivo, por CONDIÇÃO e não por nome (mesma técnica do
-- treinamentos-pdfs em 20261002190000): remove qualquer policy de
-- storage.objects que cite um destes buckets. Hoje não deve achar nada.
DO $do$
DECLARE
  r record;
  b text;
  n int := 0;
BEGIN
  FOREACH b IN ARRAY ARRAY['art-request-files', 'ai-generated-arts', 'approved-arts',
                           'brand-assets', 'art-references']
  LOOP
    FOR r IN
      SELECT policyname, cmd
        FROM pg_policies
       WHERE schemaname = 'storage'
         AND tablename  = 'objects'
         AND (coalesce(qual, '') LIKE '%''' || b || '''%'
              OR coalesce(with_check, '') LIKE '%''' || b || '''%')
    LOOP
      RAISE NOTICE 'Removendo policy de storage que abria %: "%" (%)', b, r.policyname, r.cmd;
      EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
      n := n + 1;
    END LOOP;
  END LOOP;

  IF n = 0 THEN
    RAISE NOTICE 'Buckets de arte: nenhuma policy de storage, acesso so por URL assinada.';
  END IF;
END
$do$;

-- Verificação.
DO $do$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
    FROM storage.buckets
   WHERE id IN ('art-request-files', 'ai-generated-arts', 'approved-arts',
                'brand-assets', 'art-references')
     AND public = false
     AND file_size_limit IS NOT NULL
     AND allowed_mime_types IS NOT NULL;
  IF n <> 5 THEN
    RAISE EXCEPTION 'Esperava 5 buckets de arte privados com limite, achei %', n;
  END IF;
  RAISE NOTICE 'Buckets de arte: 5 privados, com limite de tamanho e de tipo.';
END
$do$;


-- ---------------------------------------------------------------------------
-- NOTAS
--
-- (A) POR QUE NÃO HÁ POLICY "EQUIPE INTERNA LÊ"
--     Daria para criar SELECT para eh_equipe_interna, mas nada no app precisa:
--     o painel vai receber URLs assinadas da server function, como já faz com
--     demandas-anexos. Policy a menos é superfície a menos. Se um dia a UI
--     interna precisar ler direto com o JWT, o bloco é:
--       CREATE POLICY "Arte: equipe interna le" ON storage.objects
--         FOR SELECT TO authenticated
--         USING (bucket_id IN ('art-request-files','ai-generated-arts','approved-arts',
--                              'brand-assets','art-references')
--                AND public.eh_equipe_interna((select auth.uid())));
--
-- (B) allowed_mime_types CONFERE O content-type DECLARADO, NÃO O CONTEÚDO
--     O servidor precisa validar os bytes (magic number) na confirmação do
--     upload — previsto para a Fase 2. HEIC (iPhone) fica de fora: a OpenAI
--     não aceita; o formulário converte para JPEG no navegador.
--
-- (C) SVG em brand-assets
--     SVG pode carregar script. Como o bucket é privado e o arquivo só é
--     servido por URL assinada do domínio do Supabase (não do app), o risco é
--     baixo, mas a UI deve exibir logos SVG via <img>, nunca inline.
-- ---------------------------------------------------------------------------

-- ###########################################################################
-- ##  FIXTURES
-- ###########################################################################
--
-- Usuários simulados:
--   MEMBRO   dddd1111-...  Membro,  ativo
--   INATIVO  dddd2222-...  Membro,  inativo
--   ADMIN    dddd3333-...  Admin,   ativo
--   SOL1     dddd4444-...  demandante do portal (sem perfis_usuarios)
--   SOL2     dddd5555-...  outro demandante

DO $do$
DECLARE
  t text;
BEGIN
  -- Só tabelas de fixture. demandas_externas NÃO entra: em produção ela não
  -- tem trigger de usuário, e o trigger novo (tipo fixo) precisa estar ativo.
  FOREACH t IN ARRAY ARRAY['clientes', 'convites', 'perfis_usuarios']
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;
END
$do$;

INSERT INTO public.convites (email, cargo, status) VALUES
  ('membro.arte@rlstest.local',  'Membro', 'pendente'),
  ('inativo.arte@rlstest.local', 'Membro', 'pendente'),
  ('admin.arte@rlstest.local',   'Admin',  'pendente');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('dddd1111-1111-1111-1111-111111111111', 'membro.arte@rlstest.local',  '{"nome":"Membro Arte"}'::jsonb),
  ('dddd2222-2222-2222-2222-222222222222', 'inativo.arte@rlstest.local', '{"nome":"Membro Inativo"}'::jsonb),
  ('dddd3333-3333-3333-3333-333333333333', 'admin.arte@rlstest.local',   '{"nome":"Admin Arte"}'::jsonb),
  ('dddd4444-4444-4444-4444-444444444444', 'sol1.arte@rlstest.local',    '{"nome":"Solicitante 1","tipo":"demandante"}'::jsonb),
  ('dddd5555-5555-5555-5555-555555555555', 'sol2.arte@rlstest.local',    '{"nome":"Solicitante 2","tipo":"demandante"}'::jsonb);

UPDATE public.perfis_usuarios SET status = 'inativo'
 WHERE id = 'dddd2222-2222-2222-2222-222222222222';

INSERT INTO public.clientes (id, nome_empresa) VALUES
  ('ddddcc01-0000-0000-0000-000000000001', 'Empresa teste arte');

-- G1 = demanda geral do SOL1; A1 = arte do SOL1; A2 = arte do SOL2.
INSERT INTO public.demandas_externas (id, solicitante_nome, solicitante_user_id, descricao, status, tipo) VALUES
  ('dddd0de1-0000-0000-0000-000000000001', 'Solicitante 1', 'dddd4444-4444-4444-4444-444444444444', 'Demanda geral', 'pendente', 'geral'),
  ('dddd0de2-0000-0000-0000-000000000002', 'Solicitante 1', 'dddd4444-4444-4444-4444-444444444444', 'Arte do 1',     'pendente', 'arte'),
  ('dddd0de3-0000-0000-0000-000000000003', 'Solicitante 2', 'dddd5555-5555-5555-5555-555555555555', 'Arte do 2',     'aceita',   'arte');

INSERT INTO public.art_requests (id, demanda_id, solicitante_user_id, cliente_id, tipo, status, briefing, largura_px, altura_px) VALUES
  ('dddda001-0000-0000-0000-000000000001', 'dddd0de2-0000-0000-0000-000000000002', 'dddd4444-4444-4444-4444-444444444444',
   'ddddcc01-0000-0000-0000-000000000001', 'feed', 'enviada', 'Post de teste', 1080, 1440),
  ('dddda002-0000-0000-0000-000000000002', 'dddd0de3-0000-0000-0000-000000000003', 'dddd5555-5555-5555-5555-555555555555',
   'ddddcc01-0000-0000-0000-000000000001', 'stories', 'aceita', 'Story de teste', 1080, 1920);

INSERT INTO public.art_request_files (art_request_id, categoria, path, nome_arquivo, mime_type) VALUES
  ('dddda001-0000-0000-0000-000000000001', 'referencia',
   'dddd4444-4444-4444-4444-444444444444/dddda001-0000-0000-0000-000000000001/referencia/a.png', 'a.png', 'image/png'),
  ('dddda002-0000-0000-0000-000000000002', 'referencia',
   'dddd5555-5555-5555-5555-555555555555/dddda002-0000-0000-0000-000000000002/referencia/b.png', 'b.png', 'image/png');

-- J2 = job manual JÁ concluído na demanda 2 (feito pela equipe), com 1 imagem.
INSERT INTO public.ai_generation_jobs (id, art_request_id, origem, status, solicitado_por) VALUES
  ('dddd0b02-0000-0000-0000-000000000002', 'dddda002-0000-0000-0000-000000000002', 'manual', 'concluido',
   'dddd1111-1111-1111-1111-111111111111');

INSERT INTO public.ai_generations (id, job_id, art_request_id, path) VALUES
  ('dddd0e02-0000-0000-0000-000000000002', 'dddd0b02-0000-0000-0000-000000000002', 'dddda002-0000-0000-0000-000000000002',
   'dddda002-0000-0000-0000-000000000002/dddd0b02-0000-0000-0000-000000000002/s01-v1.png');

INSERT INTO public.art_references (titulo, tags, path, criado_por) VALUES
  ('Ref teste', ARRAY['feed'], 'geral/ref-teste.png', 'dddd1111-1111-1111-1111-111111111111');

INSERT INTO public.brand_assets (cliente_id, tipo, nome, valor) VALUES
  ('ddddcc01-0000-0000-0000-000000000001', 'paleta', 'Paleta teste', '{"cores":["#112233"]}'::jsonb);

-- Objetos de storage para o teste de leitura direta.
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('art-request-files', 'dddd4444-4444-4444-4444-444444444444/dddda001-0000-0000-0000-000000000001/referencia/a.png',
   'dddd4444-4444-4444-4444-444444444444'),
  ('approved-arts', 'dddda002-0000-0000-0000-000000000002/teste.png', NULL);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.perfis_usuarios WHERE email LIKE '%.arte@rlstest.local';
  IF n <> 3 THEN RAISE EXCEPTION 'FIXTURES: esperava 3 perfis internos, veio %', n; END IF;
  SELECT count(*) INTO n FROM public.demandas_externas_usuarios WHERE email LIKE 'sol%.arte@rlstest.local';
  IF n <> 2 THEN RAISE EXCEPTION 'FIXTURES: esperava 2 demandantes, veio %', n; END IF;
  SELECT count(*) INTO n FROM public.perfis_usuarios WHERE email LIKE 'sol%.arte@rlstest.local';
  IF n <> 0 THEN RAISE EXCEPTION 'FIXTURES: demandante ganhou perfil interno'; END IF;
  RAISE NOTICE 'OK: fixtures montadas';
END
$$;

-- ###########################################################################
-- ##  HELPERS
-- ###########################################################################

CREATE OR REPLACE FUNCTION pg_temp.como(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.ok(_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('ensaio.assercoes',
    (coalesce(nullif(current_setting('ensaio.assercoes', true), ''), '0')::int + 1)::text, true);
  RAISE NOTICE 'OK: %', _msg;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.falha(_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FALHOU: %', _msg;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.conta(_sql text, _esperado bigint, _msg text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE _sql INTO n;
  IF n IS DISTINCT FROM _esperado THEN
    PERFORM pg_temp.falha(format('%s (esperava %s, veio %s)', _msg, _esperado, n));
  END IF;
  PERFORM pg_temp.ok(_msg);
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.sem_efeito(_sql text, _msg text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE _sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    PERFORM pg_temp.falha(format('%s (afetou %s linha(s))', _msg, n));
  END IF;
  PERFORM pg_temp.ok(_msg);
END
$$;

-- Espera um SQLSTATE específico. Subtransação: o erro não aborta o ensaio.
CREATE OR REPLACE FUNCTION pg_temp.erro(_sql text, _estado text, _msg text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_estado text; v_texto text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE, v_texto = MESSAGE_TEXT;
    IF v_estado = _estado THEN
      PERFORM pg_temp.ok(_msg);
      RETURN;
    END IF;
    PERFORM pg_temp.falha(format('%s (esperava %s, veio %s: %s)', _msg, _estado, v_estado, v_texto));
  END;
  PERFORM pg_temp.falha(format('%s (o comando passou)', _msg));
END
$$;

-- ###########################################################################
-- ##  1) REGRAS DE INTEGRIDADE (como postgres, igual ao service role)
-- ###########################################################################
-- 23514 = check_violation, 23505 = unique_violation, 42501 = insufficient_privilege

DO $$
BEGIN
  -- Demanda geral existente segue intacta e com tipo 'geral'.
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.demandas_externas
                          WHERE tipo = 'geral' AND id = 'dddd0de1-0000-0000-0000-000000000001'$q$,
    1, 'demanda geral criada sem mexer no fluxo fica com tipo geral');

  PERFORM pg_temp.erro($q$UPDATE public.demandas_externas SET tipo = 'geral'
                         WHERE id = 'dddd0de2-0000-0000-0000-000000000002'$q$,
    '23514', 'tipo da demanda e fixo depois de criada');

  PERFORM pg_temp.erro($q$INSERT INTO public.art_requests (solicitante_user_id, tipo, largura_px, altura_px)
                         VALUES ('dddd4444-4444-4444-4444-444444444444', 'feed', 1080, 1080)$q$,
    '23514', 'feed com 1080x1080 e recusado (tamanho oficial 1080x1440)');

  PERFORM pg_temp.erro($q$INSERT INTO public.art_requests (solicitante_user_id, tipo, largura_px, altura_px, qtd_slides)
                         VALUES ('dddd4444-4444-4444-4444-444444444444', 'carrossel', 1080, 1440, 1)$q$,
    '23514', 'carrossel com 1 slide e recusado');

  PERFORM pg_temp.erro($q$INSERT INTO public.art_requests (solicitante_user_id, tipo, status, largura_px, altura_px)
                         VALUES ('dddd4444-4444-4444-4444-444444444444', 'feed', 'enviada', 1080, 1440)$q$,
    '23514', 'art_request enviada sem demanda_id e recusada');

  PERFORM pg_temp.erro($q$INSERT INTO public.art_requests (demanda_id, solicitante_user_id, tipo, status, largura_px, altura_px)
                         VALUES ('dddd0de1-0000-0000-0000-000000000001', 'dddd4444-4444-4444-4444-444444444444',
                                 'feed', 'enviada', 1080, 1440)$q$,
    '23514', 'art_request nao pode apontar para demanda GERAL');

  PERFORM pg_temp.erro($q$INSERT INTO public.art_requests (demanda_id, solicitante_user_id, tipo, status, largura_px, altura_px)
                         VALUES ('dddd0de3-0000-0000-0000-000000000003', 'dddd4444-4444-4444-4444-444444444444',
                                 'feed', 'enviada', 1080, 1440)$q$,
    '23514', 'art_request nao pode apontar para demanda de OUTRO solicitante');

  PERFORM pg_temp.erro($q$INSERT INTO public.art_requests (demanda_id, solicitante_user_id, tipo, status, largura_px, altura_px)
                         VALUES ('dddd0de3-0000-0000-0000-000000000003', 'dddd5555-5555-5555-5555-555555555555',
                                 'feed', 'enviada', 1080, 1440)$q$,
    '23505', 'demanda ja vinculada nao aceita segundo art_request (UNIQUE)');

  PERFORM pg_temp.erro($q$INSERT INTO public.art_request_files (art_request_id, categoria, path, nome_arquivo, mime_type)
                         VALUES ('dddda001-0000-0000-0000-000000000001', 'referencia',
                                 'dddd5555-5555-5555-5555-555555555555/dddda001-0000-0000-0000-000000000001/referencia/x.png',
                                 'x.png', 'image/png')$q$,
    '23514', 'arquivo com path de OUTRO solicitante e recusado');

  PERFORM pg_temp.erro($q$INSERT INTO public.art_request_files (art_request_id, categoria, path, nome_arquivo, mime_type)
                         VALUES ('dddda001-0000-0000-0000-000000000001', 'referencia',
                                 'dddd4444-4444-4444-4444-444444444444/dddda001-0000-0000-0000-000000000001/foto_pessoa/x.png',
                                 'x.png', 'image/png')$q$,
    '23514', 'arquivo com categoria do path diferente da coluna e recusado');

  PERFORM pg_temp.erro($q$INSERT INTO public.ai_generation_jobs (art_request_id, solicitado_por)
                         VALUES ('dddda001-0000-0000-0000-000000000001', 'dddd1111-1111-1111-1111-111111111111')$q$,
    '23514', 'nao gera arte de demanda ainda nao aceita');

  PERFORM pg_temp.erro($q$UPDATE public.art_requests SET status = 'concluida',
                                 job_aprovado_id = 'dddd0b02-0000-0000-0000-000000000002'
                          WHERE id = 'dddda002-0000-0000-0000-000000000002'$q$,
    '23514', 'nao conclui sem revisao aprovada (nem com service role)');

  PERFORM pg_temp.erro($q$UPDATE public.art_requests SET job_aprovado_id = 'dddd0b02-0000-0000-0000-000000000002'
                          WHERE id = 'dddda001-0000-0000-0000-000000000001'$q$,
    '23514', 'job_aprovado_id de outra demanda e recusado');

  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (tipo, nome, valor)
                         VALUES ('moldura_cargo', 'Moldura', '{"tipo_cargo":"Diretoria","cor":"azul"}')$q$,
    '23514', 'moldura com cor fora de #RRGGBB e recusada');
END
$$;

-- ###########################################################################
-- ##  2) SOLICITANTE EXTERNO
-- ###########################################################################

SET LOCAL ROLE authenticated;

DO $$
BEGIN
  PERFORM pg_temp.como('dddd4444-4444-4444-4444-444444444444');

  PERFORM pg_temp.conta('SELECT count(*) FROM public.art_requests', 1,
    'SOL1 ve so o proprio art_request');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_requests
                          WHERE id = 'dddda002-0000-0000-0000-000000000002'$q$, 0,
    'SOL1 nao ve o art_request do SOL2');
  PERFORM pg_temp.conta('SELECT count(*) FROM public.art_request_files', 1,
    'SOL1 ve so os proprios arquivos');

  PERFORM pg_temp.conta('SELECT count(*) FROM public.ai_generation_jobs', 0, 'SOL1 nao ve jobs');
  PERFORM pg_temp.conta('SELECT count(*) FROM public.ai_generations', 0, 'SOL1 nao ve geracoes');
  PERFORM pg_temp.conta('SELECT count(*) FROM public.ai_generation_reviews', 0, 'SOL1 nao ve revisoes');
  PERFORM pg_temp.conta('SELECT count(*) FROM public.art_references', 0, 'SOL1 nao ve referencias');
  PERFORM pg_temp.conta('SELECT count(*) FROM public.brand_assets', 0, 'SOL1 nao ve brand assets');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.demandas_externas
                          WHERE id::text LIKE 'dddd0de%'$q$, 0,
    'SOL1 continua sem leitura direta de demandas_externas (como hoje)');

  PERFORM pg_temp.sem_efeito($q$UPDATE public.art_requests SET status = 'cancelada'
                               WHERE id = 'dddda001-0000-0000-0000-000000000001'$q$,
    'SOL1 nao altera o proprio art_request direto (so via server function)');

  PERFORM pg_temp.erro($q$INSERT INTO public.art_requests (solicitante_user_id, tipo, largura_px, altura_px)
                         VALUES ('dddd4444-4444-4444-4444-444444444444', 'feed', 1080, 1440)$q$,
    '42501', 'SOL1 nao insere art_request direto');

  PERFORM pg_temp.erro($q$INSERT INTO public.ai_generation_jobs (art_request_id)
                         VALUES ('dddda002-0000-0000-0000-000000000002')$q$,
    '42501', 'SOL1 nao cria job de geracao');

  PERFORM pg_temp.conta($q$SELECT count(*) FROM storage.objects
                          WHERE bucket_id IN ('art-request-files','ai-generated-arts','approved-arts',
                                              'brand-assets','art-references')$q$, 0,
    'SOL1 nao le nenhum bucket de arte direto, nem o arquivo que e dono');

  PERFORM pg_temp.erro($q$INSERT INTO storage.objects (bucket_id, name, owner)
                         VALUES ('art-request-files',
                                 'dddd4444-4444-4444-4444-444444444444/dddda001-0000-0000-0000-000000000001/referencia/z.png',
                                 'dddd4444-4444-4444-4444-444444444444')$q$,
    '42501', 'SOL1 nao sobe arquivo direto no bucket (so por URL assinada)');
END
$$;

-- ###########################################################################
-- ##  3) MEMBRO INATIVO: nada
-- ###########################################################################

DO $$
DECLARE t text; n bigint;
BEGIN
  PERFORM pg_temp.como('dddd2222-2222-2222-2222-222222222222');
  FOREACH t IN ARRAY ARRAY['art_requests','art_request_files','ai_generation_jobs','ai_generations',
                           'ai_generation_reviews','art_references','brand_assets']
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 0 THEN PERFORM pg_temp.falha(format('INATIVO leu %s linha(s) de %s', n, t)); END IF;
  END LOOP;
  PERFORM pg_temp.ok('membro INATIVO nao le nenhuma tabela de arte');

  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.demandas_externas WHERE tipo = 'arte'
                          AND id::text LIKE 'dddd0de%'$q$, 0,
    'membro INATIVO nao ve demandas de arte');
END
$$;

-- ###########################################################################
-- ##  4) MEMBRO ATIVO: ve tudo do modulo, revisa, aprova
-- ###########################################################################

DO $$
DECLARE
  v_job uuid;
  v_por uuid;
  v_tags text[];
BEGIN
  PERFORM pg_temp.como('dddd1111-1111-1111-1111-111111111111');

  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_requests WHERE id::text LIKE 'dddda%'$q$, 2,
    'MEMBRO ve os art_requests de todos os solicitantes');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_request_files WHERE path LIKE 'dddd%'$q$, 2,
    'MEMBRO ve os arquivos de todas as demandas de arte');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.demandas_externas
                          WHERE id::text LIKE 'dddd0de%' AND tipo = 'arte'$q$, 2,
    'MEMBRO ve as demandas de ARTE');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.demandas_externas
                          WHERE id::text LIKE 'dddd0de%' AND tipo = 'geral'$q$, 0,
    'MEMBRO continua sem ver demanda GERAL (fluxo atual preservado)');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.ai_generations WHERE path LIKE 'dddda%'$q$, 1,
    'MEMBRO ve as geracoes');

  -- Coluna fora do GRANT: barrada por privilegio.
  PERFORM pg_temp.erro($q$UPDATE public.art_requests SET aprovado_por = 'dddd1111-1111-1111-1111-111111111111'
                          WHERE id = 'dddda002-0000-0000-0000-000000000002'$q$,
    '42501', 'MEMBRO nao escreve aprovado_por na mao');
  PERFORM pg_temp.erro($q$UPDATE public.art_requests SET max_geracoes = 50
                          WHERE id = 'dddda002-0000-0000-0000-000000000002'$q$,
    '42501', 'MEMBRO nao aumenta o teto de geracoes');

  -- Cria job de IA em nome proprio, mesmo tentando nada informar.
  INSERT INTO public.ai_generation_jobs (art_request_id, qtd_variacoes)
  VALUES ('dddda002-0000-0000-0000-000000000002', 3)
  RETURNING id, solicitado_por INTO v_job, v_por;
  IF v_por IS DISTINCT FROM 'dddd1111-1111-1111-1111-111111111111'::uuid THEN
    PERFORM pg_temp.falha('solicitado_por deveria ser o MEMBRO');
  END IF;
  PERFORM pg_temp.ok('MEMBRO cria job de IA e fica registrado como solicitante');

  PERFORM pg_temp.erro($q$INSERT INTO public.ai_generation_jobs (art_request_id)
                         VALUES ('dddda002-0000-0000-0000-000000000002')$q$,
    '23505', 'so um job ativo por demanda');

  PERFORM pg_temp.erro(format($q$UPDATE public.ai_generation_jobs SET status = 'concluido' WHERE id = %L$q$, v_job),
    '42501', 'MEMBRO nao marca job como concluido (so o processador)');

  UPDATE public.ai_generation_jobs SET status = 'cancelado' WHERE id = v_job;
  PERFORM pg_temp.conta(format($q$SELECT count(*) FROM public.ai_generation_jobs
                                  WHERE id = %L AND cancelado_por = 'dddd1111-1111-1111-1111-111111111111'
                                    AND concluido_em IS NOT NULL$q$, v_job), 1,
    'MEMBRO cancela job ativo e o cancelamento fica registrado');

  -- Revisao: revisor forcado para o MEMBRO, mesmo sem informar.
  INSERT INTO public.ai_generation_reviews (art_request_id, job_id, decisao, generation_ids)
  VALUES ('dddda002-0000-0000-0000-000000000002', 'dddd0b02-0000-0000-0000-000000000002', 'aprovada',
          ARRAY['dddd0e02-0000-0000-0000-000000000002']::uuid[]);
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.ai_generation_reviews
                          WHERE job_id = 'dddd0b02-0000-0000-0000-000000000002'
                            AND revisor_id = 'dddd1111-1111-1111-1111-111111111111'$q$, 1,
    'revisao registrada com o MEMBRO como revisor');

  PERFORM pg_temp.erro($q$UPDATE public.ai_generation_reviews SET comentario = 'mudei'
                          WHERE job_id = 'dddd0b02-0000-0000-0000-000000000002'$q$,
    '42501', 'revisao nao pode ser editada');

  PERFORM pg_temp.erro($q$INSERT INTO public.ai_generation_reviews (art_request_id, job_id, decisao)
                         VALUES ('dddda002-0000-0000-0000-000000000002', 'dddd0b02-0000-0000-0000-000000000002',
                                 'ajuste_solicitado')$q$,
    '23514', 'pedido de ajuste sem comentario e recusado');

  UPDATE public.art_requests
     SET job_aprovado_id = 'dddd0b02-0000-0000-0000-000000000002', status = 'concluida'
   WHERE id = 'dddda002-0000-0000-0000-000000000002';
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_requests
                          WHERE id = 'dddda002-0000-0000-0000-000000000002'
                            AND status = 'concluida'
                            AND aprovado_por = 'dddd1111-1111-1111-1111-111111111111'
                            AND aprovado_em IS NOT NULL
                            AND status_alterado_por = 'dddd1111-1111-1111-1111-111111111111'$q$, 1,
    'MEMBRO conclui depois da revisao aprovada; quem e quando ficam registrados');

  -- Acervo
  INSERT INTO public.art_references (titulo, tags, path)
  VALUES ('Ref membro', ARRAY[' Logo ', 'logo', 'Natal', ''], 'geral/ref-membro.png')
  RETURNING tags, criado_por INTO v_tags, v_por;
  IF v_tags IS DISTINCT FROM ARRAY['logo', 'natal'] OR v_por <> 'dddd1111-1111-1111-1111-111111111111' THEN
    PERFORM pg_temp.falha(format('tags/autor errados: %s / %s', v_tags, v_por));
  END IF;
  PERFORM pg_temp.ok('MEMBRO cadastra referencia; tags normalizadas e autor registrado');

  INSERT INTO public.brand_assets (tipo, nome, valor)
  VALUES ('moldura_cargo', 'Moldura diretoria', '{"tipo_cargo":"Diretoria","cor":"#C9A227"}');
  PERFORM pg_temp.ok('MEMBRO cadastra moldura por tipo de cargo');
  PERFORM pg_temp.erro($q$INSERT INTO public.brand_assets (tipo, nome, valor)
                         VALUES ('moldura_cargo', 'Outra', '{"tipo_cargo":" diretoria ","cor":"#000000"}')$q$,
    '23505', 'so uma moldura ativa por tipo de cargo');

  PERFORM pg_temp.conta($q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'approved-arts'$q$, 0,
    'MEMBRO tambem nao le bucket direto (acesso so por URL assinada do servidor)');
END
$$;

-- ###########################################################################
-- ##  5) SOLICITANTE depois da conclusao: ainda sem acesso a geracoes
-- ###########################################################################

DO $$
BEGIN
  PERFORM pg_temp.como('dddd5555-5555-5555-5555-555555555555');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_requests
                          WHERE id = 'dddda002-0000-0000-0000-000000000002' AND status = 'concluida'$q$, 1,
    'SOL2 ve a propria demanda como concluida');
  PERFORM pg_temp.conta('SELECT count(*) FROM public.ai_generations', 0,
    'SOL2 segue sem ler ai_generations mesmo concluida (download so via servidor)');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM storage.objects WHERE bucket_id = 'approved-arts'$q$, 0,
    'SOL2 nao le approved-arts direto');
END
$$;

-- ###########################################################################
-- ##  6) ADMIN: fluxo de demandas gerais intacto
-- ###########################################################################

DO $$
BEGIN
  PERFORM pg_temp.como('dddd3333-3333-3333-3333-333333333333');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.demandas_externas WHERE id::text LIKE 'dddd0de%'$q$, 3,
    'ADMIN ve demandas gerais e de arte');
  PERFORM pg_temp.conta($q$SELECT count(*) FROM public.art_requests WHERE id::text LIKE 'dddda%'$q$, 2,
    'ADMIN ve os art_requests');
END
$$;

-- ###########################################################################
-- ##  7) ANON
-- ###########################################################################

RESET ROLE;
SET LOCAL ROLE anon;

DO $$
DECLARE t text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  FOREACH t IN ARRAY ARRAY['art_requests','art_request_files','ai_generation_jobs','ai_generations',
                           'ai_generation_reviews','art_references','brand_assets']
  LOOP
    PERFORM pg_temp.erro(format('SELECT count(*) FROM public.%I', t), '42501',
      format('anon sem privilegio em %s', t));
  END LOOP;
END
$$;

RESET ROLE;

-- ###########################################################################
-- ##  8) DECLARATIVO: buckets e policies
-- ###########################################################################

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM storage.buckets
   WHERE id IN ('art-request-files','ai-generated-arts','approved-arts','brand-assets','art-references')
     AND public = false;
  IF n <> 5 THEN PERFORM pg_temp.falha(format('esperava 5 buckets privados, veio %s', n)); END IF;
  PERFORM pg_temp.ok('5 buckets de arte privados');

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual,'') ~ '(art-request-files|ai-generated-arts|approved-arts|brand-assets|art-references)'
       OR coalesce(with_check,'') ~ '(art-request-files|ai-generated-arts|approved-arts|brand-assets|art-references)');
  IF n <> 0 THEN PERFORM pg_temp.falha(format('%s policy(s) de storage citam buckets de arte', n)); END IF;
  PERFORM pg_temp.ok('nenhuma policy de storage abre os buckets de arte');

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'demandas_externas'
     AND policyname IN ('Admins leem demandas', 'Responsavel ou admin atualizam demandas',
                        'Responsavel ou admin excluem demandas', 'demandas_externas_admin_insert');
  IF n <> 4 THEN PERFORM pg_temp.falha('policies originais de demandas_externas foram alteradas'); END IF;
  PERFORM pg_temp.ok('as 4 policies originais de demandas_externas seguem la');
END
$$;

-- ###########################################################################
-- ##  SINAL DE SUCESSO
-- ###########################################################################

SELECT 'ENSAIO OK' AS resultado,
       coalesce(nullif(current_setting('ensaio.assercoes', true), ''),
                '(contador indisponivel)') AS assercoes_passaram,
       'Nenhuma assercao falhou. ROLLBACK a seguir, nada foi gravado.' AS observacao;

ROLLBACK;
