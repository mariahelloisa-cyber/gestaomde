import { TEXTO_ESCOPO, type Escopo } from "./escopos";

/**
 * HTML das páginas de login e consentimento, em português.
 *
 * Tudo que vem do cliente OAuth (nome, domínio, host do redirect) passa por
 * `esc()`. A doc do workers-oauth-provider é explícita: "Every string may come
 * from the client: escape it."
 */

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ESTILO = `
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --fg:#14161a;
          --muted:#5b6472; --line:#e3e6ea; --accent:#1f6feb; --danger:#b42318; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1115; --card:#171a21; --fg:#e8eaed; --muted:#9aa4b2;
            --line:#262b34; --accent:#4c8dff; --danger:#ff7b72; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center;
         justify-content:center; padding:24px; background:var(--bg); color:var(--fg);
         font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  .card { width:100%; max-width:420px; background:var(--card); border:1px solid var(--line);
          border-radius:14px; padding:28px; }
  h1 { margin:0 0 6px; font-size:19px; }
  p.sub { margin:0 0 22px; color:var(--muted); font-size:14px; }
  label { display:block; font-size:13px; color:var(--muted); margin:14px 0 6px; }
  input { width:100%; padding:10px 12px; font-size:15px; color:var(--fg);
          background:var(--bg); border:1px solid var(--line); border-radius:8px; }
  input:focus { outline:2px solid var(--accent); outline-offset:1px; }
  button { font:inherit; font-weight:600; padding:11px 16px; border-radius:8px;
           border:1px solid transparent; cursor:pointer; }
  .primary { width:100%; margin-top:20px; background:var(--accent); color:#fff; }
  .acoes { display:flex; gap:10px; margin-top:22px; }
  .acoes button { flex:1; }
  .ghost { background:transparent; color:var(--fg); border-color:var(--line); }
  .erro { margin:16px 0 0; padding:10px 12px; border-radius:8px; font-size:14px;
          color:var(--danger); border:1px solid var(--danger); background:transparent; }
  ul.escopos { margin:14px 0 0; padding:0; list-style:none; }
  ul.escopos li { padding:10px 12px; border:1px solid var(--line); border-radius:8px;
                  margin-bottom:8px; font-size:14px; }
  ul.escopos code { font-size:12px; color:var(--muted); }
  .alvo { padding:14px; border:1px solid var(--line); border-radius:8px;
          margin:18px 0 4px; }
  .alvo .rotulo { font-size:12px; text-transform:uppercase; letter-spacing:.04em;
                  color:var(--muted); margin:0 0 4px; }
  .alvo .dominio { font-size:16px; font-weight:600; word-break:break-all; }
  .alvo .quem { margin:8px 0 0; font-size:13px; color:var(--muted); }
  .aviso { margin:10px 0 0; padding:10px 12px; border-radius:8px; font-size:13px;
           color:var(--danger); border:1px solid var(--danger); }
  .rodape { margin:20px 0 0; font-size:12px; color:var(--muted); }
`;

function pagina(titulo: string, corpo: string): Response {
  const html = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(titulo)}</title>
<style>${ESTILO}</style>
</head><body><main class="card">${corpo}</main></body></html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Nada de cache: estas páginas carregam estado de autorização.
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Página de login. `erro` aparece quando a tentativa anterior falhou. */
export function paginaLogin(opts: { clientName: string; erro?: string }): Response {
  return pagina(
    "Entrar — CRM da agência",
    `
    <h1>Entrar no CRM</h1>
    <p class="sub">${esc(opts.clientName)} quer se conectar ao CRM. Use a mesma
      conta e senha que você usa no sistema.</p>
    ${opts.erro ? `<p class="erro">${esc(opts.erro)}</p>` : ""}
    <form method="POST" autocomplete="on">
      <label for="email">E-mail</label>
      <input id="email" name="email" type="email" required autofocus
             autocomplete="username" inputmode="email">
      <label for="senha">Senha</label>
      <input id="senha" name="senha" type="password" required
             autocomplete="current-password">
      <button class="primary" type="submit">Entrar</button>
    </form>
    <p class="rodape">Não criamos conta por aqui. Se você ainda não tem acesso ao
      CRM, peça um convite a um administrador da agência.</p>
  `,
  );
}

/**
 * Tela de consentimento. O `handle` vem do beginConsent() e vai no form — o
 * provider o amarra a um cookie deste navegador, de uso único, o que é a
 * proteção CSRF. Não há state assinado à mão aqui de propósito.
 *
 * O DOMÍNIO DE DESTINO VEM PRIMEIRO
 *
 *   Nome e logo do cliente são auto-declarados: um cliente registrado por DCR
 *   pode se chamar "Claude" e mandar o code para onde quiser. O único dado
 *   desta tela que o atacante não controla sem se entregar é o host do
 *   redirect_uri — é para lá que o acesso vai, de fato. Por isso ele aparece em
 *   destaque e com rótulo próprio, e o nome do cliente vem depois, como
 *   informação secundária.
 */
export function paginaConsentimento(opts: {
  clientName: string;
  clientDomain?: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
  escopos: readonly Escopo[];
  usuarioEmail: string;
  usuarioCargo: string;
  handle: string;
}): Response {
  const itens = opts.escopos
    .map((s) => {
      const texto = TEXTO_ESCOPO[s];
      return `<li><b>${esc(texto.titulo)}</b>
                <br>${esc(texto.detalhe)}
                <br><code>${esc(s)}</code></li>`;
    })
    .join("");

  return pagina(
    "Autorizar acesso — CRM da agência",
    `
    <h1>Autorizar acesso ao CRM</h1>
    <p class="sub">Você está autenticado como <b>${esc(opts.usuarioEmail)}</b>${
      opts.usuarioCargo ? ` (${esc(opts.usuarioCargo)})` : ""
    }.</p>

    <div class="alvo">
      <p class="rotulo">O acesso será enviado para</p>
      <div class="dominio">${esc(opts.redirectHost)}</div>
      <p class="quem">Aplicativo: <b>${esc(opts.clientName)}</b>${
        opts.clientDomain
          ? ` — domínio verificado: ${esc(opts.clientDomain)}`
          : " (nome não verificado)"
      }</p>
    </div>
    ${
      opts.redirectIsLoopback
        ? `<p class="aviso">Este acesso vai para um programa rodando no SEU computador.
             Qualquer programa local pode estar escutando nesse endereço, com qualquer
             nome. Só permita se você mesmo acabou de iniciar essa conexão.</p>`
        : ""
    }

    <p class="sub" style="margin:18px 0 0">Está pedindo permissão para:</p>
    <ul class="escopos">${itens}</ul>

    <form method="POST">
      <input type="hidden" name="handle" value="${esc(opts.handle)}">
      <div class="acoes">
        <button class="ghost" type="submit" name="decisao" value="negar">Negar</button>
        <button class="primary" style="margin-top:0" type="submit"
                name="decisao" value="permitir">Permitir</button>
      </div>
    </form>

    <p class="rodape">O assistente age sempre com as SUAS permissões: ele não
      enxerga nada que você já não enxergue no CRM.</p>
  `,
  );
}

/** Erro terminal, quando não há cliente OAuth para redirecionar de volta. */
export function paginaErro(titulo: string, detalhe: string, status = 400): Response {
  const r = pagina(
    titulo,
    `
    <h1>${esc(titulo)}</h1>
    <p class="sub">${esc(detalhe)}</p>
  `,
  );
  return new Response(r.body, { status, headers: r.headers });
}
