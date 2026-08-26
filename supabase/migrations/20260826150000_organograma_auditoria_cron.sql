-- Agendamento diário 09:00 BRT (= 12:00 UTC) para os avisos de auditoria do
-- organograma (lembrete 2 dias antes e "atrasada" no dia do checkpoint),
-- mesmo padrão do email-daily-08h em 20260602130006.
DO $$
BEGIN
  PERFORM cron.schedule(
    'organograma-auditoria-09h',
    '0 12 * * *',
    format($job$
      SELECT net.http_post(
        url := 'https://xn--gestomde-uza.tec.br/api/public/hooks/organograma-auditoria',
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
