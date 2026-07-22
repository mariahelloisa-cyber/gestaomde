-- Ideias: membros sugerem, Admins avaliam (aceitar com nota/pontos ou
-- rejeitar). Histórico fica visível pra todo mundo; nada é apagado.

CREATE TABLE public.ideias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descricao text,
  criado_por uuid NOT NULL REFERENCES public.perfis_usuarios(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pendente',
  pontos integer,
  avaliado_por uuid REFERENCES public.perfis_usuarios(id) ON DELETE SET NULL,
  avaliado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ideias_criado_por ON public.ideias(criado_por);

GRANT SELECT, INSERT, UPDATE ON public.ideias TO authenticated;
GRANT ALL ON public.ideias TO service_role;
ALTER TABLE public.ideias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados veem ideias"
  ON public.ideias FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados criam a propria ideia"
  ON public.ideias FOR INSERT TO authenticated WITH CHECK (auth.uid() = criado_por);

CREATE POLICY "Admins avaliam ideias"
  ON public.ideias FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Webhook: avisa os Admins por e-mail assim que uma ideia nova é criada.
CREATE OR REPLACE FUNCTION public.notificar_nova_ideia_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url    text := 'https://xn--gestomde-uza.tec.br/api/public/hooks/email-ideia';
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
    body := jsonb_build_object('ideia_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_nova_ideia_email ON public.ideias;
CREATE TRIGGER trg_notificar_nova_ideia_email
AFTER INSERT ON public.ideias
FOR EACH ROW EXECUTE FUNCTION public.notificar_nova_ideia_email();
