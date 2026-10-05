/**
 * Verificador de portabilidade de JSON Schema.
 *
 * O Inspector tem um check chamado "Schema portability" que acusa construções
 * válidas no draft 2020-12 mas recusadas por consumidores comuns (OpenAPI 3.0,
 * geradores de código, validadores mais velhos). Dois avisos já apareceram no
 * `whoami` por causa de `.nullable()`.
 *
 * Em vez de confiar em disciplina, isto é verificável: exporto a lista de
 * problemas e o script `npm run portabilidade` roda contra os schemas reais de
 * todas as ferramentas. Vale para as sete da etapa 3 e para as que vierem.
 *
 * O que é tratado como problema, e por quê:
 *
 *   type em array      `{"type":["string","null"]}` — o que o Zod gera para
 *                      `.nullable()`. Use `.optional()`.
 *   "null" como tipo   mesmo problema em forma de `anyOf`.
 *   $ref / $defs       o Zod extrai para `$defs` quando a MESMA instância de
 *                      schema aparece duas vezes no mesmo objeto. A correção é
 *                      instância nova (uma função que devolve o schema).
 *   oneOf              pouco suportado; `anyOf` cobre o caso.
 *   exclusiveMinimum
 *   booleano           forma do draft-4; o Zod 4 não gera, mas um schema
 *                      escrito à mão poderia.
 */

export interface ProblemaDePortabilidade {
  caminho: string;
  problema: string;
}

export function acharProblemas(schema: unknown, caminho = "$"): ProblemaDePortabilidade[] {
  const achados: ProblemaDePortabilidade[] = [];

  if (Array.isArray(schema)) {
    schema.forEach((item, i) => achados.push(...acharProblemas(item, `${caminho}[${i}]`)));
    return achados;
  }
  if (!schema || typeof schema !== "object") return achados;

  const obj = schema as Record<string, unknown>;

  if (Array.isArray(obj.type)) {
    achados.push({
      caminho,
      problema: `"type" em array (${JSON.stringify(obj.type)}): troque .nullable() por .optional()`,
    });
  }
  if (obj.type === "null") {
    achados.push({ caminho, problema: `"type":"null"` });
  }
  if (typeof obj.$ref === "string") {
    achados.push({
      caminho,
      problema: `$ref (${obj.$ref}): instância de schema reaproveitada — use uma função que devolva uma nova`,
    });
  }
  if (obj.$defs !== undefined || obj.definitions !== undefined) {
    achados.push({ caminho, problema: "$defs/definitions no schema" });
  }
  if (obj.oneOf !== undefined) {
    achados.push({ caminho, problema: "oneOf: prefira anyOf" });
  }
  if (typeof obj.exclusiveMinimum === "boolean" || typeof obj.exclusiveMaximum === "boolean") {
    achados.push({ caminho, problema: "exclusiveMinimum/Maximum booleano (forma do draft-4)" });
  }

  for (const [chave, valor] of Object.entries(obj)) {
    if (chave === "$schema") continue;
    achados.push(...acharProblemas(valor, `${caminho}.${chave}`));
  }

  return achados;
}
