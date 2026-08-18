ALTER TABLE public.demandas_externas ALTER COLUMN responsavel_id DROP NOT NULL;
DROP POLICY IF EXISTS "Autenticados leem demandas" ON public.demandas_externas;
CREATE POLICY "Admins leem demandas" ON public.demandas_externas FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
