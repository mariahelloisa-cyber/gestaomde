import { createMcpHandler } from "agents/mcp/server";
import type { Env } from "./env";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./mcp/server";

/**
 * Etapa 1: Streamable HTTP em /mcp, sem OAuth. Qualquer um que alcançar a URL
 * fala com o servidor, então não registre aqui nada que toque dados do CRM
 * antes da etapa 2 — o `whoami` só devolve metadados.
 *
 * O handler é construído por requisição porque `env` só existe dentro do
 * `fetch`. Na etapa 2 isso deixa de ser só conveniência: o `authContext` muda
 * a cada usuário e precisa ser passado aqui.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") {
      return Response.json({ ok: true, servidor: SERVER_NAME, versao: SERVER_VERSION });
    }

    if (pathname === "/mcp") {
      const handler = createMcpHandler(() => createServer(env), {
        route: "/mcp",
        onerror: (error) => console.error("[mcp]", error.message),
      });
      return handler(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
