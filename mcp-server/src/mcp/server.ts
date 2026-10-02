import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import type { Env } from "../env";

export const SERVER_NAME = "gestaomde-crm";
export const SERVER_VERSION = "0.1.0";

const whoamiOutput = z.object({
  servidor: z.string(),
  versao: z.string(),
  autenticado: z.boolean(),
  usuario: z
    .object({
      id: z.string().nullable(),
      email: z.string().nullable(),
      cargo: z.string().nullable(),
    })
    .nullable(),
  escopos: z.array(z.string()),
  supabase_configurado: z.boolean(),
});

/**
 * Monta uma instância do servidor MCP. O `createMcpHandler` chama isto uma vez
 * por requisição HTTP, então nada aqui deve guardar estado entre chamadas.
 *
 * A identidade do usuário vem de `getMcpAuthContext()`, que o OAuthProvider
 * preenche a partir dos `props` do token (etapa 2). Na etapa 1 ela vem vazia e
 * o `whoami` responde `autenticado: false` — é exatamente esse contraste que o
 * MCP Inspector precisa mostrar para provar que a etapa 2 funcionou.
 */
export function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "whoami",
    {
      title: "Quem sou eu",
      description:
        "Mostra qual usuário do CRM está conectado a este servidor MCP, com os escopos concedidos. Use para confirmar a conexão ou quando o usuário perguntar com qual conta está autenticado.",
      inputSchema: z.object({}),
      outputSchema: whoamiOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const props = getMcpAuthContext()?.props;

      const output = whoamiOutput.parse({
        servidor: SERVER_NAME,
        versao: SERVER_VERSION,
        autenticado: props != null,
        usuario: props
          ? {
              id: asText(props.userId),
              email: asText(props.email),
              cargo: asText(props.role),
            }
          : null,
        escopos: asScopes(props?.scope),
        supabase_configurado: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY),
      });

      return {
        content: [{ type: "text", text: descrever(output) }],
        structuredContent: output,
      };
    },
  );

  return server;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((s): s is string => typeof s === "string");
  if (typeof value === "string") return value.split(" ").filter(Boolean);
  return [];
}

/** Texto curto e legível: o modelo lê isto, não o JSON. */
function descrever(o: z.infer<typeof whoamiOutput>): string {
  const linhas = [`Servidor ${o.servidor} v${o.versao}.`];

  if (!o.autenticado) {
    linhas.push("Nenhum usuário autenticado: este servidor ainda roda sem OAuth (etapa 1).");
  } else {
    const u = o.usuario;
    linhas.push(
      `Conectado como ${u?.email ?? "e-mail desconhecido"}` +
        (u?.cargo ? ` (${u.cargo})` : "") +
        (u?.id ? `, id ${u.id}` : "") +
        ".",
    );
    linhas.push(
      o.escopos.length ? `Escopos: ${o.escopos.join(", ")}.` : "Nenhum escopo concedido.",
    );
  }

  linhas.push(
    o.supabase_configurado
      ? "Supabase configurado."
      : "Supabase ainda não configurado: nenhuma ferramenta de dados disponível.",
  );

  return linhas.join(" ");
}
