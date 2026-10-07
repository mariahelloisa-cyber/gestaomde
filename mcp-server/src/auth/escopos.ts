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
 * Conhecer não é conceder: um escopo só é concedido se também estiver em
 * ESCOPOS_SUPORTADOS. Pedir permissão que nada usa treina o usuário a aprovar
 * sem ler, e deixa um grant com poder que o código não exerce.
 */
export const ESCOPOS_CONHECIDOS = ["crm:read", "crm:write"] as const;

export type Escopo = (typeof ESCOPOS_CONHECIDOS)[number];

/**
 * Os escopos que o servidor ANUNCIA e CONCEDE hoje.
 *
 * É esta lista que vai em `scopesSupported` do provider, e é contra ela que o
 * `approveConsent` valida — ele LANÇA `invalid_scope` se receber escopo de
 * fora. `crm:write` entrou na etapa 4, junto com as ferramentas de escrita
 * (src/mcp/server.ts só as registra com ele).
 *
 * Grant antigo não ganha `crm:write` sozinho: o refresh do provider só deixa
 * REDUZIR os escopos do grant (`downscope`), nunca ampliar. Quem conectou com
 * só `crm:read` segue lendo e não vê ferramenta de escrita até reconectar.
 */
export const ESCOPOS_SUPORTADOS: readonly Escopo[] = ["crm:read", "crm:write"];

/**
 * O que um cliente recebe quando não pede nada.
 *
 * É o caso do MCP Inspector, que não manda `scope` nenhum. Sem um padrão, o
 * grant nascia com `[]`: o token valia, a tela de consentimento listava zero
 * permissões, e as ferramentas não eram registradas — sem erro nenhum para
 * explicar por quê. Decisão da etapa 4: leitura e escrita juntas por padrão.
 */
export const ESCOPOS_PADRAO: readonly Escopo[] = ESCOPOS_SUPORTADOS;

/** Texto em português para a tela de consentimento. */
export const TEXTO_ESCOPO: Record<Escopo, { titulo: string; detalhe: string }> = {
  "crm:read": {
    titulo: "Ler dados do CRM",
    detalhe:
      "Clientes, tarefas, projetos, pastas, comentários, e os seus murais e lembretes — o que você já vê no sistema.",
  },
  "crm:write": {
    titulo: "Criar e alterar tarefas, murais e lembretes no CRM",
    detalhe:
      "Criar e alterar tarefas, responsáveis, comentários, checklists, e os seus murais e lembretes. Designar alguém envia e-mail para essa pessoa. Nada é excluído (tirar um cartão do mural não apaga a tarefa), e nada que você mesmo não possa alterar no sistema.",
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
 *
 * `crm:write` sozinho vira `crm:read crm:write`: toda escrita começa lendo a
 * tarefa pelo RLS, então escrita sem leitura não existe. Fica explícito na
 * tela, em vez de ser um poder implícito que o consentimento não mostrou.
 */
export function escoposEfetivos(pedidos: readonly string[]): ResultadoEscopos {
  if (pedidos.length === 0) {
    return { ok: true, escopos: [...ESCOPOS_PADRAO] };
  }

  // Set para deduplicar: `scope=crm:read crm:read` é pedido válido, e
  // approveConsent também deduplica, mas a tela não deve listar duas vezes.
  let efetivos = [...new Set(pedidos.filter(ehSuportado))];

  if (efetivos.includes("crm:write") && !efetivos.includes("crm:read")) {
    efetivos = ["crm:read", ...efetivos];
  }

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
