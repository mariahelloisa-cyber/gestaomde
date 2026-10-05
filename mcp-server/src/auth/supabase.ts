import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";

/**
 * Cliente Supabase por requisição, sem estado nenhum.
 *
 * persistSession e autoRefreshToken desligados de propósito: num Worker não
 * existe "sessão do processo", e um cliente global guardaria a sessão de um
 * usuário e a entregaria para a requisição do próximo.
 */
export function criarClienteAnon(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Cliente que fala com o Postgres COMO o usuário, para o RLS valer. */
export function criarClienteComJwt(env: Env, accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export interface SessaoSupabase {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Login por e-mail e senha — o MESMO método que o CRM usa em
 * src/routes/login.tsx (`signInWithPassword`). O projeto não tem magic link,
 * OTP nem OAuth social em lugar nenhum, então não há outro caminho a espelhar.
 */
export async function entrarComSenha(
  env: Env,
  email: string,
  senha: string,
): Promise<{ sessao: SessaoSupabase } | { erro: string }> {
  const supabase = criarClienteAnon(env);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });

  if (error || !data.session || !data.user) {
    // Mensagem genérica de propósito: não revelar se o e-mail existe.
    return { erro: "E-mail ou senha inválidos." };
  }

  return {
    sessao: {
      userId: data.user.id,
      email: data.user.email ?? email,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    },
  };
}

/**
 * Códigos do GoTrue em que o refresh token está morto PARA SEMPRE: não há
 * tentativa futura que funcione.
 *
 * `refresh_token_already_used` entra aqui porque o Supabase faz rotação com
 * detecção de reuso: quando ele acusa reuso, a família de tokens daquela sessão
 * já foi revogada, e insistir não traz ela de volta.
 */
const CODIGOS_TERMINAIS = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  "user_not_found",
  "user_banned",
  "bad_jwt",
]);

export interface FalhaDeRenovacao {
  erro: string;
  /**
   * `true` = a sessão não volta; quem chamou deve encerrar o grant.
   * `false` = pode ter sido o Supabase fora do ar ou rede; o grant fica e o
   * cliente tenta de novo.
   *
   * A distinção não é preciosismo: tratar um 503 como terminal derrubaria a
   * conexão de toda a equipe de uma vez, e cada pessoa teria que reconectar o
   * conector à mão.
   */
  terminal: boolean;
}

/** Decide se a falha é definitiva. Fecha para o lado de NÃO destruir o grant. */
function ehTerminal(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const e = erro as { code?: unknown; status?: unknown };

  if (typeof e.code === "string" && CODIGOS_TERMINAIS.has(e.code)) return true;

  // Sem código: só o status decide. 4xx que não seja 429 é pedido ruim, e um
  // pedido de refresh "ruim" significa token inválido. 5xx e "sem status"
  // (rede, timeout) são transitórios.
  if (typeof e.status === "number") {
    return e.status >= 400 && e.status < 500 && e.status !== 429;
  }

  return false;
}

/**
 * Renova a sessão a partir do refresh token e devolve o par NOVO.
 *
 * O Supabase faz rotação de refresh token com detecção de reuso: reaproveitar
 * um refresh antigo não só falha, como revoga a família de tokens. Por isso o
 * chamador é obrigado a guardar os dois valores que voltam daqui.
 */
export async function renovarSessao(
  env: Env,
  refreshToken: string,
): Promise<{ sessao: SessaoSupabase } | FalhaDeRenovacao> {
  const supabase = criarClienteAnon(env);
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

  if (error || !data.session || !data.user) {
    return {
      erro: error?.message ?? "Falha ao renovar a sessão do Supabase.",
      // Resposta sem erro e sem sessão não deveria acontecer; se acontecer,
      // trato como transitório para não derrubar ninguém por um caso que não
      // entendo.
      terminal: error ? ehTerminal(error) : false,
    };
  }

  return {
    sessao: {
      userId: data.user.id,
      email: data.user.email ?? "",
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    },
  };
}

export type Elegibilidade =
  | { ok: true; cargo: string; nome: string }
  | {
      ok: false;
      motivo: string;
      /**
       * `true` = não deu para verificar (Supabase fora do ar, rede). Não é uma
       * negativa: quem usa isto para revogar grant tem que tratar como "tente
       * de novo depois", senão uma instabilidade de dois minutos desconecta
       * toda a equipe.
       *
       * `false` = resposta do banco, e a resposta foi não.
       */
      transitorio: boolean;
    };

/**
 * Decide se este usuário pode autorizar o conector.
 *
 * Duas checagens, as duas com o JWT do próprio usuário:
 *
 *   1. RPC public.eh_equipe_interna(uid) — true só para cargo Admin, Membro ou
 *      Supervisor. O cargo Cliente é excluído: o acesso dele ao sistema foi
 *      encerrado na migration 20261002200000. Note que NÃO serve usar
 *      tem_perfil() aqui, porque ela aceita o cargo Cliente.
 *
 *   2. perfis_usuarios.status <> 'inativo' — o mesmo portão que o app aplica em
 *      src/routes/_authenticated.tsx.
 *
 * Ler a própria linha funciona porque o usuário é equipe interna e as policies
 * de perfis_usuarios liberam equipe interna. Se a linha não vier, tratamos como
 * inelegível em vez de assumir qualquer coisa.
 */
export async function verificarElegibilidade(
  env: Env,
  sessao: SessaoSupabase,
): Promise<Elegibilidade> {
  const supabase = criarClienteComJwt(env, sessao.accessToken);

  const { data: interno, error: erroRpc } = await supabase.rpc("eh_equipe_interna", {
    _user_id: sessao.userId,
  });

  if (erroRpc) {
    // Erro na RPC é falha de infraestrutura, não negativa de acesso.
    return {
      ok: false,
      motivo: "Não foi possível verificar seu acesso. Tente novamente.",
      transitorio: true,
    };
  }
  if (interno !== true) {
    return {
      ok: false,
      motivo:
        "Esta conta não é da equipe interna da agência e não pode conectar o assistente ao CRM.",
      transitorio: false,
    };
  }

  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis_usuarios")
    .select("cargo, nome, status")
    .eq("id", sessao.userId)
    .maybeSingle();

  if (erroPerfil || !perfil) {
    // Erro de consulta é transitório; linha ausente NÃO é — o RLS respondeu, e
    // respondeu que esta conta não vê nem o próprio perfil.
    return {
      ok: false,
      motivo: "Não foi possível carregar seu perfil. Tente novamente.",
      transitorio: erroPerfil != null,
    };
  }
  if (perfil.status === "inativo") {
    return {
      ok: false,
      motivo: "Sua conta foi desativada. Fale com um administrador da agência.",
      transitorio: false,
    };
  }

  return { ok: true, cargo: String(perfil.cargo ?? ""), nome: String(perfil.nome ?? "") };
}
