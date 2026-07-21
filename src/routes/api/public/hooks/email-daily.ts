import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getEmailSettings, sendEmail, logEmail, msgLembrete, msgExpirado } from "@/lib/email.server";

type TarefaRow = {
  id: string;
  titulo: string;
  data_vencimento: string | null;
  status: string;
  cliente_id: string | null;
  aviso_lembrete_enviado_em: string | null;
  aviso_expirado_enviado_em: string | null;
  clientes: { nome_empresa: string } | null;
  tarefa_responsaveis: { usuario_id: string }[];
};

async function processar(
  tipo: "lembrete" | "expirado",
  filtroQuery: () => Promise<{ data: TarefaRow[] | null; error: unknown }>,
  settings: Awaited<ReturnType<typeof getEmailSettings>>,
) {
  const { data, error } = await filtroQuery();
  if (error) throw new Error(String(error));
  const tarefas = data ?? [];

  let enviados = 0;
  let erros = 0;

  for (const t of tarefas) {
    const respIds = (t.tarefa_responsaveis ?? []).map((r) => r.usuario_id);
    if (respIds.length === 0) continue;

    const { data: perfis } = await supabaseAdmin
      .from("perfis_usuarios")
      .select("id, nome, email")
      .in("id", respIds);

    for (const p of perfis ?? []) {
      if (!p.email) continue;
      const built =
        tipo === "lembrete"
          ? msgLembrete({
              nome: p.nome ?? "",
              titulo: t.titulo,
              cliente: t.clientes?.nome_empresa ?? null,
              vencimento: t.data_vencimento,
            })
          : msgExpirado({
              nome: p.nome ?? "",
              titulo: t.titulo,
              cliente: t.clientes?.nome_empresa ?? null,
              vencimento: t.data_vencimento,
            });

      const result = await sendEmail(p.email, built.assunto, built.html, built.text, settings);
      await logEmail({
        tarefa_id: t.id,
        usuario_id: p.id,
        destinatario: p.email,
        tipo,
        assunto: built.assunto,
        mensagem: built.text,
        result,
      });
      if (result.ok) enviados++;
      else erros++;
    }

    const patch =
      tipo === "lembrete"
        ? { aviso_lembrete_enviado_em: new Date().toISOString() }
        : { aviso_expirado_enviado_em: new Date().toISOString() };
    await supabaseAdmin.from("tarefas").update(patch).eq("id", t.id);
  }

  return { processadas: tarefas.length, enviados, erros };
}

export const Route = createFileRoute("/api/public/hooks/email-daily")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const settings = await getEmailSettings();
        const provided = request.headers.get("x-webhook-secret") ?? "";
        if (!settings.webhookSecret || provided !== settings.webhookSecret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const nowIso = new Date().toISOString();
        const in24hIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const lembretes = await processar(
          "lembrete",
          async () =>
            supabaseAdmin
              .from("tarefas")
              .select(
                "id, titulo, data_vencimento, status, cliente_id, aviso_lembrete_enviado_em, aviso_expirado_enviado_em, clientes(nome_empresa), tarefa_responsaveis(usuario_id)",
              )
              .neq("status", "Concluído")
              .not("data_vencimento", "is", null)
              .gte("data_vencimento", nowIso)
              .lte("data_vencimento", in24hIso)
              .is("aviso_lembrete_enviado_em", null) as unknown as Promise<{
              data: TarefaRow[] | null;
              error: unknown;
            }>,
          settings,
        );

        const expirados = await processar(
          "expirado",
          async () =>
            supabaseAdmin
              .from("tarefas")
              .select(
                "id, titulo, data_vencimento, status, cliente_id, aviso_lembrete_enviado_em, aviso_expirado_enviado_em, clientes(nome_empresa), tarefa_responsaveis(usuario_id)",
              )
              .neq("status", "Concluído")
              .not("data_vencimento", "is", null)
              .lt("data_vencimento", nowIso)
              .is("aviso_expirado_enviado_em", null) as unknown as Promise<{
              data: TarefaRow[] | null;
              error: unknown;
            }>,
          settings,
        );

        return Response.json({ ok: true, lembretes, expirados });
      },
    },
  },
});