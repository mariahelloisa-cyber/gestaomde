-- Campo opcional para o solicitante informar o setor de onde a demanda parte
-- (ex: secretaria, comercial), ajudando a equipe a triar mais rápido.
ALTER TABLE public.demandas_externas ADD COLUMN setor text;
