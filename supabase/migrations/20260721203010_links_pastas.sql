-- Pastas nomeadas para guardar links de trabalho, com comentário e quantos
-- links forem necessários. Acesso liberado para qualquer autenticado, igual
-- ao padrão já usado em clientes/tarefas.

CREATE TABLE public.pastas_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  comentario text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pastas_links TO authenticated;
GRANT ALL ON public.pastas_links TO service_role;
ALTER TABLE public.pastas_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados gerenciam pastas_links"
  ON public.pastas_links FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.pastas_links_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pasta_id uuid NOT NULL REFERENCES public.pastas_links(id) ON DELETE CASCADE,
  url text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pastas_links_itens_pasta ON public.pastas_links_itens(pasta_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pastas_links_itens TO authenticated;
GRANT ALL ON public.pastas_links_itens TO service_role;
ALTER TABLE public.pastas_links_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados gerenciam pastas_links_itens"
  ON public.pastas_links_itens FOR ALL TO authenticated USING (true) WITH CHECK (true);
