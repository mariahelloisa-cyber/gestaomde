import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { citar, estaAtrasada, linhaDePagina, rodapeDeDados, rotulo, texto } from "../formato";
import { consultar } from "../sessao";
import {
  ANOTACOES_LEITURA,
  camposDePaginacao,
  ehUuid,
  erro,
  escaparLike,
  faixa,
  mapaDeNomes,
  ok,
} from "./comuns";

const PLANOS = ["Bronze", "Prata", "Ouro", "Diamond"] as const;
const STATUS_CLIENTE = ["ativo", "inativo"] as const;

const COLUNAS = "id, nome_empresa, plano, status, email, documento, endereco, contrato_url";

interface LinhaCliente {
  id: string;
  nome_empresa: string;
  plano: string | null;
  status: string | null;
  email: string | null;
  documento: string | null;
  endereco: string | null;
  contrato_url: string | null;
}

const clienteResumo = () =>
  z.object({
    id: z.string(),
    nome_empresa: z.string(),
    plano: z.string().optional(),
    status: z.string().optional(),
    email: z.string().optional(),
    documento: z.string().optional(),
    tem_contrato: z.boolean(),
  });

function paraResumo(c: LinhaCliente) {
  return {
    id: c.id,
    nome_empresa: c.nome_empresa,
    plano: texto(c.plano),
    status: texto(c.status),
    email: texto(c.email),
    documento: texto(c.documento),
    // Só a existência. O valor é um path do bucket privado 'contratos', e
    // transformar isso em signed URL seria distribuir o arquivo do contrato
    // dentro de uma conversa — outra coisa, com outro risco.
    tem_contrato: Boolean(c.contrato_url),
  };
}

const DESC_BUSCAR =
  "Busca empresas clientes do CRM por nome, e-mail ou documento (CNPJ/CPF). Use para " +
  "'quais clientes temos', 'acha o cliente X' ou para descobrir o id de um cliente " +
  "antes de usar ver_cliente ou de filtrar tarefas. Devolve sempre o id.";

export function registrarBuscarClientes(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    "buscar_clientes",
    {
      title: "Buscar clientes",
      description: DESC_BUSCAR,
      inputSchema: z.object({
        busca: z
          .string()
          .describe("Texto procurado no nome da empresa, no e-mail ou no documento.")
          .optional(),
        status: z.enum(STATUS_CLIENTE).describe("Filtra por situação do cliente.").optional(),
        plano: z.enum(PLANOS).describe("Filtra por plano contratado.").optional(),
        ...camposDePaginacao(),
      }),
      outputSchema: z.object({
        clientes: z.array(clienteResumo()),
        total: z.number().int(),
        offset: z.number().int(),
        tem_mais: z.boolean(),
      }),
      annotations: { title: "Buscar clientes", ...ANOTACOES_LEITURA },
    },
    async (entrada) => buscarClientes(supabase, entrada),
  );
}

async function buscarClientes(
  supabase: SupabaseClient,
  entrada: {
    busca?: string;
    status?: (typeof STATUS_CLIENTE)[number];
    plano?: (typeof PLANOS)[number];
    limite: number;
    offset: number;
  },
) {
  const { limite, offset } = entrada;
  let query = supabase.from("clientes").select(COLUNAS, { count: "exact" });

  if (entrada.status) query = query.eq("status", entrada.status);
  if (entrada.plano) query = query.eq("plano", entrada.plano);

  if (entrada.busca) {
    const t = escaparLike(entrada.busca);
    // `or` do PostgREST: o texto procurado vale para os três campos de uma vez.
    query = query.or(`nome_empresa.ilike.%${t}%,email.ilike.%${t}%,documento.ilike.%${t}%`);
  }

  const r = await consultar(() =>
    query.order("nome_empresa", { ascending: true }).range(...faixa(offset, limite)),
  );
  if (!r.ok) return r.resposta;

  const clientes = (r.dados ?? []) as unknown as LinhaCliente[];
  const total = r.total ?? clientes.length;

  if (clientes.length === 0) {
    return ok("Nenhum cliente encontrado com esses filtros.", {
      clientes: [],
      total,
      offset,
      tem_mais: false,
    });
  }

  const linhas = clientes.map((c) => {
    const partes = [
      `Plano: ${rotulo(c.plano, 40)}`,
      `Situação: ${rotulo(c.status, 40, "não informada")}`,
      `E-mail: ${rotulo(c.email, 80)}`,
      `Documento: ${rotulo(c.documento, 40)}`,
      `Contrato em arquivo: ${c.contrato_url ? "sim" : "não"}`,
    ];
    return `- Empresa: ${citar(c.nome_empresa, 120)}\n  id: ${c.id}\n  ${partes.join(" · ")}`;
  });

  const relato = [
    "Clientes encontrados:",
    "",
    linhas.join("\n"),
    "",
    linhaDePagina(clientes.length, total, offset),
    rodapeDeDados(),
  ].join("\n");

  return ok(relato, {
    clientes: clientes.map(paraResumo),
    total,
    offset,
    tem_mais: offset + clientes.length < total,
  });
}

const DESC_VER_CLIENTE =
  "Mostra um cliente com o resumo do trabalho ligado a ele: dados cadastrais, quantas " +
  "tarefas em cada status, quantas estão atrasadas e em quais projetos ele aparece. " +
  "Use quando o usuário quiser a situação de UM cliente. Aceita o nome da empresa " +
  "(mesmo parcial) ou o id; nome ambíguo devolve erro pedindo para escolher.";

/** Teto de tarefas varridas para montar as contagens do cliente. */
const TETO_TAREFAS_CLIENTE = 1000;

export function registrarVerCliente(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    "ver_cliente",
    {
      title: "Ver cliente",
      description: DESC_VER_CLIENTE,
      inputSchema: z.object({
        cliente: z.string().describe("Nome da empresa (mesmo parcial) ou id do cliente."),
      }),
      outputSchema: z.object({
        cliente: z.object({
          id: z.string(),
          nome_empresa: z.string(),
          plano: z.string().optional(),
          status: z.string().optional(),
          email: z.string().optional(),
          documento: z.string().optional(),
          endereco: z.string().optional(),
          tem_contrato: z.boolean(),
        }),
        tarefas: z.object({
          total: z.number().int(),
          atrasadas: z.number().int(),
          por_status: z.array(z.object({ status: z.string(), quantidade: z.number().int() })),
          truncado: z.boolean(),
        }),
        projetos: z.array(
          z.object({ id: z.string(), nome: z.string(), tarefas: z.number().int() }),
        ),
      }),
      annotations: { title: "Ver cliente", ...ANOTACOES_LEITURA },
    },
    async ({ cliente }) => verCliente(supabase, cliente),
  );
}

async function verCliente(supabase: SupabaseClient, busca: string) {
  // A resolução aqui é a mesma de resolverPorNome, mas preciso da linha
  // inteira, não só do id — então repito o padrão de ambiguidade em vez de
  // resolver e consultar de novo.
  let query = supabase.from("clientes").select(COLUNAS);
  query = ehUuid(busca)
    ? query.eq("id", busca)
    : query.ilike("nome_empresa", `%${escaparLike(busca)}%`);

  const achados = await consultar(() => query.limit(6));
  if (!achados.ok) return achados.resposta;

  const linhas = (achados.dados ?? []) as unknown as LinhaCliente[];

  if (linhas.length === 0) {
    return erro(
      `Não encontrei cliente com nome parecido com «${busca}». Confira o nome ou passe o id.`,
    );
  }
  if (linhas.length > 1) {
    const nomes = linhas.map((l) => `«${l.nome_empresa}» (id ${l.id})`).join("; ");
    return erro(`Mais de um cliente para «${busca}»: ${nomes}. Pergunte ao usuário qual deles.`);
  }

  const c = linhas[0]!;

  const r = await consultar(() =>
    supabase
      .from("tarefas")
      .select("id, status, data_vencimento, projeto_id", { count: "exact" })
      .eq("cliente_id", c.id)
      .eq("tipo", "tarefa")
      .limit(TETO_TAREFAS_CLIENTE),
  );
  if (!r.ok) return r.resposta;

  const tarefas = (r.dados ?? []) as unknown as Array<{
    id: string;
    status: string;
    data_vencimento: string | null;
    projeto_id: string | null;
  }>;
  const totalTarefas = r.total ?? tarefas.length;

  const contagem = new Map<string, number>();
  for (const t of tarefas) contagem.set(t.status, (contagem.get(t.status) ?? 0) + 1);

  const agora = new Date();
  const atrasadas = tarefas.filter((t) => estaAtrasada(t.status, t.data_vencimento, agora));

  const porProjeto = new Map<string, number>();
  for (const t of tarefas) {
    if (t.projeto_id) porProjeto.set(t.projeto_id, (porProjeto.get(t.projeto_id) ?? 0) + 1);
  }

  const nomesProjeto = await mapaDeNomes(supabase, "projetos", "nome", [...porProjeto.keys()]);
  if (!nomesProjeto.ok) return nomesProjeto.resposta;

  const projetos = [...porProjeto.entries()]
    .map(([id, qtd]) => ({ id, nome: nomesProjeto.mapa.get(id) ?? "(sem nome)", tarefas: qtd }))
    .sort((a, b) => b.tarefas - a.tarefas);

  const porStatus = [...contagem.entries()]
    .map(([status, quantidade]) => ({ status, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade);

  const truncado = tarefas.length >= TETO_TAREFAS_CLIENTE;

  const saida = {
    cliente: {
      id: c.id,
      nome_empresa: c.nome_empresa,
      plano: texto(c.plano),
      status: texto(c.status),
      email: texto(c.email),
      documento: texto(c.documento),
      endereco: texto(c.endereco),
      tem_contrato: Boolean(c.contrato_url),
    },
    tarefas: {
      total: totalTarefas,
      atrasadas: atrasadas.length,
      por_status: porStatus,
      truncado,
    },
    projetos,
  };

  const relato = [
    `Empresa: ${citar(c.nome_empresa, 120)}`,
    `id: ${c.id}`,
    `Plano: ${rotulo(c.plano, 40)} · Situação: ${rotulo(c.status, 40, "não informada")}`,
    `E-mail: ${rotulo(c.email, 80)}`,
    `Documento: ${rotulo(c.documento, 40)}`,
    `Endereço: ${rotulo(c.endereco, 200)}`,
    `Contrato em arquivo: ${c.contrato_url ? "sim" : "não"}`,
    "",
    `Tarefas: ${totalTarefas} no total, ${atrasadas.length} atrasada(s).`,
    porStatus.length > 0
      ? porStatus.map((s) => `  ${s.status}: ${s.quantidade}`).join("\n")
      : "  (nenhuma tarefa)",
    "",
    projetos.length > 0
      ? `Projetos com tarefa deste cliente:\n${projetos
          .map((p) => `  - ${citar(p.nome, 80)} · id: ${p.id} · ${p.tarefas} tarefa(s)`)
          .join("\n")}`
      : "Projetos: nenhum.",
    truncado
      ? `\nAtenção: a contagem olhou as primeiras ${TETO_TAREFAS_CLIENTE} tarefas; há mais.`
      : "",
    rodapeDeDados(),
  ].join("\n");

  return ok(relato, saida);
}
