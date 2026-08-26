import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getEmailSettings } from "@/lib/email.server";
import { sendTelegramMessage } from "@/lib/telegram.server";
import {
  AUDITORIA_DIAS_FIXOS,
  checkpointAnterior,
  hojeBrasil,
  mesmoDia,
  proximoCheckpoint,
} from "@/lib/organograma-auditoria";

type NoRow = {
  id: string;
  nome: string;
  parent_id: string | null;
  link: string | null;
  auditoria_marcada_em: string | null;
  auditoria_aviso_lembrete_em: string | null;
  auditoria_aviso_expirado_em: string | null;
};

async function chatIdsGestores(): Promise<number[]> {
  const { data, error } = await supabaseAdmin
    .from("telegram_usuarios")
    .select("telegram_chat_id, perfis_usuarios!inner(cargo)")
    .in("perfis_usuarios.cargo", ["Admin", "Supervisor"]);
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => d.telegram_chat_id);
}

async function avisarTodos(chatIds: number[], texto: string) {
  await Promise.all(chatIds.map((id) => sendTelegramMessage(id, texto)));
}

export const Route = createFileRoute("/api/public/hooks/organograma-auditoria")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const settings = await getEmailSettings();
        const provided = request.headers.get("x-webhook-secret") ?? "";
        if (!settings.webhookSecret || provided !== settings.webhookSecret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { data, error } = await supabaseAdmin
          .from("organograma_nos")
          .select(
            "id, nome, parent_id, link, auditoria_marcada_em, auditoria_aviso_lembrete_em, auditoria_aviso_expirado_em",
          )
          .not("link", "is", null);
        if (error) return Response.json({ ok: false, erro: error.message }, { status: 500 });

        const nos = (data ?? []) as NoRow[];
        if (nos.length === 0) return Response.json({ ok: true, lembretes: 0, expirados: 0 });

        const { data: todos } = await supabaseAdmin.from("organograma_nos").select("id, nome");
        const nomePorId = new Map((todos ?? []).map((n) => [n.id, n.nome]));

        const hoje = hojeBrasil();
        const anterior = checkpointAnterior(hoje);
        const proximo = proximoCheckpoint(hoje);
        const dataLembrete = new Date(proximo);
        dataLembrete.setDate(proximo.getDate() - 2);

        let chatIds: number[] | null = null;
        const getChatIds = async () => (chatIds ??= await chatIdsGestores());

        let lembretes = 0;
        let expirados = 0;

        for (const no of nos) {
          const empresa = no.parent_id ? (nomePorId.get(no.parent_id) ?? "—") : "—";
          const marcada = no.auditoria_marcada_em ? new Date(no.auditoria_marcada_em) : null;

          // Vencida: hoje é um dos checkpoints fixos e não foi marcada desde o checkpoint anterior.
          const eCheckpointHoje = AUDITORIA_DIAS_FIXOS.includes(hoje.getDate());
          const vencidaHoje = eCheckpointHoje && (!marcada || marcada.getTime() < anterior.getTime());
          const jaAvisouExpiradoHoje =
            !!no.auditoria_aviso_expirado_em && mesmoDia(new Date(no.auditoria_aviso_expirado_em), hoje);

          if (eCheckpointHoje && vencidaHoje && !jaAvisouExpiradoHoje) {
            const ids = await getChatIds();
            await avisarTodos(
              ids,
              `⚠️ Auditoria atrasada: "${no.nome}" de ${empresa} não foi marcada — o prazo do dia ${hoje.getDate()} venceu.`,
            );
            await supabaseAdmin
              .from("organograma_nos")
              .update({ auditoria_aviso_expirado_em: new Date().toISOString() })
              .eq("id", no.id);
            expirados++;
            continue;
          }

          // Lembrete: faltam 2 dias para o próximo checkpoint e ainda não foi marcada no período em vigor.
          const emDiaAgora = !!marcada && marcada.getTime() >= anterior.getTime();
          const jaAvisouLembreteHoje =
            !!no.auditoria_aviso_lembrete_em && mesmoDia(new Date(no.auditoria_aviso_lembrete_em), hoje);

          if (mesmoDia(hoje, dataLembrete) && !emDiaAgora && !jaAvisouLembreteHoje) {
            const ids = await getChatIds();
            await avisarTodos(
              ids,
              `⏰ Auditoria expirando: "${no.nome}" de ${empresa} ainda não foi marcada e o prazo vence dia ${proximo.getDate()} (em 2 dias).`,
            );
            await supabaseAdmin
              .from("organograma_nos")
              .update({ auditoria_aviso_lembrete_em: new Date().toISOString() })
              .eq("id", no.id);
            lembretes++;
          }
        }

        return Response.json({ ok: true, lembretes, expirados });
      },
    },
  },
});
