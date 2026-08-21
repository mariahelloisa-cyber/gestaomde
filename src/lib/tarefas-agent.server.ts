import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const STATUS_VALIDOS = ["Pendente", "Em Progresso", "Em Análise", "Concluído"] as const;
const PRIORIDADES_VALIDAS = ["Alta", "Média", "Baixa", "Nenhuma"] as const;

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurado.");
  return new Anthropic({ apiKey });
}

type Resolvido = { ok: true; id: string; nome: string } | { ok: false; erro: string };

async function resolverResponsavel(nomeBusca: string): Promise<Resolvido> {
  const { data, error } = await supabaseAdmin
    .from("perfis_usuarios")
    .select("id, nome")
    .ilike("nome", `%${nomeBusca}%`);
  if (error) return { ok: false, erro: `Erro ao buscar responsável: ${error.message}` };
  if (!data || data.length === 0) {
    return { ok: false, erro: `Nenhum responsável encontrado com o nome "${nomeBusca}".` };
  }
  if (data.length > 1) {
    return {
      ok: false,
      erro: `Mais de um responsável encontrado para "${nomeBusca}": ${data.map((d) => d.nome).join(", ")}. Pergunte ao usuário qual deles.`,
    };
  }
  return { ok: true, id: data[0].id, nome: data[0].nome };
}

async function resolverCliente(nomeBusca: string): Promise<Resolvido> {
  const { data, error } = await supabaseAdmin
    .from("clientes")
    .select("id, nome_empresa")
    .ilike("nome_empresa", `%${nomeBusca}%`);
  if (error) return { ok: false, erro: `Erro ao buscar cliente: ${error.message}` };
  if (!data || data.length === 0) {
    return { ok: false, erro: `Nenhum cliente encontrado com o nome "${nomeBusca}".` };
  }
  if (data.length > 1) {
    return {
      ok: false,
      erro: `Mais de um cliente encontrado para "${nomeBusca}": ${data.map((d) => d.nome_empresa).join(", ")}. Pergunte ao usuário qual deles.`,
    };
  }
  return { ok: true, id: data[0].id, nome: data[0].nome_empresa };
}

const criarTarefaTool = betaTool({
  name: "criar_tarefa",
  description: "Cria uma nova tarefa no sistema, atribuída a um responsável.",
  inputSchema: {
    type: "object",
    properties: {
      titulo: { type: "string", description: "Título curto da tarefa" },
      descricao: { type: "string", description: "Descrição adicional, se mencionada" },
      responsavel_nome: { type: "string", description: "Nome (ou parte do nome) do responsável pela tarefa" },
      prazo: { type: "string", description: "Prazo/vencimento em ISO 8601 (ex: 2026-08-25), se mencionado" },
      prioridade: { type: "string", enum: PRIORIDADES_VALIDAS, description: "Prioridade da tarefa" },
      cliente_nome: {
        type: "string",
        description:
          "Nome da EMPRESA cliente relacionada, apenas se o usuário mencionar explicitamente um cliente. NUNCA preencha este campo com o nome do responsável — deixe de fora se nenhum cliente for citado.",
      },
    },
    required: ["titulo", "responsavel_nome"],
  } as const,
  run: async (input) => {
    const responsavel = await resolverResponsavel(input.responsavel_nome);
    if (!responsavel.ok) return responsavel.erro;

    // Resolução de cliente é best-effort: se falhar, a tarefa ainda é criada
    // (o cliente é informação secundária, não deve bloquear a ação principal).
    let cliente_id: string | null = null;
    let avisoCliente = "";
    if (input.cliente_nome) {
      const cliente = await resolverCliente(input.cliente_nome);
      if (cliente.ok) {
        cliente_id = cliente.id;
      } else {
        avisoCliente = ` (obs: ${cliente.erro})`;
      }
    }

    const { data: tarefa, error } = await supabaseAdmin
      .from("tarefas")
      .insert({
        titulo: input.titulo,
        descricao: input.descricao ?? null,
        data_vencimento: input.prazo ?? null,
        prioridade: input.prioridade ?? "Nenhuma",
        cliente_id,
      })
      .select("id, titulo")
      .single();
    if (error || !tarefa) return `Erro ao criar tarefa: ${error?.message ?? "desconhecido"}`;

    const { error: errResp } = await supabaseAdmin
      .from("tarefa_responsaveis")
      .insert({ tarefa_id: tarefa.id, usuario_id: responsavel.id });
    if (errResp) return `Tarefa criada, mas houve erro ao designar o responsável: ${errResp.message}`;

    return `Tarefa "${tarefa.titulo}" criada com sucesso, atribuída a ${responsavel.nome}.${avisoCliente}`;
  },
});

const consultarTarefasTool = betaTool({
  name: "consultar_tarefas",
  description: "Consulta tarefas existentes, com filtros opcionais por responsável, status ou cliente.",
  inputSchema: {
    type: "object",
    properties: {
      responsavel_nome: { type: "string", description: "Filtrar pelo nome do responsável" },
      status: { type: "string", enum: STATUS_VALIDOS, description: "Filtrar pelo status" },
      cliente_nome: { type: "string", description: "Filtrar pelo nome do cliente" },
    },
    required: [],
  } as const,
  run: async (input) => {
    let query = supabaseAdmin
      .from("tarefas")
      .select("titulo, status, prioridade, data_vencimento, tarefa_responsaveis(perfis_usuarios(nome))")
      .order("data_vencimento", { ascending: true })
      .limit(15);

    if (input.status) query = query.eq("status", input.status);

    if (input.cliente_nome) {
      const cliente = await resolverCliente(input.cliente_nome);
      if (!cliente.ok) return cliente.erro;
      query = query.eq("cliente_id", cliente.id);
    }

    const { data, error } = await query;
    if (error) return `Erro ao consultar tarefas: ${error.message}`;
    if (!data || data.length === 0) return "Nenhuma tarefa encontrada com esses filtros.";

    type Linha = {
      titulo: string;
      status: string;
      prioridade: string;
      data_vencimento: string | null;
      tarefa_responsaveis: Array<{ perfis_usuarios: { nome: string } | null }>;
    };
    let linhas = data as unknown as Linha[];

    if (input.responsavel_nome) {
      const alvo = input.responsavel_nome.toLowerCase();
      linhas = linhas.filter((t) =>
        t.tarefa_responsaveis.some((r) => r.perfis_usuarios?.nome.toLowerCase().includes(alvo)),
      );
      if (linhas.length === 0) {
        return `Nenhuma tarefa encontrada para responsável contendo "${input.responsavel_nome}".`;
      }
    }

    return linhas
      .map((t) => {
        const responsaveis =
          t.tarefa_responsaveis.map((r) => r.perfis_usuarios?.nome).filter(Boolean).join(", ") ||
          "sem responsável";
        const prazo = t.data_vencimento
          ? new Date(t.data_vencimento).toLocaleDateString("pt-BR")
          : "sem prazo";
        return `• ${t.titulo} — ${t.status} — ${responsaveis} — prazo: ${prazo}`;
      })
      .join("\n");
  },
});

const atualizarStatusTarefaTool = betaTool({
  name: "atualizar_status_tarefa",
  description: "Atualiza o status de uma tarefa existente, buscando pelo título (ou parte dele).",
  inputSchema: {
    type: "object",
    properties: {
      titulo_busca: { type: "string", description: "Título ou parte do título da tarefa a atualizar" },
      novo_status: { type: "string", enum: STATUS_VALIDOS },
    },
    required: ["titulo_busca", "novo_status"],
  } as const,
  run: async (input) => {
    const { data, error } = await supabaseAdmin
      .from("tarefas")
      .select("id, titulo")
      .ilike("titulo", `%${input.titulo_busca}%`);
    if (error) return `Erro ao buscar tarefa: ${error.message}`;
    if (!data || data.length === 0) {
      return `Nenhuma tarefa encontrada com título contendo "${input.titulo_busca}".`;
    }
    if (data.length > 1) {
      return `Mais de uma tarefa encontrada: ${data.map((t) => t.titulo).join(", ")}. Pergunte ao usuário qual delas.`;
    }

    const { error: errUpdate } = await supabaseAdmin
      .from("tarefas")
      .update({ status: input.novo_status })
      .eq("id", data[0].id);
    if (errUpdate) return `Erro ao atualizar status: ${errUpdate.message}`;

    return `Tarefa "${data[0].titulo}" atualizada para status "${input.novo_status}".`;
  },
});

/** Remove resquícios de markdown que o Claude eventualmente escreva, já que o Telegram não os renderiza. */
function removerMarkdown(texto: string): string {
  return texto
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/`([^`]*)`/g, "$1");
}

export type HistoricoMensagem = { role: "user" | "assistant"; content: string };

/**
 * Roda o agente de tarefas dado o histórico da conversa (mensagens anteriores +
 * a nova mensagem do usuário como último item) e devolve a resposta final em texto.
 * O histórico é necessário porque cada chamada roda numa function serverless sem
 * estado — sem ele, o bot não lembra de perguntas de esclarecimento que ele mesmo fez.
 */
export async function runTarefasAgent(historico: HistoricoMensagem[]): Promise<string> {
  const client = getClient();
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const finalMessage = await client.beta.messages.toolRunner({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: [
      "Você é um assistente que gerencia tarefas de uma agência via Telegram.",
      `Hoje é ${hoje} (use como referência para prazos relativos como "amanhã" ou "sexta").`,
      "Sempre responda em português, de forma curta e direta — é uma mensagem de chat, não um e-mail.",
      "Não use formatação markdown (nada de **negrito**, listas com *, ou #títulos) — o Telegram não renderiza isso, escreva em texto simples. Para listas, use um traço \"-\" no início da linha.",
      "Se uma ferramenta retornar erro dizendo que há mais de um resultado (responsável, cliente ou tarefa ambíguos), pergunte ao usuário qual ele quis dizer em vez de adivinhar.",
      "As mensagens anteriores desta conversa estão incluídas como histórico — use-as para entender respostas curtas de esclarecimento (ex: se você perguntou qual tarefa e o usuário respondeu só o nome dela, una o nome com o pedido original).",
      "Nunca invente dados que não vieram das ferramentas.",
    ].join(" "),
    messages: historico,
    tools: [criarTarefaTool, consultarTarefasTool, atualizarStatusTarefaTool],
  });

  const textBlocks = finalMessage.content.filter(
    (b): b is Anthropic.Beta.BetaTextBlock => b.type === "text",
  );
  const texto = textBlocks.map((b) => b.text).join("\n").trim();
  return removerMarkdown(texto) || "Não consegui gerar uma resposta.";
}
