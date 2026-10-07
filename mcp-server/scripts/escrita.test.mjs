/**
 * Testes das regras puras da etapa 4: escopos, datas, resumo da auditoria e os
 * avisos que a resposta das ferramentas de escrita dá ao modelo.
 *
 * O que depende do banco (RLS, auditoria, duplicata) é testado pelos ensaios
 * em supabase/tests/ e pelo roteiro do DEPLOY.md; aqui fica o que um edit
 * desatento quebraria sem nenhum typecheck reclamar — por exemplo, o -03:00 do
 * prazo virar UTC e toda tarefa vencer um dia antes.
 */
import {
  escoposEfetivos,
  ESCOPOS_PADRAO,
  ESCOPOS_SUPORTADOS,
  TEXTO_ESCOPO,
} from "../src/auth/escopos.ts";
import {
  COR_PADRAO,
  CONTEUDO_MAXIMO,
  CORES,
  escolherPorNome,
  nomeDaCor,
  trechoInicial,
} from "../src/mcp/ferramentas/murais.ts";
import { posicaoEntre } from "../src/mcp/ferramentas/murais-escrita.ts";
import {
  avisoDePrazo,
  avisoDeVisibilidade,
  CANAL_DE_AVISO,
  dataExiste,
  ehEu,
  normalizar,
  prazoParaTimestamp,
  resumirArgumentos,
  textoDeAviso,
} from "../src/mcp/ferramentas/escrita.ts";
import { createServer } from "../src/mcp/server.ts";

let falhas = 0;
function conferir(descricao, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.error(`FALHA  ${descricao}\n       esperado ${JSON.stringify(esperado)}`);
    console.error(`       obtido   ${JSON.stringify(obtido)}`);
  }
  return ok;
}

// --- escopos ---
conferir("crm:write é suportado", ESCOPOS_SUPORTADOS, ["crm:read", "crm:write"]);
conferir("padrão é leitura + escrita", ESCOPOS_PADRAO, ["crm:read", "crm:write"]);
conferir("sem scope -> padrão", escoposEfetivos([]), {
  ok: true,
  escopos: ["crm:read", "crm:write"],
});
conferir("só leitura continua possível", escoposEfetivos(["crm:read"]), {
  ok: true,
  escopos: ["crm:read"],
});
conferir("crm:write sozinho traz crm:read junto", escoposEfetivos(["crm:write"]), {
  ok: true,
  escopos: ["crm:read", "crm:write"],
});
conferir("escopo desconhecido some, conhecido fica", escoposEfetivos(["crm:admin", "crm:write"]), {
  ok: true,
  escopos: ["crm:read", "crm:write"],
});
conferir("só desconhecido é erro", escoposEfetivos(["crm:admin"]).ok, false);

// --- datas ---
conferir("data real existe", dataExiste("2026-10-07"), true);
conferir("29/02 de ano bissexto existe", dataExiste("2028-02-29"), true);
conferir("30/02 não existe", dataExiste("2026-02-30"), false);
conferir("mês 13 não existe", dataExiste("2026-13-01"), false);
conferir("formato errado não passa", dataExiste("07/10/2026"), false);

// O app grava fim do dia em Brasília: 23:59:59-03:00 = 02:59:59Z do dia seguinte.
conferir(
  "prazo é fim do dia em Brasília, igual ao toTimestamp do app",
  prazoParaTimestamp("2026-10-07"),
  "2026-10-08T02:59:59.000Z",
);

const agora = new Date("2026-10-07T15:00:00Z");
conferir("prazo de hoje não avisa", avisoDePrazo("2026-10-07", agora), "");
conferir("prazo futuro não avisa", avisoDePrazo("2026-10-08", agora), "");
conferir("prazo passado avisa", avisoDePrazo("2026-10-06", agora).includes("já passou"), true);

// --- normalização e 'eu' ---
conferir("normalizar ignora caixa e espaço", normalizar("  Revisar   ARTE "), "revisar arte");
conferir("'Eu' é a pessoa conectada", ehEu(" Eu "), true);
conferir("'Eunice' não é 'eu'", ehEu("Eunice"), false);

// --- resumo da auditoria ---
const longo = "x".repeat(500);
const resumo = resumirArgumentos({ titulo: longo, ausente: undefined, n: 3 });
conferir("texto da auditoria é cortado em 120", resumo.titulo.length, 120);
conferir("undefined não entra na auditoria", "ausente" in resumo, false);
conferir("número passa intacto", resumo.n, 3);
const enorme = resumirArgumentos({
  itens: Array.from({ length: 20 }, () => "y".repeat(60)),
  a: longo,
  b: longo,
  c: longo,
  d: longo,
  e: longo,
  f: longo,
  g: longo,
  h: longo,
  i: longo,
  j: longo,
  k: longo,
  l: longo,
  m: longo,
});
conferir("resumo grande demais vira só a lista de campos", enorme.truncado, true);
conferir("o resumo truncado cabe no CHECK de 2048", JSON.stringify(enorme).length < 2048, true);

// --- avisos ---
const ana = { id: "1", nome: "Ana", cargo: "Membro" };
const chefe = { id: "2", nome: "Chefe", cargo: "Admin" };
conferir("canal de aviso é só e-mail (decisão D)", CANAL_DE_AVISO, "e-mail");
conferir("aviso de designação cita e-mail", textoDeAviso([ana]).includes("e-mail"), true);
conferir("aviso de designação cita a pessoa", textoDeAviso([ana]).includes("«Ana»"), true);
conferir("sem responsável, sem aviso", textoDeAviso([]), "");
conferir(
  "Membro designando Admin é avisado que perde a tarefa",
  avisoDeVisibilidade("Membro", [chefe]).includes("não vai mais"),
  true,
);
conferir("Admin designando Admin não recebe aviso", avisoDeVisibilidade("Admin", [chefe]), "");
conferir(
  "Supervisor designando Admin não recebe aviso",
  avisoDeVisibilidade("Supervisor", [chefe]),
  "",
);
conferir("Membro designando Membro não recebe aviso", avisoDeVisibilidade("Membro", [ana]), "");

// --- registro condicional: escrita só com crm:write ---
// Registrar ferramenta não toca o banco, então props falsos bastam.
const envFalso = { SUPABASE_URL: "https://exemplo.supabase.co", SUPABASE_PUBLISHABLE_KEY: "x" };
const propsFalsos = {
  userId: "00000000-0000-0000-0000-000000000001",
  email: "teste@exemplo.com",
  cargo: "Membro",
  sbAccess: "jwt-falso",
  sbRefresh: "refresh-falso",
};
const ESCRITA = [
  "criar_tarefa",
  "atualizar_tarefa",
  "definir_responsaveis",
  "comentar_tarefa",
  "adicionar_itens_checklist",
  "marcar_item_checklist",
  // etapa 4b
  "criar_mural",
  "editar_mural",
  "criar_quadro",
  "editar_quadro",
  "colocar_tarefa_no_mural",
  "tirar_tarefa_do_mural",
  "criar_lembrete_no_mural",
  "editar_lembrete",
];

/** Mesmo truque do portabilidade.mjs: acha o mapa de ferramentas no McpServer. */
function nomesDasFerramentas(s) {
  for (const valor of [
    ...Object.values(s),
    ...Object.values(s._registeredTools ? { t: s._registeredTools } : {}),
  ]) {
    if (valor && typeof valor === "object") {
      const chaves = Object.keys(valor);
      if (
        chaves.length > 0 &&
        valor[chaves[0]] &&
        typeof valor[chaves[0]] === "object" &&
        "description" in valor[chaves[0]]
      ) {
        return chaves.sort();
      }
    }
  }
  return null;
}

const soLeitura = nomesDasFerramentas(createServer(envFalso, propsFalsos, ["crm:read"]));
const comEscrita = nomesDasFerramentas(
  createServer(envFalso, propsFalsos, ["crm:read", "crm:write"]),
);
const semLogin = nomesDasFerramentas(createServer(envFalso, null, ["crm:read", "crm:write"]));

conferir(
  "grant só de leitura: nenhuma ferramenta de escrita",
  soLeitura.filter((n) => ESCRITA.includes(n)),
  [],
);
conferir("grant só de leitura: 11 ferramentas", soLeitura.length, 11);
conferir(
  "grant só de leitura: as 3 de mural/lembrete aparecem",
  ["listar_murais", "ver_lembrete", "ver_mural"].every((n) => soLeitura.includes(n)),
  true,
);
conferir(
  "com crm:write: as 14 de escrita aparecem",
  comEscrita.filter((n) => ESCRITA.includes(n)),
  [...ESCRITA].sort(),
);
conferir("com crm:write: 25 ferramentas", comEscrita.length, 25);
conferir("sem login: só o whoami", semLogin, ["whoami"]);

// --- etapa 4b: murais e lembretes ---
conferir("cor padrão é a primeira da paleta do app", CORES[COR_PADRAO], "#7B68EE");
conferir("paleta tem as 10 cores do app", Object.keys(CORES).length, 10);
conferir("hex da paleta vira nome", nomeDaCor("#ef4444"), "vermelho");
conferir("hex fora da paleta volta como hex", nomeDaCor("#123456"), "#123456");

const quadros = [
  { id: "a", nome: "Hoje" },
  { id: "b", nome: "Hoje cedo" },
  { id: "c", nome: "Semana" },
];
conferir(
  "nome exato vence o parcial",
  escolherPorNome(quadros, " hoje ").map((q) => q.id),
  ["a"],
);
conferir(
  "parcial único resolve",
  escolherPorNome(quadros, "sem").map((q) => q.id),
  ["c"],
);
conferir(
  "trecho do meio resolve",
  escolherPorNome(quadros, "oje c").map((q) => q.id),
  ["b"],
);
conferir(
  "parcial ambíguo devolve todos (vira pedido de escolha)",
  escolherPorNome(quadros, "e").map((q) => q.id),
  ["a", "b", "c"],
);
conferir("nada casa: vazio", escolherPorNome(quadros, "mês"), []);

// posicaoEntre: a mesma regra do app (MuralView.tsx).
conferir("entre dois vizinhos: ponto médio", posicaoEntre(1, 2), 1.5);
conferir("depois do último: +1", posicaoEntre(3, undefined), 4);
conferir("antes do primeiro: -1", posicaoEntre(undefined, 1), 0);
conferir("lista vazia: 1", posicaoEntre(undefined, undefined), 1);

conferir("conteúdo de lembrete vai até 20 mil", CONTEUDO_MAXIMO, 20000);
conferir("trecho inicial corta e delimita", trechoInicial("x".repeat(500), 20).length, 22);
conferir("trecho inicial de vazio", trechoInicial("  "), "(sem conteúdo)");

// A auditoria nunca recebe o roteiro: só o tamanho. O resumo corta texto em
// 120, mas o conteúdo nem chega lá — este teste garante o corte de qualquer
// string que escape.
conferir(
  "resumo da auditoria não carrega texto longo",
  JSON.stringify(resumirArgumentos({ titulo: "t", conteudo_len: 18000 })).length < 200,
  true,
);

conferir(
  "consentimento de escrita cita murais e lembretes",
  TEXTO_ESCOPO["crm:write"].detalhe.includes("murais e lembretes"),
  true,
);

if (falhas > 0) {
  console.error(`\n${falhas} teste(s) falharam.`);
  process.exit(1);
}
console.log("Todos os testes de escrita passaram.");
