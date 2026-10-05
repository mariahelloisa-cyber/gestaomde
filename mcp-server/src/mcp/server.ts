import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { criarClienteComJwt } from "../auth/supabase";
import type { Env } from "../env";
import { registrarBuscarClientes, registrarVerCliente } from "./ferramentas/clientes";
import { registrarLinks } from "./ferramentas/links";
import { registrarProjetos } from "./ferramentas/projetos";
import {
  registrarListarTarefas,
  registrarResumoDoDia,
  registrarVerTarefa,
} from "./ferramentas/tarefas";
import { consultar, MENSAGEM_SESSAO_EXPIRADA } from "./sessao";

export const SERVER_NAME = "gestaomde-crm";
export const SERVER_VERSION = "0.2.0";

/** O que o AuthHandler guardou em `props` no completeAuthorization. */
export interface PropsUsuario {
  userId: string;
  email: string;
  cargo: string;
  sbAccess: string;
  sbRefresh: string;
}

/**
 * REGRA DE PORTABILIDADE: nada de `.nullable()` aqui.
 *
 * O Zod 4 traduz `z.string().nullable()` para `{"type":["string","null"]}`, e
 * array em `type` é justamente o que o Inspector acusa em "Schema
 * portability": é válido no draft 2020-12, mas OpenAPI 3.0 e vários geradores
 * de código recusam. O truque do `z.union([z.string(), z.null()])` NÃO resolve
 * — o Zod colapsa para o mesmo array.
 *
 * O que resolve é `.optional()`: sai `{"type":"string"}` e o campo apenas não
 * entra em `required`. Para um campo que só existe quando há login, "ausente"
 * descreve melhor do que "presente e nulo" — e `autenticado` e `sessaoCrm` já
 * dizem o porquê.
 */
const whoamiOutput = z.object({
  servidor: z.string(),
  versao: z.string(),
  autenticado: z.boolean(),
  /** Ausente quando não há login. */
  email: z.string().optional(),
  /** Ausente quando não há login. */
  cargo: z.string().optional(),
  escopos: z.array(z.string()),
  /** Se o JWT guardado nos props ainda é aceito pelo Supabase agora. */
  sessaoCrm: z.enum(["ativa", "expirada", "sem-login"]),
});

/**
 * Monta uma instância do servidor MCP para UMA requisição.
 *
 * `props` chega do OAuthProvider (ctx.props), já descriptografado. Vem null
 * quando não há token válido — o que na prática o OAuthProvider não deixa
 * acontecer na rota protegida, mas tratamos de todo jeito.
 *
 * Os escopos entram aqui para registro condicional de ferramenta: na etapa 4,
 * as de crm:write só são registradas se o token tiver esse escopo, para o
 * Claude nem ver o que não pode usar.
 */
export function createServer(env: Env, props: PropsUsuario | null, escopos: string[]): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "whoami",
    {
      title: "Quem sou eu",
      description:
        "Mostra com qual conta do CRM o assistente está conectado, o cargo dessa pessoa, as permissões concedidas e se a sessão com o CRM ainda está válida. Use para confirmar a conexão, quando o usuário perguntar com qual conta está autenticado, ou quando outra ferramenta disser que a sessão expirou.",
      inputSchema: z.object({}),
      outputSchema: whoamiOutput,
      // As quatro, e não só readOnlyHint: no spec do MCP, `destructiveHint` e
      // `openWorldHint` têm default TRUE, e `idempotentHint` default FALSE.
      // Declarar só readOnlyHint deixa a ferramenta anunciada como destrutiva
      // por omissão, e é daí que vem o triângulo de aviso no Inspector.
      annotations: {
        title: "Quem sou eu",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      // O whoami toca o banco de propósito: é o diagnóstico mais rápido para
      // "o conector está conectado mas nada funciona". Um token MCP válido
      // pode carregar um JWT do Supabase já morto — se o grant foi revogado
      // mas o access token ainda não venceu, ou se a conta foi desativada e o
      // eh_equipe_interna passou a devolver false. Sem esta consulta o whoami
      // responderia "conectado como você" numa sessão que não lê nada.
      const sessaoCrm = props ? await conferirSessao(env, props) : "sem-login";

      const saida = whoamiOutput.parse({
        servidor: SERVER_NAME,
        versao: SERVER_VERSION,
        autenticado: props != null,
        // `undefined` some do JSON; `null` viraria schema não portável.
        email: props?.email || undefined,
        cargo: props?.cargo || undefined,
        escopos,
        sessaoCrm,
      });

      return {
        content: [{ type: "text", text: descrever(saida) }],
        structuredContent: saida,
        // isError na sessão expirada: o modelo precisa saber que a chamada não
        // entregou o que devia, senão ele trata a mensagem como informação
        // solta e segue chamando as outras ferramentas.
        ...(sessaoCrm === "expirada" ? { isError: true } : {}),
      };
    },
  );

  // Etapa 3: as ferramentas de LEITURA.
  //
  // Condicionadas a crm:read e a haver props: sem token não há JWT, e sem JWT
  // não há como consultar nada — registrar as ferramentas assim mostraria ao
  // modelo um ferramental que falharia em toda chamada.
  //
  // O cliente é criado UMA vez por requisição e compartilhado pelas sete. Ele
  // carrega o JWT do usuário, então toda consulta passa pelo RLS: quem decide o
  // que aparece é o banco, não este código.
  if (props && escopos.includes("crm:read")) {
    const supabase = criarClienteComJwt(env, props.sbAccess);

    registrarBuscarClientes(server, supabase);
    registrarVerCliente(server, supabase);
    registrarListarTarefas(server, supabase, props.userId);
    registrarVerTarefa(server, supabase);
    registrarResumoDoDia(server, supabase, props.userId);
    registrarProjetos(server, supabase);
    registrarLinks(server, supabase);
  }

  // Etapa 4 registra as de escrita, condicionadas a escopos.includes("crm:write").

  return server;
}

/**
 * Consulta mais barata possível que ainda exige JWT válido E passa pelo RLS:
 * a própria linha de perfis_usuarios.
 *
 * Linha ausente conta como expirada, não como ativa: se o RLS não devolve nem o
 * próprio perfil, ou o JWT morreu ou a conta deixou de ser equipe interna, e
 * nos dois casos a saída para o usuário é a mesma — reconectar.
 */
async function conferirSessao(env: Env, props: PropsUsuario): Promise<"ativa" | "expirada"> {
  const r = await consultar(() =>
    criarClienteComJwt(env, props.sbAccess)
      .from("perfis_usuarios")
      .select("id")
      .eq("id", props.userId)
      .maybeSingle(),
  );

  if (!r.ok || !r.dados) return "expirada";
  return "ativa";
}

/** Texto curto e legível: é o que o modelo lê, não o JSON. */
function descrever(o: z.infer<typeof whoamiOutput>): string {
  if (!o.autenticado) {
    return `Servidor ${o.servidor} v${o.versao}. Nenhum usuário autenticado.`;
  }
  if (o.sessaoCrm === "expirada") {
    return MENSAGEM_SESSAO_EXPIRADA;
  }
  const quem = o.email ?? "e-mail desconhecido";
  const cargo = o.cargo ? ` (${o.cargo})` : "";
  const perms = o.escopos.length ? o.escopos.join(", ") : "nenhuma";
  return `Conectado ao CRM como ${quem}${cargo}. Permissões: ${perms}.`;
}
