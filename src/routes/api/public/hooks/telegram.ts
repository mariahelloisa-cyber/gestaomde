import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendTelegramMessage } from "@/lib/telegram.server";
import { runTarefasAgent } from "@/lib/tarefas-agent.server";

export const Route = createFileRoute("/api/public/hooks/telegram")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
        if (!secret || provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        let update: { message?: { chat?: { id?: number }; text?: string } };
        try {
          update = await request.json();
        } catch {
          return Response.json({ ok: true, skipped: "invalid_json" });
        }

        const chatId = update.message?.chat?.id;
        const text = update.message?.text;
        if (!chatId || !text) {
          return Response.json({ ok: true, skipped: "no_text" });
        }

        try {
          const { data: vinculo } = await supabaseAdmin
            .from("telegram_usuarios")
            .select("usuario_id")
            .eq("telegram_chat_id", chatId)
            .maybeSingle();

          if (!vinculo) {
            await sendTelegramMessage(chatId, "Seu chat do Telegram ainda não está vinculado a um usuário do sistema.");
            return Response.json({ ok: true, skipped: "not_linked" });
          }

          // Contexto de conversa: últimas mensagens desse chat na última meia hora
          // (janela curta o bastante pra não misturar assuntos de horas atrás).
          const meiaHoraAtras = new Date(Date.now() - 30 * 60 * 1000).toISOString();
          const { data: anteriores } = await supabaseAdmin
            .from("telegram_conversas")
            .select("role, conteudo")
            .eq("telegram_chat_id", chatId)
            .gte("criado_em", meiaHoraAtras)
            .order("criado_em", { ascending: true })
            .limit(20);

          const historico = [
            ...(anteriores ?? []).map((m) => ({ role: m.role as "user" | "assistant", content: m.conteudo })),
            { role: "user" as const, content: text },
          ];

          const resposta = await runTarefasAgent(historico);
          await sendTelegramMessage(chatId, resposta);

          await supabaseAdmin.from("telegram_conversas").insert([
            { telegram_chat_id: chatId, role: "user", conteudo: text },
            { telegram_chat_id: chatId, role: "assistant", conteudo: resposta },
          ]);
        } catch (e) {
          console.error("[telegram webhook]", e);
          await sendTelegramMessage(chatId, "Ocorreu um erro interno ao processar sua mensagem. Tente de novo em instantes.").catch(() => {});
        }

        // Sempre 200 pro Telegram, mesmo em erro interno — evita retries duplicados.
        return Response.json({ ok: true });
      },
    },
  },
});
