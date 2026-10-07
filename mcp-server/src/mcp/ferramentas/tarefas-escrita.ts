import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { citar, citarBloco, dataBr, rodapeDeDados, rotulo } from "../formato";
import { consultar } from "../sessao";
import {
  campoDeData,
  ehUuid,
  erro,
  mapaDeNomes,
  ok,
  resolverPorNome,
  responsaveisPorTarefa,
} from "./comuns";
import {
  AVISO_ESCRITA,
  avisoDePrazo,
  avisoDeVisibilidade,
  CANAL_DE_AVISO,
  cargoAtual,
  carregarTarefa,
  COMPLEXIDADES,
  type ContextoEscrita,
  dataExiste,
  type Desfecho,
  ehEu,
  executarEscrita,
  inicioDaJanela,
  marcadorDeCriacao,
  normalizar,
  type Pessoa,
  prazoParaTimestamp,
  recusaDoBanco,
  recusarSeLembrete,
  resolverPessoasAtivas,
  semAuditoria,
  temAnexos,
  textoDeAviso,
} from "./escrita";
import { PRIORIDADES, STATUS } from "./tarefas";

/**
 * As três ferramentas de escrita que mexem na TAREFA: criar, alterar campos e
 * definir responsáveis. Comentário e checklist ficam em colaboracao.ts.
 *
 * Anotações (decididas na proposta da etapa 4): `destructiveHint` é "perde
 * informação" — sobrescrever título/descrição sem histórico, remover
 * responsável. `openWorldHint` é true onde a ação faz o CRM mandar e-mail.
 */

const pessoaSaida = () => z.object({ id: z.string(), nome: z.string() });

// ============================================================ criar_tarefa

const DESC_CRIAR =
  "Cria uma tarefa no CRM, com status Pendente, e opcionalmente descrição, prazo, prioridade, " +
  "complexidade, projeto, cliente e responsáveis. Cada responsável designado recebe " +
  `${CANAL_DE_AVISO} do CRM avisando da tarefa: diga isso ao usuário. Responsável é pessoa ativa ` +
  "da equipe, por nome (mesmo parcial), id ou 'eu'; nome ambíguo devolve erro pedindo para " +
  "escolher, e nesse caso nada é criado. Se você mesmo já criou uma tarefa com o mesmo título " +
  "nos últimos 2 minutos, ela é devolvida em vez de duplicada." +
  AVISO_ESCRITA;

export function registrarCriarTarefa(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "criar_tarefa",
    {
      title: "Criar tarefa",
      description: DESC_CRIAR,
      inputSchema: z.object({
        titulo: z.string().min(1).max(500).describe("Título curto da tarefa."),
        descricao: z.string().max(5000).describe("Descrição, se o usuário deu uma.").optional(),
        prazo: campoDeData(
          "Prazo (AAAA-MM-DD), no fuso de Brasília. Vale até o fim desse dia.",
        ).optional(),
        prioridade: z.enum(PRIORIDADES).describe("Padrão: Nenhuma.").optional(),
        complexidade: z.enum(COMPLEXIDADES).describe("Padrão: Média.").optional(),
        responsaveis: z
          .array(z.string().min(1))
          .max(10)
          .describe(
            "Quem responde pela tarefa: nomes (mesmo parciais), ids, ou 'eu'. Cada um recebe e-mail.",
          )
          .optional(),
        projeto: z.string().describe("Nome (mesmo parcial) ou id do projeto.").optional(),
        cliente: z
          .string()
          .describe(
            "Nome (mesmo parcial) ou id da EMPRESA cliente, só se o usuário citou um cliente. Nunca o nome de um responsável.",
          )
          .optional(),
      }),
      outputSchema: z.object({
        resultado: z.enum(["criada", "duplicata", "parcial"]),
        tarefa_id: z.string(),
        titulo: z.string(),
        responsaveis: z.array(pessoaSaida()),
        avisados_por_email: z.array(z.string()),
      }),
      annotations: {
        title: "Criar tarefa",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (entrada) => executarEscrita(ctx, "criar_tarefa", () => criarTarefa(ctx, entrada)),
  );
}

interface EntradaCriar {
  titulo: string;
  descricao?: string;
  prazo?: string;
  prioridade?: (typeof PRIORIDADES)[number];
  complexidade?: (typeof COMPLEXIDADES)[number];
  responsaveis?: string[];
  projeto?: string;
  cliente?: string;
}

async function criarTarefa(ctx: ContextoEscrita, e: EntradaCriar): Promise<Desfecho> {
  const { supabase, meuId } = ctx;

  // --- 1. Valida e resolve TUDO antes de gravar qualquer coisa ---
  const titulo = e.titulo.trim();
  if (!titulo) return semAuditoria(erro("O título não pode ser vazio."));
  const descricao = e.descricao?.trim() || null;

  if (e.prazo && !dataExiste(e.prazo)) {
    return semAuditoria(erro(`A data ${e.prazo} não existe. Use AAAA-MM-DD.`));
  }

  let projeto: { id: string; nome: string } | null = null;
  if (e.projeto) {
    const r = await resolverPorNome(supabase, {
      tabela: "projetos",
      colunaNome: "nome",
      busca: e.projeto,
      rotulo: "projeto",
    });
    if (!r.ok) return semAuditoria(r.resposta);
    projeto = { id: r.id, nome: r.nome };
  }

  let cliente: { id: string; nome: string } | null = null;
  if (e.cliente) {
    const r = await resolverPorNome(supabase, {
      tabela: "clientes",
      colunaNome: "nome_empresa",
      busca: e.cliente,
      rotulo: "cliente",
    });
    if (!r.ok) return semAuditoria(r.resposta);
    cliente = { id: r.id, nome: r.nome };
  }

  let responsaveis: Pessoa[] = [];
  if (e.responsaveis?.length) {
    const r = await resolverPessoasAtivas(ctx, e.responsaveis);
    if (!r.ok) return semAuditoria(r.resposta);
    responsaveis = r.pessoas;
  }

  const prioridade = e.prioridade ?? "Nenhuma";
  const complexidade = e.complexidade ?? "Média";
  const argumentos = {
    titulo,
    descricao_len: descricao?.length ?? 0,
    prazo: e.prazo,
    prioridade,
    complexidade,
    projeto_id: projeto?.id,
    cliente_id: cliente?.id,
    responsaveis: responsaveis.map((p) => p.id),
  };

  // --- 2. Duplicata: o marcador do KV primeiro, o banco depois ---
  const marcador = await marcadorDeCriacao(ctx, "criar_tarefa", titulo);
  let existente = await marcador.ler();
  if (!existente) {
    const r = await consultar(() =>
      supabase
        .from("tarefas")
        .select("id")
        .eq("criado_por", meuId)
        .eq("titulo", titulo)
        .eq("tipo", "tarefa")
        .gte("data_criacao", inicioDaJanela())
        .order("data_criacao", { ascending: false })
        .limit(1),
    );
    if (!r.ok) return semAuditoria(r.resposta);
    const linhas = (r.dados ?? []) as Array<{ id: string }>;
    existente = linhas[0]?.id ?? null;
  }

  if (existente) {
    return {
      resposta: ok(
        `Não criei outra: você já criou a tarefa ${citar(titulo)} há menos de 2 minutos ` +
          `(id ${existente}). Se o usuário quer mesmo uma segunda tarefa igual, mude o título ` +
          "ou espere 2 minutos. Para ajustar a existente, use atualizar_tarefa ou definir_responsaveis.",
        {
          resultado: "duplicata",
          tarefa_id: existente,
          titulo,
          responsaveis: [],
          avisados_por_email: [],
        },
      ),
      auditoria: { resultado: "duplicata", tarefaId: existente, argumentos },
    };
  }

  // --- 3. A tarefa ---
  const prazoTs = e.prazo ? prazoParaTimestamp(e.prazo) : null;
  const ins = await consultar(() =>
    supabase
      .from("tarefas")
      .insert({
        titulo,
        descricao,
        status: "Pendente",
        prioridade,
        complexidade,
        data_vencimento: prazoTs,
        tipo: "tarefa",
        escopo: "geral",
        criado_por: meuId,
        projeto_id: projeto?.id ?? null,
        cliente_id: cliente?.id ?? null,
      })
      .select("id")
      .single(),
  );
  if (!ins.ok) return recusaDoBanco(ins, { argumentos });

  // `as unknown as`: sem os tipos do banco, o supabase-js infere `null` para o
  // retorno de insert().select().single(). A forma real vem do select acima.
  const tarefaId = (ins.dados as unknown as { id: string }).id;
  try {
    await marcador.gravar(tarefaId);
  } catch {
    // Sem o marcador, sobra a consulta ao banco. Não vale falhar a criação.
    console.warn("[mcp] criar_tarefa: marcador de duplicata nao gravou");
  }

  const cabecalho = [
    `Tarefa criada: ${citar(titulo, 300)}`,
    `id: ${tarefaId}`,
    `Status: Pendente · Prioridade: ${prioridade} · Complexidade: ${complexidade}`,
    `Prazo: ${dataBr(prazoTs)}${e.prazo ? avisoDePrazo(e.prazo) : ""}`,
    `Projeto: ${rotulo(projeto?.nome, 60, "nenhum")} · Cliente: ${rotulo(cliente?.nome, 60, "nenhum")}`,
  ];

  // --- 4. Responsáveis: TODOS num INSERT só ---
  // Num INSERT só por causa do RLS: a primeira linha com um Admin já tornaria
  // a tarefa "de Admin", e um segundo INSERT de quem não é Admin seria
  // recusado. Dentro do mesmo comando, as linhas não se enxergam.
  if (responsaveis.length > 0) {
    const rr = await consultar(() =>
      supabase
        .from("tarefa_responsaveis")
        .insert(responsaveis.map((p) => ({ tarefa_id: tarefaId, usuario_id: p.id }))),
    );
    if (!rr.ok) {
      return {
        resposta: ok(
          [
            ...cabecalho,
            "",
            "ATENÇÃO: a tarefa foi criada, mas os responsáveis NÃO foram designados " +
              `(${rr.codigo === "42501" ? "o CRM recusou" : "falha ao gravar"}). ` +
              "Ninguém foi avisado. Use definir_responsaveis nesta tarefa para tentar de novo.",
            rodapeDeDados(),
          ].join("\n"),
          {
            resultado: "parcial",
            tarefa_id: tarefaId,
            titulo,
            responsaveis: [],
            avisados_por_email: [],
          },
        ),
        auditoria: {
          resultado: "parcial",
          tarefaId,
          argumentos,
          detalhe: `responsaveis nao gravaram: ${rr.codigo ?? "?"}`,
        },
      };
    }
  }

  let visibilidade = "";
  if (responsaveis.some((p) => p.cargo === "Admin")) {
    const c = await cargoAtual(ctx);
    visibilidade = avisoDeVisibilidade(c.ok ? c.cargo : null, responsaveis);
  }

  const linhas = [
    ...cabecalho,
    `Responsáveis: ${
      responsaveis.length > 0 ? responsaveis.map((p) => citar(p.nome, 40)).join(", ") : "nenhum"
    }`,
  ];
  if (responsaveis.length > 0) linhas.push("", textoDeAviso(responsaveis) + visibilidade);
  linhas.push(rodapeDeDados());

  return {
    resposta: ok(linhas.join("\n"), {
      resultado: "criada",
      tarefa_id: tarefaId,
      titulo,
      responsaveis: responsaveis.map((p) => ({ id: p.id, nome: p.nome })),
      avisados_por_email: responsaveis.map((p) => p.nome),
    }),
    auditoria: {
      resultado: "ok",
      tarefaId,
      ids: responsaveis.map((p) => p.id),
      argumentos,
    },
  };
}

// ======================================================== atualizar_tarefa

const DESC_ATUALIZAR =
  "Altera campos de UMA tarefa existente: título, descrição (substitui o texto inteiro), prazo, " +
  "status, prioridade, complexidade e projeto. Só os campos informados mudam. Mudar o status " +
  `para 'Em Análise' faz o CRM mandar ${CANAL_DE_AVISO} a todos os Admins: avise o usuário. ` +
  "'Concluído' só pode ser posto por quem tem cargo Admin, e só em tarefa sem anexos (as com " +
  "anexo se concluem pelo app, que apaga os anexos). O cliente da tarefa não muda por aqui, " +
  "como no app. A resposta traz o valor anterior de cada campo alterado. Precisa do id da " +
  "tarefa (pegue com listar_tarefas)." +
  AVISO_ESCRITA;

export function registrarAtualizarTarefa(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "atualizar_tarefa",
    {
      title: "Atualizar tarefa",
      description: DESC_ATUALIZAR,
      inputSchema: z.object({
        tarefa_id: z.string().describe("O id (uuid) da tarefa, como devolvido por listar_tarefas."),
        titulo: z.string().min(1).max(500).describe("Novo título.").optional(),
        descricao: z
          .string()
          .max(5000)
          .describe("Nova descrição. SUBSTITUI a atual inteira; texto vazio apaga a descrição.")
          .optional(),
        prazo: campoDeData("Novo prazo (AAAA-MM-DD), fuso de Brasília.").optional(),
        remover_prazo: z.boolean().describe("Se true, a tarefa fica sem prazo.").optional(),
        status: z.enum(STATUS).describe("Novo status.").optional(),
        prioridade: z.enum(PRIORIDADES).describe("Nova prioridade.").optional(),
        complexidade: z.enum(COMPLEXIDADES).describe("Nova complexidade.").optional(),
        projeto: z.string().describe("Nome (mesmo parcial) ou id do novo projeto.").optional(),
        remover_projeto: z.boolean().describe("Se true, a tarefa sai do projeto.").optional(),
      }),
      outputSchema: z.object({
        resultado: z.enum(["atualizada", "sem_mudanca"]),
        tarefa_id: z.string(),
        alteracoes: z.array(
          z.object({
            campo: z.string(),
            /** Ausente quando o campo estava vazio. */
            antes: z.string().optional(),
            /** Ausente quando o campo ficou vazio. */
            depois: z.string().optional(),
          }),
        ),
      }),
      annotations: {
        title: "Atualizar tarefa",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (entrada) =>
      executarEscrita(ctx, "atualizar_tarefa", () => atualizarTarefa(ctx, entrada)),
  );
}

interface EntradaAtualizar {
  tarefa_id: string;
  titulo?: string;
  descricao?: string;
  prazo?: string;
  remover_prazo?: boolean;
  status?: (typeof STATUS)[number];
  prioridade?: (typeof PRIORIDADES)[number];
  complexidade?: (typeof COMPLEXIDADES)[number];
  projeto?: string;
  remover_projeto?: boolean;
}

interface Alteracao {
  campo: string;
  antes?: string;
  depois?: string;
}

async function atualizarTarefa(ctx: ContextoEscrita, e: EntradaAtualizar): Promise<Desfecho> {
  const { supabase } = ctx;

  const pedidos = [
    e.titulo,
    e.descricao,
    e.prazo,
    e.remover_prazo,
    e.status,
    e.prioridade,
    e.complexidade,
    e.projeto,
    e.remover_projeto,
  ].filter((v) => v !== undefined && v !== false);
  if (pedidos.length === 0) {
    return semAuditoria(erro("Diga ao menos um campo para alterar."));
  }
  if (e.prazo && e.remover_prazo) {
    return semAuditoria(erro("Use prazo OU remover_prazo, não os dois."));
  }
  if (e.projeto && e.remover_projeto) {
    return semAuditoria(erro("Use projeto OU remover_projeto, não os dois."));
  }
  if (e.titulo !== undefined && !e.titulo.trim()) {
    return semAuditoria(erro("O título não pode ser vazio."));
  }
  if (e.prazo && !dataExiste(e.prazo)) {
    return semAuditoria(erro(`A data ${e.prazo} não existe. Use AAAA-MM-DD.`));
  }

  const c = await carregarTarefa(ctx, e.tarefa_id);
  if (!c.ok) return semAuditoria(c.resposta);
  const t = c.tarefa;

  const lembrete = recusarSeLembrete(t);
  if (lembrete) return lembrete;

  let projetoNovo: { id: string; nome: string } | null = null;
  if (e.projeto) {
    const r = await resolverPorNome(supabase, {
      tabela: "projetos",
      colunaNome: "nome",
      busca: e.projeto,
      rotulo: "projeto",
    });
    if (!r.ok) return semAuditoria(r.resposta);
    projetoNovo = { id: r.id, nome: r.nome };
  }

  // --- o que muda de verdade, comparado ao que está gravado ---
  const patch: Record<string, unknown> = {};
  const alteracoes: Alteracao[] = [];
  let descricaoAnterior: string | null = null;

  if (e.titulo !== undefined && e.titulo.trim() !== t.titulo) {
    patch.titulo = e.titulo.trim();
    alteracoes.push({ campo: "titulo", antes: t.titulo, depois: e.titulo.trim() });
  }

  if (e.descricao !== undefined) {
    const nova = e.descricao.trim() || null;
    if (nova !== (t.descricao?.trim() || null)) {
      patch.descricao = nova;
      descricaoAnterior = t.descricao;
      alteracoes.push({
        campo: "descricao",
        antes: t.descricao ? `${t.descricao.length} caracteres` : undefined,
        depois: nova ? `${nova.length} caracteres` : undefined,
      });
    }
  }

  if (e.prazo) {
    const novo = prazoParaTimestamp(e.prazo);
    const atual = t.data_vencimento ? new Date(t.data_vencimento).getTime() : null;
    if (atual !== new Date(novo).getTime()) {
      patch.data_vencimento = novo;
      alteracoes.push({ campo: "prazo", antes: t.data_vencimento ?? undefined, depois: novo });
    }
  }
  if (e.remover_prazo && t.data_vencimento) {
    patch.data_vencimento = null;
    alteracoes.push({ campo: "prazo", antes: t.data_vencimento });
  }

  if (e.status && e.status !== t.status) {
    patch.status = e.status;
    alteracoes.push({ campo: "status", antes: t.status, depois: e.status });
  }
  if (e.prioridade && e.prioridade !== t.prioridade) {
    patch.prioridade = e.prioridade;
    alteracoes.push({ campo: "prioridade", antes: t.prioridade, depois: e.prioridade });
  }
  if (e.complexidade && e.complexidade !== t.complexidade) {
    patch.complexidade = e.complexidade;
    alteracoes.push({
      campo: "complexidade",
      antes: t.complexidade ?? undefined,
      depois: e.complexidade,
    });
  }

  if (projetoNovo && projetoNovo.id !== t.projeto_id) {
    patch.projeto_id = projetoNovo.id;
    alteracoes.push({ campo: "projeto", antes: t.projeto_id ?? undefined, depois: projetoNovo.id });
  }
  if (e.remover_projeto && t.projeto_id) {
    patch.projeto_id = null;
    alteracoes.push({ campo: "projeto", antes: t.projeto_id });
  }

  const argumentos = {
    campos: alteracoes.map((a) => a.campo),
    titulo: patch.titulo as string | undefined,
    descricao_len: typeof patch.descricao === "string" ? patch.descricao.length : undefined,
    prazo: e.prazo ?? (e.remover_prazo ? "remover" : undefined),
    status: e.status,
    prioridade: e.prioridade,
    complexidade: e.complexidade,
    projeto_id: projetoNovo?.id ?? (e.remover_projeto ? "remover" : undefined),
  };

  // --- Concluir: as duas regras do APP que o banco não impõe ---
  if (patch.status === "Concluído") {
    const cargo = await cargoAtual(ctx);
    if (!cargo.ok) return semAuditoria(cargo.resposta);
    if (cargo.cargo !== "Admin") {
      return {
        resposta: erro(
          "Só quem tem cargo Admin pode concluir tarefas (regra do CRM). Nada foi alterado. " +
            "Sugira ao usuário pôr em 'Em Análise' ou pedir a um Admin.",
        ),
        auditoria: {
          resultado: "negado",
          tarefaId: t.id,
          argumentos,
          detalhe: "concluir exige cargo Admin",
        },
      };
    }
    if (temAnexos(t)) {
      return {
        resposta: erro(
          "Esta tarefa tem anexos: conclua pelo app, que apaga os anexos. Nada foi alterado.",
        ),
        auditoria: {
          resultado: "negado",
          tarefaId: t.id,
          argumentos,
          detalhe: "concluir tarefa com anexos",
        },
      };
    }
  }

  if (alteracoes.length === 0) {
    return {
      resposta: ok(
        `Nada mudou: a tarefa ${citar(t.titulo)} (id ${t.id}) já estava com esses valores.`,
        { resultado: "sem_mudanca", tarefa_id: t.id, alteracoes: [] },
      ),
      auditoria: { resultado: "sem_mudanca", tarefaId: t.id, argumentos },
    };
  }

  // .select("id") para saber se a linha foi mesmo alterada: USING que recusa
  // filtra em silêncio, sem erro, e sem isto pareceria sucesso.
  const up = await consultar(() =>
    supabase.from("tarefas").update(patch).eq("id", t.id).select("id"),
  );
  if (!up.ok) return recusaDoBanco(up, { tarefaId: t.id, argumentos });
  if (((up.dados ?? []) as unknown[]).length === 0) {
    return {
      resposta: erro("O CRM não permite essa alteração para a sua conta. Nada foi gravado."),
      auditoria: {
        resultado: "negado",
        tarefaId: t.id,
        argumentos,
        detalhe: "update afetou 0 linhas",
      },
    };
  }

  // --- resposta legível, com o valor anterior de cada campo ---
  const nomesProjeto = await mapaDeNomes(supabase, "projetos", "nome", [
    t.projeto_id,
    projetoNovo?.id,
  ]);
  const projeto = (id?: string) =>
    id ? rotulo(nomesProjeto.ok ? nomesProjeto.mapa.get(id) : undefined, 60, id) : "nenhum";

  const tituloAgora = typeof patch.titulo === "string" ? patch.titulo : t.titulo;
  const linhas = [`Tarefa ${citar(tituloAgora)} (id ${t.id}) atualizada:`];
  for (const a of alteracoes) {
    if (a.campo === "titulo") linhas.push(`- Título: ${citar(a.antes)} → ${citar(a.depois)}`);
    else if (a.campo === "descricao") {
      linhas.push(
        `- Descrição: substituída (antes: ${a.antes ?? "vazia"}; agora: ${a.depois ?? "vazia"})`,
      );
    } else if (a.campo === "prazo") {
      const aviso = e.prazo ? avisoDePrazo(e.prazo) : "";
      linhas.push(`- Prazo: ${dataBr(a.antes)} → ${dataBr(a.depois)}${aviso}`);
    } else if (a.campo === "projeto") {
      linhas.push(`- Projeto: ${projeto(a.antes)} → ${projeto(a.depois)}`);
    } else {
      const rotuloCampo = a.campo.charAt(0).toUpperCase() + a.campo.slice(1);
      linhas.push(`- ${rotuloCampo}: ${a.antes ?? "vazio"} → ${a.depois ?? "vazio"}`);
    }
  }
  if (patch.status === "Em Análise") {
    linhas.push(
      "",
      `O CRM manda ${CANAL_DE_AVISO} a todos os Admins avisando que a tarefa entrou em análise.`,
    );
  }
  if (descricaoAnterior) {
    // A descrição anterior volta inteira (até 2000) para dar como desfazer:
    // não há histórico de descrição no CRM.
    linhas.push("", "Descrição anterior (texto do usuário, para desfazer se preciso):");
    linhas.push(citarBloco(descricaoAnterior));
  }
  linhas.push(rodapeDeDados());

  return {
    resposta: ok(linhas.join("\n"), { resultado: "atualizada", tarefa_id: t.id, alteracoes }),
    auditoria: { resultado: "ok", tarefaId: t.id, argumentos },
  };
}

// ==================================================== definir_responsaveis

const DESC_RESPONSAVEIS =
  "Adiciona e/ou remove responsáveis de UMA tarefa. Quem é adicionado recebe " +
  `${CANAL_DE_AVISO} de designação do CRM: avise o usuário disso. Remover não gera aviso. ` +
  "Pessoas por nome (mesmo parcial), id ou 'eu'; só pessoas ativas da equipe podem ser " +
  "adicionadas. Adicionar quem já é responsável, ou remover quem não é, não muda nada. " +
  "Se quem pede não é Admin nem Supervisor e adiciona um Admin, a tarefa deixa de ser " +
  "visível para essa pessoa. Precisa do id da tarefa (pegue com listar_tarefas)." +
  AVISO_ESCRITA;

export function registrarDefinirResponsaveis(server: McpServer, ctx: ContextoEscrita) {
  server.registerTool(
    "definir_responsaveis",
    {
      title: "Definir responsáveis",
      description: DESC_RESPONSAVEIS,
      inputSchema: z.object({
        tarefa_id: z.string().describe("O id (uuid) da tarefa, como devolvido por listar_tarefas."),
        adicionar: z
          .array(z.string().min(1))
          .max(10)
          .describe("Quem passa a ser responsável: nomes, ids ou 'eu'. Cada um recebe e-mail.")
          .optional(),
        remover: z
          .array(z.string().min(1))
          .max(10)
          .describe("Quem deixa de ser responsável: nomes, ids ou 'eu'.")
          .optional(),
      }),
      outputSchema: z.object({
        resultado: z.enum(["atualizada", "sem_mudanca", "parcial"]),
        tarefa_id: z.string(),
        adicionados: z.array(pessoaSaida()),
        removidos: z.array(pessoaSaida()),
        ignorados: z.array(z.string()),
        responsaveis_agora: z.array(pessoaSaida()),
      }),
      annotations: {
        title: "Definir responsáveis",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (entrada) =>
      executarEscrita(ctx, "definir_responsaveis", () => definirResponsaveis(ctx, entrada)),
  );
}

async function definirResponsaveis(
  ctx: ContextoEscrita,
  e: { tarefa_id: string; adicionar?: string[]; remover?: string[] },
): Promise<Desfecho> {
  const { supabase, meuId } = ctx;
  const adicionar = e.adicionar ?? [];
  const remover = e.remover ?? [];
  if (adicionar.length === 0 && remover.length === 0) {
    return semAuditoria(erro("Diga quem adicionar e/ou quem remover."));
  }

  const c = await carregarTarefa(ctx, e.tarefa_id);
  if (!c.ok) return semAuditoria(c.resposta);
  const t = c.tarefa;

  const lembrete = recusarSeLembrete(t);
  if (lembrete) return lembrete;

  const atuaisR = await responsaveisPorTarefa(supabase, [t.id]);
  if (!atuaisR.ok) return semAuditoria(atuaisR.resposta);
  const atuais = atuaisR.mapa.get(t.id) ?? [];

  // --- quem entra: pessoa ativa da equipe ---
  const entram = await resolverPessoasAtivas(ctx, adicionar);
  if (!entram.ok) return semAuditoria(entram.resposta);

  // --- quem sai: procurado entre os responsáveis ATUAIS ---
  // Não na equipe inteira: quem sai pode estar inativo, e o nome só precisa
  // ser único dentro desta tarefa.
  const ignorados: string[] = [];
  const saem: Array<{ id: string; nome: string }> = [];
  for (const v of remover) {
    let achados: Array<{ id: string; nome: string }>;
    if (ehEu(v)) achados = atuais.filter((p) => p.id === meuId);
    else if (ehUuid(v.trim())) achados = atuais.filter((p) => p.id === v.trim());
    else {
      const alvo = normalizar(v);
      const exatos = atuais.filter((p) => normalizar(p.nome) === alvo);
      achados =
        exatos.length > 0 ? exatos : atuais.filter((p) => normalizar(p.nome).includes(alvo));
    }

    if (achados.length === 0) {
      ignorados.push(`${citar(v, 40)} não é responsável por esta tarefa`);
    } else if (achados.length > 1) {
      const nomes = achados.map((p) => `${citar(p.nome, 40)} (id ${p.id})`).join("; ");
      return semAuditoria(
        erro(
          `${citar(v, 40)} casa com mais de um responsável: ${nomes}. Pergunte ao usuário qual.`,
        ),
      );
    } else if (!saem.some((p) => p.id === achados[0]!.id)) {
      saem.push(achados[0]!);
    }
  }

  const conflito = entram.pessoas.find((p) => saem.some((s) => s.id === p.id));
  if (conflito) {
    return semAuditoria(erro(`${citar(conflito.nome, 40)} aparece para adicionar e para remover.`));
  }

  const paraAdicionar = entram.pessoas.filter((p) => !atuais.some((a) => a.id === p.id));
  for (const p of entram.pessoas) {
    if (atuais.some((a) => a.id === p.id))
      ignorados.push(`${citar(p.nome, 40)} já era responsável`);
  }

  const argumentos = {
    adicionar: paraAdicionar.map((p) => p.id),
    remover: saem.map((p) => p.id),
  };
  const ids = [...paraAdicionar.map((p) => p.id), ...saem.map((p) => p.id)];

  const saida = (resultado: string, adicionados: Pessoa[], removidos: typeof saem) => ({
    resultado,
    tarefa_id: t.id,
    adicionados: adicionados.map((p) => ({ id: p.id, nome: p.nome })),
    removidos,
    ignorados,
    responsaveis_agora: [
      ...atuais.filter((a) => !removidos.some((r) => r.id === a.id)),
      ...adicionados.map((p) => ({ id: p.id, nome: p.nome })),
    ],
  });

  if (paraAdicionar.length === 0 && saem.length === 0) {
    return {
      resposta: ok(
        `Nada mudou nos responsáveis de ${citar(t.titulo)}. ${ignorados.join("; ")}.`,
        saida("sem_mudanca", [], []),
      ),
      auditoria: { resultado: "sem_mudanca", tarefaId: t.id, argumentos },
    };
  }

  // --- remove ANTES de adicionar ---
  // Ordem obrigatória: se um Admin entrasse primeiro, a tarefa viraria "de
  // Admin" e quem não é Admin não conseguiria mais remover ninguém dela.
  if (saem.length > 0) {
    const del = await consultar(() =>
      supabase
        .from("tarefa_responsaveis")
        .delete()
        .eq("tarefa_id", t.id)
        .in(
          "usuario_id",
          saem.map((p) => p.id),
        )
        .select("usuario_id"),
    );
    if (!del.ok) return recusaDoBanco(del, { tarefaId: t.id, ids, argumentos });
    if (((del.dados ?? []) as unknown[]).length === 0) {
      return {
        resposta: erro("O CRM não permite essa alteração para a sua conta. Nada foi gravado."),
        auditoria: {
          resultado: "negado",
          tarefaId: t.id,
          ids,
          argumentos,
          detalhe: "delete afetou 0 linhas",
        },
      };
    }
  }

  // Todos num INSERT só: ver o comentário em criarTarefa.
  if (paraAdicionar.length > 0) {
    const ins = await consultar(() =>
      supabase
        .from("tarefa_responsaveis")
        .insert(paraAdicionar.map((p) => ({ tarefa_id: t.id, usuario_id: p.id }))),
    );
    if (!ins.ok) {
      if (saem.length === 0) return recusaDoBanco(ins, { tarefaId: t.id, ids, argumentos });
      return {
        resposta: ok(
          `ATENÇÃO: removi ${saem.map((p) => citar(p.nome, 40)).join(", ")} da tarefa ` +
            `${citar(t.titulo)}, mas NÃO consegui adicionar ` +
            `${paraAdicionar.map((p) => citar(p.nome, 40)).join(", ")}. Ninguém foi avisado. ` +
            "Tente adicionar de novo com definir_responsaveis.",
          saida("parcial", [], saem),
        ),
        auditoria: {
          resultado: "parcial",
          tarefaId: t.id,
          ids,
          argumentos,
          detalhe: `remocao ok, insercao falhou: ${ins.codigo ?? "?"}`,
        },
      };
    }
  }

  let visibilidade = "";
  if (paraAdicionar.some((p) => p.cargo === "Admin")) {
    const cargo = await cargoAtual(ctx);
    visibilidade = avisoDeVisibilidade(cargo.ok ? cargo.cargo : null, paraAdicionar);
  }

  const resultado = saida("atualizada", paraAdicionar, saem);
  const linhas = [`Responsáveis de ${citar(t.titulo)} (id ${t.id}) atualizados.`];
  if (paraAdicionar.length > 0) {
    linhas.push(`Adicionados: ${paraAdicionar.map((p) => citar(p.nome, 40)).join(", ")}.`);
  }
  if (saem.length > 0) {
    linhas.push(`Removidos: ${saem.map((p) => citar(p.nome, 40)).join(", ")} (sem aviso).`);
  }
  if (ignorados.length > 0) linhas.push(`Sem efeito: ${ignorados.join("; ")}.`);
  linhas.push(
    `Responsáveis agora: ${
      resultado.responsaveis_agora.length > 0
        ? resultado.responsaveis_agora.map((p) => citar(p.nome, 40)).join(", ")
        : "nenhum — a tarefa ficou sem responsável"
    }.`,
  );
  if (paraAdicionar.length > 0) linhas.push("", textoDeAviso(paraAdicionar) + visibilidade);
  linhas.push(rodapeDeDados());

  return {
    resposta: ok(linhas.join("\n"), resultado),
    auditoria: { resultado: "ok", tarefaId: t.id, ids, argumentos },
  };
}
