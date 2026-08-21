-- Vínculo entre chat do Telegram e usuário do sistema, usado pelo bot do Telegram.
-- Acesso restrito ao service_role (usado pelo webhook do bot); não há policy para
-- authenticated/anon porque nenhum código de app comum deve ler esta tabela.
CREATE TABLE public.telegram_usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id BIGINT NOT NULL UNIQUE,
  usuario_id UUID NOT NULL REFERENCES public.perfis_usuarios(id) ON DELETE CASCADE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.telegram_usuarios TO service_role;
ALTER TABLE public.telegram_usuarios ENABLE ROW LEVEL SECURITY;
