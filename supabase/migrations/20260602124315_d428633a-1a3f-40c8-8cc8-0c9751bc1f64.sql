
-- 1) Tabela de configuracoes globais (chave/valor)
CREATE TABLE IF NOT EXISTS public.configuracoes_sistema (
  chave TEXT NOT NULL PRIMARY KEY,
  valor TEXT,
  descricao TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por UUID
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.configuracoes_sistema TO authenticated;
GRANT ALL ON public.configuracoes_sistema TO service_role;

ALTER TABLE public.configuracoes_sistema ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins leem configuracoes"
  ON public.configuracoes_sistema FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins inserem configuracoes"
  ON public.configuracoes_sistema FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins atualizam configuracoes"
  ON public.configuracoes_sistema FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins excluem configuracoes"
  ON public.configuracoes_sistema FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- 2) Seed das chaves de WhatsApp (vazias, para o Admin preencher na UI)
INSERT INTO public.configuracoes_sistema (chave, valor, descricao) VALUES
  ('whatsapp_api_url',   '', 'URL completa do endpoint de envio (ex: https://free.uazapi.com/send/text)'),
  ('whatsapp_api_token', '', 'Token de autenticacao do provedor WhatsApp')
ON CONFLICT (chave) DO NOTHING;

-- 3) Atualiza a funcao do trigger para ler do banco
CREATE OR REPLACE FUNCTION public.notificar_designacao_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url   TEXT := 'https://gestaomde.lovable.app/api/public/hooks/whatsapp-assignment';
  v_token TEXT;
BEGIN
  SELECT valor INTO v_token
  FROM public.configuracoes_sistema
  WHERE chave = 'whatsapp_api_token';

  IF v_token IS NULL OR v_token = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-trigger', v_token
    ),
    body := jsonb_build_object(
      'tarefa_id', NEW.tarefa_id,
      'usuario_id', NEW.usuario_id
    )
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notificar_designacao_whatsapp() FROM PUBLIC, anon, authenticated;
