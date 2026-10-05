# Deploy em produção — etapa 3 (só leitura)

Passo a passo para publicar o `gestaomde-mcp` na Cloudflare com as sete ferramentas de
leitura. Nada aqui escreve no CRM.

Antes de começar, rode a verificação local:

```bash
cd mcp-server
npm run verificar
```

Isso roda typecheck, os testes do `formato.ts`, o verificador de portabilidade dos
schemas e o `dry-run` do bundle. Se algum falhar, não siga.

---

## 1. Login na Cloudflare

```bash
npx wrangler login
npx wrangler whoami
```

O `whoami` tem que mostrar a conta certa. Se a agência tiver mais de uma, confirme o
Account ID antes — publicar na conta errada cria um Worker público com acesso ao CRM.

---

## 2. Criar o KV de produção

```bash
npx wrangler kv namespace create OAUTH_KV --config wrangler.jsonc
```

O comando imprime algo como:

```
{ "binding": "OAUTH_KV", "id": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" }
```

Copie o `id` e cole no `wrangler.jsonc`, substituindo `COLE_AQUI_O_ID_DE_PRODUCAO`:

```jsonc
"kv_namespaces": [
  {
    "binding": "OAUTH_KV",
    "id": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",  // <- o que o comando imprimiu
    "preview_id": "0000000000000000000000000000dev0"
  }
]
```

Não mexa no `preview_id`: ele é só para `wrangler dev`, que simula o KV localmente.

**Este KV guarda credencial.** Clients registrados, grants, authorization codes e tokens
(os props vão criptografados, os tokens como hash). Apagar o namespace desconecta todo
mundo; é também o botão de pânico do item 8.

---

## 3. Criar os secrets

```bash
npx wrangler secret put SUPABASE_URL --config wrangler.jsonc
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY --config wrangler.jsonc
```

Cada comando pede o valor no terminal. Use os mesmos do `.dev.vars` — é o mesmo projeto
Supabase.

**A service role NÃO entra aqui.** Só a chave publishable (anon). O desenho inteiro
depende disso: toda leitura passa pelo RLS com o JWT do usuário, então uma service role
neste Worker transformaria um furo de lógica em acesso total ao CRM.

**`PERMITIR_REDIRECT_LOCAL` não deve ser criado em produção.** Ele libera `redirect_uri`
de loopback no `/register`, que é o que o MCP Inspector precisa em dev — e, ligado em
produção, deixa qualquer processo local se registrar como cliente OAuth deste servidor.
Ele existe só no `.dev.vars`, que é gitignored; o `wrangler.jsonc` não tem bloco `vars`,
então não há como ele vazar por arquivo. O passo 5 confirma que não está ligado: o `/health` em produção tem que responder `redirect_local: "desligado"`.

Para conferir o que existe na conta:

```bash
npx wrangler secret list --config wrangler.jsonc
```

Devem aparecer exatamente dois: `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`.

---

## 4. Escolher a URL — e ficar com UMA

```bash
npx wrangler deploy --config wrangler.jsonc
```

Ao final o wrangler imprime a URL. Duas opções:

### Opção A — workers.dev (mais rápida)

```
https://gestaomde-mcp.SEU-SUBDOMINIO.workers.dev
```

Sai pronta, sem DNS. Serve para começar. O endpoint MCP é essa URL + `/mcp`.

### Opção B — domínio próprio (recomendada para ficar)

No `wrangler.jsonc`, acrescente:

```jsonc
"routes": [{ "pattern": "mcp.suaagencia.com.br", "custom_domain": true }]
```

O domínio precisa estar na mesma conta Cloudflare. O wrangler cria o registro e o
certificado no deploy. Vantagens que importam aqui: a URL não muda se o Worker for
renomeado, e o endereço que a equipe vê é da agência, não um subdomínio genérico.

### O detalhe que morde

**Escolha uma URL e use só ela.** O `resource` do OAuth (RFC 8707) é derivado da origem
da requisição: `https://<origem>/mcp`. Um token emitido via workers.dev não vale para o
domínio próprio e vice-versa — são recursos diferentes. Se você conectar o Claude pela
workers.dev e depois trocar para o domínio próprio, todo mundo reconecta.

Se for usar domínio próprio, configure-o **antes** de conectar o Claude.

---

## 5. Checklist pós-deploy

Tudo num comando, no PowerShell:

```powershell
npm run verificar-producao -- https://gestaomde-mcp.SEU-SUBDOMINIO.workers.dev
```

É Node puro, sem dependência, e não usa `curl`, `seq` nem sintaxe de bash. Pode passar a
URL com ou sem `/mcp` no fim — ele normaliza, porque é a com `/mcp` que vai no Claude e
a sem `/mcp` que estas rotas usam.

Opções:

| Opção              | Para que serve                                                  |
| ------------------ | --------------------------------------------------------------- |
| `--sem-rate-limit` | Pula o teste de rate limiting (que gasta 20 registros por hora) |
| `--timeout=20000`  | Timeout por requisição, em ms (padrão 15000)                    |
| `--permitir-http`  | Aceita `http`, só para ensaiar contra o `npm run dev`           |

O que ele verifica, na ordem:

| #   | Verificação                          | Esperado                                         |
| --- | ------------------------------------ | ------------------------------------------------ |
| 1   | `/health`                            | 200, secrets presentes, KV ok, dev desligado     |
| 2   | metadata do AS (RFC 8414)            | `scopes_supported` só com `crm:read`             |
| 3   | metadata do recurso (RFC 9728)       | `resource` = a URL que você passou + `/mcp`      |
| 4   | `/mcp` sem token                     | 401 com `WWW-Authenticate` e `resource_metadata` |
| 5   | `/register` com redirect de atacante | 403 `access_denied`                              |
| 6   | `/register` com redirect de loopback | 403 `access_denied`                              |
| 7   | `/register` com callback do Claude   | 201 com `client_id`                              |
| 8   | `/authorize`                         | 200 **com o formulário de login** no HTML        |
| 9   | rate limiting do `/register`         | 429 ao passar de 20 registros por hora           |

Saída: tabela `OK`/`FALHOU` com esperado e obtido, o detalhe completo de cada falha (a
tabela trunca; o detalhe não), uma observação explicando o que fazer em cada falha
conhecida, e a lista dos `client_id` de teste criados — com o comando pronto para apagar
cada um. Sai com código 1 se algo falhou, então serve em CI.

Ele cria **um** cliente de teste em produção, o do item 7. O laço do item 9 usa de
propósito um `redirect_uri` que o servidor recusa: o contador conta toda tentativa antes
de olhar a política, então o limite é exercitado sem gravar cliente nenhum no KV.

### Dois avisos

**Rodar duas vezes na mesma hora** faz os itens 5 a 9 falharem com 429 — o limite é 20
registros por hora por IP, e a primeira rodada gastou 21. Não é defeito; o script diz
isso na observação. Para rodar de novo antes da hora, apague a chave `rl:register_ip:…`
do KV (item 8).

**Ensaiar contra o `npm run dev`** é útil para ver a saída antes de publicar:

```powershell
npm run dev
# noutro terminal:
npm run verificar-producao -- http://127.0.0.1:8787 --permitir-http
```

Em dev, os itens **1 e 6 falham de propósito**: o `.dev.vars` tem
`PERMITIR_REDIRECT_LOCAL="1"`, então o `/health` reporta `redirect_local: LIGADO` e o
`/register` aceita loopback — que é justamente o que o Inspector precisa. Em produção os
dois têm que passar. Se passarem em dev, é porque a flag não está no `.dev.vars`, e aí o
Inspector é que vai parar de funcionar.

### Os mesmos testes à mão

Se preferir conferir um item isolado, no PowerShell:

```powershell
$URL = "https://gestaomde-mcp.SEU-SUBDOMINIO.workers.dev"

# 1) Health
Invoke-RestMethod "$URL/health"

# 2) Metadata do AS
(Invoke-RestMethod "$URL/.well-known/oauth-authorization-server").scopes_supported

# 3) Metadata do recurso
(Invoke-RestMethod "$URL/.well-known/oauth-protected-resource/mcp").resource

# 4) /mcp sem token -> espera 401
try {
  Invoke-WebRequest -Method POST "$URL/mcp" -ContentType "application/json" `
    -Headers @{ Accept = "application/json, text/event-stream" } `
    -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' -SkipHttpErrorCheck |
    Select-Object StatusCode, @{n="WWWAuth";e={$_.Headers["WWW-Authenticate"]}}
} catch { $_.Exception.Response.StatusCode }

# 5) /register com redirect de atacante -> espera 403
Invoke-WebRequest -Method POST "$URL/register" -ContentType "application/json" `
  -Body '{"client_name":"Claude","redirect_uris":["https://atacante.example/callback"]}' `
  -SkipHttpErrorCheck | Select-Object StatusCode, Content
```

`-SkipHttpErrorCheck` existe no PowerShell 7+. No Windows PowerShell 5.1, o
`Invoke-WebRequest` lança exceção em status 4xx — por isso o `try/catch` acima, e por
isso o script em Node é o caminho recomendado.

### Rate limiting em produção

O rate limiting é contador no KV e funciona igual em produção — a diferença é que lá o
IP é real. Em `wrangler dev` o header `cf-connecting-ip` não existe e todo mundo
compartilha o contador `sem-ip`; em produção cada IP tem o seu.

Limites: 10 falhas de login por IP em 10 min, 5 por e-mail em 15 min, 20 registros por
IP em 1 h. O item 9 testa o do `/register`, que é o único que se confirma sem envolver
conta de ninguém — testar o de login exigiria errar a senha de um e-mail real cinco
vezes, o que trancaria essa pessoa por 15 minutos.

---

## 6. Adicionar como conector personalizado no Claude

1. Abra o Claude na web (claude.ai) e vá em **Configurações → Conectores**.
2. **Adicionar conector personalizado**.
3. Nome: `CRM da agência`. URL: a sua URL **+ `/mcp`**, por exemplo
   `https://gestaomde-mcp.SEU-SUBDOMINIO.workers.dev/mcp`.
4. Salve e clique em **Conectar**. O Claude descobre o servidor de autorização, se
   registra sozinho no `/register` e abre a tela de login do CRM.
5. Entre com sua conta do CRM — a mesma do sistema. Quem não é equipe interna ativa é
   barrado aqui, com mensagem explicando.
6. Na tela de consentimento, confira antes de aprovar:
   - **o domínio de destino em destaque** deve ser `claude.ai` (ou `claude.com`). Se
     aparecer outro, não aprove: o nome do aplicativo é auto-declarado, o domínio não;
   - a permissão listada deve ser **só** "Ler dados do CRM" (`crm:read`).
7. **Permitir**. O Claude volta conectado.

### Perguntas para testar de verdade

Comece pela que confirma a identidade, e depois vá nas de trabalho:

| Pergunta                                         | Ferramenta esperada             |
| ------------------------------------------------ | ------------------------------- |
| "Com qual conta do CRM você está conectado?"     | `whoami`                        |
| "O que eu tenho para hoje?"                      | `resumo_do_dia`                 |
| "Quais tarefas estão atrasadas?"                 | `listar_tarefas`                |
| "Quais tarefas são minhas e vencem esta semana?" | `listar_tarefas`                |
| "O que a Maria tem em andamento?"                | `listar_tarefas` (resolve nome) |
| "Me conta tudo da tarefa sobre o briefing"       | `listar_tarefas` + `ver_tarefa` |
| "Quais clientes temos no plano Ouro?"            | `buscar_clientes`               |
| "Como está a situação do cliente Acme?"          | `ver_cliente`                   |
| "Quais projetos têm mais tarefas atrasadas?"     | `listar_projetos`               |
| "Onde está o link do Drive?"                     | `buscar_links`                  |

O que observar:

- **Ambiguidade.** Pergunte por um nome que exista em duplicado ("o que o Ana tem?"). O
  Claude deve voltar perguntando qual das pessoas, não escolher uma.
- **Permissões de verdade.** Entre com uma conta de Membro e pergunte algo que só Admin
  vê. O Claude tem que não encontrar — quem corta é o RLS, não o prompt.
- **Nada de escrita.** Peça "crie uma tarefa para amanhã". Ele não tem ferramenta para
  isso e deve dizer que não consegue. Se ele disser que criou, é alucinação — confira no
  CRM antes de acreditar.
- **Datas.** As respostas devem usar dd/mm/aaaa e marcar as atrasadas.

### Se um membro for desativado

Desative no CRM e o acesso cai em duas camadas: o banco para de devolver dado na hora
(a função `eh_equipe_interna` exige conta ativa), e na renovação seguinte do token — no
máximo uma hora — o grant é revogado e o conector pede para reconectar. Não precisa
fazer nada aqui.

---

## 7. Observar

Logs ao vivo (`observability` já está ligado no `wrangler.jsonc`):

```bash
npx wrangler tail --config wrangler.jsonc
```

O que o Worker loga, de propósito sem conteúdo sensível:

| Linha                                              | Significa                               |
| -------------------------------------------------- | --------------------------------------- |
| `[register] recusado por politica de redirect_uri` | Alguém tentou registrar outro callback  |
| `[register] bloqueado por rate limit`              | Rate limit de registro atuou            |
| `[authorize] redirect_uri fora da lista branca`    | Cliente antigo ou pedido forjado        |
| `[authorize] login guardado nao corresponde...`    | Tentativa de reusar login noutro pedido |
| `[oauth] encerrando grant: ...`                    | Grant revogado (inelegível ou sessão)   |
| `[oauth] falha transitoria ao renovar...`          | Supabase instável; grant preservado     |

Nenhum log carrega token, senha, e-mail ou conteúdo de tarefa. Se precisar investigar um
caso específico, o que existe é o id do grant no Cloudflare e o log do Supabase.

Repetição de `[authorize] redirect_uri fora da lista branca` ou de
`[register] recusado por politica` é sinal de que alguém está tentando phishing contra a
equipe. Não é falha do servidor — é a defesa funcionando —, mas vale avisar o time para
desconfiar de link de "conecte o CRM".

---

## 8. Desligar rápido

Em ordem de brutalidade. Os três primeiros são reversíveis.

### a) Desconectar todo mundo, mantendo o Worker de pé

Apagar as chaves de grant e token do KV: os conectores param de funcionar na próxima
chamada e cada pessoa reconecta quando você mandar.

> **`--remote --preview false` em todo comando de `kv key`.** Sem `--remote`, o
> wrangler 4 opera no KV **local** (`.wrangler/state`) e não avisa: o comando responde
> `[]`, não dá erro nenhum, e você conclui que revogou todo mundo enquanto produção
> segue intacta. Numa emergência isso é pior do que não ter o comando. O `--preview
false` é o default dos comandos de `key`, mas no `delete` ele não aparece como default
> no `--help` — e este projeto tem `preview_id` configurado, então vale ser explícito.
>
> Os comandos de `kv namespace` (create/delete) não têm `--remote`: eles sempre agem na
> conta.

O `wrangler` não tem delete em massa por prefixo, mas tem `--prefix` no `list` e a saída
é JSON limpo no stdout — então o PowerShell resolve. **Numa emergência, use isto**:
apagar chave por chave para uma equipe inteira não é viável.

```powershell
# O que existe, por prefixo
$saida = npx wrangler kv key list --binding OAUTH_KV --remote --preview false --config wrangler.jsonc
$chaves = $saida | ConvertFrom-Json
$chaves | Group-Object { ($_.name -split ":")[0] } | Select-Object Count, Name

# Derruba TODAS as conexoes (grants + tokens). Reversivel: cada pessoa reconecta.
foreach ($prefixo in @("grant:", "token:")) {
  $saida = npx wrangler kv key list --binding OAUTH_KV --remote --preview false `
    --prefix $prefixo --config wrangler.jsonc
  $chaves = $saida | ConvertFrom-Json
  Write-Host "$prefixo -> $($chaves.Count) chave(s)"
  $chaves | ForEach-Object {
    npx wrangler kv key delete --binding OAUTH_KV --remote --preview false `
      --config wrangler.jsonc $_.name
  }
}
```

> **Guarde a saída numa variável antes do `ConvertFrom-Json`.** O wrangler imprime um
> banner junto do JSON; num pipeline em streaming (`npx ... | ConvertFrom-Json |
Select-Object ...`) isso faz o `Select-Object` falhar com "Propriedade name não
> encontrada". Com a variável intermediária, o `ConvertFrom-Json` recebe tudo de uma vez
> e funciona. Testado no Windows PowerShell 5.1.

Para desconectar UMA pessoa, use `--prefix "grant:$userId"` — o `userId` é o id dela em
`perfis_usuarios`, e o `whoami` do conector mostra qual é. Apague os `token:` dela
também, com `--prefix "token:$userId"`.

Para zerar os contadores de rate limiting, o mesmo laço com `--prefix "rl:"`.

> O `key list` devolve no máximo 1000 chaves por página e este laço pega só a primeira.
> Com mais que isso, rode de novo até o `Group-Object` não listar mais o prefixo.

Prefixos que existem no namespace:

| Prefixo           | O que é                                        | Apagar causa                   |
| ----------------- | ---------------------------------------------- | ------------------------------ |
| `grant:`          | Autorização de uma pessoa                      | Ela reconecta                  |
| `token:`          | Access/refresh tokens                          | Ela reconecta                  |
| `client:`         | Clientes registrados por DCR                   | O Claude se registra outra vez |
| `transaction:`    | Tela de consentimento em aberto (TTL curto)    | Nada; expira só                |
| `login_pendente:` | Login entre a senha e o consentimento (TTL 5m) | Nada; expira só                |
| `rl:`             | Contadores de rate limiting                    | Zera os bloqueios              |
| `purge:cursor`    | Onde a limpeza diária parou                    | A próxima varredura recomeça   |

### b) Cortar o acesso a dado, sem tocar na Cloudflare

Mais forte que (a), porque atinge **qualquer** portador de JWT, não só o MCP: desative
as contas no CRM, ou reverta o acesso no banco. A função `eh_equipe_interna` é o portão;
`supabase/tests/rollback_eh_equipe_interna_ativo.sql` documenta o caminho inverso (e
avisa o que reabre).

### c) Desativar o Worker

No dashboard da Cloudflare: **Workers & Pages → gestaomde-mcp → Settings**. Ali dá para
remover as rotas/domínio, o que derruba o acesso sem apagar nada. O Worker volta
religando a rota.

### d) Apagar o Worker

```powershell
npx wrangler delete --config wrangler.jsonc
```

Derruba o endpoint na hora, e tira o cron junto. O KV **sobrevive** — grants e clients
continuam lá, então um deploy futuro com o mesmo namespace reativa as conexões antigas.
Para apagar de verdade:

```powershell
npx wrangler kv namespace delete --binding OAUTH_KV --preview false --config wrangler.jsonc
```

Isso é irreversível e desconecta todo mundo. O `--preview false` aponta o namespace de
produção, e não o de preview; `kv namespace delete` não tem `--remote` porque sempre age
na conta. Ele pede confirmação (`-y` pula, use com cuidado). Depois, criar namespace novo
e colar o id no `wrangler.jsonc`.

### Em qualquer caso

O que **não** precisa ser feito: mexer no Supabase por causa do MCP. Este Worker não tem
service role e não guarda dado do CRM — ele só repassa consulta com o JWT de quem
perguntou. Derrubar o Worker não deixa dado órfão em lugar nenhum.

---

## 9. Limpeza automática do KV (cron diário)

O `wrangler.jsonc` tem um Cron Trigger e o `src/index.ts` tem o `scheduled()` que chama
`purgeExpiredData()` do provider.

```jsonc
"triggers": { "crons": ["17 6 * * *"] }
```

**O cron da Cloudflare é sempre em UTC** — não existe campo de fuso. `17 6 * * *` é
06:17 UTC, ou seja **03:17 em Brasília**. O Brasil extinguiu o horário de verão em 2019,
então -3 é estável; se voltar, isso passa a ser 02:17 local, o que para uma limpeza de
madrugada não muda nada. O minuto 17 em vez de 00 evita a fila dos horários redondos.

### O que ela apaga — e o que não toca

Conferido no código da biblioteca (`node_modules/@cloudflare/workers-oauth-provider`). O
sweep lista **só** os prefixos `grant:` e `token:`, e remove dois casos:

| Caso                                             | Por que é lixo                                |
| ------------------------------------------------ | --------------------------------------------- |
| `grant:` expirado (`now >= expiresAt`)           | Já não autoriza nada                          |
| `grant:` órfão: o `client:` dele não existe mais | Sem client, o refresh falha de qualquer forma |
| `token:` órfão: o `grant:` dele não existe mais  | Resquício de revogação parcial                |

**Grant válido e não expirado, com client presente, não é tocado. Token cujo grant
existe não é tocado.** Ninguém conectado é desconectado por esta rotina.

`client:`, `transaction:`, `login_pendente:` e `rl:` nem são listados — os quatro têm TTL
próprio e o KV os coleta sozinho.

### O cursor, que é a parte que erra

Cada chamada examina no máximo `batchSize` registros **por fase** e devolve um cursor
quando sobrou coisa. Sem guardar esse cursor, toda execução reexaminaria os mesmos
primeiros registros para sempre: o log sairia bonito e o resto do namespace nunca seria
varrido. Por isso o cursor vai para o KV em `purge:cursor`, e cada madrugada continua de
onde a anterior parou — recomeçando quando termina.

`TAMANHO_DO_LOTE` é 20, conservador de propósito: cada registro examinado é pelo menos
uma leitura de KV, e leitura de KV conta no limite de subrequests da invocação — **50 no
plano gratuito do Workers, 1000 no pago**. No plano pago dá para subir para 100 ou 200 e
varrer tudo em poucos dias. Em namespace pequeno isso nem importa, porque `token:` já
expira sozinho por TTL.

### Testar localmente, antes do deploy

```powershell
npx wrangler dev --config wrangler.jsonc --test-scheduled
```

Noutro terminal (o `--test-scheduled` expõe a rota `/__scheduled`):

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/__scheduled?cron=17+6+*+*+*"
```

Responde `Ran scheduled event`, e o terminal do `dev` mostra a linha do log:

```
[cron] limpeza do KV: grants 0/0, tokens 0/0, varredura completa
```

Para ver a rotina **removendo** coisa, semeie o KV local com um caso válido e dois de
lixo. O que isso prova é justamente que o válido sobrevive.

> **Não passe o JSON direto na linha de comando no PowerShell.** O Windows PowerShell
> 5.1 come as aspas internas ao chamar um executável: `'{"a":"b"}'` chega no wrangler
> como `{a:b}`, que não é JSON, e a limpeza simplesmente ignora o registro — teste
> inútil, sem erro visível. Use `--path` com arquivo.
>
> E escreva o arquivo com `[IO.File]::WriteAllText`, não com `Out-File -Encoding utf8`:
> o `Out-File` do 5.1 grava BOM, e `JSON.parse` com BOM lança.

```powershell
$kv = "--binding OAUTH_KV --preview --local --config wrangler.jsonc".Split(" ")
$dir = "$PWD\.wrangler\tmp\seed"
New-Item -ItemType Directory -Force $dir | Out-Null

# um client que existe, um grant VALIDO apontando para ele, e o token desse grant
[IO.File]::WriteAllText("$dir\client.json", '{"clientId":"c-ok"}')
[IO.File]::WriteAllText("$dir\grant-ok.json", '{"id":"g2","userId":"u2","clientId":"c-ok"}')
[IO.File]::WriteAllText("$dir\token-ok.json", '{"userId":"u2","grantId":"g2"}')
# lixo: grant orfao (client inexistente) e token orfao (grant inexistente)
[IO.File]::WriteAllText("$dir\grant-orfao.json", '{"id":"g1","userId":"u1","clientId":"c-sumiu"}')
[IO.File]::WriteAllText("$dir\token-orfao.json", '{"userId":"u3","grantId":"g3"}')

npx wrangler kv key put @kv "client:c-ok"      --path "$dir\client.json"
npx wrangler kv key put @kv "grant:u2:g2"      --path "$dir\grant-ok.json"
npx wrangler kv key put @kv "token:u2:g2:aaa"  --path "$dir\token-ok.json"
npx wrangler kv key put @kv "grant:u1:g1"      --path "$dir\grant-orfao.json"
npx wrangler kv key put @kv "token:u3:g3:zzz"  --path "$dir\token-orfao.json"

Invoke-RestMethod "http://127.0.0.1:8787/__scheduled?cron=17+6+*+*+*"

# Guarde a saida numa variavel antes do ConvertFrom-Json: o banner do wrangler
# quebra o pipeline em streaming.
$saida = npx wrangler kv key list @kv
($saida | ConvertFrom-Json).name
```

Resultado esperado — foi o que deu aqui:

```
[cron] limpeza do KV: grants 1/2, tokens 1/2, varredura completa

client:c-ok
grant:u2:g2
token:u2:g2:aaa
```

Um grant e um token removidos; o grant válido, o token dele e o client intactos. Para
ver também o corte por expiração, acrescente um grant com `expiresAt` no passado
(segundos epoch) e ele será removido mesmo com o client presente.

Para ver o cursor em ação, semeie mais de 20 grants: a primeira execução para no meio e
grava `purge:cursor`, a segunda continua e apaga a chave ao terminar. Confirmado aqui
com 22 grants — a primeira passada removeu 19 e gravou o cursor, a segunda removeu o
resto e apagou a chave.

No fim, limpe o que você semeou:

```powershell
$saida = npx wrangler kv key list @kv
($saida | ConvertFrom-Json) | ForEach-Object { npx wrangler kv key delete @kv $_.name }
```

### Confirmar, depois do deploy, que o cron rodou

```powershell
npx wrangler deploy --config wrangler.jsonc
```

A saída do deploy lista os triggers — confira que aparece `schedule: 17 6 * * *`.

Depois, três formas de confirmar, da mais rápida à mais paciente:

**1. Forçar agora, sem esperar a madrugada.** No painel: **Workers & Pages →
gestaomde-mcp → Settings → Trigger Events → Cron Triggers**, e use o botão de executar.
Ou deixe o `tail` aberto e espere o horário.

**2. `wrangler tail`.** Ele mostra invocações de cron junto com as de HTTP:

```powershell
npx wrangler tail --config wrangler.jsonc
```

A linha a procurar é a do log, com só contagens:

```
[cron] limpeza do KV: grants 3/20, tokens 0/5, varredura continua amanha
```

Se falhar, a linha é `[cron] limpeza do KV falhou (17 6 * * *): <motivo>` e a invocação
aparece como erro — o handler relança de propósito, para a falha não sumir em silêncio.

> O `tail` só mostra o que acontece **enquanto está aberto**. Para ver o cron das 03:17
> por ele, teria que ficar aberto de madrugada; na prática, use o item 1 ou o 3.

**3. Painel da Cloudflare.** Em **Workers & Pages → gestaomde-mcp → Observability →
Logs**, filtre por `[cron]`. Com `observability.enabled` ligado (já está), os logs ficam
retidos e dá para olhar de manhã o que rodou às 03:17. A aba **Metrics** mostra as
invocações por tipo, incluindo as de cron, e a contagem de erros.

**4. Pelo efeito.** Se a varredura não terminou numa noite, a chave do cursor existe:

```powershell
npx wrangler kv key get --binding OAUTH_KV --remote --preview false `
  --config wrangler.jsonc "purge:cursor" --text
```

Valor presente = rodou e continua amanhã. `Value not found` = ou terminou a varredura
(ela apaga o cursor ao concluir), ou nunca rodou. Para distinguir os dois, o log é o que
responde.

---

## Pendências conhecidas para a etapa 5

Não bloqueiam este deploy, mas ficam anotadas:

- ~~**Limpeza do KV.**~~ Resolvido: Cron Trigger diário às 03:17 BRT, seção 9.
- **`crm:write`.** Já está em `auth/escopos.ts` como escopo conhecido, fora dos
  concedidos. Entra em `ESCOPOS_SUPORTADOS` junto com as ferramentas de escrita, nunca
  antes.
- **Log de auditoria.** Leitura hoje não deixa rastro no CRM. Para escrita isso passa a
  ser requisito.
- **`TAMANHO_DO_LOTE` da limpeza.** Está em 20, que é seguro no plano gratuito (limite de
  50 subrequests por invocação). Se a conta for paga, 100 ou 200 varre o namespace em
  poucos dias em vez de semanas. Só importa se o namespace crescer.
