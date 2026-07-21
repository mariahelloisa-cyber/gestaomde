
-- Adiciona campos de cadastro completo
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS endereco TEXT,
  ADD COLUMN IF NOT EXISTS documento TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS contrato_url TEXT,
  ADD COLUMN IF NOT EXISTS criado_por UUID;

-- Bucket privado para contratos
INSERT INTO storage.buckets (id, name, public)
VALUES ('contratos', 'contratos', false)
ON CONFLICT (id) DO NOTHING;

-- Políticas de storage: autenticados leem e enviam contratos
DROP POLICY IF EXISTS "Autenticados leem contratos" ON storage.objects;
CREATE POLICY "Autenticados leem contratos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'contratos');

DROP POLICY IF EXISTS "Autenticados enviam contratos" ON storage.objects;
CREATE POLICY "Autenticados enviam contratos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'contratos');

DROP POLICY IF EXISTS "Autenticados atualizam contratos" ON storage.objects;
CREATE POLICY "Autenticados atualizam contratos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'contratos');

DROP POLICY IF EXISTS "Autenticados excluem contratos" ON storage.objects;
CREATE POLICY "Autenticados excluem contratos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'contratos');
