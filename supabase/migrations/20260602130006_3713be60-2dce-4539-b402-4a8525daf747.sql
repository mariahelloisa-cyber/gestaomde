-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Campos de controle de idempotência nos avisos
ALTER TABLE public.tarefas
  ADD COLUMN IF NOT EXISTS aviso_lembrete_enviado_em timestamptz,
  ADD COLUMN IF NOT EXISTS aviso_expirado_enviado_em timestamptz;

-- Configurações globais (Admin apenas)
CREATE TABLE public.configuracoes_sistema (
  chave text PRIMARY KEY,
  valor text,
  descricao text,
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.configuracoes_sistema TO authenticated;
GRANT ALL ON public.configuracoes_sistema TO service_role;

ALTER TABLE public.configuracoes_sistema ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins leem configuracoes"
  ON public.configuracoes_sistema FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins inserem configuracoes"
  ON public.configuracoes_sistema FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins atualizam configuracoes"
  ON public.configuracoes_sistema FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins excluem configuracoes"
  ON public.configuracoes_sistema FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- Logs de envio de e-mail
CREATE TABLE public.email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id uuid,
  usuario_id uuid,
  destinatario text,
  tipo text NOT NULL,
  assunto text NOT NULL,
  mensagem text NOT NULL,
  status text NOT NULL,
  resposta text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.email_logs TO authenticated;
GRANT ALL ON public.email_logs TO service_role;

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados leem logs de email"
  ON public.email_logs FOR SELECT TO authenticated
  USING (true);

CREATE INDEX idx_email_logs_tarefa ON public.email_logs(tarefa_id);
CREATE INDEX idx_email_logs_criado_em ON public.email_logs(criado_em DESC);

-- Trigger para disparar webhook ao designar responsável
CREATE OR REPLACE FUNCTION public.notificar_designacao_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url    text := 'https://gestaomde.lovable.app/api/public/hooks/email-assignment';
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

REVOKE EXECUTE ON FUNCTION public.notificar_designacao_email() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notificar_designacao_email
AFTER INSERT ON public.tarefa_responsaveis
FOR EACH ROW EXECUTE FUNCTION public.notificar_designacao_email();

-- Agendamento diário 08:00 BRT (= 11:00 UTC) para lembretes/expirados
DO $$
DECLARE
  v_secret text;
BEGIN
  SELECT valor INTO v_secret
  FROM public.configuracoes_sistema
  WHERE chave = 'email_webhook_secret';

  PERFORM cron.schedule(
    'email-daily-08h',
    '0 11 * * *',
    format($job$
      SELECT net.http_post(
        url := 'https://gestaomde.lovable.app/api/public/hooks/email-daily',
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