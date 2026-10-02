import { supabaseAdmin } from "@/integrations/supabase/client.server";

/* Quem foi inativado não recebe mais tarefa. O que já era dele continua dele
 * (histórico e tarefas em andamento não mudam) — a trava vale só para novas
 * atribuições, aqui no servidor, para não depender das telas filtrarem a
 * lista. Leitura via supabaseAdmin: é só o status do perfil, e a checagem
 * precisa valer igual para qualquer cargo. */
export async function garantirResponsaveisAtivos(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { data, error } = await supabaseAdmin
    .from("perfis_usuarios")
    .select("id, nome, status")
    .in("id", ids);
  if (error) throw new Error(error.message);

  const encontrados = new Set((data ?? []).map((p) => p.id));
  const sumiram = ids.filter((id) => !encontrados.has(id));
  if (sumiram.length > 0) throw new Error("Responsável não encontrado.");

  const inativos = (data ?? []).filter((p) => (p.status ?? "ativo") === "inativo");
  if (inativos.length > 0) {
    const nomes = inativos.map((p) => p.nome).join(", ");
    throw new Error(
      inativos.length === 1
        ? `${nomes} está inativo e não pode receber tarefas.`
        : `${nomes} estão inativos e não podem receber tarefas.`,
    );
  }
}
