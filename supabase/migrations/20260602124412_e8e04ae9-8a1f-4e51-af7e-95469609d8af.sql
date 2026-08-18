CREATE OR REPLACE FUNCTION public.notificar_designacao_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url    TEXT := 'https://gestaomde.lovable.app/api/public/hooks/whatsapp-assignment';
  v_secret TEXT;
BEGIN
  SELECT valor INTO v_secret
  FROM public.configuracoes_sistema
  WHERE chave = 'whatsapp_webhook_secret';

  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
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
