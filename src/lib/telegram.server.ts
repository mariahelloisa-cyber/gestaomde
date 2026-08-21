export type SendResult = { ok: boolean; status: number; response: string };

/** Envia mensagem de texto via Telegram Bot API (POST .../sendMessage). */
export async function sendTelegramMessage(chatId: number, text: string): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, status: 0, response: "TELEGRAM_BOT_TOKEN não configurado." };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, response: body.slice(0, 2000) };
  } catch (e) {
    return { ok: false, status: 0, response: e instanceof Error ? e.message : String(e) };
  }
}
