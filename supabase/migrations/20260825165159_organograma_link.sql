-- Nós-folha do organograma (ex: redes sociais) podem carregar um link opcional,
-- exibido no app como um card com "Ver" em vez da caixa padrão.
ALTER TABLE public.organograma_nos ADD COLUMN link text;
