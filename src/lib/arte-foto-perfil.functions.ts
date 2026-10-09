import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { exigirEquipeInterna } from "./arte.server";
import { STATUS_COMPOE, executarComposicaoFotoPerfil } from "./arte-foto-perfil.server";

/* Foto de perfil: composição no modelo do nível do cargo, disparada por
 * membro interno na aba Artes. Sem IA e sem custo; 1 versão por clique
 * ("Gerar novamente" monta outra). Vai para revisão interna como qualquer
 * arte — nada chega ao solicitante antes da aprovação. */

export const gerarFotoPerfil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ art_request_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);

    const r = await executarComposicaoFotoPerfil(data.art_request_id, userId);

    // Versão anterior ainda sem decisão deixa de valer: só a nova vai para
    // revisão (mesma regra do envio manual e da IA).
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
      .in("status", STATUS_COMPOE);
    if (error) throw new Error(error.message);

    return { jobId: r.job_id, status: "aguardando_revisao" as const };
  });
