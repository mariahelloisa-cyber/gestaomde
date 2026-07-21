DO $$
BEGIN
  PERFORM cron.unschedule('whatsapp-daily-08h');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DROP FUNCTION IF EXISTS public.notificar_designacao_whatsapp() CASCADE;

DROP TABLE IF EXISTS public.whatsapp_logs;
DROP TABLE IF EXISTS public.configuracoes_sistema;

ALTER TABLE public.perfis_usuarios DROP COLUMN IF EXISTS telefone;
ALTER TABLE public.tarefas DROP COLUMN IF EXISTS aviso_lembrete_enviado_em;
ALTER TABLE public.tarefas DROP COLUMN IF EXISTS aviso_expirado_enviado_em;