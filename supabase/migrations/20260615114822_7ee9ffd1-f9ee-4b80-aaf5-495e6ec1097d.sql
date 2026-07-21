
-- 1) demandas-anexos: add admin-only UPDATE/DELETE policies
DROP POLICY IF EXISTS "demandas_anexos_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "demandas_anexos_admin_delete" ON storage.objects;

CREATE POLICY "demandas_anexos_admin_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'demandas-anexos' AND public.is_admin(auth.uid()))
WITH CHECK (bucket_id = 'demandas-anexos' AND public.is_admin(auth.uid()));

CREATE POLICY "demandas_anexos_admin_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'demandas-anexos' AND public.is_admin(auth.uid()));

-- 2) demandas_externas: explicit admin-only INSERT (public form uses service role)
DROP POLICY IF EXISTS "demandas_externas_admin_insert" ON public.demandas_externas;
CREATE POLICY "demandas_externas_admin_insert"
ON public.demandas_externas FOR INSERT TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

-- 3) treinamentos-pdfs: scope SELECT by plan
DROP POLICY IF EXISTS "treinamentos_pdfs_select" ON storage.objects;
DROP POLICY IF EXISTS "treinamentos pdfs select authenticated" ON storage.objects;
DROP POLICY IF EXISTS "treinamentos-pdfs select authenticated" ON storage.objects;

CREATE POLICY "treinamentos_pdfs_select_by_plan"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'treinamentos-pdfs'
  AND EXISTS (
    SELECT 1 FROM public.treinamentos t
    WHERE t.url_video = 'supabase://treinamentos-pdfs/' || storage.objects.name
      AND (
        NOT public.is_cliente(auth.uid())
        OR 'Todos' = ANY(t.plano_destino)
        OR public.get_meu_plano() = ANY(t.plano_destino)
      )
  )
);
