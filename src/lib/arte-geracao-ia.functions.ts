import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { exigirEquipeInterna } from "./arte.server";
import {
  STATUS_GERA,
  configGeracao,
  estimarCustoGeracao,
  executarGeracaoIA,
  gastoGeracaoHoje,
  tamanhoDeGeracao,
} from "./arte-geracao-ia.server";

/* Geração de artes com IA (Fase 4B), disparada por membro interno na aba
 * Artes. Uma geração por clique, dentro da própria requisição (1 a 3 min):
 * o job nasce 'processando' com lease, e o índice "um job ativo por demanda"
 * da Fase 1 barra o segundo clique. O resultado vai para revisão interna —
 * nada chega ao solicitante antes da aprovação. */

const artSchema = z.object({ art_request_id: z.string().uuid() });

/** Dados para a confirmação antes de gerar: custo estimado e teto de hoje. */
export const resumoGeracaoIA = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => artSchema.parse(input))
  .handler(async ({ data, context }) => {
    await exigirEquipeInterna(context.userId);
    const { data: art, error } = await context.supabase
      .from("art_requests")
      .select("id, largura_px, altura_px, max_geracoes")
      .eq("id", data.art_request_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!art) throw new Error("Demanda de arte não encontrada.");

    const cfg = configGeracao();
    const gerado = tamanhoDeGeracao(art.largura_px, art.altura_px);
    const [estimativa, gastoHoje, usadas] = await Promise.all([
      estimarCustoGeracao(gerado.largura * gerado.altura),
      gastoGeracaoHoje(),
      supabaseAdmin
        .from("ai_generation_jobs")
        .select("id", { count: "exact", head: true })
        .eq("art_request_id", art.id)
        .eq("origem", "ia")
        .not("status", "in", "(falhou,cancelado)")
        .then((r) => r.count ?? 0),
    ]);
    return {
      configurado: cfg.configurado,
      modelo: cfg.modelo,
      limiteDiarioUsd: cfg.limiteDiarioUsd,
      gastoHojeUsd: gastoHoje,
      estimativaUsd: estimativa,
      tamanhoGerado: { largura: gerado.largura, altura: gerado.altura },
      geracoesUsadas: usadas,
      geracoesMax: art.max_geracoes,
    };
  });

export const gerarArteComIA = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => artSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);

    const r = await executarGeracaoIA(data.art_request_id, userId);

    // Versão anterior ainda sem decisão deixa de valer: só a nova vai para
    // revisão (mesma regra do envio manual).
    await supabaseAdmin
      .from("ai_generations")
      .update({ status: "descartada" })
      .eq("art_request_id", r.art_request_id)
      .eq("status", "gerada")
      .neq("job_id", r.job_id);

    // Com o JWT do membro: o trigger registra quem mandou para revisão.
    const { error } = await supabase
      .from("art_requests")
      .update({ status: "aguardando_revisao" })
      .eq("id", r.art_request_id)
      .in("status", STATUS_GERA);
    if (error) throw new Error(error.message);

    return {
      jobId: r.job_id,
      status: "aguardando_revisao" as const,
      variacoesGeradas: r.imagens,
      custoRealUsd: Number(r.custoUsd.toFixed(4)),
    };
  });
