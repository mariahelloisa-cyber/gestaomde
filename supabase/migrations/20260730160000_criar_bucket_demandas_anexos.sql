
-- O bucket "demandas-anexos" nunca foi criado (só as políticas de storage
-- existiam), então todo upload — PDF ou áudio — falhava com "bucket not
-- found". Privado: leitura só para a equipe autenticada, upload liberado
-- para anon também (formulário público sem login).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('demandas-anexos', 'demandas-anexos', false, 15728640)
ON CONFLICT (id) DO NOTHING;
