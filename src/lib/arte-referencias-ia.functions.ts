import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { exigirEquipeInterna } from "./arte.server";
import {
  configAnalise,
  executarAnaliseReferencia,
  gastoAnaliseHoje,
} from "./arte-referencias-ia.server";
import {
  ANALISE_CUSTO_ESTIMADO_USD,
  ESFORCOS_ANALISE,
  ESFORCO_PADRAO,
} from "./arte/analise-referencias";

/* Enriquecimento das referências globais com IA (Fase 4A).
 *
 * A tela chama analisarReferencia uma referência por vez (lote no navegador,
 * com progresso e botão de parar), então nenhuma requisição fica longa e o
 * lote pode ser retomado: referência já analisada na versão atual é pulada.
 * A execução (teto, trava, chamada e gravação via service role) fica em
 * executarAnaliseReferencia, no .server. */

export const resumoAnaliseReferencias = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirEquipeInterna(context.userId);
    const cfg = configAnalise();
    const gasto = await gastoAnaliseHoje();
    return {
      configurado: cfg.configurado,
      modelo: cfg.modelo,
      limiteDiarioUsd: cfg.limiteDiarioUsd,
      gastoHojeUsd: gasto.total,
      /** Custo por análise de cada esforço: média real, ou estimativa. */
      custoUsd: {
        medio: gasto.media.medio ?? ANALISE_CUSTO_ESTIMADO_USD.medio,
        alto: gasto.media.alto ?? ANALISE_CUSTO_ESTIMADO_USD.alto,
      },
      custoReal: { medio: gasto.media.medio !== null, alto: gasto.media.alto !== null },
    };
  });

export const analisarReferencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        forcar: z.boolean().default(false),
        esforco: z.enum(ESFORCOS_ANALISE).default(ESFORCO_PADRAO),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigirEquipeInterna(context.userId);
    return executarAnaliseReferencia(data.id, { forcar: data.forcar, esforco: data.esforco });
  });
