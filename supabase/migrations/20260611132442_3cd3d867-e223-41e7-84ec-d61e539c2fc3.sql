
DROP POLICY IF EXISTS "Clientes veem treinamentos do seu plano" ON public.treinamentos;

ALTER TABLE public.treinamentos DROP CONSTRAINT IF EXISTS treinamentos_plano_destino_check;
ALTER TABLE public.treinamentos ALTER COLUMN plano_destino DROP DEFAULT;
ALTER TABLE public.treinamentos ALTER COLUMN plano_destino TYPE text[] USING ARRAY[plano_destino];
ALTER TABLE public.treinamentos ALTER COLUMN plano_destino SET DEFAULT ARRAY['Todos']::text[];
ALTER TABLE public.treinamentos ALTER COLUMN plano_destino SET NOT NULL;

ALTER TABLE public.treinamentos
  ADD CONSTRAINT treinamentos_plano_destino_check
  CHECK (
    array_length(plano_destino, 1) >= 1
    AND plano_destino <@ ARRAY['Bronze','Prata','Ouro','Diamond','Todos']::text[]
  );

CREATE POLICY "Clientes veem treinamentos do seu plano"
ON public.treinamentos
FOR SELECT
USING (
  ('Todos' = ANY(plano_destino))
  OR (get_meu_plano() = ANY(plano_destino))
  OR ((NOT is_cliente(auth.uid())) AND (auth.uid() IS NOT NULL))
);
