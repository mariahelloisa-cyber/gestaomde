import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getEmailSettings, sendEmail, logEmail, msgDesignacao } from "@/lib/email.server";

export const Route = createFileRoute("/api/public/hooks/email-assignment")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const settings = await getEmailSettings();
        const provided = request.headers.get("x-webhook-secret") ?? "";
        if (!settings.webhookSecret || provided !== settings.webhookSecret) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: { tarefa_id?: string; usuario_id?: string };
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (!body.tarefa_id || !body.usuario_id) {
          return new Response("Missing fields", { status: 400 });
        }

        // Idempotência: se já enviamos designação para esse par, sai
        const { data: existente } = await supabaseAdmin
          .from("email_logs")
          .select("id")
          .eq("tarefa_id", body.tarefa_id)
          .eq("usuario_id", body.usuario_id)
          .eq("tipo", "designacao")
          .eq("status", "enviado")
          .limit(1)
          .maybeSingle();
        if (existente) {
          return Response.json({ ok: true, skipped: "duplicate" });
        }

        const [tarefaRes, perfilRes] = await Promise.all([
          supabaseAdmin
            .from("tarefas")
            .select("id, titulo, prioridade, data_vencimento, cliente_id, clientes(nome_empresa)")
            .eq("id", body.tarefa_id)
            .maybeSingle(),
          supabaseAdmin
            .from("perfis_usuarios")
            .select("id, nome, email")
            .eq("id", body.usuario_id)
            .maybeSingle(),
        ]);

        if (!tarefaRes.data) return Response.json({ ok: true, skipped: "no_task" });
        if (!perfilRes.data?.email) {
          return Response.json({ ok: true, skipped: "no_email" });
        }

        const t = tarefaRes.data as unknown as {
          id: string;
          titulo: string;
          prioridade: string;
          data_vencimento: string | null;
          clientes: { nome_empresa: string } | null;
        };
        const { assunto, html, text } = msgDesignacao({
          nome: perfilRes.data.nome ?? "",
          titulo: t.titulo,
          cliente: t.clientes?.nome_empresa ?? null,
          vencimento: t.data_vencimento,
          prioridade: t.prioridade ?? "Nenhuma",
        });

        const result = await sendEmail(perfilRes.data.email, assunto, html, text, settings);
        await logEmail({
          tarefa_id: t.id,
          usuario_id: perfilRes.data.id,
          destinatario: perfilRes.data.email,
          tipo: "designacao",
          assunto,
          mensagem: text,
          result,
        });

        return Response.json({ ok: result.ok, status: result.status });
      },
    },
  },
});