import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type EmailSettings = {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  webhookSecret: string;
};

export async function getEmailSettings(): Promise<EmailSettings> {
  const { data, error } = await supabaseAdmin
    .from("configuracoes_sistema")
    .select("chave, valor")
    .in("chave", [
      "resend_api_key",
      "email_from_address",
      "email_from_name",
      "email_webhook_secret",
    ]);

  if (error) throw new Error(error.message);

  const map = new Map((data ?? []).map((r) => [r.chave, r.valor ?? ""]));
  return {
    apiKey: map.get("resend_api_key") ?? "",
    fromEmail: map.get("email_from_address") ?? "",
    fromName: map.get("email_from_name") ?? "Painel",
    webhookSecret: map.get("email_webhook_secret") ?? "",
  };
}

export type SendResult = { ok: boolean; status: number; response: string };

/** Envia e-mail via Resend (POST https://api.resend.com/emails). */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  settings?: EmailSettings,
): Promise<SendResult> {
  const cfg = settings ?? (await getEmailSettings());
  if (!cfg.apiKey || !cfg.fromEmail) {
    return { ok: false, status: 0, response: "API Key ou E-mail remetente não configurados." };
  }
  if (!to || !to.includes("@")) {
    return { ok: false, status: 0, response: "Destinatário inválido." };
  }

  const from = cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, response: body.slice(0, 2000) };
  } catch (e) {
    return { ok: false, status: 0, response: e instanceof Error ? e.message : String(e) };
  }
}

export async function logEmail(params: {
  tarefa_id: string | null;
  usuario_id: string | null;
  destinatario: string | null;
  tipo: "designacao" | "lembrete" | "expirado" | "teste";
  assunto: string;
  mensagem: string;
  result: SendResult;
}) {
  await supabaseAdmin.from("email_logs").insert({
    tarefa_id: params.tarefa_id,
    usuario_id: params.usuario_id,
    destinatario: params.destinatario,
    tipo: params.tipo,
    assunto: params.assunto,
    mensagem: params.mensagem,
    status: params.result.ok ? "enviado" : "erro",
    resposta: `${params.result.status} ${params.result.response}`.slice(0, 2000),
  });
}

function formatDataBR(iso: string | null): string {
  if (!iso) return "sem data";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapHtml(title: string, intro: string, items: Array<[string, string]>, footer: string): string {
  const rows = items
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;">${escapeHtml(k)}</td><td style="padding:4px 0;color:#111827;font-size:14px;"><strong>${escapeHtml(v)}</strong></td></tr>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <h1 style="margin:0 0 8px;font-size:20px;">${escapeHtml(title)}</h1>
    <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.5;">${escapeHtml(intro)}</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${rows}</table>
    <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.5;">${escapeHtml(footer)}</p>
  </div>
</body></html>`;
}

export type MsgInput = {
  nome: string;
  titulo: string;
  cliente: string | null;
  vencimento: string | null;
  prioridade?: string;
};

export function msgDesignacao(opts: MsgInput) {
  const assunto = `Nova tarefa designada: ${opts.titulo}`;
  const items: Array<[string, string]> = [
    ["Tarefa", opts.titulo],
    ["Prioridade", opts.prioridade ?? "Nenhuma"],
  ];
  if (opts.cliente) items.push(["Cliente", opts.cliente]);
  if (opts.vencimento) items.push(["Vencimento", formatDataBR(opts.vencimento)]);
  const html = wrapHtml(
    `Olá, ${opts.nome}!`,
    "Você foi designado(a) para a tarefa abaixo:",
    items,
    "Acesse o painel para mais detalhes.",
  );
  const text = [
    `Olá, ${opts.nome}!`,
    "",
    "Você foi designado(a) para a tarefa:",
    `- ${opts.titulo}`,
    opts.cliente ? `- Cliente: ${opts.cliente}` : null,
    `- Prioridade: ${opts.prioridade ?? "Nenhuma"}`,
    opts.vencimento ? `- Vencimento: ${formatDataBR(opts.vencimento)}` : null,
    "",
    "Acesse o painel para mais detalhes.",
  ]
    .filter(Boolean)
    .join("\n");
  return { assunto, html, text };
}

export function msgLembrete(opts: MsgInput) {
  const assunto = `Lembrete: a tarefa "${opts.titulo}" vence em menos de 24h`;
  const items: Array<[string, string]> = [["Tarefa", opts.titulo]];
  if (opts.cliente) items.push(["Cliente", opts.cliente]);
  if (opts.vencimento) items.push(["Vencimento", formatDataBR(opts.vencimento)]);
  const html = wrapHtml(
    `Olá, ${opts.nome}!`,
    "Lembrete: a tarefa abaixo vence em menos de 24h.",
    items,
    "Não esqueça de concluir antes do prazo.",
  );
  const text = [
    `Olá, ${opts.nome}!`,
    "",
    "Lembrete: a tarefa abaixo vence em menos de 24h:",
    `- ${opts.titulo}`,
    opts.cliente ? `- Cliente: ${opts.cliente}` : null,
    opts.vencimento ? `- Vencimento: ${formatDataBR(opts.vencimento)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { assunto, html, text };
}

export function msgExpirado(opts: MsgInput) {
  const assunto = `Tarefa expirada: ${opts.titulo}`;
  const items: Array<[string, string]> = [["Tarefa", opts.titulo]];
  if (opts.cliente) items.push(["Cliente", opts.cliente]);
  if (opts.vencimento) items.push(["Venceu em", formatDataBR(opts.vencimento)]);
  const html = wrapHtml(
    `Olá, ${opts.nome}!`,
    "A tarefa abaixo expirou e ainda está pendente.",
    items,
    "Por favor, atualize o status no painel.",
  );
  const text = [
    `Olá, ${opts.nome}!`,
    "",
    "A tarefa abaixo expirou e ainda está pendente:",
    `- ${opts.titulo}`,
    opts.cliente ? `- Cliente: ${opts.cliente}` : null,
    opts.vencimento ? `- Venceu em: ${formatDataBR(opts.vencimento)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { assunto, html, text };
}