# gestaomde-mcp

Servidor MCP remoto do CRM, em Cloudflare Workers. Transporte Streamable HTTP em `/mcp`.

Estado: **etapa 1 de 6** — Worker mínimo com a ferramenta `whoami`, sem OAuth e sem
acesso a dados.

Próximas etapas: (2) OAuth 2.1 com login Supabase e consentimento, (3) ferramentas de
leitura sob RLS, (4) ferramentas de escrita com escopos e log de auditoria,
(5) rate limiting e revisão de segurança, (6) conector personalizado no Claude.

## Rodar local

```bash
npm install
cp .dev.vars.example .dev.vars   # opcional na etapa 1
npm run dev                      # http://127.0.0.1:8787
npm run typecheck
```

> O `--config wrangler.jsonc` nos scripts não é enfeite. O build do app principal
> grava `../.wrangler/deploy/config.json`, e sem o flag o wrangler encontra os dois
> configs e aborta com "these do not share the same base path".

## Testar

Com o MCP Inspector:

```bash
npm run inspector
# Transport: Streamable HTTP · URL: http://127.0.0.1:8787/mcp
```

Ou direto por HTTP:

```bash
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
```

Na etapa 1 o `whoami` responde `autenticado: false`. Depois da etapa 2 ele passa a
devolver o e-mail, o cargo e os escopos do usuário — é o teste mais rápido para
saber se o OAuth está de fato entregando os `props` ao servidor.

`GET /mcp` responde 405: serving é stateless, sem sessão nem SSE legado.
`GET /health` responde um JSON simples, útil para o healthcheck do Cloudflare.

## Rotas

| Rota      | Método | O que faz                      |
| --------- | ------ | ------------------------------ |
| `/mcp`    | POST   | Endpoint MCP (Streamable HTTP) |
| `/health` | GET    | Liveness                       |

## Deploy

```bash
npm run dry-run   # valida o bundle sem publicar
npm run deploy
```

Secrets (nenhum é obrigatório na etapa 1):

```bash
npx wrangler secret put SUPABASE_URL --config wrangler.jsonc
npx wrangler secret put SUPABASE_ANON_KEY --config wrangler.jsonc
```

## Notas de implementação

O briefing manda conferir a API dos pacotes antes de codar. O que está instalado aqui:

- `createMcpHandler` de `agents/mcp/server` é um alias de `createStatelessMcpHandler`.
  Assinatura: `(factory, options?)`, onde `factory: (ctx: McpRequestContext) => McpServer`.
  Opções usadas: `route`, `onerror`. Também aceita `authContext: { props }` — é por aí
  que a identidade do OAuthProvider entra na etapa 2.
- `McpServer` e `createMcpHandler` também são exportados por `@modelcontextprotocol/server`.
  Usamos o de `agents/mcp/server` porque é o wrapper de Worker, com validação de
  `Host`/`Origin` e CORS.
- Registro de ferramenta é `server.registerTool(name, config, cb)`, com `inputSchema`
  e `outputSchema` em zod (v4). A forma `tool()` antiga está deprecada.
- O handler é construído dentro do `fetch` porque `env` só existe ali — e porque na
  etapa 2 o `authContext` muda a cada requisição.
