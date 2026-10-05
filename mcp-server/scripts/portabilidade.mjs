/**
 * Roda o verificador contra os schemas REAIS das ferramentas registradas.
 *
 * Monta o servidor com props e escopo de leitura falsos (nada toca o banco:
 * registrar ferramenta não consulta), pega o que o `tools/list` anunciaria e
 * passa cada inputSchema/outputSchema pelo acharProblemas.
 */
import { z } from "zod";
import { createServer } from "../src/mcp/server.ts";
import { acharProblemas } from "../src/mcp/portabilidade.ts";

const env = {
  SUPABASE_URL: "https://exemplo.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "chave-de-teste",
};

const props = {
  userId: "00000000-0000-0000-0000-000000000001",
  email: "teste@exemplo.com",
  cargo: "Admin",
  sbAccess: "jwt-falso",
  sbRefresh: "refresh-falso",
};

const server = createServer(env, props, ["crm:read", "crm:write"]);

// O McpServer guarda as ferramentas registradas; o nome exato do campo varia
// por versão, então procuro o mapa em vez de cravar o caminho.
function acharFerramentas(s) {
  for (const valor of Object.values(s)) {
    if (valor && typeof valor === "object") {
      const chaves = Object.keys(valor);
      if (chaves.length > 0 && chaves.every((k) => typeof k === "string")) {
        const primeiro = valor[chaves[0]];
        if (primeiro && typeof primeiro === "object" && "description" in primeiro) return valor;
      }
    }
  }
  return null;
}

const registradas = acharFerramentas(server) ?? acharFerramentas(server._registeredTools ?? {});

if (!registradas) {
  console.error("Não achei o mapa de ferramentas no McpServer. Ajuste o script.");
  process.exit(2);
}

let problemas = 0;
let ferramentas = 0;

for (const [nome, def] of Object.entries(registradas)) {
  ferramentas += 1;
  for (const lado of ["inputSchema", "outputSchema"]) {
    const esquema = def[lado];
    if (!esquema) continue;
    const json = z.toJSONSchema(esquema, { io: lado === "inputSchema" ? "input" : "output" });
    const achados = acharProblemas(json, `${nome}.${lado}`);
    for (const a of achados) {
      problemas += 1;
      console.error(`AVISO  ${a.caminho}: ${a.problema}`);
    }
  }
  const ann = def.annotations ?? {};
  const faltando = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"].filter(
    (k) => ann[k] === undefined,
  );
  if (faltando.length > 0) {
    problemas += 1;
    console.error(`AVISO  ${nome}.annotations: faltam ${faltando.join(", ")}`);
  }
}

console.log(`${ferramentas} ferramenta(s) verificada(s).`);
if (problemas > 0) {
  console.error(`${problemas} problema(s) de portabilidade.`);
  process.exit(1);
}
console.log("Nenhum problema de portabilidade.");
