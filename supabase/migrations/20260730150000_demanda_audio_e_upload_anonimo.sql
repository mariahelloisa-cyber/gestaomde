
-- 1) O formulário público de nova demanda (/demandas/nova) roda sem login,
-- mas a migration de segurança de 11/06 restringiu o upload no bucket
-- demandas-anexos a usuários autenticados — bloqueando o envio de PDF (e o
-- novo envio de áudio) por visitantes externos. Reabre o INSERT para anon,
-- mantendo a leitura restrita à equipe autenticada.
DROP POLICY IF EXISTS "Demandas anexos: upload autenticado" ON storage.objects;

CREATE POLICY "Demandas anexos: upload publico"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'demandas-anexos');

-- 2) Campo para a nota de áudio opcional enviada junto com a demanda.
ALTER TABLE public.demandas_externas ADD COLUMN audio jsonb;
