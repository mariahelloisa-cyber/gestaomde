// Server-only: usa a service role key. O sufixo .server.ts mantém este arquivo
// fora do bundle do cliente (ver src/lib/config.server.ts).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface LinkAniversariante {
  aniversarianteId: string;
  expira_em: string | null;
  linkId: string;
  acessos: number;
}

/**
 * Resolve o token opaco de um link de aniversariante em public.compartilhamentos.
 * Devolve null para token inexistente, de outro tipo, revogado ou expirado —
 * mesmas regras do link de tarefa, sem distinguir o motivo para quem recebeu.
 */
export async function resolverLinkAniversariante(
  token: string,
): Promise<LinkAniversariante | null> {
  const { data: link } = await supabaseAdmin
    .from("compartilhamentos")
    .select("id, tipo, aniversariante_id, expira_em, revogado_em, acessos")
    .eq("token", token)
    .maybeSingle();

  if (!link || link.tipo !== "aniversariante" || !link.aniversariante_id) return null;
  if (link.revogado_em) return null;
  if (link.expira_em && new Date(link.expira_em).getTime() <= Date.now()) return null;

  return {
    aniversarianteId: link.aniversariante_id,
    expira_em: link.expira_em,
    linkId: link.id,
    acessos: link.acessos ?? 0,
  };
}
