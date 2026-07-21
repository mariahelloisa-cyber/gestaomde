CREATE POLICY "Auth pode ler pdfs de treinamentos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'treinamentos-pdfs');

CREATE POLICY "Admins podem enviar pdfs de treinamentos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'treinamentos-pdfs' AND public.is_admin(auth.uid()));

CREATE POLICY "Admins podem atualizar pdfs de treinamentos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'treinamentos-pdfs' AND public.is_admin(auth.uid()));

CREATE POLICY "Admins podem deletar pdfs de treinamentos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'treinamentos-pdfs' AND public.is_admin(auth.uid()));