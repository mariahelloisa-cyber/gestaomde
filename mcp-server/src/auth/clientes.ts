import type { ClientRegistrationCallbackOptions } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../env";

/**
 * Política de quem pode se registrar como cliente OAuth deste servidor.
 *
 * O PROBLEMA
 *
 *   /register é Dynamic Client Registration (RFC 7591) e é aberto: qualquer um
 *   faz um POST e recebe um client_id. Sem restrição, um atacante registra um
 *   cliente com `client_name: "Claude"` e `redirect_uri` apontando para o
 *   servidor dele, manda o link de /authorize para alguém da equipe e, se a
 *   pessoa fizer login e aprovar, o authorization code vai para o atacante.
 *   Nome e logo do cliente são auto-declarados: a tela de consentimento não
 *   tem como desmentir.
 *
 *   Nossos clientes legítimos são conhecidos e fixos — só o Claude consome este
 *   servidor. Então a lista branca de redirect_uri é a defesa certa: ela não
 *   depende de o usuário ler a tela com atenção.
 *
 * O QUE ESTA LISTA NÃO FAZ
 *
 *   Ela não autentica o cliente. Qualquer um ainda pode registrar um cliente
 *   com estes redirect_uri; só que então o code vai para o Claude de verdade, e
 *   não para o atacante, que fica sem ele. É isso que mata o phishing.
 */

/**
 * Os dois callbacks de conector remoto do Claude. São os únicos endereços para
 * onde este servidor aceita mandar authorization code.
 *
 * Comparação exata de string, depois de normalizar. Nada de prefixo ou
 * `endsWith`: `https://claude.ai.evil.com/...` passaria num `startsWith` mal
 * feito, e `...auth_callback?x=1` num `endsWith`.
 */
export const REDIRECTS_PERMITIDOS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
] as const;

/** A flag de dev está ligada? Só "1" conta, para não ligar por acidente. */
export function permiteLoopback(env: Env): boolean {
  return env.PERMITIR_REDIRECT_LOCAL === "1";
}

/**
 * Loopback conforme a RFC 8252 §7.3: localhost, 127.0.0.0/8 e ::1. Porta
 * livre de propósito — o Inspector sorteia a dele.
 */
function ehLoopback(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host === "[::1]") return true;
  const ipv4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return ipv4 !== null && ipv4.slice(1).every((octeto) => Number(octeto) <= 255);
}

/**
 * Normaliza para comparar: só o que identifica o destino. Query e fragmento
 * entram na comparação como vazios porque a lista branca não tem nenhum dos
 * dois — se um dia tiver, isto precisa mudar junto.
 */
function normalizar(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.search || url.hash) return null;
  // `origin` já embute esquema, host e porta, em minúsculas.
  return `${url.origin}${url.pathname}`;
}

export type VeredictoRedirect = { ok: true } | { ok: false; motivo: string };

/** Este redirect_uri pode receber authorization code deste servidor? */
export function avaliarRedirect(env: Env, uri: string): VeredictoRedirect {
  const normalizado = normalizar(uri);
  if (!normalizado) {
    return { ok: false, motivo: "redirect_uri inválido ou com query/fragmento." };
  }

  if ((REDIRECTS_PERMITIDOS as readonly string[]).includes(normalizado)) {
    return { ok: true };
  }

  if (permiteLoopback(env)) {
    const url = new URL(normalizado);
    // http é aceito só no loopback, e só em dev: é o caso do Inspector.
    if (ehLoopback(url) && (url.protocol === "http:" || url.protocol === "https:")) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    motivo: "Este servidor só autoriza os conectores do Claude (claude.ai e claude.com).",
  };
}

/** Todos os redirect_uri do pedido precisam passar. */
export function avaliarRedirects(env: Env, uris: readonly string[]): VeredictoRedirect {
  for (const uri of uris) {
    const veredicto = avaliarRedirect(env, uri);
    if (!veredicto.ok) return veredicto;
  }
  return { ok: true };
}

/**
 * Lista de redirect_uris do corpo cru do /register.
 *
 * `clientMetadata` é o JSON como veio — a callback do provider roda antes de o
 * cliente ser gravado, e recebe snake_case, não o ClientInfo já normalizado.
 */
function lerRedirectUris(metadata: Record<string, unknown>): string[] | null {
  const bruto = metadata["redirect_uris"];
  if (!Array.isArray(bruto) || bruto.length === 0) return null;
  const uris: string[] = [];
  for (const item of bruto) {
    if (typeof item !== "string" || !item) return null;
    uris.push(item);
  }
  return uris;
}

/**
 * `clientRegistrationCallback` do provider: devolver nada aprova, devolver
 * objeto reprova (RFC 7591 §3.2.2).
 *
 * Fecha por omissão: metadata sem redirect_uris utilizável também é recusada.
 * O provider já valida o formato depois, mas quem decide política é aqui, e
 * política que depende de validação alheia envelhece mal.
 *
 * `access_denied` com 403, e não `invalid_client_metadata` com 400: o pedido
 * está bem formado, foi a política que negou.
 */
export function politicaDeRegistro(env: Env) {
  return ({ clientMetadata }: ClientRegistrationCallbackOptions) => {
    const uris = lerRedirectUris(clientMetadata);
    if (!uris) {
      return {
        code: "invalid_client_metadata",
        description: "redirect_uris é obrigatório e precisa ser uma lista de strings.",
        status: 400,
      };
    }

    const veredicto = avaliarRedirects(env, uris);
    if (!veredicto.ok) {
      // Sem ecoar o redirect_uri recusado: ele é entrada do atacante e a
      // resposta do /register pode acabar em log de terceiro.
      console.warn("[register] recusado por politica de redirect_uri");
      return {
        code: "access_denied",
        description: `Registro não permitido. ${veredicto.motivo}`,
        status: 403,
      };
    }

    return undefined;
  };
}
