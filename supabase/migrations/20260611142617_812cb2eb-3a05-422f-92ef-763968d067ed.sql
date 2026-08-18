-- 1) demandas_externas: restringir update/delete a responsável ou admin
DROP POLICY IF EXISTS "Autenticados atualizam demandas" ON public.demandas_externas;
DROP POLICY IF EXISTS "Autenticados excluem demandas" ON public.demandas_externas;
CREATE POLICY "Responsavel ou admin atualizam demandas"
  ON public.demandas_externas FOR UPDATE
  TO authenticated
  USING (responsavel_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (responsavel_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "Responsavel ou admin excluem demandas"
  ON public.demandas_externas FOR DELETE
  TO authenticated
  USING (responsavel_id = auth.uid() OR public.is_admin(auth.uid()));
-- 2) financeiro_transacoes: somente admin
DROP POLICY IF EXISTS "Autenticados gerenciam transacoes" ON public.financeiro_transacoes;
CREATE POLICY "Admins gerenciam transacoes"
  ON public.financeiro_transacoes FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
-- 3) email_logs: somente admin lê
DROP POLICY IF EXISTS "Autenticados leem logs de email" ON public.email_logs;
CREATE POLICY "Admins leem logs de email"
  ON public.email_logs FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));
-- 4) Storage demandas-anexos: exigir autenticação
DROP POLICY IF EXISTS "Demandas anexos: leitura pública" ON storage.objects;
DROP POLICY IF EXISTS "Demandas anexos: upload público" ON storage.objects;
CREATE POLICY "Demandas anexos: leitura autenticada"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'demandas-anexos');
CREATE POLICY "Demandas anexos: upload autenticado"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'demandas-anexos');
-- 5) Corrigir search_path mutável em tg_treinamentos_updated
CREATE OR REPLACE FUNCTION public.tg_treinamentos_updated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END
$$;
-- 6) Revogar EXECUTE de anon nas funções SECURITY DEFINER auxiliares
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_cliente(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_meu_plano() FROM anon, public;
