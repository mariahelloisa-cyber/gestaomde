-- O app deixou de rodar em gestaomde.lovable.app e passou a rodar no domínio
-- próprio (xn--gestomde-uza.tec.br). Atualiza as URLs hardcoded usadas pelos
-- webhooks internos (designação de tarefa e lembretes/expirados diários).

CREATE OR REPLACE FUNCTION public.notificar_designacao_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url    text := 'https://xn--gestomde-uza.tec.br/api/public/hooks/email-assignment';
  v_secret text;
BEGIN
  SELECT valor INTO v_secret
  FROM public.configuracoes_sistema
  WHERE chave = 'email_webhook_secret';

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

DO $$
BEGIN
  PERFORM cron.unschedule('email-daily-08h');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'email-daily-08h',
    '0 11 * * *',
    format($job$
      SELECT net.http_post(
        url := 'https://xn--gestomde-uza.tec.br/api/public/hooks/email-daily',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-webhook-secret', COALESCE(
            (SELECT valor FROM public.configuracoes_sistema WHERE chave = 'email_webhook_secret'),
            ''
          )
        ),
        body := '{}'::jsonb
      );
    $job$)
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
