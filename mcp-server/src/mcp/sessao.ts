import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * Como as ferramentas reagem quando a sessão do Supabase morre embaixo delas.
 *
 * POR QUE ISTO É NECESSÁRIO, SE O REFRESH JÁ DERRUBA O GRANT
 *
 *   O tokenExchangeCallback revoga o grant quando o refresh do Supabase falha.
 *   Mas revogar o grant não apaga instantaneamente o access token MCP que o
 *   cliente já tem na mão: ele vale até a revogação alcançá-lo ou até o TTL
 *   vencer (uma hora). Nessa janela existe um token MCP aceito pelo servidor
 *   carregando um JWT do Supabase que o Postgres já recusa.
 *
 *   Sem tratamento, a ferramenta devolveria "JWT expired" ou um erro vazio de
 *   RLS, e o modelo diria ao usuário algo como "não encontrei nenhuma tarefa" —
 *   que é pior do que um erro, porque é uma resposta errada com cara de certa.
 *
 *   Daí a mensagem única e acionável: ela diz o que aconteceu e o que fazer.
 */

/**
 * Códigos que `consultar` devolve no lugar do SQLSTATE quando não houve um.
 *
 * As ferramentas de escrita usam o código para separar "o banco recusou"
 * (42501, vai para a auditoria como negado) de "a sessão morreu" (nada
 * aconteceu, e nem dá para auditar, porque o JWT é o mesmo).
 */
export const CODIGO_SESSAO_MORTA = "sessao-morta";
export const CODIGO_SEM_RESPOSTA = "sem-resposta";

/** A única mensagem de sessão expirada. Toda ferramenta responde exatamente esta. */
export const MENSAGEM_SESSAO_EXPIRADA =
  "Sua sessão expirou. Reconecte o CRM nas configurações de conectores do Claude.";

/**
 * Códigos do PostgREST/GoTrue que significam "este JWT não serve mais".
 *
 * PGRST301 é o do PostgREST para JWT expirado ou inválido. Os outros vêm do
 * GoTrue quando a chamada passa pelo /auth. 42501 (insufficient_privilege) fica
 * FORA de propósito: ele é negativa de RLS, ou seja, a sessão está viva e a
 * pessoa realmente não pode ver aquilo — confundir os dois faria o usuário
 * reconectar o conector atrás de uma permissão que ele nunca teve.
 */
const CODIGOS_DE_SESSAO_MORTA = new Set([
  "PGRST301",
  "bad_jwt",
  "session_not_found",
  "session_expired",
]);

/** Trechos de mensagem, para o caso de o erro vir sem código. */
const TEXTOS_DE_SESSAO_MORTA = [
  "jwt expired",
  "jwt is expired",
  "invalid jwt",
  "token is expired",
  "invalid claim",
];

/**
 * O erro é "a sessão morreu" e não "você não tem permissão"?
 *
 * Aceita o formato de erro do supabase-js (PostgrestError e AuthError), que têm
 * `code`, `message` e às vezes `status`.
 */
export function ehSessaoMorta(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;

  const e = erro as { code?: unknown; message?: unknown; status?: unknown };

  if (typeof e.code === "string" && CODIGOS_DE_SESSAO_MORTA.has(e.code)) return true;
  if (e.status === 401) return true;

  if (typeof e.message === "string") {
    const msg = e.message.toLowerCase();
    return TEXTOS_DE_SESSAO_MORTA.some((t) => msg.includes(t));
  }

  return false;
}

/**
 * O que uma ferramenta MCP devolve.
 *
 * É o tipo do próprio SDK, e não um molde meu parecido: com um tipo paralelo, o
 * `registerTool` recusa a callback — e a mensagem que ele dá é sobre overload
 * de `ZodRawShape`, que não tem nada a ver com a causa.
 */
export type RespostaFerramenta = CallToolResult;

/** Resposta de erro padronizada para sessão expirada. */
export function respostaSessaoExpirada(): RespostaFerramenta {
  return {
    content: [{ type: "text", text: MENSAGEM_SESSAO_EXPIRADA }],
    isError: true,
  };
}

/**
 * Roda uma consulta do supabase-js e separa os três desfechos.
 *
 * As ferramentas chamam por aqui em vez de olhar `error` na mão, para que a
 * mensagem de sessão expirada seja a mesma em todas e nenhuma esqueça de
 * tratar o caso.
 *
 * `total` vem do header Content-Range quando a consulta pediu
 * `{ count: "exact" }`, e é o que sustenta a paginação. Vem `null` quando a
 * consulta não pediu contagem.
 *
 * ```ts
 * const r = await consultar(() =>
 *   criarClienteComJwt(env, props.sbAccess).from("tarefas").select("id, titulo"),
 * );
 * if (!r.ok) return r.resposta;      // sessão expirada OU falha real
 * return formatar(r.dados);
 * ```
 */
export async function consultar<T>(
  executar: () => PromiseLike<{ data: T | null; error: unknown; count?: number | null }>,
): Promise<
  | { ok: true; dados: T | null; total: number | null }
  | { ok: false; resposta: RespostaFerramenta; codigo?: string }
> {
  let resultado: { data: T | null; error: unknown; count?: number | null };
  try {
    resultado = await executar();
  } catch (erro) {
    // Exceção (rede, fetch abortado) também passa pelo mesmo crivo: o
    // supabase-js lança em vez de devolver `error` em alguns caminhos.
    if (ehSessaoMorta(erro)) {
      return { ok: false, resposta: respostaSessaoExpirada(), codigo: CODIGO_SESSAO_MORTA };
    }
    console.error("[mcp] consulta falhou");
    return {
      ok: false,
      codigo: CODIGO_SEM_RESPOSTA,
      resposta: {
        content: [
          { type: "text", text: "Não consegui falar com o CRM agora. Tente de novo em instantes." },
        ],
        isError: true,
      },
    };
  }

  if (resultado.error) {
    if (ehSessaoMorta(resultado.error)) {
      return { ok: false, resposta: respostaSessaoExpirada(), codigo: CODIGO_SESSAO_MORTA };
    }
    // Só o código, nunca o objeto: a mensagem do PostgREST pode citar valores
    // da linha, e isso iria para o log do Worker.
    const bruto = (resultado.error as { code?: unknown }).code;
    const codigo = typeof bruto === "string" ? bruto : "sem-codigo";
    console.error("[mcp] erro do supabase", codigo);
    return {
      ok: false,
      codigo,
      resposta: {
        content: [{ type: "text", text: "O CRM recusou a consulta. Avise um administrador." }],
        isError: true,
      },
    };
  }

  return { ok: true, dados: resultado.data, total: resultado.count ?? null };
}
