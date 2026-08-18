-- 1) Telefone no perfil (obrigatorio na UI; nullable no DB para nao quebrar usuarios existentes)
ALTER TABLE public.perfis_usuarios
  ADD COLUMN IF NOT EXISTS telefone TEXT;
-- 2) Colunas de controle de aviso nas tarefas (idempotencia)
ALTER TABLE public.tarefas
  ADD COLUMN IF NOT EXISTS aviso_lembrete_enviado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aviso_expirado_enviado_em TIMESTAMPTZ;
-- 3) Tabela de logs dos envios de WhatsApp
CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tarefa_id UUID,
  usuario_id UUID,
  telefone TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('designacao','lembrete','expirado','teste')),
  mensagem TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('enviado','erro')),
  resposta TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.whatsapp_logs TO authenticated;
GRANT ALL ON public.whatsapp_logs TO service_role;
ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticados leem logs whatsapp"
  ON public.whatsapp_logs FOR SELECT
  TO authenticated
  USING (true);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_tarefa ON public.whatsapp_logs(tarefa_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_criado ON public.whatsapp_logs(criado_em DESC);
-- 4) Extensoes necessarias
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;
-- 5) Configuracoes do webhook (URL e apikey ficam em app settings)
-- Definidos via insert tool depois da migracao para nao expor no codigo.

-- 6) Funcao + trigger: ao designar responsavel, dispara webhook
CREATE OR REPLACE FUNCTION public.notificar_designacao_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url TEXT;
  v_apikey TEXT;
BEGIN
  BEGIN
    v_url := current_setting('app.whatsapp_assignment_url', true);
    v_apikey := current_setting('app.whatsapp_apikey', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  IF v_url IS NULL OR v_url = '' OR v_apikey IS NULL OR v_apikey = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_apikey
    ),
    body := jsonb_build_object(
      'tarefa_id', NEW.tarefa_id,
      'usuario_id', NEW.usuario_id
    )
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notificar_designacao ON public.tarefa_responsaveis;
CREATE TRIGGER trg_notificar_designacao
AFTER INSERT ON public.tarefa_responsaveis
FOR EACH ROW
EXECUTE FUNCTION public.notificar_designacao_whatsapp();
