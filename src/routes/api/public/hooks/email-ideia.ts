import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getEmailSettings, sendEmail, logEmail, msgNovaIdeia } from "@/lib/email.server";

export const Route = createFileRoute("/api/public/hooks/email-ideia")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const settings = await getEmailSettings();
        const provided = request.headers.get("x-webhook-secret") ?? "";
        if (!settings.webhookSecret || provided !== settings.webhookSecret) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: { ideia_id?: string };
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (!body.ideia_id) {
          return new Response("Missing fields", { status: 400 });
        }

        const { data: ideia } = await supabaseAdmin
          .from("ideias")
          .select("id, titulo, descricao, criado_por")
          .eq("id", body.ideia_id)
          .maybeSingle();
        if (!ideia) return Response.json({ ok: true, skipped: "no_idea" });

        const { data: autor } = await supabaseAdmin
          .from("perfis_usuarios")
          .select("nome")
          .eq("id", ideia.criado_por)
          .maybeSingle();

        const { data: admins } = await supabaseAdmin
          .from("perfis_usuarios")
          .select("id, nome, email")
          .eq("cargo", "Admin")
          .eq("status", "ativo");

        let enviados = 0;
        for (const admin of admins ?? []) {
          if (!admin.email) continue;
          const { assunto, html, text } = msgNovaIdeia({
            nomeAdmin: admin.nome ?? "",
            autor: autor?.nome ?? "Alguém",
            titulo: ideia.titulo,
            descricao: ideia.descricao,
          });
          const result = await sendEmail(admin.email, assunto, html, text, settings);
          await logEmail({
            tarefa_id: null,
            usuario_id: admin.id,
            destinatario: admin.email,
            tipo: "ideia",
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
