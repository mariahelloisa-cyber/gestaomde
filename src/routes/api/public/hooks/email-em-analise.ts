import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getEmailSettings, sendEmail, logEmail, msgEmAnalise } from "@/lib/email.server";

export const Route = createFileRoute("/api/public/hooks/email-em-analise")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const settings = await getEmailSettings();
        const provided = request.headers.get("x-webhook-secret") ?? "";
        if (!settings.webhookSecret || provided !== settings.webhookSecret) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: { tarefa_id?: string };
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (!body.tarefa_id) {
          return new Response("Missing fields", { status: 400 });
        }

        const { data: tarefa } = await supabaseAdmin
          .from("tarefas")
          .select("id, titulo, prioridade, data_vencimento, cliente_id, clientes(nome_empresa)")
          .eq("id", body.tarefa_id)
          .maybeSingle();
        if (!tarefa) return Response.json({ ok: true, skipped: "no_task" });

        const t = tarefa as unknown as {
          id: string;
          titulo: string;
          prioridade: string;
          data_vencimento: string | null;
          clientes: { nome_empresa: string } | null;
        };

        const { data: admins } = await supabaseAdmin
          .from("perfis_usuarios")
          .select("id, nome, email")
          .eq("cargo", "Admin")
          .eq("status", "ativo");

        let enviados = 0;
        for (const admin of admins ?? []) {
          if (!admin.email) continue;
          const { assunto, html, text } = msgEmAnalise({
            nome: admin.nome ?? "",
            titulo: t.titulo,
            cliente: t.clientes?.nome_empresa ?? null,
            vencimento: t.data_vencimento,
            prioridade: t.prioridade ?? "Nenhuma",
          });
          const result = await sendEmail(admin.email, assunto, html, text, settings);
          await logEmail({
            tarefa_id: t.id,
            usuario_id: admin.id,
            destinatario: admin.email,
            tipo: "em_analise",
            assunto,
            mensagem: text,
            result,
          });
          if (result.ok) enviados++;
        }

        return Response.json({ ok: true, enviados });
      },
    },
  },
});
