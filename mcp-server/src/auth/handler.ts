import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../env";
import { avaliarRedirect } from "./clientes";
import { escoposEfetivos, type Escopo } from "./escopos";
import {
  contar,
  estaBloqueado,
  ipDoCliente,
  limpar,
  LIMITE_LOGIN_EMAIL,
  LIMITE_LOGIN_IP,
  MENSAGEM_BLOQUEIO,
} from "./limites";
import { paginaConsentimento, paginaErro, paginaLogin } from "./pages";
import { entrarComSenha, verificarElegibilidade, type SessaoSupabase } from "./supabase";

/**
 * AuthHandler: o lado "servidor de autorização" do Worker.
 *
 * Fluxo, todo em /authorize:
 *
 *   GET  /authorize   parseAuthRequest + lookupClient -> página de login
 *   POST /authorize   (sem `handle`) login no Supabase, checa elegibilidade,
 *                     beginConsent -> página de consentimento
 *   POST /authorize   (com `handle`) approveConsent/denyConsent ->
 *                     completeAuthorization -> redirect de volta ao cliente
 *
 * Por que um endpoint só: o `handle` do beginConsent já é a credencial de uso
 * único amarrada a este navegador, então a presença dele no POST é o que
 * distingue "estou mandando login" de "estou respondendo o consentimento". Não
 * preciso de uma segunda rota nem de state assinado à mão.
 *
 * CSRF: quem protege é o par beginConsent/approveConsent do provider. O
 * `handle` só vale com o cookie de ligação que o beginConsent emitiu, vale uma
 * única vez, e expira. Os headers que ele devolve também proibem enquadrar a
 * página.
 */

/** Chave do cookie que aponta para a sessão Supabase guardada no KV. */
const COOKIE_LOGIN = "mcp_login";

/** Vida da sessão intermediária entre o login e o consentimento. */
const TTL_LOGIN_SEGUNDOS = 300;

/** Escopos dos contadores de rate limiting. */
const ESCOPO_IP = "login_ip";
const ESCOPO_EMAIL = "login_email";

function cookieSeguro(nome: string, valor: string, maxAge: number): string {
  // HttpOnly: JS da página não lê. Secure: só HTTPS. SameSite=Lax: sobrevive ao
  // redirect de volta do cliente OAuth, mas não vai em POST de outro site.
  return `${nome}=${valor}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function cookieApagado(nome: string): string {
  return `${nome}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function lerCookie(request: Request, nome: string): string | null {
  const bruto = request.headers.get("cookie");
  if (!bruto) return null;
  for (const parte of bruto.split(";")) {
    const [k, ...resto] = parte.trim().split("=");
    if (k === nome) return resto.join("=") || null;
  }
  return null;
}

/** Id opaco, sem significado, para a chave do KV. */
function idAleatorio(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface LoginGuardado {
  sessao: SessaoSupabase;
  cargo: string;
  nome: string;
  /**
   * O pedido OAuth em que este login nasceu.
   *
   * Sem isto, o cookie de login é uma credencial solta: vale para QUALQUER
   * query string em /authorize. O ataque é direto — o atacante leva a vítima a
   * /authorize?client_id=dele&redirect_uri=dele logo depois de um login
   * legítimo e, com o cookie ainda no prazo, a tela de consentimento aparece já
   * autenticada. Um clique distraído em Permitir manda o code para o cliente
   * dele.
   *
   * Amarrando clientId e redirectUri, o login só serve para o pedido que o
   * criou.
   */
  clientId: string;
  redirectUri: string;
}

const chaveKv = (id: string) => `login_pendente:${id}`;

/**
 * Guarda a sessão do Supabase entre o POST do login e o POST do consentimento.
 *
 * Vai para o KV, e não para um cookie, de propósito: o access token do Supabase
 * é um JWT e eu não quero mandá-lo ao navegador nem como cookie HttpOnly. O que
 * trafega é só um id opaco. TTL curto e leitura de uso único.
 */
async function guardarLogin(env: Env, dados: LoginGuardado): Promise<string> {
  const id = idAleatorio();
  await env.OAUTH_KV.put(chaveKv(id), JSON.stringify(dados), {
    expirationTtl: TTL_LOGIN_SEGUNDOS,
  });
  return id;
}

async function consumirLogin(env: Env, id: string): Promise<LoginGuardado | null> {
  const bruto = await env.OAUTH_KV.get(chaveKv(id));
  if (!bruto) return null;
  // Uso único: some mesmo que o consentimento falhe depois.
  await env.OAUTH_KV.delete(chaveKv(id));
  try {
    return JSON.parse(bruto) as LoginGuardado;
  } catch {
    return null;
  }
}

/**
 * O login guardado nasceu NESTE pedido OAuth?
 *
 * Comparação exata dos dois campos. O redirectUri entra junto com o clientId
 * porque um cliente legítimo pode ter vários redirect_uri registrados, e trocar
 * de um para outro no meio do fluxo não é coisa que cliente honesto faça.
 */
function loginCombinaComPedido(login: LoginGuardado, authRequest: AuthRequest): boolean {
  return login.clientId === authRequest.clientId && login.redirectUri === authRequest.redirectUri;
}

/** Mostra a tela de consentimento para um login já validado. */
async function responderConsentimento(
  env: Env,
  authRequest: AuthRequest,
  login: LoginGuardado,
  cookieId: string,
  escopos: readonly Escopo[],
): Promise<Response> {
  const descricao = await env.OAUTH_PROVIDER.describeConsent(authRequest);
  const { handle, headers } = await env.OAUTH_PROVIDER.beginConsent(authRequest);

  const pagina = paginaConsentimento({
    clientName: descricao.clientName,
    clientDomain: descricao.clientDomain,
    redirectHost: descricao.redirectHost,
    redirectIsLoopback: descricao.redirectIsLoopback,
    // Os EFETIVOS, não `descricao.scope`: aquele é o que o cliente pediu, que
    // pode estar vazio. A pessoa tem que aprovar o que vai de fato ser
    // concedido.
    escopos,
    usuarioEmail: login.sessao.email,
    usuarioCargo: login.cargo,
    handle,
  });

  // Os headers do beginConsent trazem o cookie de ligação e o anti-frame.
  const saida = new Headers(pagina.headers);
  headers.forEach((v, k) => saida.append(k, v));
  saida.append("set-cookie", cookieSeguro(COOKIE_LOGIN, cookieId, TTL_LOGIN_SEGUNDOS));

  return new Response(pagina.body, { status: 200, headers: saida });
}

export const AuthHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return await saude(env);
    }

    if (url.pathname !== "/authorize") {
      return new Response("Not found", { status: 404 });
    }

    // parseAuthRequest valida response_type, client_id, redirect_uri (só as
    // registradas) e PKCE. Se falhar, não há cliente confiável para onde
    // redirecionar: respondemos uma página de erro.
    let authRequest: AuthRequest;
    try {
      authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    } catch {
      return paginaErro(
        "Pedido de autorização inválido",
        "O aplicativo não mandou um pedido de autorização válido. Tente conectar de novo a partir dele.",
      );
    }

    const cliente = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
    if (!cliente) {
      return paginaErro(
        "Aplicativo desconhecido",
        "Este aplicativo não está registrado neste servidor.",
      );
    }

    // A lista branca de redirect_uri é aplicada no /register, mas confiro aqui
    // de novo: um cliente registrado ANTES desta política continua gravado no
    // KV até o clientRegistrationTTL vencer, e a checagem no registro não
    // alcança quem já passou. Barato, e fecha a janela.
    const veredicto = avaliarRedirect(env, authRequest.redirectUri);
    if (!veredicto.ok) {
      console.warn("[authorize] redirect_uri fora da lista branca");
      return paginaErro("Aplicativo não autorizado", veredicto.motivo, 403);
    }

    // Os escopos EFETIVOS, resolvidos uma vez e usados em tudo que vem depois:
    // a tela de consentimento, o approveConsent e o grant. O Inspector não
    // manda `scope`, e sem isto o grant nascia vazio.
    const resolvidos = escoposEfetivos(authRequest.scope);
    if (!resolvidos.ok) {
      return paginaErro(resolvidos.titulo, resolvidos.detalhe, 400);
    }
    const escopos = resolvidos.escopos;

    const nomeCliente = cliente.clientName ?? authRequest.clientId;

    // ---------------------------------------------------------------- GET ---
    if (request.method === "GET") {
      return paginaLogin({ clientName: nomeCliente });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
    }

    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");

    // ------------------------------------------- POST: consentimento --------
    if (handle) {
      const cookieId = lerCookie(request, COOKIE_LOGIN);
      if (!cookieId) {
        return paginaErro(
          "Sessão expirada",
          "Faça o login de novo: a sessão entre o login e a autorização expirou.",
          400,
        );
      }

      const login = await consumirLogin(env, cookieId);
      if (!login) {
        return paginaErro(
          "Sessão expirada",
          "Faça o login de novo: a sessão entre o login e a autorização expirou.",
          400,
        );
      }

      // O login tem que ser DESTE pedido. Como consumirLogin já apagou o
      // registro, tentar reaproveitar queima o login de qualquer jeito: quem
      // fizer isso volta ao começo.
      if (!loginCombinaComPedido(login, authRequest)) {
        console.warn("[authorize] login guardado nao corresponde ao pedido OAuth");
        return paginaErro(
          "Pedido não corresponde ao login",
          "Este login foi feito para outro aplicativo. Comece de novo a partir do aplicativo com que você quer se conectar.",
          400,
        );
      }

      const decisao = String(form.get("decisao") ?? "");

      // --- Negar: redirect com error=access_denied, feito pelo provider ---
      if (decisao !== "permitir") {
        const negado = await env.OAUTH_PROVIDER.denyConsent(request, handle, {
          description: "O usuário negou o acesso ao CRM.",
        });
        const headers = new Headers(negado.headers);
        headers.append("set-cookie", cookieApagado(COOKIE_LOGIN));
        headers.set("location", negado.redirectTo);
        return new Response(null, { status: 302, headers });
      }

      // --- Permitir ---
      // approveConsent consome o handle: exige o cookie de ligação, serve uma
      // vez só e lança se estiver expirado ou já usado.
      let aprovado;
      try {
        aprovado = await env.OAUTH_PROVIDER.approveConsent(request, handle, {
          // Os efetivos. approveConsent sobrescreve o scope do pedido com
          // estes, e é o pedido aprovado que vira o grant logo abaixo.
          scope: [...escopos],
        });
      } catch {
        return paginaErro(
          "Autorização expirada",
          "Esta tela de autorização não vale mais. Tente conectar de novo a partir do aplicativo.",
          400,
        );
      }

      // Reconfere a elegibilidade AGORA, e não só depois do login: entre uma
      // coisa e outra o usuário pode ter sido desativado ou trocado de cargo.
      const elegivel = await verificarElegibilidade(env, login.sessao);
      if (!elegivel.ok) {
        return paginaErro("Acesso não permitido", elegivel.motivo, 403);
      }

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: aprovado.request,
        userId: login.sessao.userId,
        scope: aprovado.request.scope,
        // `metadata` é só para os painéis de grant do provider.
        metadata: { email: login.sessao.email, cargo: elegivel.cargo },
        // O provider criptografa os props no KV. O cargo entra só para exibir e
        // para decidir quais ferramentas registrar; quem autoriza é o RLS.
        props: {
          userId: login.sessao.userId,
          email: login.sessao.email,
          cargo: elegivel.cargo,
          sbAccess: login.sessao.accessToken,
          sbRefresh: login.sessao.refreshToken,
        },
      });

      const headers = new Headers(aprovado.headers);
      headers.append("set-cookie", cookieApagado(COOKIE_LOGIN));
      headers.set("location", redirectTo);
      return new Response(null, { status: 302, headers });
    }

    // ------------------------------------------------- POST: login ----------
    const email = String(form.get("email") ?? "").trim();
    const senha = String(form.get("senha") ?? "");

    if (!email || !senha) {
      return paginaLogin({ clientName: nomeCliente, erro: "Informe e-mail e senha." });
    }

    const ip = ipDoCliente(request);

    // Dois contadores, de propósito: só por IP não pega o ataque distribuído
    // em muitos IPs contra uma conta, e só por e-mail não pega a varredura de
    // vários e-mails saindo do mesmo lugar.
    //
    // O custo conhecido do limite por e-mail é que alguém pode travar um
    // e-mail conhecido por 15 minutos errando a senha cinco vezes. Aceito: a
    // alternativa é deixar a conta exposta a força bruta, e a janela é curta.
    const [bloqueadoPorIp, bloqueadoPorEmail] = await Promise.all([
      estaBloqueado(env, ESCOPO_IP, ip, LIMITE_LOGIN_IP),
      estaBloqueado(env, ESCOPO_EMAIL, email, LIMITE_LOGIN_EMAIL),
    ]);

    if (bloqueadoPorIp || bloqueadoPorEmail) {
      // Nem tenta o login: o ponto é não gastar o rate limit do Supabase e não
      // dar como resposta se a senha estava certa.
      return paginaLogin({ clientName: nomeCliente, erro: MENSAGEM_BLOQUEIO });
    }

    const tentativa = await entrarComSenha(env, email, senha);
    if ("erro" in tentativa) {
      await Promise.all([
        contar(env, ESCOPO_IP, ip, LIMITE_LOGIN_IP),
        contar(env, ESCOPO_EMAIL, email, LIMITE_LOGIN_EMAIL),
      ]);

      // Se foi esta falha que estourou o limite, já respondemos a mensagem de
      // bloqueio — senão a pessoa só descobriria tentando de novo.
      const [passouIp, passouEmail] = await Promise.all([
        estaBloqueado(env, ESCOPO_IP, ip, LIMITE_LOGIN_IP),
        estaBloqueado(env, ESCOPO_EMAIL, email, LIMITE_LOGIN_EMAIL),
      ]);

      // Genérica nos dois casos: não dizemos se o e-mail existe.
      const erro = passouIp || passouEmail ? MENSAGEM_BLOQUEIO : tentativa.erro;
      return paginaLogin({ clientName: nomeCliente, erro });
    }

    // Senha certa: os contadores de falha somem, mesmo que a elegibilidade
    // reprove depois. Quem acertou a senha não é força bruta.
    await Promise.all([limpar(env, ESCOPO_IP, ip), limpar(env, ESCOPO_EMAIL, email)]);

    const elegivel = await verificarElegibilidade(env, tentativa.sessao);
    if (!elegivel.ok) {
      return paginaLogin({ clientName: nomeCliente, erro: elegivel.motivo });
    }

    const login: LoginGuardado = {
      sessao: tentativa.sessao,
      cargo: elegivel.cargo,
      nome: elegivel.nome,
      clientId: authRequest.clientId,
      redirectUri: authRequest.redirectUri,
    };

    const cookieId = await guardarLogin(env, login);

    return responderConsentimento(env, authRequest, login, cookieId, escopos);
  },
};

/**
 * Healthcheck que serve para algo.
 *
 * `{ok: true}` fixo não detecta o erro que realmente acontece em produção:
 * secret não criado, ou id de KV errado colado no wrangler.jsonc. Nos dois
 * casos o Worker sobe, responde 200 no health, e só quebra quando alguém tenta
 * fazer login — que é a pior hora para descobrir.
 *
 * Então confiro o que é confirmável sem credencial de usuário:
 *
 *   - os dois secrets do Supabase existem e não estão vazios;
 *   - o binding do KV responde a uma leitura.
 *
 * O que NÃO vai na resposta: valor de secret, nem id de namespace. Só
 * "configurado" ou "faltando" — isto é endpoint público.
 *
 * A leitura do KV é de uma chave que não existe: prova que o binding está
 * ligado sem gravar nada e sem custo relevante.
 */
async function saude(env: Env): Promise<Response> {
  const supabase =
    env.SUPABASE_URL?.trim() && env.SUPABASE_PUBLISHABLE_KEY?.trim() ? "configurado" : "faltando";

  let kv: "ok" | "falhou" = "ok";
  try {
    await env.OAUTH_KV.get("health:sonda");
  } catch {
    kv = "falhou";
  }

  const ok = supabase === "configurado" && kv === "ok";

  return Response.json(
    {
      ok,
      supabase,
      kv,
      // Útil no checklist pós-deploy: diz se a flag de dev vazou para produção.
      redirect_local: env.PERMITIR_REDIRECT_LOCAL === "1" ? "LIGADO" : "desligado",
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
