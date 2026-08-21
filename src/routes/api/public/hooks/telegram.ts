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
          // TODO: remover o "as any" depois de regenerar src/integrations/supabase/types.ts
          // (a tabela telegram_usuarios só entra no tipo Database após a migration ser
          // aplicada em produção e os types serem re-gerados).
          const { data: vinculo } = await (supabaseAdmin as any)
            .from("telegram_usuarios")
            .select("usuario_id")
            .eq("telegram_chat_id", chatId)
            .maybeSingle();

          if (!vinculo) {
            await sendTelegramMessage(chatId, "Seu chat do Telegram ainda não está vinculado a um usuário do sistema.");
            return Response.json({ ok: true, skipped: "not_linked" });
          }

          const resposta = await runTarefasAgent(text);
          await sendTelegramMessage(chatId, resposta);
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
