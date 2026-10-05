import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/**
 * Bindings e secrets do Worker.
 *
 * Nada aqui é opcional a partir da etapa 2: o login depende do Supabase e o
 * OAuthProvider depende do KV. Os secrets entram por `wrangler secret put`,
 * nunca no wrangler.jsonc.
 */
export interface Env {
  /** Exigido pelo @cloudflare/workers-oauth-provider para guardar grants e tokens. */
  OAUTH_KV: KVNamespace;

  /**
   * Injetado pelo OAuthProvider no `defaultHandler`. É por aqui que o
   * AuthHandler chama parseAuthRequest, beginConsent, completeAuthorization etc.
   */
  OAUTH_PROVIDER: OAuthHelpers;

  /** Projeto Supabase do CRM, ex. https://xxxx.supabase.co */
  SUPABASE_URL: string;

  /**
   * Chave publishable (anon). O login usa ela e nada além dela: a service role
   * NÃO entra neste Worker, porque o ponto da etapa 3 é que toda leitura passe
   * pelo RLS com o JWT do usuário.
   */
  SUPABASE_PUBLISHABLE_KEY: string;

  /**
   * Só em desenvolvimento: "1" libera redirect_uri de loopback (localhost,
   * 127.0.0.0/8, ::1) no registro dinâmico de cliente, para o MCP Inspector
   * conseguir se registrar.
   *
   * Opcional de propósito: ausente significa produção. Mora no .dev.vars, que é
   * gitignored, e NÃO deve existir como secret em produção — com ela ligada,
   * qualquer processo local pode se registrar como cliente OAuth deste servidor.
   */
  PERMITIR_REDIRECT_LOCAL?: string;
}
