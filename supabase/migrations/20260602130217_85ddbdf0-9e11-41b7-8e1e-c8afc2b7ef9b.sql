UPDATE public.configuracoes_sistema
SET valor = encode(gen_random_bytes(32), 'hex'),
    descricao = 'Segredo HMAC usado pelo gatilho e pelo cron para chamar os webhooks de email',
    atualizado_em = now()
WHERE chave = 'email_webhook_secret'
  AND (valor IS NULL OR length(valor) < 32);
