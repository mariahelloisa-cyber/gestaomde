/**
 * Os escopos deste servidor, num só lugar.
 *
 * Antes, a lista vivia em três: `scopesSupported` no index.ts, o dicionário de
 * textos no pages.ts e o que o handler passava para o approveConsent. Três
 * cópias de uma lista é uma divergência esperando acontecer — e a divergência
 * aqui tem consequência: `approveConsent` LANÇA `invalid_scope` se receber um
 * escopo que não esteja em `scopesSupported`.
 */

/**
 * TODOS os escopos que este servidor conhece.
 *
 * Conhecer não é conceder: `crm:write` existe aqui, com texto pronto, para a
 * etapa 4 — mas não entra em ESCOPOS_SUPORTADOS enquanto não houver ferramenta
 * de escrita. Pedir permissão que nada usa treina o usuário a aprovar sem ler,
 * e deixa um grant com poder que o código não exerce.
 */
export const ESCOPOS_CONHECIDOS = ["crm:read", "crm:write"] as const;

export type Escopo = (typeof ESCOPOS_CONHECIDOS)[number];

/**
 * Os escopos que o servidor ANUNCIA e CONCEDE hoje.
 *
 * É esta lista que vai em `scopesSupported` do provider, e é contra ela que o
 * `approveConsent` valida — ele LANÇA `invalid_scope` se receber escopo de
 * fora. Então acrescentar `crm:write` aqui é o gatilho da etapa 4, e tem que
 * acontecer junto com o registro das ferramentas de escrita, não antes.
 */
export const ESCOPOS_SUPORTADOS: readonly Escopo[] = ["crm:read"];

/**
 * O que um cliente recebe quando não pede nada.
 *
 * É o caso do MCP Inspector, que não manda `scope` nenhum. Sem um padrão, o
 * grant nascia com `[]`: o token valia, a tela de consentimento listava zero
 * permissões, e as ferramentas não eram registradas — sem erro nenhum para
 * explicar por quê.
 */
export const ESCOPOS_PADRAO: readonly Escopo[] = ESCOPOS_SUPORTADOS;

/** Texto em português para a tela de consentimento. */
export const TEXTO_ESCOPO: Record<Escopo, { titulo: string; detalhe: string }> = {
  "crm:read": {
    titulo: "Ler dados do CRM",
    detalhe: "Clientes, tarefas, projetos, pastas e comentários que você já vê no sistema.",
  },
  "crm:write": {
    titulo: "Criar e alterar dados do CRM",
    detalhe: "Tarefas, comentários e clientes. Nada que você mesmo não possa alterar.",
  },
};

function ehSuportado(escopo: string): escopo is Escopo {
  return (ESCOPOS_SUPORTADOS as readonly string[]).includes(escopo);
}

export type ResultadoEscopos =
  | { ok: true; escopos: Escopo[] }
  | { ok: false; titulo: string; detalhe: string };

/**
 * Os escopos que este pedido vai receber de fato.
 *
 *   sem scope          -> ESCOPOS_PADRAO
 *   com scope          -> só os que este servidor suporta, na ordem pedida
 *   com scope, nenhum
 *   deles suportado    -> erro
 *
 * O último caso falha em vez de cair no padrão: o cliente pediu algo
 * específico, e conceder outra coisa no lugar seria conceder o que ninguém
 * pediu. `parseAuthRequest` não filtra por `scopesSupported` — ele só valida a
 * gramática do token —, então escopo desconhecido chega aqui de verdade.
 */
export function escoposEfetivos(pedidos: readonly string[]): ResultadoEscopos {
  if (pedidos.length === 0) {
    return { ok: true, escopos: [...ESCOPOS_PADRAO] };
  }

  // Set para deduplicar: `scope=crm:read crm:read` é pedido válido, e
  // approveConsent também deduplica, mas a tela não deve listar duas vezes.
  const efetivos = [...new Set(pedidos.filter(ehSuportado))];

  if (efetivos.length === 0) {
    return {
      ok: false,
      titulo: "Permissões não reconhecidas",
      detalhe:
        "O aplicativo pediu permissões que este servidor não oferece. Tente conectar de novo a partir dele.",
    };
  }

  return { ok: true, escopos: efetivos };
}
