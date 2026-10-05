import OAuthProvider, {
  getOAuthApi,
  OAuthError,
  type OAuthHelpers,
  type OAuthProviderOptions,
  type OAuthResourceAuth,
  type TokenExchangeCallbackOptions,
  type TokenExchangeCallbackResult,
} from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { politicaDeRegistro } from "./auth/clientes";
import { ESCOPOS_SUPORTADOS } from "./auth/escopos";
import { AuthHandler } from "./auth/handler";
import {
  contar,
  estaBloqueado,
  ipDoCliente,
  LIMITE_REGISTER_IP,
  MENSAGEM_BLOQUEIO,
} from "./auth/limites";
import { renovarSessao, verificarElegibilidade } from "./auth/supabase";
import type { Env } from "./env";
import { createServer, type PropsUsuario } from "./mcp/server";

/**
 * Etapa 2: o Worker é, ao mesmo tempo, servidor de autorização OAuth 2.1 e
 * servidor de recurso MCP — a opção 4 da doc da Cloudflare, "Your MCP Server
 * handles authorization itself".
 *
 * Requisições em /mcp com token válido vão para o apiHandler, com os props
 * descriptografados em ctx.props. Todo o resto (/authorize, /health) cai no
 * AuthHandler, que alcança os helpers por env.OAUTH_PROVIDER.
 *
 * /token, /register e os endpoints de metadata e revogação são implementados
 * pelo próprio provider.
 */

const apiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // ExecutionContext.props já existe e é `unknown`, então o estreitamento é
    // aqui. O `auth` é o que o OAuthProvider acrescenta no ctx desta rota, e
    // OAuthResourceAuth é o tipo que o pacote exporta para ele.
    const props = (ctx.props ?? null) as PropsUsuario | null;
    const comAuth = ctx as ExecutionContext & { auth?: OAuthResourceAuth };
    const escopos = comAuth.auth?.scope ?? [];

    // O handler é construído POR REQUISIÇÃO, e não uma vez no módulo: o
    // authContext é por usuário, e um handler compartilhado entregaria os props
    // de uma pessoa para a requisição da próxima.
    const handler = createMcpHandler(() => createServer(env, props, escopos), {
      route: "/mcp",
      authContext: props ? { props: props as unknown as Record<string, unknown> } : undefined,
      // Só a mensagem, nunca o objeto inteiro: o erro pode carregar cabeçalho
      // de autorização e aí o token iria para o log.
      onerror: (error) => console.error("[mcp]", error.message),
    });

    return handler(request, env, ctx);
  },
};

/**
 * O provider é construído sob demanda, e não no escopo do módulo, por causa do
 * `resourceMetadata.resource`: ele é a URL pública do endpoint MCP, que difere
 * entre `wrangler dev` e produção. Derivo da própria requisição e memoizo por
 * origem, então não há um terceiro lugar para configurar e esquecer.
 */
const providers = new Map<string, OAuthProvider<Env>>();

function obterProvider(resource: string, env: Env): OAuthProvider<Env> {
  // A chave inclui a flag de dev porque ela muda a política de registro, e um
  // provider memoizado com a política errada seria um furo silencioso.
  const chave = `${resource}|${env.PERMITIR_REDIRECT_LOCAL ?? ""}`;
  const existente = providers.get(chave);
  if (existente) return existente;

  const provider = criarProvider(resource, env);
  providers.set(chave, provider);
  return provider;
}

/**
 * Rate limiting do /register, por IP.
 *
 * Fica AQUI, antes de entregar ao provider, porque o
 * `clientRegistrationCallback` não recebe `env` — e sem o binding do KV não há
 * contador. Vantagem de quebra: a tentativa bloqueada nem chega a ser parseada.
 *
 * Conta TODAS as tentativas, não só as recusadas: registro dinâmico legítimo
 * acontece uma vez por conector, então vinte por hora no mesmo IP já é muito, e
 * cada registro aceito grava uma chave no KV — contar só as falhas deixaria de
 * fora justamente o abuso que enche o namespace.
 */
async function limitarRegistro(request: Request, env: Env): Promise<Response | null> {
  const ip = ipDoCliente(request);

  if (await estaBloqueado(env, "register_ip", ip, LIMITE_REGISTER_IP)) {
    console.warn("[register] bloqueado por rate limit");
    return respostaLimite(request);
  }

  await contar(env, "register_ip", ip, LIMITE_REGISTER_IP);
  return null;
}

/**
 * 429 em JSON, no formato de erro do OAuth. `temporarily_unavailable` é o
 * código mais honesto que a RFC 6749 oferece: a RFC 7591 não definiu nenhum
 * para excesso de requisições.
 */
function respostaLimite(request: Request): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
    "retry-after": "600",
  };

  // O provider põe CORS nas respostas dele; esta sai antes dele, então o
  // cabeçalho vai na mão para o cliente de navegador ler o corpo do erro.
  const origem = request.headers.get("origin");
  if (origem) {
    headers["access-control-allow-origin"] = origem;
    headers["vary"] = "Origin";
  }

  return new Response(
    JSON.stringify({
      error: "temporarily_unavailable",
      error_description: MENSAGEM_BLOQUEIO,
    }),
    { status: 429, headers },
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/register" && request.method === "POST") {
      const bloqueio = await limitarRegistro(request, env);
      if (bloqueio) return bloqueio;
    }

    const resource = `${url.origin}/mcp`;
    return obterProvider(resource, env).fetch(request, env, ctx);
  },

  /**
   * Cron diário: coleta de lixo do KV. Ver `limparKv`.
   *
   * O erro é logado e relançado de propósito. Engolir faria a limpeza falhar em
   * silêncio todo dia, e o jeito de descobrir seria o namespace cheio meses
   * depois; relançando, a invocação aparece como erro no painel da Cloudflare e
   * no `wrangler tail`.
   */
  async scheduled(evento: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await limparKv(env);
    } catch (erro) {
      // Só a mensagem: o objeto de erro pode carregar trecho de chave do KV.
      const motivo = erro instanceof Error ? erro.message : "desconhecido";
      console.error(`[cron] limpeza do KV falhou (${evento.cron}): ${motivo}`);
      throw erro;
    }
  },
} satisfies ExportedHandler<Env>;

function criarProvider(resource: string, envDaConstrucao: Env): OAuthProvider<Env> {
  return new OAuthProvider<Env>(opcoesDoProvider(resource, envDaConstrucao));
}

/**
 * As opções do provider, separadas da construção.
 *
 * Duas coisas precisam delas sem ser uma requisição HTTP: o
 * `tokenExchangeCallback`, que chama `getOAuthApi()` para revogar grant, e a
 * tarefa agendada de limpeza do KV, que não tem requisição nenhuma.
 */
function opcoesDoProvider(resource: string, envDaConstrucao: Env): OAuthProviderOptions<Env> {
  // Anotado e referenciado dentro do próprio literal: o tokenExchangeCallback
  // precisa das opções para obter os helpers com getOAuthApi(). A referência só
  // é lida quando a callback roda, bem depois da inicialização.
  const opcoes: OAuthProviderOptions<Env> = {
    apiRoute: "/mcp",
    apiHandler,
    defaultHandler: AuthHandler,

    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",

    // RFC 9728: o que sai em /.well-known/oauth-protected-resource.
    // `authorization_servers` fica de fora de propósito: na configuração
    // combinada ele já assume a origem do token endpoint, que é este Worker.
    resourceMetadata: {
      resource,
      resource_name: "CRM da agência (gestaomde)",
    },

    // Mesma fonte que a tela de consentimento e o approveConsent usam.
    scopesSupported: [...ESCOPOS_SUPORTADOS],
    accessTokenTTL: 3600,

    /**
     * Lista branca de redirect_uri no registro dinâmico. Sem ela, /register é
     * um convite ao phishing: qualquer um registra um cliente chamado "Claude"
     * apontando para o servidor dele. Ver src/auth/clientes.ts.
     *
     * `envDaConstrucao` é usado só para ler a flag de dev, que é imutável no
     * deploy — e obterProvider() inclui a flag na chave do memo, então um
     * provider nunca é reaproveitado com política diferente.
     */
    clientRegistrationCallback: politicaDeRegistro(envDaConstrucao),

    tokenExchangeCallback: (opts) => aoTrocarToken(opts, opcoes),
  };

  return opcoes;
}

/**
 * Chamado em toda emissão de token: na troca do code e em cada refresh.
 *
 * Faz DUAS coisas, e as duas são obrigatórias:
 *
 *   1. RENOVA A SESSÃO DO SUPABASE. O JWT do Supabase expira em ~1h, igual ao
 *      access token MCP. Sem isto, na primeira renovação o token MCP viria novo
 *      e o `sbAccess` continuaria o velho — e as ferramentas quebrariam com
 *      "JWT expired" sem explicação.
 *
 *   2. RECONFERE A ELEGIBILIDADE, com o JWT RENOVADO. É o único ponto em que o
 *      servidor volta a olhar quem a pessoa é depois do consentimento. Um grant
 *      dura semanas; conferir só no login significaria que desativar um membro
 *      no CRM não tira o acesso dele pelo MCP. Deixar de ser elegível encerra o
 *      grant, não só nega esta renovação.
 *
 * Dois cuidados que não são opcionais:
 *
 *   - Devolver o PAR NOVO de tokens. O Supabase faz rotação de refresh token
 *     com detecção de reuso: reaproveitar o refresh antigo não só falha, como
 *     revoga a família inteira de tokens daquela sessão.
 *
 *   - Só renovar no refresh_token. Na troca do authorization_code o `sbAccess`
 *     acabou de nascer no login — e a elegibilidade acabou de ser conferida no
 *     consentimento —, então renovar ali queimaria o refresh sem motivo.
 */
async function aoTrocarToken(
  opts: TokenExchangeCallbackOptions<Env>,
  opcoes: OAuthProviderOptions<Env>,
): Promise<TokenExchangeCallbackResult | void> {
  if (opts.grantType !== "refresh_token") return;

  const env = opts.env;
  const atuais = opts.props as PropsUsuario | undefined;

  if (!atuais?.sbRefresh) {
    // Grant sem refresh do Supabase não tem como ser renovado nunca mais: ou é
    // de uma versão anterior deste Worker, ou os props vieram corrompidos.
    throw await encerrarGrant(opts, opcoes, "grant sem refresh token do Supabase");
  }

  const renovada = await renovarSessao(env, atuais.sbRefresh);

  if ("erro" in renovada) {
    if (!renovada.terminal) {
      // Transitório: o grant FICA. `temporarily_unavailable` é o código que o
      // provider NÃO trata como motivo para revogar.
      console.warn("[oauth] falha transitoria ao renovar a sessao do Supabase");
      throw new OAuthError("temporarily_unavailable", {
        description: "Não foi possível falar com o CRM agora. Tente de novo em instantes.",
        statusCode: 503,
      });
    }
    // Sem a mensagem do Supabase no log: ela pode citar o token.
    throw await encerrarGrant(opts, opcoes, "refresh token do Supabase invalido");
  }

  // Reconferência com o JWT NOVO, e não com o antigo: é o JWT novo que as
  // ferramentas vão usar na próxima hora, então é ele que precisa valer.
  const elegivel = await verificarElegibilidade(env, renovada.sessao);

  if (!elegivel.ok) {
    if (elegivel.transitorio) {
      console.warn("[oauth] nao foi possivel verificar a elegibilidade agora");
      throw new OAuthError("temporarily_unavailable", {
        description: "Não foi possível verificar seu acesso ao CRM agora. Tente de novo.",
        statusCode: 503,
      });
    }
    throw await encerrarGrant(opts, opcoes, "usuario deixou de ser elegivel");
  }

  const novos: PropsUsuario = {
    ...atuais,
    email: renovada.sessao.email || atuais.email,
    // O cargo é relido junto: quem virou Supervisor no CRM não fica com o
    // cargo antigo congelado nos props até reconectar.
    cargo: elegivel.cargo,
    sbAccess: renovada.sessao.accessToken,
    sbRefresh: renovada.sessao.refreshToken,
  };

  // newProps grava no grant (vale para os refresh seguintes);
  // accessTokenProps grava neste access token. Os dois, senão o próximo
  // refresh volta a mandar o refresh velho.
  return { newProps: novos, accessTokenProps: novos };
}

/**
 * Encerra o grant e devolve o erro que o chamador deve lançar.
 *
 * Por que devolver em vez de lançar aqui dentro: `throw await encerrarGrant()`
 * no ponto de uso deixa o TypeScript ver que o fluxo acaba ali, sem `never`
 * fingido nem cast depois.
 *
 * revokeGrant apaga o grant e os access tokens dele no KV. O token que o
 * cliente já tem na mão pode sobreviver até o TTL vencer, se a revogação não o
 * alcançar — é por isso que as ferramentas também respondem "sua sessão
 * expirou" por conta própria (src/mcp/sessao.ts). As duas camadas são
 * necessárias: esta encerra a credencial, a outra cobre a janela.
 *
 * O `invalid_grant` que lançamos depois faria o provider revogar o grant por
 * conta dele também. Mantenho a chamada explícita porque encerrar o acesso é
 * decisão DESTA política de segurança, e não efeito colateral do código de erro
 * que escolhemos — e a revogação é idempotente, são deletes no KV.
 */
async function encerrarGrant(
  opts: TokenExchangeCallbackOptions<Env>,
  opcoes: OAuthProviderOptions<Env>,
  motivo: string,
): Promise<OAuthError> {
  console.warn(`[oauth] encerrando grant: ${motivo}`);

  try {
    const helpers: OAuthHelpers = getOAuthApi(opcoes, opts.env);
    await helpers.revokeGrant(opts.grantId, opts.userId);
  } catch {
    // Revogação falhou (limite de subrequest no KV, por exemplo). Não
    // engolimos o fluxo: o invalid_grant abaixo faz o provider tentar revogar
    // de novo, e purgeExpiredData() limpa o que sobrar.
    console.error("[oauth] revokeGrant falhou; o invalid_grant vai tentar de novo");
  }

  return new OAuthError("invalid_grant", {
    description:
      "Sua sessão com o CRM não é mais válida. Reconecte o CRM nas configurações de conectores do Claude.",
  });
}

/**
 * Coleta de lixo do KV, uma vez por dia.
 *
 * O QUE A BIBLIOTECA APAGA — e o que ela NÃO toca
 *
 *   Conferi em node_modules/@cloudflare/workers-oauth-provider. O sweep varre
 *   só os prefixos `grant:` e `token:`, e apaga exatamente dois casos:
 *
 *     grant  expirado (`now >= grantData.expiresAt`), ou órfão: o
 *            `client:<clientId>` dele não existe mais no KV.
 *     token  órfão: o `grant:<userId>:<grantId>` dele não existe mais.
 *
 *   Grant válido e não expirado, com client presente, NÃO é tocado. Token cujo
 *   grant existe NÃO é tocado. Ou seja: ninguém conectado é desconectado por
 *   esta rotina — o que ela remove já estava inutilizável.
 *
 *   `client:`, `transaction:`, `login_pendente:` e `rl:` nem são listados: os
 *   quatro têm TTL próprio e o KV os coleta sozinho.
 *
 * O CURSOR NÃO É OPCIONAL
 *
 *   Cada chamada examina no máximo `batchSize` registros POR FASE e devolve um
 *   cursor quando sobrou coisa. Sem guardar esse cursor, toda execução
 *   reexaminaria os mesmos primeiros registros para sempre e o resto do
 *   namespace nunca seria varrido — a rotina pareceria funcionar, com log
 *   bonito, sem limpar nada além do começo.
 *
 *   Por isso o cursor vai para o KV entre as execuções. A varredura é contínua:
 *   cada madrugada continua de onde a anterior parou, e recomeça ao terminar.
 */

/** Onde o cursor da varredura fica entre as execuções. */
const CHAVE_DO_CURSOR = "purge:cursor";

/**
 * Registros examinados por fase, por chamada.
 *
 * Conservador de propósito: cada registro examinado é pelo menos uma leitura de
 * KV, e leitura de KV conta no limite de subrequests da invocação — 50 no plano
 * gratuito do Workers, 1000 no pago. Com 20, o pior caso fica em torno de 40
 * leituras somando as duas fases, com folga para os deletes de quem for
 * removido.
 *
 * No plano pago dá para subir para 100 ou 200 e varrer o namespace inteiro em
 * poucos dias. Em namespace pequeno isso nem importa: `token:` já expira
 * sozinho por TTL, então o que sobra para varrer é pouco.
 */
const TAMANHO_DO_LOTE = 20;

/**
 * Qualquer string serve: o `resource` só aparece nos endpoints de metadata, e a
 * limpeza não passa por nenhum deles. Mas o construtor do provider exige um, e
 * na tarefa agendada não existe requisição de onde derivar a origem.
 */
const RECURSO_PARA_LIMPEZA = "https://cron.interno.invalid/mcp";

async function limparKv(env: Env): Promise<void> {
  const helpers = getOAuthApi(opcoesDoProvider(RECURSO_PARA_LIMPEZA, env), env);

  // Cursor inválido (formato mudou entre versões da lib) faria purgeExpiredData
  // lançar TypeError. Tratar como "começar do zero" é melhor do que a limpeza
  // morrer todo dia por causa de uma chave velha.
  const guardado = (await env.OAUTH_KV.get(CHAVE_DO_CURSOR)) ?? undefined;

  let resultado;
  try {
    resultado = await helpers.purgeExpiredData({
      batchSize: TAMANHO_DO_LOTE,
      cursor: guardado,
    });
  } catch (erro) {
    if (guardado && erro instanceof TypeError) {
      console.warn("[cron] cursor invalido; recomecando a varredura do zero");
      await env.OAUTH_KV.delete(CHAVE_DO_CURSOR);
      resultado = await helpers.purgeExpiredData({ batchSize: TAMANHO_DO_LOTE });
    } else {
      throw erro;
    }
  }

  if (resultado.done) {
    await env.OAUTH_KV.delete(CHAVE_DO_CURSOR);
  } else if (resultado.cursor) {
    // Sem TTL: o cursor tem que sobreviver até a execução de amanhã.
    await env.OAUTH_KV.put(CHAVE_DO_CURSOR, resultado.cursor);
  }

  // Só contagem. Nome de chave, id de grant, id de usuário e conteúdo ficam de
  // fora: isto vai para o log do Worker, que é mais fácil de ler do que de
  // proteger.
  console.log(
    `[cron] limpeza do KV: grants ${resultado.grantsPurged}/${resultado.grantsChecked}, ` +
      `tokens ${resultado.tokensPurged}/${resultado.tokensChecked}, ` +
      `varredura ${resultado.done ? "completa" : "continua amanha"}`,
  );
}
