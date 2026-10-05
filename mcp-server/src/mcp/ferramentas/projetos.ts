import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { citar, estaAtrasada, linhaDePagina, rodapeDeDados, texto } from "../formato";
import { consultar } from "../sessao";
import { ANOTACOES_LEITURA, camposDePaginacao, escaparLike, faixa, ok } from "./comuns";

/**
 * `projetos` é uma tabela magra: id, nome, criado_em, criado_por. Não há
 * status, cliente nem data de entrega.
 *
 * Por isso não existe `ver_projeto`: ele não teria o que mostrar além das
 * tarefas, que `listar_tarefas(projeto: ...)` já dá com todos os filtros. O que
 * falta a ela — "quantas tarefas tem cada projeto" — é o que esta ferramenta
 * entrega.
 */

const DESC =
  "Lista os projetos do CRM com a contagem de tarefas de cada um: total, quantas " +
  "atrasadas e quantas em cada status. Use para 'quais projetos temos', 'como está o " +
  "projeto X' ou para achar o id de um projeto. Para ver as tarefas de um projeto, " +
  "use listar_tarefas com o filtro de projeto.";

/** Teto de tarefas varridas para contar por projeto. */
const TETO = 2000;

export function registrarProjetos(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    "listar_projetos",
    {
      title: "Listar projetos",
      description: DESC,
      inputSchema: z.object({
        busca: z.string().describe("Texto procurado no nome do projeto.").optional(),
        ...camposDePaginacao(),
      }),
      outputSchema: z.object({
        projetos: z.array(
          z.object({
            id: z.string(),
            nome: z.string(),
            criado_em: z.string().optional(),
            tarefas_total: z.number().int(),
            tarefas_atrasadas: z.number().int(),
            por_status: z.array(z.object({ status: z.string(), quantidade: z.number().int() })),
          }),
        ),
        total: z.number().int(),
        offset: z.number().int(),
        tem_mais: z.boolean(),
        contagem_truncada: z.boolean(),
      }),
      annotations: { title: "Listar projetos", ...ANOTACOES_LEITURA },
    },
    async (entrada) => listarProjetos(supabase, entrada),
  );
}

async function listarProjetos(
  supabase: SupabaseClient,
  entrada: { busca?: string; limite: number; offset: number },
) {
  const { limite, offset } = entrada;
  let query = supabase.from("projetos").select("id, nome, criado_em", { count: "exact" });
  if (entrada.busca) query = query.ilike("nome", `%${escaparLike(entrada.busca)}%`);

  const r = await consultar(() =>
    query.order("criado_em", { ascending: false }).range(...faixa(offset, limite)),
  );
  if (!r.ok) return r.resposta;

  const projetos = (r.dados ?? []) as unknown as Array<{
    id: string;
    nome: string;
    criado_em: string | null;
  }>;
  const total = r.total ?? projetos.length;

  if (projetos.length === 0) {
    return ok("Nenhum projeto encontrado.", {
      projetos: [],
      total,
      offset,
      tem_mais: false,
      contagem_truncada: false,
    });
  }

  // Uma consulta para as tarefas de TODOS os projetos da página, e a contagem
  // sai daqui. O app faz igual na página de Projetos: só tarefa, sem lembrete.
  const tarefasRes = await consultar(() =>
    supabase
      .from("tarefas")
      .select("projeto_id, status, data_vencimento")
      .in(
        "projeto_id",
        projetos.map((p) => p.id),
      )
      .eq("tipo", "tarefa")
      .limit(TETO),
  );
  if (!tarefasRes.ok) return tarefasRes.resposta;

  const tarefas = (tarefasRes.dados ?? []) as unknown as Array<{
    projeto_id: string | null;
    status: string;
    data_vencimento: string | null;
  }>;
  const truncada = tarefas.length >= TETO;
  const agora = new Date();

  const porProjeto = new Map<
    string,
    { total: number; atrasadas: number; status: Map<string, number> }
  >();
  for (const p of projetos) {
    porProjeto.set(p.id, { total: 0, atrasadas: 0, status: new Map() });
  }
  for (const t of tarefas) {
    if (!t.projeto_id) continue;
    const acc = porProjeto.get(t.projeto_id);
    if (!acc) continue;
    acc.total += 1;
    if (estaAtrasada(t.status, t.data_vencimento, agora)) acc.atrasadas += 1;
    acc.status.set(t.status, (acc.status.get(t.status) ?? 0) + 1);
  }

  const saida = projetos.map((p) => {
    const acc = porProjeto.get(p.id)!;
    return {
      id: p.id,
      nome: p.nome,
      criado_em: texto(p.criado_em),
      tarefas_total: acc.total,
      tarefas_atrasadas: acc.atrasadas,
      por_status: [...acc.status.entries()]
        .map(([status, quantidade]) => ({ status, quantidade }))
        .sort((a, b) => b.quantidade - a.quantidade),
    };
  });

  const linhas = saida.map((p) => {
    const status =
      p.por_status.length > 0
        ? p.por_status.map((s) => `${s.status}: ${s.quantidade}`).join(", ")
        : "nenhuma tarefa";
    return (
      `- Projeto: ${citar(p.nome, 120)}\n  id: ${p.id}\n` +
      `  Tarefas: ${p.tarefas_total} · Atrasadas: ${p.tarefas_atrasadas} · ${status}`
    );
  });

  const relato = [
    "Projetos:",
    "",
    linhas.join("\n"),
    "",
    linhaDePagina(projetos.length, total, offset),
    truncada ? `Atenção: a contagem olhou as primeiras ${TETO} tarefas; há mais.` : "",
    rodapeDeDados(),
  ].join("\n");

  return ok(relato, {
    projetos: saida,
    total,
    offset,
    tem_mais: offset + projetos.length < total,
    contagem_truncada: truncada,
  });
}
