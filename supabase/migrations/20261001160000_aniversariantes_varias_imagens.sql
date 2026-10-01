-- Aniversariantes: de uma arte para VÁRIAS por pessoa.
--
-- As três colunas imagem_path/imagem_nome/imagem_tipo viram um array jsonb
-- `imagens`, no mesmo formato que public.tarefas.anexos já usa no projeto. A
-- ordem do array é a ordem de envio: o primeiro item é a capa — miniatura da
-- lista, foto do pop-up e og:image da prévia do link.
--
-- Re-executável, como a migration anterior do módulo.

ALTER TABLE public.aniversariantes
  ADD COLUMN IF NOT EXISTS imagens jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Converte o cadastro antigo (uma arte) para o array e remove as colunas
-- velhas. Dentro de um IF para a migration poder rodar de novo depois que as
-- colunas já sumiram.
DO $mig$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'aniversariantes'
      AND column_name = 'imagem_path'
  ) THEN
    UPDATE public.aniversariantes
    SET imagens = jsonb_build_array(
      jsonb_build_object(
        'path', imagem_path,
        'nome', imagem_nome,
        'tipo', imagem_tipo
      )
    )
    WHERE jsonb_array_length(imagens) = 0;

    ALTER TABLE public.aniversariantes
      DROP COLUMN imagem_path,
      DROP COLUMN imagem_nome,
      DROP COLUMN imagem_tipo;
  END IF;
END $mig$;

-- O default só existiu para preencher as linhas antigas no ADD COLUMN. A partir
-- daqui `imagens` é obrigatório: cadastro sem arte não tem o que publicar.
ALTER TABLE public.aniversariantes ALTER COLUMN imagens DROP DEFAULT;

-- A validação mora numa função porque CHECK não aceita subconsulta, e conferir
-- item a item do array exige uma. O CASE garante a ordem de avaliação:
-- jsonb_array_length levanta erro se o valor não for array, então o tipo é
-- testado primeiro.
CREATE OR REPLACE FUNCTION public.aniversariante_imagens_validas(_imagens jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN _imagens IS NULL THEN false
    WHEN jsonb_typeof(_imagens) <> 'array' THEN false
    -- Pelo menos uma arte; o teto de 10 segura o bucket e a folha de
    -- compartilhamento do sistema.
    WHEN jsonb_array_length(_imagens) NOT BETWEEN 1 AND 10 THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(_imagens) AS img
      WHERE jsonb_typeof(img) <> 'object'
         OR COALESCE(img ->> 'path', '') = ''
         OR COALESCE(img ->> 'nome', '') = ''
         OR COALESCE(img ->> 'tipo', '') = ''
    )
  END
$fn$;

ALTER TABLE public.aniversariantes
  DROP CONSTRAINT IF EXISTS aniversariantes_imagens_validas;

ALTER TABLE public.aniversariantes
  ADD CONSTRAINT aniversariantes_imagens_validas
    CHECK (public.aniversariante_imagens_validas(imagens));
