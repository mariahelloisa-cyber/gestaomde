/**
 * Verificação pós-deploy, em Node puro.
 *
 * Existe porque o DEPLOY.md nasceu com curl e sintaxe de bash — `URL=...`,
 * `$URL`, `seq`, `head`, aspas simples —, e nada disso funciona no PowerShell.
 * Aqui é Node sem dependência nenhuma: roda igual no Windows, no macOS e no CI.
 *
 * Uso:
 *   npm run verificar-producao -- https://gestaomde-mcp.xxx.workers.dev
 *
 * Opções:
 *   --sem-rate-limit   pula o teste de rate limiting do /register
 *   --timeout=20000    timeout por requisição, em ms (padrão 15000)
 *
 * Saída: tabela OK/FALHOU com esperado e obtido, a lista dos client_id de teste
 * criados no KV (para você apagar) e código de saída 1 se algo falhou.
 */

const TIMEOUT_PADRAO = 15000;

/** Callback do conector remoto do Claude: o único redirect_uri que o servidor aceita. */
const CALLBACK_CLAUDE = "https://claude.ai/api/mcp/auth_callback";

/** PKCE de exemplo da RFC 7636. O servidor só guarda o desafio nesta etapa. */
const DESAFIO_PKCE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const resultados = [];
const clientesCriados = [];
let registrosFeitos = 0;
let bloqueadoPorRateLimit = false;

function registrar(nome, ok, esperado, obtido, observacao) {
  resultados.push({ nome, ok, esperado, obtido, observacao });
}

/**
 * Uma requisição, sem exceção escapando.
 *
 * Falha de rede vira resultado com `erro`, e não crash: o script tem que
 * terminar a tabela mesmo que um item não responda.
 */
async function pedir(url, opcoes = {}, timeout = TIMEOUT_PADRAO) {
  try {
    const resposta = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(timeout) });
    const corpo = await resposta.text();
    let json = null;
    try {
      json = JSON.parse(corpo);
    } catch {
      // Nem toda rota devolve JSON (a de login devolve HTML).
    }
    return { status: resposta.status, headers: resposta.headers, corpo, json };
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    return { status: 0, headers: new Headers(), corpo: "", json: null, erro: motivo };
  }
}

/** Corta texto longo para caber na tabela. */
function curto(valor, maximo = 58) {
  const texto = typeof valor === "string" ? valor : JSON.stringify(valor);
  if (texto === undefined) return "(vazio)";
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length > maximo ? `${limpo.slice(0, maximo - 1)}…` : limpo;
}

/** Tabela em ASCII puro: cmd.exe com codepage antigo não quebra. */
function imprimirTabela(linhas) {
  const colunas = ["#", "Verificacao", "Status", "Esperado", "Obtido"];
  const dados = linhas.map((l, i) => [
    String(i + 1),
    curto(l.nome, 36),
    l.ok ? "OK" : "FALHOU",
    curto(l.esperado, 40),
    curto(l.obtido, 46),
  ]);

  const larguras = colunas.map((c, i) => Math.max(c.length, ...dados.map((d) => d[i].length)));

  const linha = (celulas) => "| " + celulas.map((c, i) => c.padEnd(larguras[i])).join(" | ") + " |";
  const separador = "+" + larguras.map((w) => "-".repeat(w + 2)).join("+") + "+";

  console.log(separador);
  console.log(linha(colunas));
  console.log(separador);
  for (const d of dados) console.log(linha(d));
  console.log(separador);
}

// ---------------------------------------------------------------- 1 a 3 ----

async function verificarHealth(base) {
  const r = await pedir(`${base}/health`);
  const j = r.json ?? {};

  const esperado = "200 ok:true supabase:configurado kv:ok redirect_local:desligado";
  // Campo a campo, e não o JSON cru: no JSON cru o `redirect_local` cai fora da
  // largura da coluna, e é justamente o campo que decide se o deploy está seguro.
  const obtido = r.erro
    ? `erro de rede: ${r.erro}`
    : `${r.status} ok:${j.ok} supabase:${j.supabase} kv:${j.kv} redirect_local:${j.redirect_local}`;

  const ok =
    r.status === 200 &&
    j.ok === true &&
    j.supabase === "configurado" &&
    j.kv === "ok" &&
    j.redirect_local === "desligado";

  let observacao;
  if (j.redirect_local === "LIGADO") {
    observacao =
      "PARE: o secret PERMITIR_REDIRECT_LOCAL existe em producao. Remova com\n" +
      "   npx wrangler secret delete PERMITIR_REDIRECT_LOCAL --config wrangler.jsonc\n" +
      "   e publique de novo. Com ele ligado, qualquer processo local pode se\n" +
      "   registrar como cliente OAuth deste servidor.";
  } else if (j.supabase === "faltando") {
    observacao =
      "Os secrets do Supabase nao estao na conta. Rode os dois wrangler secret put\n" +
      "   do passo 3 do DEPLOY.md e publique de novo.";
  } else if (j.kv === "falhou") {
    observacao =
      "O binding do KV nao respondeu. Confira se o id de producao no wrangler.jsonc\n" +
      "   e o que o `kv namespace create` imprimiu.";
  }

  registrar("/health", ok, esperado, obtido, observacao);
}

async function verificarMetadataAS(base) {
  const r = await pedir(`${base}/.well-known/oauth-authorization-server`);
  const escopos = r.json?.scopes_supported;
  const ok =
    r.status === 200 && Array.isArray(escopos) && escopos.length === 1 && escopos[0] === "crm:read";

  registrar(
    "metadata do AS (RFC 8414)",
    ok,
    'scopes_supported ["crm:read"]',
    r.erro ? `erro de rede: ${r.erro}` : `status ${r.status}, ${JSON.stringify(escopos)}`,
    ok
      ? undefined
      : "Se aparecer crm:write, a etapa 4 entrou sem as ferramentas de escrita:\n" +
          "   confira ESCOPOS_SUPORTADOS em src/auth/escopos.ts.",
  );
}

async function verificarMetadataRecurso(base) {
  const r = await pedir(`${base}/.well-known/oauth-protected-resource/mcp`);
  const recurso = r.json?.resource;
  const esperadoRecurso = `${base}/mcp`;
  const ok = r.status === 200 && recurso === esperadoRecurso;

  registrar(
    "metadata do recurso (RFC 9728)",
    ok,
    `resource ${esperadoRecurso}`,
    r.erro ? `erro de rede: ${r.erro}` : `status ${r.status}, resource ${recurso ?? "(ausente)"}`,
    ok
      ? undefined
      : "O resource sai da origem da requisicao. Se nao bate com a URL que voce vai\n" +
          "   usar no Claude, use SEMPRE a mesma origem: token de uma nao vale na outra.",
  );
}

// ------------------------------------------------------------------- 4 ----

async function verificarMcpSemToken(base) {
  const r = await pedir(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

  const desafio = r.headers.get("www-authenticate") ?? "";
  const ok = r.status === 401 && /Bearer/i.test(desafio) && /resource_metadata/i.test(desafio);

  registrar(
    "/mcp sem token",
    ok,
    "401 com WWW-Authenticate: Bearer ... resource_metadata",
    r.erro
      ? `erro de rede: ${r.erro}`
      : `status ${r.status}, WWW-Authenticate: ${desafio || "(ausente)"}`,
    r.status === 200
      ? "GRAVE: o endpoint MCP respondeu sem token. Nao conecte o Claude e nao\n" +
          "   deixe o Worker publicado assim — veja o item 8 do DEPLOY.md."
      : undefined,
  );
}

// --------------------------------------------------------------- 5 a 7 ----

/**
 * Um POST em /register.
 *
 * Cada chamada conta no rate limiting (o servidor conta TODAS as tentativas,
 * aceitas ou recusadas), então o contador fica aqui: o relatório precisa dizer
 * em qual tentativa o 429 apareceu, incluindo as dos itens 5 a 7.
 */
async function registrarCliente(base, nome, redirects) {
  registrosFeitos += 1;
  const r = await pedir(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: nome, redirect_uris: redirects }),
  });

  if (r.status === 429) bloqueadoPorRateLimit = true;
  if (r.status === 201 && r.json?.client_id) {
    clientesCriados.push({ client_id: r.json.client_id, nome });
  }
  return r;
}

const AVISO_429 =
  "O /register bateu o rate limit (20 por hora por IP) antes do fim das\n" +
  "   verificacoes. Isso NAO e defeito: provavelmente este script ja rodou nesta\n" +
  "   ultima hora. Espere, ou apague as chaves rl: do KV (item 8 do DEPLOY.md).";

async function verificarRegistroRecusado(base, titulo, redirect) {
  const r = await registrarCliente(base, "Claude", [redirect]);

  if (r.status === 429) {
    registrar(titulo, false, "403 access_denied", "429 (rate limit)", AVISO_429);
    return;
  }

  const ok = r.status === 403 && r.json?.error === "access_denied";
  registrar(
    titulo,
    ok,
    "403 com error access_denied",
    r.erro
      ? `erro de rede: ${r.erro}`
      : `status ${r.status}, error ${r.json?.error ?? "(ausente)"}`,
    r.status === 201
      ? "GRAVE: o servidor aceitou um redirect_uri que nao e do Claude. E a porta do\n" +
          "   phishing: confira REDIRECTS_PERMITIDOS em src/auth/clientes.ts e, se o\n" +
          "   redirect for loopback, veja se PERMITIR_REDIRECT_LOCAL vazou para producao."
      : undefined,
  );
}

async function verificarRegistroAceito(base) {
  const r = await registrarCliente(base, "Verificacao pos-deploy", [CALLBACK_CLAUDE]);

  if (r.status === 429) {
    registrar(
      "/register com callback do Claude",
      false,
      "201 com client_id",
      "429 (rate limit)",
      AVISO_429,
    );
    return null;
  }

  const id = r.json?.client_id;
  const ok = r.status === 201 && typeof id === "string" && id.length > 0;

  registrar(
    "/register com callback do Claude",
    ok,
    "201 com client_id",
    r.erro ? `erro de rede: ${r.erro}` : `status ${r.status}, client_id ${id ?? "(ausente)"}`,
    ok ? undefined : "Sem isto o Claude nao consegue se registrar, e o conector nao conecta.",
  );

  return ok ? id : null;
}

// ------------------------------------------------------------------- 8 ----

async function verificarAuthorize(base, clientId) {
  if (!clientId) {
    registrar(
      "/authorize (tela de login)",
      false,
      "200 com a tela de login",
      "nao testado: o item anterior nao devolveu client_id",
    );
    return;
  }

  const parametros = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK_CLAUDE,
    scope: "crm:read",
    state: "verificacao",
    code_challenge: DESAFIO_PKCE,
    code_challenge_method: "S256",
  });

  const r = await pedir(`${base}/authorize?${parametros}`);

  // Confiro o conteúdo, não só o status: uma página de erro do próprio servidor
  // também responderia 200 em alguns caminhos, e aí o teste passaria sem que a
  // tela de login existisse.
  const temFormulario = /name="senha"/.test(r.corpo) && /Entrar no CRM/.test(r.corpo);
  const ok = r.status === 200 && temFormulario;

  registrar(
    "/authorize (tela de login)",
    ok,
    "200 com o formulario de login do CRM",
    r.erro
      ? `erro de rede: ${r.erro}`
      : `status ${r.status}, formulario ${temFormulario ? "presente" : "ausente"}`,
    ok ? undefined : "Se o status for 200 sem formulario, veja o titulo da pagina devolvida.",
  );
}

// ------------------------------------------------------- rate limiting ----

/**
 * Confirma o rate limiting do /register.
 *
 * Usa o /register de propósito: é o único limite que se testa sem envolver
 * conta de ninguém. Testar o de login exigiria errar a senha de um e-mail real
 * cinco vezes, o que trancaria essa pessoa por 15 minutos.
 *
 * E usa um redirect_uri RECUSADO no laço, de propósito: o contador do servidor
 * conta TODAS as tentativas, antes de olhar a política. Então o limite é
 * exercitado do mesmo jeito e nenhum cliente é gravado no KV — a primeira
 * versão disto deixava 17 clientes de teste para apagar à mão.
 *
 * O limite é 20 por hora por IP, e os itens 5 a 7 já gastaram 3. A conta que o
 * relatório mostra é absoluta, não relativa a este laço.
 */
async function verificarRateLimit(base) {
  const TETO = 30;
  let tentativaDoBloqueio = null;

  for (let i = 0; i < TETO && tentativaDoBloqueio === null; i += 1) {
    const r = await registrarCliente(base, "Teste de rate limit", [
      "https://descartado.example/cb",
    ]);
    if (r.status === 429) tentativaDoBloqueio = registrosFeitos;
    if (r.status === 0) {
      registrar(
        "rate limiting do /register",
        false,
        "429 ao passar de 20 registros por hora",
        `erro de rede na tentativa ${registrosFeitos}: ${r.erro}`,
      );
      return;
    }
  }

  const ok = tentativaDoBloqueio !== null;
  registrar(
    "rate limiting do /register",
    ok,
    "429 ao passar de 20 registros por hora no mesmo IP",
    ok
      ? `429 na tentativa ${tentativaDoBloqueio} de /register`
      : `nenhum 429 em ${registrosFeitos} tentativas`,
    ok
      ? undefined
      : "Sem rate limiting, o /register aceita registro em volume e enche o KV.\n" +
          "   Confira se o binding OAUTH_KV de producao esta correto: o contador mora nele.",
  );
}

// --------------------------------------------------------------- main ----

function lerArgumentos(argv) {
  const soltos = [];
  const opcoes = { rateLimit: true, timeout: TIMEOUT_PADRAO, permitirHttp: false };

  for (const arg of argv) {
    if (arg === "--sem-rate-limit") opcoes.rateLimit = false;
    else if (arg === "--permitir-http") opcoes.permitirHttp = true;
    else if (arg.startsWith("--timeout=")) {
      const n = Number.parseInt(arg.slice("--timeout=".length), 10);
      if (Number.isFinite(n) && n > 0) opcoes.timeout = n;
    } else if (arg.startsWith("--")) {
      console.error(`Opcao desconhecida: ${arg}`);
      process.exit(2);
    } else soltos.push(arg);
  }

  if (soltos.length !== 1) {
    console.error("Uso: npm run verificar-producao -- https://gestaomde-mcp.xxx.workers.dev");
    console.error("");
    console.error("Opcoes: --sem-rate-limit    pula o teste de rate limiting");
    console.error("        --permitir-http    aceita http, so para ensaiar contra o wrangler dev");
    console.error("        --timeout=20000    timeout por requisicao, em ms");
    process.exit(2);
  }

  let base;
  try {
    base = new URL(soltos[0]);
  } catch {
    console.error(`URL invalida: ${soltos[0]}`);
    process.exit(2);
  }

  if (base.protocol !== "https:" && !opcoes.permitirHttp) {
    console.error(`A URL precisa ser https. Recebi: //`);
    console.error("Em producao o cookie de login e Secure e nao viaja em http.");
    console.error("");
    console.error("Para ensaiar o script contra `npm run dev`, use --permitir-http.");
    process.exit(2);
  }

  // Aceita com ou sem /mcp no fim: a confusao e previsivel, porque e a URL com
  // /mcp que vai no Claude, e e a sem /mcp que estas rotas usam.
  let caminho = base.pathname.replace(/\/+$/, "");
  if (caminho.endsWith("/mcp")) caminho = caminho.slice(0, -"/mcp".length);

  return { base: `${base.origin}${caminho}`, ...opcoes };
}

async function main() {
  const { base, rateLimit, timeout } = lerArgumentos(process.argv.slice(2));

  console.log(`Verificando ${base}`);
  console.log(`Timeout por requisicao: ${timeout} ms`);
  console.log(rateLimit ? "Com teste de rate limiting." : "Sem teste de rate limiting.");
  console.log("");

  await verificarHealth(base);
  await verificarMetadataAS(base);
  await verificarMetadataRecurso(base);
  await verificarMcpSemToken(base);
  await verificarRegistroRecusado(
    base,
    "/register com redirect de atacante",
    "https://atacante.example/callback",
  );
  await verificarRegistroRecusado(
    base,
    "/register com redirect de loopback",
    "http://localhost:6274/cb",
  );
  const clientId = await verificarRegistroAceito(base);
  await verificarAuthorize(base, clientId);
  if (rateLimit) await verificarRateLimit(base);

  imprimirTabela(resultados);

  const falhas = resultados.filter((r) => !r.ok);

  // A tabela trunca para ficar legível; aqui vai o valor inteiro de cada falha.
  // Sem isto, o campo que explica o problema pode ser justamente o que o corte
  // engoliu — foi o que aconteceu com o redirect_local no /health.
  if (falhas.length > 0) {
    console.log("");
    console.log("Detalhe das falhas:");
    for (const f of falhas) {
      console.log("");
      console.log(`  ${f.nome}`);
      console.log(`    esperado: ${f.esperado}`);
      console.log(`    obtido:   ${f.obtido}`);
    }
  }

  const comObservacao = resultados.filter((r) => r.observacao);
  if (comObservacao.length > 0) {
    console.log("");
    console.log("Observacoes:");
    for (const r of comObservacao) console.log(` - ${r.nome}: ${r.observacao}`);
  }

  if (clientesCriados.length > 0) {
    console.log("");
    console.log(`Clientes de teste criados no KV (${clientesCriados.length}).`);
    console.log("Apague um a um; nao ha delete em massa por prefixo:");
    console.log("");
    for (const c of clientesCriados) {
      console.log(
        "npx wrangler kv key delete --binding OAUTH_KV --remote --preview false " +
          `--config wrangler.jsonc "client:${c.client_id}"`,
      );
    }
    console.log("");
    console.log("O --remote nao e enfeite: sem ele o wrangler 4 mexe no KV LOCAL e nao diz nada,");
    console.log("entao o comando 'funciona' sem apagar nada em producao.");
    console.log("");
    console.log("Deixar estes clientes nao abre acesso a dado nenhum: eles so apontam para o");
    console.log("callback do Claude e nao tem grant. O motivo de apagar e higiene do KV.");
  }

  if (bloqueadoPorRateLimit && rateLimit) {
    console.log("");
    console.log("Para rodar o script de novo dentro da mesma hora, zere o contador:");
    console.log(
      "  npx wrangler kv key list --binding OAUTH_KV --remote --preview false --config wrangler.jsonc",
    );
    console.log("  (apague a chave que comeca com rl:register_ip:)");
  }

  console.log("");
  if (falhas.length === 0) {
    console.log(`Tudo passou: ${resultados.length} verificacao(oes).`);
    console.log("Proximo passo: item 6 do DEPLOY.md, adicionar o conector no Claude.");
    console.log(`A URL do conector e ${base}/mcp`);
    return;
  }

  console.log(`${falhas.length} de ${resultados.length} verificacao(oes) FALHOU/FALHARAM:`);
  for (const f of falhas) console.log(` - ${f.nome}`);
  console.log("");
  console.log("Nao conecte o Claude antes de resolver.");
  process.exitCode = 1;
}

await main();
