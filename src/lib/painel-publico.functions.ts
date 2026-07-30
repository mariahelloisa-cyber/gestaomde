import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface PainelPublicoTarefa {
  id: string;
  titulo: string;
  descricao?: string;
  status: "Pendente" | "Em Progresso" | "Em Análise" | "Concluído";
  prioridade: "Alta" | "Média" | "Baixa" | "Nenhuma";
  complexidade: "Fácil" | "Média" | "Difícil";
  data_vencimento: string;
  concluido_em: string | null;
  projeto_id: string | null;
  cliente_id: string | null;
  responsaveis: { id: string; nome: string; iniciais: string; atribuido_em: string }[];
}

export interface PainelPublicoData {
  tarefas: PainelPublicoTarefa[];
  clientes: { id: string; nome_empresa: string; cor: string }[];
  membros: { id: string; nome: string; iniciais: string; cor: string }[];
  projetos: { id: string; nome: string }[];
}

const tokenSchema = z.object({ token: z.string().uuid() });

/** Sem autenticação — validado só pelo token opaco (ver system-settings.functions.ts:
 * gerarPainelPublicoLink/revogarPainelPublicoLink). Espelha a mesma tela de tarefas que o
 * Admin vê (Kanban por status), mas é puramente informativo: título, descrição, cliente e
 * responsáveis aparecem porque é o conteúdo real dos cards — nunca e-mail, contrato ou
 * dado financeiro. */
export const getPainelPublicoData = createServerFn({ method: "GET" })
  .inputValidator((input) => tokenSchema.parse(input))
  .handler(async ({ data }): Promise<PainelPublicoData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normalizeStatus, normalizeComplexidade, toDateOnly, colorFromId, initialsFromName } =
      await import("./data.functions");

    const { data: cfg } = await supabaseAdmin
      .from("configuracoes_sistema")
      .select("valor")
      .eq("chave", "painel_publico_token")
      .maybeSingle();
    if (!cfg?.valor || cfg.valor !== data.token) {
      throw new Error("Link inválido ou expirado.");
    }

    const [tarefasRes, respRes, clientesRes, perfisRes, projetosRes] = await Promise.all([
      supabaseAdmin
        .from("tarefas")
        .select(
          "id, titulo, descricao, status, prioridade, complexidade, data_vencimento, concluido_em, projeto_id, cliente_id",
        )
        .eq("tipo", "tarefa"),
      supabaseAdmin.from("tarefa_responsaveis").select("tarefa_id, usuario_id, criado_em"),
      supabaseAdmin.from("clientes").select("id, nome_empresa, status"),
      supabaseAdmin.from("perfis_usuarios").select("id, nome, cargo"),
      supabaseAdmin.from("projetos").select("id, nome").order("nome"),
    ]);
    if (tarefasRes.error) throw new Error(tarefasRes.error.message);
    if (respRes.error) throw new Error(respRes.error.message);
    if (clientesRes.error) throw new Error(clientesRes.error.message);
    if (perfisRes.error) throw new Error(perfisRes.error.message);
    if (projetosRes.error) throw new Error(projetosRes.error.message);

    const clientesAtivos = (clientesRes.data ?? []).filter(
      (c) => (c.status ?? "ativo") === "ativo",
    );
    const activeClientIds = new Set(clientesAtivos.map((c) => c.id));

    const profileById = new Map((perfisRes.data ?? []).map((p) => [p.id, p]));

    const respByTarefa = new Map<string, PainelPublicoTarefa["responsaveis"]>();
    for (const r of respRes.data ?? []) {
      const profile = profileById.get(r.usuario_id);
      if (!profile) continue;
      const arr = respByTarefa.get(r.tarefa_id) ?? [];
      arr.push({
        id: r.usuario_id,
        nome: profile.nome,
        iniciais: initialsFromName(profile.nome),
        atribuido_em: r.criado_em,
      });
      respByTarefa.set(r.tarefa_id, arr);
    }

    const membros = (perfisRes.data ?? [])
      .filter((p) => (p.cargo as string) !== "Cliente")
      .map((p) => ({
        id: p.id,
        nome: p.nome,
        iniciais: initialsFromName(p.nome),
        cor: colorFromId(p.id),
      }));

    const tarefas: PainelPublicoTarefa[] = (tarefasRes.data ?? [])
      .filter((t) => !t.cliente_id || activeClientIds.has(t.cliente_id))
      .map((t) => ({
        id: t.id,
        titulo: t.titulo,
        descricao: t.descricao ?? undefined,
        status: normalizeStatus(t.status),
        prioridade: t.prioridade,
        complexidade: normalizeComplexidade(t.complexidade),
        data_vencimento: toDateOnly(t.data_vencimento),
        concluido_em: t.concluido_em ?? null,
        projeto_id: t.projeto_id ?? null,
        cliente_id: t.cliente_id ?? null,
        responsaveis: respByTarefa.get(t.id) ?? [],
      }));

    return {
      tarefas,
      clientes: clientesAtivos.map((c) => ({
        id: c.id,
        nome_empresa: c.nome_empresa,
        cor: colorFromId(c.id),
      })),
      membros,
      projetos: (projetosRes.data ?? []).map((p) => ({ id: p.id, nome: p.nome })),
    };
  });
