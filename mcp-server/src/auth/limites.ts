import type { Env } from "../env";

/**
 * Rate limiting por contador no KV.
 *
 * POR QUE KV E NÃO O BINDING DE RATE LIMITING DO WORKERS
 *
 *   O binding é um recurso da conta, não funciona em `wrangler dev` local e
 *   exigiria mais um passo de configuração antes de qualquer teste. O contador
 *   no KV roda igual em dev e em produção, e o KV já é dependência obrigatória
 *   aqui (o OAuthProvider não existe sem ele).
 *
 *   O preço: o KV é eventualmente consistente e não tem incremento atômico,
 *   então duas tentativas simultâneas podem ler o mesmo valor e gravar o mesmo
 *   +1. Na prática escapam poucas tentativas além do limite, o que é
 *   irrelevante para frear força bruta — o que importa é que 10 mil tentativas
 *   não passem, não que a décima primeira seja barrada com precisão. Se um dia
 *   for preciso contagem exata, o caminho é um Durable Object, não ajustar isto.
 *
 * JANELA FIXA, ANCORADA NA PRIMEIRA OCORRÊNCIA
 *
 *   O fim da janela é gravado DENTRO do valor, e o TTL de cada gravação é só o
 *   que falta até lá. Sem isso, reenviar `expirationTtl` a cada tentativa
 *   empurraria o fim da janela para frente e quem insiste ficaria preso para
 *   sempre — o oposto de um bloqueio temporário.
 */

export interface Limite {
  /** Quantas ocorrências a janela aceita antes de bloquear. */
  max: number;
  /** Tamanho da janela em segundos. */
  janelaSegundos: number;
}

/** Falhas de login por IP: pega o atacante que varre vários e-mails. */
export const LIMITE_LOGIN_IP: Limite = { max: 10, janelaSegundos: 600 };

/** Falhas de login por e-mail: pega o atacante distribuído em vários IPs. */
export const LIMITE_LOGIN_EMAIL: Limite = { max: 5, janelaSegundos: 900 };

/** Registros dinâmicos de cliente por IP. Conta TODAS as tentativas, não só as recusadas. */
export const LIMITE_REGISTER_IP: Limite = { max: 20, janelaSegundos: 3600 };

/**
 * Chamadas de ferramenta de escrita do MCP, por usuário. Conta TODAS, inclusive
 * as que caem na proteção de duplicata: o que isto freia é o modelo em loop,
 * e um loop que repete a mesma chamada é exatamente o caso da duplicata.
 */
export const LIMITE_ESCRITA_USUARIO: Limite = { max: 30, janelaSegundos: 600 };

/** Mínimo que o KV aceita em expirationTtl. */
const TTL_MINIMO_KV = 60;

/** IP do cliente. Em `wrangler dev` o header não vem; o fallback mantém o contador útil. */
export function ipDoCliente(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "sem-ip";
}

/** SHA-256 em hex. Usado para não gravar e-mail cru em chave de KV. */
export async function digerir(valor: string): Promise<string> {
  const bytes = new TextEncoder().encode(valor);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function chave(escopo: string, valor: string): Promise<string> {
  return `rl:${escopo}:${await digerir(valor.toLowerCase().trim())}`;
}

interface Contador {
  /** Ocorrências na janela. */
  n: number;
  /** Fim da janela, em segundos epoch. */
  fim: number;
}

const agora = () => Math.floor(Date.now() / 1000);

async function ler(env: Env, k: string): Promise<Contador | null> {
  const bruto = await env.OAUTH_KV.get(k);
  if (!bruto) return null;
  try {
    const dados = JSON.parse(bruto) as Partial<Contador>;
    if (typeof dados.n !== "number" || typeof dados.fim !== "number") return null;
    // Janela vencida que o KV ainda não coletou: vale como inexistente.
    if (dados.fim <= agora()) return null;
    return { n: dados.n, fim: dados.fim };
  } catch {
    return null;
  }
}

/** Já passou do limite? Só lê, não conta. */
export async function estaBloqueado(
  env: Env,
  escopo: string,
  valor: string,
  limite: Limite,
): Promise<boolean> {
  const contador = await ler(env, await chave(escopo, valor));
  return contador !== null && contador.n >= limite.max;
}

/** Conta uma ocorrência na janela. */
export async function contar(
  env: Env,
  escopo: string,
  valor: string,
  limite: Limite,
): Promise<void> {
  const k = await chave(escopo, valor);
  const atual = await ler(env, k);
  const fim = atual ? atual.fim : agora() + limite.janelaSegundos;
  const proximo: Contador = { n: (atual?.n ?? 0) + 1, fim };

  await env.OAUTH_KV.put(k, JSON.stringify(proximo), {
    expirationTtl: Math.max(TTL_MINIMO_KV, fim - agora()),
  });
}

/** Limpa o contador. Chamado depois de um login bem-sucedido. */
export async function limpar(env: Env, escopo: string, valor: string): Promise<void> {
  await env.OAUTH_KV.delete(await chave(escopo, valor));
}

/**
 * Mensagem única para qualquer bloqueio. Genérica de propósito: não diz qual
 * limite bateu, se o e-mail existe nem quanto falta, para não ajudar a
 * calibrar um ataque.
 */
export const MENSAGEM_BLOQUEIO = "Muitas tentativas, tente em alguns minutos.";
