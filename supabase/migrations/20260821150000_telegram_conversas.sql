-- Histórico de mensagens por chat do Telegram, para o bot manter contexto
-- entre uma mensagem e outra (ex: bot pergunta algo, usuário responde depois).
-- Acesso restrito ao service_role, mesmo raciocínio de telegram_usuarios.
CREATE TABLE public.telegram_conversas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id BIGINT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  conteudo TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_telegram_conversas_chat ON public.telegram_conversas(telegram_chat_id, criado_em);

GRANT ALL ON public.telegram_conversas TO service_role;
ALTER TABLE public.telegram_conversas ENABLE ROW LEVEL SECURITY;
