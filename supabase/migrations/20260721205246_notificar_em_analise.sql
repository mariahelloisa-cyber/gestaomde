-- Ao mover uma tarefa para "Em Análise", avisa todos os Admins ativos por
-- e-mail (mesmo mecanismo de webhook já usado para designação/lembretes).

CREATE OR REPLACE FUNCTION public.notificar_em_analise_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url    text := 'https://xn--gestomde-uza.tec.br/api/public/hooks/email-em-analise';
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
    body := jsonb_build_object('tarefa_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_em_analise_email ON public.tarefas;
CREATE TRIGGER trg_notificar_em_analise_email
AFTER UPDATE ON public.tarefas
FOR EACH ROW
WHEN (NEW.status = 'Em Análise' AND OLD.status IS DISTINCT FROM 'Em Análise')
EXECUTE FUNCTION public.notificar_em_analise_email();
