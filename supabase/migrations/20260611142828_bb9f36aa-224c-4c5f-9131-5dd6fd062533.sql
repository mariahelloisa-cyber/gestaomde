CREATE POLICY "Capas treinamentos: leitura autenticada"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'treinamentos-capas');
CREATE POLICY "Capas treinamentos: admin insere"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'treinamentos-capas' AND public.is_admin(auth.uid()));
CREATE POLICY "Capas treinamentos: admin atualiza"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'treinamentos-capas' AND public.is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'treinamentos-capas' AND public.is_admin(auth.uid()));
CREATE POLICY "Capas treinamentos: admin exclui"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'treinamentos-capas' AND public.is_admin(auth.uid()));
