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

BEGIN;

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

COMMIT;

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
