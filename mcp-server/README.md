# gestaomde-mcp

Servidor MCP remoto do CRM, em Cloudflare Workers. Transporte Streamable HTTP em `/mcp`.

Estado: **etapa 3 de 6** — OAuth 2.1 completo e sete ferramentas de LEITURA sob RLS.
Nada escreve no CRM ainda.

Próximas etapas: (4) ferramentas de escrita com escopos e log de auditoria, (5) revisão
de segurança final, (6) conector personalizado no Claude.

## Ferramentas

Todas são de leitura, registradas só quando o token tem `crm:read`, e toda consulta usa
o JWT do usuário — quem decide o que aparece é o RLS, não este código.

| Ferramenta        | Para que serve                                                       |
| ----------------- | -------------------------------------------------------------------- |
| `whoami`          | Com qual conta está conectado e se a sessão com o CRM está viva      |
| `buscar_clientes` | Clientes por nome, e-mail ou documento                               |
| `ver_cliente`     | Um cliente + contagem de tarefas, atrasadas e projetos envolvidos    |
| `listar_tarefas`  | Tarefas com filtros, atrasadas primeiro                              |
| `ver_tarefa`      | Uma tarefa inteira: descrição, checklist, responsáveis e comentários |
| `listar_projetos` | Projetos com contagem de tarefas por status                          |
| `buscar_links`    | Pastas de links salvos e as URLs dentro delas                        |
| `resumo_do_dia`   | Atrasadas, vencem hoje, próximos 7 dias e em análise, com amostra    |

Decisões que valem saber antes de mexer:

- **`listar_tarefas` esconde concluídas e lembretes por padrão.** A ordem pedida é
  "atrasadas primeiro, depois prazo mais próximo", e isso é `data_vencimento` crescente.
  Uma tarefa de janeiro já concluída tem data pequena e subiria ao topo da lista de
  urgências. `incluir_concluidas` e `incluir_lembretes` destravam.
- **Não existe `ver_projeto`.** A tabela `projetos` só tem id, nome e data de criação —
  um detalhe dela não teria o que mostrar além das tarefas, que `listar_tarefas` já dá.
- **`ver_cliente` diz se existe contrato, não dá o arquivo.** `contrato_url` é path do
  bucket privado `contratos`; virar signed URL seria distribuir o contrato numa conversa.
- **`buscar_links` não acha link por título**, porque link não tem título no schema: só
  `url`. A busca olha nome da pasta, comentário da pasta e o texto da URL.
- **Nome de pessoa, cliente ou projeto aceita busca parcial**, e ambiguidade é ERRO com
  pedido de desambiguação — nunca um palpite. `responsavel: "minhas"` é o atalho para o
  próprio usuário.
- **Filtro por responsável usa join (`tarefa_responsaveis!inner`)**, não lista de ids na
  URL: 500 tarefas dariam ~18 KB de query string e a requisição morreria no limite de
  URL, justamente para quem tem mais trabalho.

## Rodar local

```bash
npm install
cp .dev.vars.example .dev.vars   # preencha SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY
npm run dev                      # http://127.0.0.1:8787
npm run typecheck
```

> O `--config wrangler.jsonc` nos scripts não é enfeite. O build do app principal
> grava `../.wrangler/deploy/config.json`, e sem o flag o wrangler encontra os dois
> configs e aborta com "these do not share the same base path".

Antes do primeiro `npm run dev`, crie o KV e cole os ids no `wrangler.jsonc`:

```bash
npx wrangler kv namespace create OAUTH_KV --config wrangler.jsonc
npx wrangler kv namespace create OAUTH_KV --preview --config wrangler.jsonc
```

## Segurança do fluxo OAuth

Quatro travas, que vale conhecer antes de mexer:

| Trava                                         | Onde                     |
| --------------------------------------------- | ------------------------ |
| Só equipe interna ATIVA autoriza              | `auth/supabase.ts` + RLS |
| Lista branca de `redirect_uri` no `/register` | `auth/clientes.ts`       |
| Rate limiting de login e de registro          | `auth/limites.ts`        |
| Login guardado amarrado ao pedido OAuth       | `auth/handler.ts`        |

A elegibilidade é reconferida **a cada refresh de token** (`index.ts`,
`tokenExchangeCallback`): quem é desativado no CRM perde o grant na renovação
seguinte, no máximo uma hora depois. No banco, quem corta o acesso a dado é
`eh_equipe_interna()`, que exige conta ativa desde a migration
`20261002210000_eh_equipe_interna_exige_ativo.sql`.

## Testar com o MCP Inspector

O Inspector roda em `localhost`, e `localhost` **não** está na lista branca de
`redirect_uri`. Para ele conseguir se registrar, o `.dev.vars` precisa ter:

```
PERMITIR_REDIRECT_LOCAL="1"
```

Esse secret existe só em dev. Em produção ele não deve ser criado.

```bash
# terminal 1
npm run dev

# terminal 2
npm run inspector
```

No Inspector:

1. Transport: **Streamable HTTP** · URL: `http://127.0.0.1:8787/mcp`
2. **Connect**. Ele descobre o servidor de autorização, registra um cliente em
   `/register` e abre `/authorize` no navegador.
3. Entre com uma conta do CRM. A tela de consentimento mostra, em destaque, **o
   domínio para onde o acesso vai** — no Inspector é `127.0.0.1`, com o aviso de
   destino local.
4. **Permitir**. O Inspector volta com um token e lista as ferramentas.
5. Rode `whoami`: deve vir `autenticado: true`, seu e-mail, seu cargo,
   `escopos: ["crm:read","crm:write"]` e `sessaoCrm: "ativa"`.
6. Com `crm:read` no token, as outras sete aparecem na lista. Roteiro curto:

   | Ferramenta        | Entrada de teste                  | O que conferir                                             |
   | ----------------- | --------------------------------- | ---------------------------------------------------------- |
   | `resumo_do_dia`   | `{}`                              | Grupos atrasadas / hoje / 7 dias / em análise; datas dd/mm |
   | `listar_tarefas`  | `{}`                              | Atrasadas no topo, marcadas `(ATRASADA)`; sem concluídas   |
   | `listar_tarefas`  | `{"responsavel":"minhas"}`        | Só as suas                                                 |
   | `listar_tarefas`  | `{"responsavel":"ma"}`            | Se der mais de um nome, erro pedindo para escolher         |
   | `listar_tarefas`  | `{"atrasadas":true,"limite":5}`   | Só atrasadas; linha de paginação com `offset`              |
   | `ver_tarefa`      | um `id` da lista acima            | Checklist, responsáveis, comentários; texto entre `« »`    |
   | `buscar_clientes` | `{"busca":"a"}`                   | `tem_contrato` true/false, nenhuma URL de contrato         |
   | `ver_cliente`     | nome de um cliente                | Contagem por status e projetos envolvidos                  |
   | `listar_projetos` | `{}`                              | Contagem de tarefas e atrasadas por projeto                |
   | `buscar_links`    | `{}` e depois `{"busca":"drive"}` | Pastas com as URLs dentro                                  |

   Em toda resposta, confira no fim a frase que diz que o texto entre `« »` é dado e não
   instrução — e que nenhuma ferramenta mostra triângulo de aviso na lista.

O Inspector não manda `scope` nenhum no pedido de autorização. Quando isso
acontece, o servidor aplica o padrão — todos os escopos que ele oferece —, e é
esse conjunto que a tela de consentimento lista e que o grant recebe. Cliente
que manda `scope` recebe só a interseção com `scopes_supported`; cliente que
manda apenas escopos desconhecidos recebe erro, em vez de cair no padrão.

`whoami` consulta o banco de propósito: `sessaoCrm` é o jeito mais rápido de saber se
o JWT do Supabase guardado no grant ainda vale. Se vier `expirada`, a resposta é a
mensagem única de reconexão.

## Testar as travas de segurança

Com `npm run dev` rodando. Nenhum destes depende do Inspector.

```bash
# 1) /register recusa redirect_uri que nao e do Claude -> 403 access_denied
curl -si -X POST http://127.0.0.1:8787/register \
  -H 'Content-Type: application/json' \
  -d '{"client_name":"Claude","redirect_uris":["https://atacante.example/callback"]}' \
  | head -20

# 2) /register aceita o callback real do Claude -> 201 com client_id
curl -s -X POST http://127.0.0.1:8787/register \
  -H 'Content-Type: application/json' \
  -d '{"client_name":"Claude","redirect_uris":["https://claude.ai/api/mcp/auth_callback"]}'

# 3) Rate limit do /register: 20 por hora por IP. Da 21a em diante responde 429.
for i in $(seq 1 22); do
  curl -s -o /dev/null -w "$i: %{http_code}\n" -X POST http://127.0.0.1:8787/register \
    -H 'Content-Type: application/json' \
    -d '{"client_name":"t","redirect_uris":["https://claude.ai/api/mcp/auth_callback"]}'
done

# 5) /health
curl -s http://127.0.0.1:8787/health
```

O limite de login (5 falhas por e-mail em 15 min, 10 por IP em 10 min) se testa na
tela: abra `/authorize` pelo Inspector, erre a senha seis vezes e veja a mensagem
trocar de "E-mail ou senha inválidos." para "Muitas tentativas, tente em alguns
minutos.".

Para zerar os contadores no meio dos testes, apague as chaves `rl:` do KV local. Em
`wrangler dev` elas ficam em `.wrangler/state`, e sobrevivem a um restart:

```bash
npx wrangler kv key list --binding OAUTH_KV --preview --local --config wrangler.jsonc \
  | grep '"rl:'
npx wrangler kv key delete --binding OAUTH_KV --preview --local --config wrangler.jsonc \
  "rl:register_ip:<hash>"
```

Sem `cf-connecting-ip` (que é o caso em `wrangler dev`), o IP vira a string `sem-ip`,
cujo hash é `12ca17b49af2289436f303e0166030a21e525d266e209267433801a8fd4071a0` — ou
seja, em dev todos os testes dividem o mesmo contador.

### Testar a reconferência de elegibilidade

É o teste do item 1 da revisão, e precisa de um refresh de token:

1. Conecte pelo Inspector e confirme o `whoami`.
2. No CRM, desative esse usuário (status `inativo`).
3. No Inspector, force um refresh (reconectar sem reautorizar, ou esperar a hora do
   `accessTokenTTL`). O `/token` responde `invalid_grant` e o grant é revogado.
4. Enquanto o access token antigo ainda vale, `whoami` responde
   `Sua sessão expirou. Reconecte o CRM nas configurações de conectores do Claude.`

## Rotas

| Rota                                      | Método   | O que faz                       |
| ----------------------------------------- | -------- | ------------------------------- |
| `/mcp`                                    | POST     | Endpoint MCP (Streamable HTTP)  |
| `/authorize`                              | GET/POST | Login + consentimento           |
| `/token`                                  | POST     | Token e revogação (do provider) |
| `/register`                               | POST     | DCR, com lista branca           |
| `/health`                                 | GET      | Liveness                        |
| `/.well-known/oauth-protected-resource`   | GET      | RFC 9728 (do provider)          |
| `/.well-known/oauth-authorization-server` | GET      | RFC 8414 (do provider)          |

`GET /mcp` responde 405: serving é stateless, sem sessão nem SSE legado.

## Deploy

O passo a passo completo está em [DEPLOY.md](DEPLOY.md): KV de produção, secrets, as
duas opções de URL, checklist pós-deploy, como adicionar no Claude e como desligar
rápido.

Antes de qualquer deploy:

```bash
npm run verificar   # typecheck + testes do formato + portabilidade + dry-run
```

```bash
npm run dry-run   # valida o bundle sem publicar
npm run deploy
```

Depois de publicar, verifique (Windows/PowerShell, sem curl):

```powershell
npm run verificar-producao -- https://gestaomde-mcp.SEU-SUBDOMINIO.workers.dev
```

Node puro, sem dependência: roda as 9 verificações pós-deploy, mostra tabela OK/FALHOU
com esperado e obtido, e lista os `client_id` de teste criados com o comando pronto para
apagar cada um. Sai com código 1 se algo falhar.

Secrets:

```bash
npx wrangler secret put SUPABASE_URL --config wrangler.jsonc
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY --config wrangler.jsonc
```

A service role **não** entra aqui: toda leitura passa pelo RLS com o JWT do usuário.
E `PERMITIR_REDIRECT_LOCAL` não deve ser criado em produção — o `/health` em produção
tem que responder `redirect_local: "desligado"`.

## Notas de implementação

O briefing manda conferir a API dos pacotes antes de codar. O que está instalado aqui:

- `createMcpHandler` de `agents/mcp/server` é um alias de `createStatelessMcpHandler`.
  Assinatura: `(factory, options?)`, onde `factory: (ctx: McpRequestContext) => McpServer`.
  Opções usadas: `route`, `authContext`, `onerror`.
- Registro de ferramenta é `server.registerTool(name, config, cb)`, com `inputSchema`
  e `outputSchema` em zod (v4). Com `outputSchema` declarado, a ferramenta é obrigada
  a devolver `structuredContent` — inclusive no caminho de erro.
- `clientRegistrationCallback` recebe o JSON cru do `/register` (snake_case) e **não**
  recebe `env`. Por isso o rate limiting do `/register` mora no `fetch` de `index.ts`,
  antes do provider, que é onde o binding do KV existe.
- `tokenExchangeCallback` que lança `OAuthError('invalid_grant')` faz o provider
  revogar o grant; `temporarily_unavailable` deixa o grant em paz para o cliente
  tentar de novo. A diferença é o que separa "o usuário foi desativado" de "o Supabase
  piscou".
- `describeConsent()` devolve `redirectHost` e `redirectIsLoopback`, que é o que a
  tela de consentimento exibe. Nome e logo do cliente são auto-declarados; o host do
  redirect não é.
- Escopo vive em `auth/escopos.ts` e em nenhum outro lugar: `scopesSupported` do
  provider, os textos da tela e o que vai no `approveConsent` saem todos de lá.
  `approveConsent` **lança** `invalid_scope` se receber escopo fora de
  `scopesSupported`, e `parseAuthRequest` não filtra nada — ele só valida a
  gramática do token —, então escopo desconhecido chega ao handler de verdade.
- Nas `annotations` de ferramenta, o spec do MCP dá default **true** para
  `destructiveHint` e `openWorldHint`. Declarar só `readOnlyHint: true` deixa a
  ferramenta anunciada como destrutiva por omissão, e é daí que vem o triângulo
  de aviso no Inspector. As quatro vão explícitas.

## Verificar os schemas

```bash
npm run portabilidade
```

Monta o servidor com props falsos (registrar ferramenta não toca o banco), gera o JSON
Schema de cada `inputSchema`/`outputSchema` e falha se achar o que o check "Schema
portability" do Inspector acusa: `type` em array, `"type":"null"`, `$ref`/`$defs`,
`oneOf`, `exclusiveMinimum` booleano. Também exige as quatro annotations em toda
ferramenta.

Os dois problemas que ele pegaria hoje se alguém reintroduzisse:

- `.nullable()` em schema de saída. O Zod 4 traduz para `{"type":["string","null"]}`, e
  `z.union([z.string(), z.null()])` colapsa no mesmo. O que resolve é `.optional()`.
- A MESMA instância de schema zod usada duas vezes dentro de um `z.object`. O Zod extrai
  para `$defs` e emite `$ref`. Por isso `camposDePaginacao()` e `campoDeData()` são
  funções: cada ferramenta recebe instância nova.

## Texto de usuário no `content`

Título, descrição, comentário e nome de pasta são escritos por gente, e parte do
conteúdo do CRM entrou pelo portal público de demandas. No `content` isso nunca vai
solto:

- todo valor tem rótulo fixo escrito pelo servidor;
- texto de usuário vai entre `« »`, e `«`/`»` que venham dentro do texto são trocados
  por `‹ ›`, então o conteúdo não fecha o próprio delimitador;
- em lista, quebra de linha é colapsada, para o texto não desenhar uma linha falsa com
  cara de rótulo do servidor; em bloco (descrição, comentário), cada linha leva o
  prefixo `│`;
- toda resposta com texto de usuário termina dizendo que o que está entre `« »` é dado,
  não instrução.

Não é para impedir o modelo de ler o conteúdo. É para impedir o conteúdo de se passar
pelo servidor.

- Escopo vive em `auth/escopos.ts`; as ferramentas de leitura vivem em
  `mcp/ferramentas/` e são registradas por `mcp/server.ts` só quando o token tem
  `crm:read` e há props. Sem props não há JWT, e registrar ferramenta que falharia em
  toda chamada só ensina o modelo a tentar.
- `consultar()` em `mcp/sessao.ts` é o único caminho até o banco: ele padroniza a
  mensagem de sessão expirada, separa "sessão morreu" de "RLS negou" (42501 fica de
  fora de propósito) e devolve o `count` do PostgREST, que é o que sustenta a paginação.
- "Atrasada" usa o instante da meia-noite de São Paulo, não a string da data:
  `data_vencimento` é TIMESTAMPTZ e comparar com `'AAAA-MM-DD'` faria o Postgres
  interpretar no fuso dele (UTC), jogando o corte três horas para trás — das 21h à
  meia-noite de Brasília, tarefa que vence hoje apareceria atrasada. O offset é derivado
  via `Intl` (o `workerd` tem ICU completo), não cravado, para o caso de o horário de
  verão voltar.
- Nome de cliente/projeto/pessoa é resolvido com `ilike` e os curingas do LIKE são
  escapados: sem isso, buscar "100%" devolveria tudo. Não é injeção — o supabase-js
  parametriza —, é resultado errado.
- Campo opcional do CRM aparece de três formas para dizer a mesma coisa: `NULL`, `""` e
  `"   "`. `texto()` e `rotulo()` no `formato.ts` normalizam os três para ausência —
  `undefined` na saída estruturada (que some do JSON, como o schema portável espera) e
  "não informado" no `content`. Toda ferramenta passa por eles.
- `/health` confere o que é confirmável sem credencial: os dois secrets existem, o KV
  responde a uma leitura, e a flag de dev não está ligada. Devolve 503 se algo falta.
  Um health fixo em `{ok:true}` não pegaria secret ausente nem id de KV errado — os dois
  erros que de fato acontecem no deploy.
- A limpeza do KV é um Cron Trigger diário (`triggers.crons` no wrangler.jsonc, handler
  `scheduled` no index.ts) que chama `purgeExpiredData()` do provider. Ela remove só
  grant expirado, grant órfão (client sumiu) e token órfão (grant sumiu) — grant válido e
  token de grant existente não são tocados. O cursor da varredura mora em `purge:cursor`
  no KV: sem ele, cada execução reexaminaria os mesmos primeiros registros para sempre.
  Testar: `npx wrangler dev --test-scheduled` e `GET /__scheduled?cron=17+6+*+*+*`.
- Comando de KV contra produção precisa de `--remote --preview false`. Sem `--remote` o
  wrangler 4 opera no KV local e **não avisa**: o comando responde `[]`, não dá erro, e
  parece ter funcionado. Em dev, o par é `--preview --local`.
