ALTER TABLE public.treinamentos ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'video';
ALTER TABLE public.treinamentos DROP CONSTRAINT IF EXISTS treinamentos_tipo_check;
ALTER TABLE public.treinamentos ADD CONSTRAINT treinamentos_tipo_check CHECK (tipo IN ('video','pdf'));
