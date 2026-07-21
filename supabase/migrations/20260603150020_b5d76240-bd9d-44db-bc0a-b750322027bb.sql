
-- Status enum
CREATE TYPE public.status_demanda AS ENUM ('pendente', 'aceita', 'recusada', 'transferida');

CREATE TABLE public.demandas_externas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  solicitante_nome text NOT NULL,
  solicitante_email text,
  responsavel_id uuid NOT NULL,
  descricao text NOT NULL,
  prazo_sugerido date,
  anexos jsonb NOT NULL DEFAULT '[]'::jsonb,
  status public.status_demanda NOT NULL DEFAULT 'pendente',
  justificativa_recusa text,
  tarefa_id uuid,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.demandas_externas TO authenticated;
GRANT ALL ON public.demandas_externas TO service_role;

ALTER TABLE public.demandas_externas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados leem demandas"
ON public.demandas_externas FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados atualizam demandas"
ON public.demandas_externas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Autenticados excluem demandas"
ON public.demandas_externas FOR DELETE TO authenticated USING (true);

-- Storage policies: público pode ler e fazer upload no bucket demandas-anexos
CREATE POLICY "Demandas anexos: leitura pública"
ON storage.objects FOR SELECT
USING (bucket_id = 'demandas-anexos');

CREATE POLICY "Demandas anexos: upload público"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'demandas-anexos');
