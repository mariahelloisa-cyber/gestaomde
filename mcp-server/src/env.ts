/**
 * Bindings e secrets do Worker.
 *
 * Na etapa 1 nada é obrigatório: o `whoami` só relata o que já está
 * configurado, para confirmar que o Worker sobe antes de ligar o Supabase
 * (etapa 3) e o OAuth (etapa 2).
 */
export interface Env {
  /** Projeto Supabase do CRM, ex. https://xxxx.supabase.co */
  SUPABASE_URL?: string;
  /** Chave anon/publishable. As ferramentas sempre usam o JWT do usuário por cima dela. */
  SUPABASE_ANON_KEY?: string;

  // Etapa 2 (OAuth):
  // OAUTH_KV: KVNamespace;
  // OAUTH_PROVIDER: OAuthHelpers;
  // COOKIE_ENCRYPTION_KEY: string;
}
