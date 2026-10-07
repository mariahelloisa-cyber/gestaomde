import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  citar,
  citarBloco,
  dataBr,
  dataHoraBr,
  estaAtrasada,
  hojeNoBrasil,
  inicioDeHojeNoBrasil,
  inicioEmDias,
  linhaDePagina,
  rodapeDeDados,
  rotulo,
  texto,
} from "../formato";
import { consultar } from "../sessao";
import {
  ANOTACOES_LEITURA,
  campoDeData,
  camposDePaginacao,
  ehUuid,
  erro,
  escaparLike,
  faixa,
  ok,
  resolverPorNome,
  responsaveisPorTarefa,
  mapaDeNomes,
} from "./comuns";

/** Valores reais das colunas, iguais aos enums do app (src/lib/data.functions.ts). */
export const STATUS = ["Pendente", "Em Progresso", "Em Análise", "Concluído"] as const;
export const PRIORIDADES = ["Alta", "Média", "Baixa", "Nenhuma"] as const;

/** Colunas que as listagens leem. Sem áudio/vídeo/anexos: são paths de storage. */
const COLUNAS_LISTA =
  "id, titulo, status, prioridade, data_vencimento, cliente_id, projeto_id, tipo";

interface LinhaTarefa {
  id: string;
  titulo: string;
  status: string;
  prioridade: string;
  data_vencimento: string | null;
  cliente_id: string | null;
  projeto_id: string | null;
  tipo: string;
}

/**
 * Uma tarefa em uma linha de texto.
 *
 * Todo valor tem rótulo fixo escrito aqui, e o único texto de usuário — o
 * título — vai entre « ». Ver src/mcp/formato.ts para o porquê.
 */
function linhaDeTarefa(
  t: LinhaTarefa,
  nomeCliente: string | undefined,
  nomeProjeto: string | undefined,
  responsaveis: Array<{ nome: string }>,
  agora: Date,
): string {
  const atrasada = estaAtrasada(t.status, t.data_vencimento, agora);
  const partes = [
    `Status: ${t.status}`,
    `Prioridade: ${t.prioridade}`,
    `Prazo: ${dataBr(t.data_vencimento)}${atrasada ? " (ATRASADA)" : ""}`,
  ];
  if (texto(nomeCliente)) partes.push(`Cliente: ${rotulo(nomeCliente, 60)}`);
  if (texto(nomeProjeto)) partes.push(`Projeto: ${rotulo(nomeProjeto, 60)}`);
  partes.push(
    responsaveis.length > 0
      ? `Responsáveis: ${responsaveis.map((r) => citar(r.nome, 40)).join(", ")}`
      : "Responsáveis: nenhum",
  );

  return `- Título: ${citar(t.titulo)}\n  id: ${t.id}\n  ${partes.join(" · ")}`;
}

/**
 * Enriquece uma página de tarefas com nome de cliente, de projeto e
 * responsáveis — três consultas, independente do tamanho da página.
 */
async function enriquecer(supabase: SupabaseClient, tarefas: LinhaTarefa[]) {
  const [clientes, projetos, responsaveis] = await Promise.all([
    mapaDeNomes(
      supabase,
      "clientes",
      "nome_empresa",
      tarefas.map((t) => t.cliente_id),
    ),
    mapaDeNomes(
      supabase,
      "projetos",
      "nome",
      tarefas.map((t) => t.projeto_id),
    ),
    responsaveisPorTarefa(
      supabase,
      tarefas.map((t) => t.id),
    ),
  ]);

  if (!clientes.ok) return clientes;
  if (!projetos.ok) return projetos;
  if (!responsaveis.ok) return responsaveis;

  return {
    ok: true as const,
    clientes: clientes.mapa,
    projetos: projetos.mapa,
    responsaveis: responsaveis.mapa,
  };
}

/** Saída estruturada de uma tarefa em lista. Datas em ISO, nenhum `.nullable()`. */
const tarefaResumo = () =>
  z.object({
    id: z.string(),
    titulo: z.string(),
    status: z.string(),
    prioridade: z.string(),
    /** Ausente quando a tarefa não tem prazo. */
    data_vencimento: z.string().optional(),
    atrasada: z.boolean(),
    cliente_id: z.string().optional(),
    cliente_nome: z.string().optional(),
    projeto_id: z.string().optional(),
    projeto_nome: z.string().optional(),
    responsaveis: z.array(z.object({ id: z.string(), nome: z.string() })),
    tipo: z.string(),
  });

function paraSaida(
  t: LinhaTarefa,
  clientes: Map<string, string>,
  projetos: Map<string, string>,
  responsaveis: Map<string, Array<{ id: string; nome: string }>>,
  agora: Date,
) {
  const nomeCliente = t.cliente_id ? clientes.get(t.cliente_id) : undefined;
  const nomeProjeto = t.projeto_id ? projetos.get(t.projeto_id) : undefined;
  return {
    id: t.id,
    titulo: t.titulo,
    status: t.status,
    prioridade: t.prioridade,
    data_vencimento: texto(t.data_vencimento),
    atrasada: estaAtrasada(t.status, t.data_vencimento, agora),
    cliente_id: texto(t.cliente_id),
    cliente_nome: texto(nomeCliente),
    projeto_id: texto(t.projeto_id),
    projeto_nome: texto(nomeProjeto),
    responsaveis: responsaveis.get(t.id) ?? [],
    tipo: t.tipo,
  };
}

/** "minhas" | nome | uuid -> id, com descrição pronta para a mensagem. */
async function idDoResponsavel(
  supabase: SupabaseClient,
  valor: string,
  meuId: string,
): Promise<
  { ok: true; id: string; descricao: string } | { ok: false; resposta: ReturnType<typeof erro> }
> {
  if (valor.trim().toLowerCase() === "minhas") {
    return { ok: true, id: meuId, descricao: "você" };
  }
  const r = await resolverPorNome(supabase, {
    tabela: "perfis_usuarios",
    colunaNome: "nome",
    busca: valor,
    rotulo: "pessoa da equipe",
  });
  if (!r.ok) return { ok: false, resposta: r.resposta };
  return { ok: true, id: r.id, descricao: citar(r.nome, 40) };
}

const DESC_LISTAR =
  "Lista tarefas do CRM com filtros, ordenadas por urgência: as atrasadas primeiro, " +
  "depois as de prazo mais próximo, e por fim as sem prazo. Use para perguntas como " +
  "'o que está atrasado', 'minhas tarefas', 'tarefas do cliente X' ou 'o que vence " +
  "esta semana'. Por padrão NÃO traz tarefas concluídas nem lembretes. Devolve sempre " +
  "o id de cada tarefa, que é o que ver_tarefa usa.";

export function registrarListarTarefas(server: McpServer, supabase: SupabaseClient, meuId: string) {
  server.registerTool(
    "listar_tarefas",
    {
      title: "Listar tarefas",
      description: DESC_LISTAR,
      inputSchema: z.object({
        responsavel: z
          .string()
          .describe(
            "Quem responde pela tarefa. Use 'minhas' para o usuário conectado, ou o nome (mesmo parcial) da pessoa, ou o id dela. Nome ambíguo devolve erro pedindo para escolher.",
          )
          .optional(),
        status: z.enum(STATUS).describe("Filtra por um status exato.").optional(),
        prioridade: z.enum(PRIORIDADES).describe("Filtra por prioridade.").optional(),
        cliente: z.string().describe("Nome (mesmo parcial) ou id da empresa cliente.").optional(),
        projeto: z.string().describe("Nome (mesmo parcial) ou id do projeto.").optional(),
        atrasadas: z
          .boolean()
          .describe("Se true, só as atrasadas: prazo vencido e status diferente de Concluído.")
          .optional(),
        vence_de: campoDeData("Só o que vence nesta data ou depois (AAAA-MM-DD).").optional(),
        vence_ate: campoDeData("Só o que vence nesta data ou antes (AAAA-MM-DD).").optional(),
        busca: z.string().describe("Texto procurado no título da tarefa.").optional(),
        incluir_concluidas: z
          .boolean()
          .describe(
            "Se true, inclui status Concluído. Padrão false: concluída é histórico e atrapalha a ordem por urgência.",
          )
          .optional(),
        incluir_lembretes: z
          .boolean()
          .describe(
            "Se true, inclui lembretes de agenda. Padrão false. Lembrete pessoal de outra pessoa nunca aparece, por regra do banco.",
          )
          .optional(),
        ...camposDePaginacao(),
      }),
      outputSchema: z.object({
        tarefas: z.array(tarefaResumo()),
        total: z.number().int(),
        offset: z.number().int(),
        tem_mais: z.boolean(),
        hoje: z.string(),
      }),
      annotations: { title: "Listar tarefas", ...ANOTACOES_LEITURA },
    },
    async (entrada) => listarTarefas(supabase, meuId, entrada),
  );
}

interface EntradaLista {
  responsavel?: string;
  status?: (typeof STATUS)[number];
  prioridade?: (typeof PRIORIDADES)[number];
  cliente?: string;
  projeto?: string;
  atrasadas?: boolean;
  vence_de?: string;
  vence_ate?: string;
  busca?: string;
  incluir_concluidas?: boolean;
  incluir_lembretes?: boolean;
  limite: number;
  offset: number;
}

const DESC_VER =
  "Mostra uma tarefa inteira: dados, descrição, checklist, responsáveis e todos os " +
  "comentários com autor e data. Use quando o usuário quiser detalhe de UMA tarefa, " +
  "ou depois de listar_tarefas para abrir uma delas. Precisa do id da tarefa — pegue " +
  "com listar_tarefas antes.";

const tarefaDetalhe = () =>
  z.object({
    id: z.string(),
    titulo: z.string(),
    status: z.string(),
    prioridade: z.string(),
    complexidade: z.string().optional(),
    tipo: z.string(),
    descricao: z.string().optional(),
    data_vencimento: z.string().optional(),
    atrasada: z.boolean(),
    concluido_em: z.string().optional(),
    cliente_id: z.string().optional(),
    cliente_nome: z.string().optional(),
    projeto_id: z.string().optional(),
    projeto_nome: z.string().optional(),
    responsaveis: z.array(z.object({ id: z.string(), nome: z.string() })),
    checklist: z.array(z.object({ id: z.string(), texto: z.string(), concluido: z.boolean() })),
    comentarios: z.array(
      z.object({
        id: z.string(),
        autor_nome: z.string(),
        conteudo: z.string(),
        criado_em: z.string(),
      }),
    ),
    tem_anexos: z.boolean(),
  });

export function registrarVerTarefa(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    "ver_tarefa",
    {
      title: "Ver tarefa",
      description: DESC_VER,
      inputSchema: z.object({
        tarefa_id: z.string().describe("O id (uuid) da tarefa, como devolvido por listar_tarefas."),
      }),
      outputSchema: z.object({ tarefa: tarefaDetalhe() }),
      annotations: { title: "Ver tarefa", ...ANOTACOES_LEITURA },
    },
    async ({ tarefa_id }) => verTarefa(supabase, tarefa_id),
  );
}

interface LinhaTarefaCheia extends LinhaTarefa {
  descricao: string | null;
  complexidade: string | null;
  concluido_em: string | null;
  anexos: unknown;
  audio: unknown;
  video: unknown;
}

async function verTarefa(supabase: SupabaseClient, tarefaId: string) {
  const agora = new Date();

  if (!ehUuid(tarefaId)) {
    return erro("O id da tarefa precisa ser um uuid. Use listar_tarefas para obter o id certo.");
  }

  const r = await consultar(() =>
    supabase
      .from("tarefas")
      .select(
        "id, titulo, status, prioridade, complexidade, tipo, descricao, data_vencimento, concluido_em, cliente_id, projeto_id, anexos, audio, video",
      )
      .eq("id", tarefaId)
      .maybeSingle(),
  );
  if (!r.ok) return r.resposta;

  const t = r.dados as unknown as LinhaTarefaCheia | null;
  if (!t) {
    // Pode ser id inexistente OU tarefa que o RLS não deixa este usuário ver.
    // A mensagem não distingue de propósito: dizer "existe mas você não pode"
    // já é contar que existe.
    return erro("Não encontrei essa tarefa. Ou o id está errado, ou ela não está no seu acesso.");
  }

  const [extra, checklist, comentarios] = await Promise.all([
    enriquecer(supabase, [t]),
    consultar(() =>
      supabase
        .from("tarefa_checklist_itens")
        .select("id, texto, concluido")
        .eq("tarefa_id", tarefaId)
        .order("criado_em", { ascending: true }),
    ),
    consultar(() =>
      supabase
        .from("comentarios_tarefa")
        .select("id, usuario_id, conteudo, criado_em")
        .eq("tarefa_id", tarefaId)
        .order("criado_em", { ascending: true }),
    ),
  ]);

  if (!extra.ok) return extra.resposta;
  if (!checklist.ok) return checklist.resposta;
  if (!comentarios.ok) return comentarios.resposta;

  const itens = (checklist.dados ?? []) as unknown as Array<{
    id: string;
    texto: string;
    concluido: boolean;
  }>;
  const brutos = (comentarios.dados ?? []) as unknown as Array<{
    id: string;
    usuario_id: string;
    conteudo: string;
    criado_em: string;
  }>;

  const autores = await mapaDeNomes(
    supabase,
    "perfis_usuarios",
    "nome",
    brutos.map((c) => c.usuario_id),
  );
  if (!autores.ok) return autores.resposta;

  const responsaveis = extra.responsaveis.get(t.id) ?? [];
  const nomeCliente = t.cliente_id ? extra.clientes.get(t.cliente_id) : undefined;
  const nomeProjeto = t.projeto_id ? extra.projetos.get(t.projeto_id) : undefined;
  const atrasada = estaAtrasada(t.status, t.data_vencimento, agora);
  const anexos = Array.isArray(t.anexos) ? t.anexos.length : 0;
  const temAnexos = anexos > 0 || Boolean(t.audio) || Boolean(t.video);

  const saida = {
    tarefa: {
      id: t.id,
      titulo: t.titulo,
      status: t.status,
      prioridade: t.prioridade,
      complexidade: texto(t.complexidade),
      tipo: t.tipo,
      descricao: texto(t.descricao),
      data_vencimento: texto(t.data_vencimento),
      atrasada,
      concluido_em: texto(t.concluido_em),
      cliente_id: texto(t.cliente_id),
      cliente_nome: texto(nomeCliente),
      projeto_id: texto(t.projeto_id),
      projeto_nome: texto(nomeProjeto),
      responsaveis,
      checklist: itens.map((i) => ({ id: i.id, texto: i.texto, concluido: i.concluido })),
      comentarios: brutos.map((c) => ({
        id: c.id,
        autor_nome: autores.mapa.get(c.usuario_id) ?? "(sem nome)",
        conteudo: c.conteudo,
        criado_em: c.criado_em,
      })),
      tem_anexos: temAnexos,
    },
  };

  return ok(textoDaTarefa(saida.tarefa, agora), saida);
}

/**
 * A tarefa inteira em texto.
 *
 * Todo rótulo é escrito aqui e todo texto de pessoa vai entre « » ou em bloco
 * prefixado por "│". Descrição e comentário são o conteúdo mais longo que o CRM
 * guarda, e parte dele pode ter vindo do portal público de demandas — então é
 * justamente aqui que a delimitação importa.
 */
function textoDaTarefa(t: z.infer<ReturnType<typeof tarefaDetalhe>>, agora: Date): string {
  const linhas: string[] = [];

  linhas.push(`Tarefa ${t.id}`);
  linhas.push(`Título: ${citar(t.titulo, 300)}`);
  linhas.push(
    `Status: ${t.status} · Prioridade: ${t.prioridade}` +
      (t.complexidade ? ` · Complexidade: ${t.complexidade}` : ""),
  );
  linhas.push(
    `Prazo: ${dataBr(t.data_vencimento)}${t.atrasada ? " (ATRASADA)" : ""}` +
      (t.concluido_em ? ` · Concluída em: ${dataBr(t.concluido_em)}` : ""),
  );
  linhas.push(`Cliente: ${rotulo(t.cliente_nome, 60, "nenhum")}`);
  linhas.push(`Projeto: ${rotulo(t.projeto_nome, 60, "nenhum")}`);
  linhas.push(
    `Responsáveis: ${
      t.responsaveis.length > 0 ? t.responsaveis.map((r) => citar(r.nome, 40)).join(", ") : "nenhum"
    }`,
  );
  if (t.tem_anexos) {
    linhas.push("Anexos: sim (áudio, vídeo ou arquivo). Os arquivos não são lidos por aqui.");
  }

  linhas.push("");
  linhas.push("Descrição (texto do usuário):");
  linhas.push(citarBloco(t.descricao));

  linhas.push("");
  if (t.checklist.length === 0) {
    linhas.push("Checklist: nenhum item.");
  } else {
    const feitos = t.checklist.filter((i) => i.concluido).length;
    linhas.push(`Checklist: ${feitos} de ${t.checklist.length} concluídos.`);
    for (const i of t.checklist) {
      linhas.push(`  [${i.concluido ? "x" : " "}] ${citar(i.texto, 200)}`);
    }
  }

  linhas.push("");
  if (t.comentarios.length === 0) {
    linhas.push("Comentários: nenhum.");
  } else {
    linhas.push(`Comentários: ${t.comentarios.length}.`);
    for (const c of t.comentarios) {
      linhas.push(`  Autor: ${citar(c.autor_nome, 40)} · Em: ${dataHoraBr(c.criado_em)}`);
      linhas.push(citarBloco(c.conteudo, 1000));
    }
  }

  linhas.push("");
  linhas.push(`Hoje é ${dataBr(agora.toISOString())}.`);
  linhas.push(rodapeDeDados());

  return linhas.join("\n");
}

const DESC_RESUMO =
  "Panorama de urgência de uma pessoa: quantas tarefas estão atrasadas, quantas vencem " +
  "hoje, quantas vencem nos próximos 7 dias e quantas estão em análise — com as mais " +
  "urgentes de cada grupo. Use para 'o que eu tenho para hoje', 'como está minha " +
  "semana' ou 'o que está pegando fogo'. Por padrão olha o usuário conectado.";

const grupoResumo = () =>
  z.object({
    quantidade: z.number().int(),
    amostra: z.array(
      z.object({
        id: z.string(),
        titulo: z.string(),
        status: z.string(),
        data_vencimento: z.string().optional(),
        cliente_nome: z.string().optional(),
      }),
    ),
  });

export function registrarResumoDoDia(server: McpServer, supabase: SupabaseClient, meuId: string) {
  server.registerTool(
    "resumo_do_dia",
    {
      title: "Resumo do dia",
      description: DESC_RESUMO,
      inputSchema: z.object({
        responsavel: z
          .string()
          .describe(
            "De quem é o resumo. Padrão 'minhas' (o usuário conectado). Aceita nome parcial ou id.",
          )
          .optional(),
      }),
      outputSchema: z.object({
        de_quem: z.string(),
        hoje: z.string(),
        atrasadas: grupoResumo(),
        vencem_hoje: grupoResumo(),
        proximos_7_dias: grupoResumo(),
        em_analise: grupoResumo(),
        total_abertas: z.number().int(),
      }),
      annotations: { title: "Resumo do dia", ...ANOTACOES_LEITURA },
    },
    async ({ responsavel }) => resumoDoDia(supabase, meuId, responsavel ?? "minhas"),
  );
}

/** Quantas tarefas abertas o resumo varre. Acima disto, as contagens avisam que truncaram. */
const TETO_RESUMO = 400;

async function resumoDoDia(supabase: SupabaseClient, meuId: string, responsavel: string) {
  const agora = new Date();
  const alvo = await idDoResponsavel(supabase, responsavel, meuId);
  if (!alvo.ok) return alvo.resposta;

  const vazio = {
    de_quem: alvo.descricao,
    hoje: hojeNoBrasil(agora),
    atrasadas: { quantidade: 0, amostra: [] },
    vencem_hoje: { quantidade: 0, amostra: [] },
    proximos_7_dias: { quantidade: 0, amostra: [] },
    em_analise: { quantidade: 0, amostra: [] },
    total_abertas: 0,
  };

  // Mesmo motivo de listar_tarefas: filtro por join, não lista de ids na URL.
  const r = await consultar(() =>
    supabase
      .from("tarefas")
      .select(`${COLUNAS_LISTA}, tarefa_responsaveis!inner(usuario_id)`)
      .eq("tarefa_responsaveis.usuario_id", alvo.id)
      .eq("tipo", "tarefa")
      .neq("status", "Concluído")
      .order("data_vencimento", { ascending: true, nullsFirst: false })
      .limit(TETO_RESUMO),
  );
  if (!r.ok) return r.resposta;

  const abertas = (r.dados ?? []) as unknown as LinhaTarefa[];
  if (abertas.length === 0) {
    return ok(`Nenhuma tarefa aberta com ${alvo.descricao} como responsável.`, vazio);
  }

  const clientes = await mapaDeNomes(
    supabase,
    "clientes",
    "nome_empresa",
    abertas.map((t) => t.cliente_id),
  );
  if (!clientes.ok) return clientes.resposta;

  const inicioHoje = new Date(inicioDeHojeNoBrasil(agora)).getTime();
  const inicioAmanha = new Date(inicioEmDias(1, agora)).getTime();
  const fimDaSemana = new Date(inicioEmDias(8, agora)).getTime();

  const quando = (t: LinhaTarefa) =>
    t.data_vencimento ? new Date(t.data_vencimento).getTime() : null;

  const atrasadas = abertas.filter((t) => {
    const q = quando(t);
    return q !== null && q < inicioHoje;
  });
  const vencemHoje = abertas.filter((t) => {
    const q = quando(t);
    return q !== null && q >= inicioHoje && q < inicioAmanha;
  });
  const proximos = abertas.filter((t) => {
    const q = quando(t);
    return q !== null && q >= inicioAmanha && q < fimDaSemana;
  });
  const emAnalise = abertas.filter((t) => t.status === "Em Análise");

  const grupo = (lista: LinhaTarefa[]) => ({
    quantidade: lista.length,
    amostra: lista.slice(0, 5).map((t) => ({
      id: t.id,
      titulo: t.titulo,
      status: t.status,
      data_vencimento: texto(t.data_vencimento),
      cliente_nome: texto(t.cliente_id ? clientes.mapa.get(t.cliente_id) : undefined),
    })),
  });

  const saida = {
    de_quem: alvo.descricao,
    hoje: hojeNoBrasil(agora),
    atrasadas: grupo(atrasadas),
    vencem_hoje: grupo(vencemHoje),
    proximos_7_dias: grupo(proximos),
    em_analise: grupo(emAnalise),
    total_abertas: abertas.length,
  };

  const bloco = (titulo: string, g: ReturnType<typeof grupo>) => {
    if (g.quantidade === 0) return `${titulo}: nenhuma.`;
    const itens = g.amostra
      .map(
        (t) =>
          `  - ${citar(t.titulo, 120)} · id: ${t.id} · Prazo: ${dataBr(t.data_vencimento)}` +
          (texto(t.cliente_nome) ? ` · Cliente: ${rotulo(t.cliente_nome, 60)}` : ""),
      )
      .join("\n");
    const resto =
      g.quantidade > g.amostra.length ? `\n  (e outras ${g.quantidade - g.amostra.length})` : "";
    return `${titulo}: ${g.quantidade}.\n${itens}${resto}`;
  };

  const aviso =
    abertas.length >= TETO_RESUMO
      ? `\nAtenção: o resumo olhou as ${TETO_RESUMO} tarefas abertas mais urgentes; há mais.`
      : "";

  const relato = [
    `Resumo de ${alvo.descricao}. Hoje é ${dataBr(agora.toISOString())}.`,
    `Tarefas abertas no total: ${abertas.length}.`,
    "",
    bloco("ATRASADAS", saida.atrasadas),
    "",
    bloco("VENCEM HOJE", saida.vencem_hoje),
    "",
    bloco("PRÓXIMOS 7 DIAS", saida.proximos_7_dias),
    "",
    bloco("EM ANÁLISE", saida.em_analise),
    aviso,
    rodapeDeDados(),
  ].join("\n");

  return ok(relato, saida);
}

/**
 * O corpo de `listar_tarefas`.
 *
 * O `select` é montado UMA vez, antes de qualquer filtro: com responsável, ele
 * ganha o join `tarefa_responsaveis!inner`, e aí o filtro por pessoa acontece
 * no banco.
 *
 * A alternativa — buscar os ids do responsável e passar em `.in("id", [...])` —
 * monta uma URL com 37 bytes por uuid: quem tem 500 tarefas gera ~18 KB de
 * query string e a requisição morre no limite de URL. Ou seja, quebraria
 * justamente para quem tem mais trabalho.
 *
 * O embed vem filtrado (dentro dele aparece só o responsável do filtro), e isso
 * não importa: os responsáveis da página são buscados à parte, em `enriquecer`,
 * exatamente para mostrar todos.
 */
async function listarTarefas(supabase: SupabaseClient, meuId: string, entrada: EntradaLista) {
  const agora = new Date();
  const { limite, offset } = entrada;

  const vazio = (mensagem: string) =>
    ok(mensagem, { tarefas: [], total: 0, offset, tem_mais: false, hoje: hojeNoBrasil(agora) });

  // --- resolve os nomes ANTES de montar a consulta ---
  let idResponsavel: string | null = null;
  if (entrada.responsavel) {
    const alvo = await idDoResponsavel(supabase, entrada.responsavel, meuId);
    if (!alvo.ok) return alvo.resposta;
    idResponsavel = alvo.id;
  }

  let idCliente: string | null = null;
  if (entrada.cliente) {
    const r = await resolverPorNome(supabase, {
      tabela: "clientes",
      colunaNome: "nome_empresa",
      busca: entrada.cliente,
      rotulo: "cliente",
    });
    if (!r.ok) return r.resposta;
    idCliente = r.id;
  }

  let idProjeto: string | null = null;
  if (entrada.projeto) {
    const r = await resolverPorNome(supabase, {
      tabela: "projetos",
      colunaNome: "nome",
      busca: entrada.projeto,
      rotulo: "projeto",
    });
    if (!r.ok) return r.resposta;
    idProjeto = r.id;
  }

  const selecao: string = idResponsavel
    ? `${COLUNAS_LISTA}, tarefa_responsaveis!inner(usuario_id)`
    : COLUNAS_LISTA;

  let query = supabase.from("tarefas").select(selecao, { count: "exact" });

  if (idResponsavel) query = query.eq("tarefa_responsaveis.usuario_id", idResponsavel);
  if (idCliente) query = query.eq("cliente_id", idCliente);
  if (idProjeto) query = query.eq("projeto_id", idProjeto);

  // Lembrete é outra coisa (agenda/mural); a própria página de Projetos do app
  // filtra tipo='tarefa'.
  if (!entrada.incluir_lembretes) query = query.eq("tipo", "tarefa");
  if (!entrada.incluir_concluidas && !entrada.status) query = query.neq("status", "Concluído");
  if (entrada.status) query = query.eq("status", entrada.status);
  if (entrada.prioridade) query = query.eq("prioridade", entrada.prioridade);
  if (entrada.busca) query = query.ilike("titulo", `%${escaparLike(entrada.busca)}%`);

  if (entrada.atrasadas) {
    query = query
      .not("data_vencimento", "is", null)
      .lt("data_vencimento", inicioDeHojeNoBrasil(agora))
      .neq("status", "Concluído");
  }
  if (entrada.vence_de) query = query.gte("data_vencimento", `${entrada.vence_de}T00:00:00`);
  if (entrada.vence_ate) query = query.lte("data_vencimento", `${entrada.vence_ate}T23:59:59`);

  // A ordem pedida: prazo crescente põe as atrasadas (datas menores) primeiro e
  // as sem prazo no fim. É por isso que concluída fica fora por padrão — uma
  // tarefa de janeiro já fechada subiria ao topo da lista de urgências.
  const r = await consultar(() =>
    query
      .order("data_vencimento", { ascending: true, nullsFirst: false })
      .order("data_criacao", { ascending: false })
      .range(...faixa(offset, limite)),
  );
  if (!r.ok) return r.resposta;

  const tarefas = (r.dados ?? []) as unknown as LinhaTarefa[];
  const total = r.total ?? tarefas.length;

  if (tarefas.length === 0) return vazio("Nenhuma tarefa encontrada com esses filtros.");

  const extra = await enriquecer(supabase, tarefas);
  if (!extra.ok) return extra.resposta;

  const linhas = tarefas.map((t) =>
    linhaDeTarefa(
      t,
      t.cliente_id ? extra.clientes.get(t.cliente_id) : undefined,
      t.projeto_id ? extra.projetos.get(t.projeto_id) : undefined,
      extra.responsaveis.get(t.id) ?? [],
      agora,
    ),
  );

  const relato = [
    `Tarefas encontradas. Hoje é ${dataBr(agora.toISOString())}.`,
    "",
    linhas.join("\n"),
    "",
    linhaDePagina(tarefas.length, total, offset),
    rodapeDeDados(),
  ].join("\n");

  return ok(relato, {
    tarefas: tarefas.map((t) =>
      paraSaida(t, extra.clientes, extra.projetos, extra.responsaveis, agora),
    ),
    total,
    offset,
    tem_mais: offset + tarefas.length < total,
    hoje: hojeNoBrasil(agora),
  });
}
