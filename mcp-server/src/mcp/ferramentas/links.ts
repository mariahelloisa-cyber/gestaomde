import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { citar, dataBr, linhaDePagina, rodapeDeDados, rotulo, texto } from "../formato";
import { consultar } from "../sessao";
import { ANOTACOES_LEITURA, camposDePaginacao, escaparLike, faixa, ok } from "./comuns";

/**
 * Busca em `pastas_links` e `pastas_links_itens`.
 *
 * LIMITE REAL DESTA FERRAMENTA: o item de link só tem `url`. Não há título nem
 * descrição por link — isso está no schema, não é escolha minha. Então a busca
 * casa em três coisas: nome da pasta, comentário da pasta e o texto da própria
 * URL. Procurar "contrato do cliente X" só acha se isso estiver no nome ou no
 * comentário da pasta. A descrição da ferramenta diz isso ao modelo, para ele
 * não prometer ao usuário uma busca que o dado não sustenta.
 */

const DESC =
  "Busca pastas de links salvos no CRM e os links dentro delas. A busca olha o nome " +
  "da pasta, o comentário da pasta e o texto da URL — os links não têm título próprio, " +
  "só o endereço. Use para 'onde está o link de X', 'quais pastas de links temos' ou " +
  "'me dá os links da pasta Y'. Sem busca, lista as pastas mais recentes.";

interface LinhaPasta {
  id: string;
  nome: string;
  comentario: string | null;
  criado_em: string;
}

export function registrarLinks(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    "buscar_links",
    {
      title: "Buscar links",
      description: DESC,
      inputSchema: z.object({
        busca: z
          .string()
          .describe("Texto procurado no nome da pasta, no comentário dela ou na URL.")
          .optional(),
        ...camposDePaginacao(),
      }),
      outputSchema: z.object({
        pastas: z.array(
          z.object({
            id: z.string(),
            nome: z.string(),
            comentario: z.string().optional(),
            criado_em: z.string(),
            links: z.array(z.object({ id: z.string(), url: z.string() })),
          }),
        ),
        total: z.number().int(),
        offset: z.number().int(),
        tem_mais: z.boolean(),
      }),
      annotations: { title: "Buscar links", ...ANOTACOES_LEITURA },
    },
    async (entrada) => buscarLinks(supabase, entrada),
  );
}

async function buscarLinks(
  supabase: SupabaseClient,
  entrada: { busca?: string; limite: number; offset: number },
) {
  const { limite, offset } = entrada;
  const termo = entrada.busca ? escaparLike(entrada.busca) : null;

  // Com busca, a URL também conta — e URL está na tabela filha. Então primeiro
  // descubro quais pastas têm link casando, e depois junto com as pastas cujo
  // nome ou comentário casam. Duas consultas, uma união de ids: o PostgREST não
  // faz `or` atravessando tabela sem embed, e embed com `or` traria pasta
  // inteira só porque um link casou, sem dizer qual.
  let idsPorUrl: string[] = [];
  if (termo) {
    const r = await consultar(() =>
      supabase.from("pastas_links_itens").select("pasta_id").ilike("url", `%${termo}%`).limit(500),
    );
    if (!r.ok) return r.resposta;
    idsPorUrl = [
      ...new Set(((r.dados ?? []) as Array<{ pasta_id: string }>).map((i) => i.pasta_id)),
    ];
  }

  let query = supabase
    .from("pastas_links")
    .select("id, nome, comentario, criado_em", { count: "exact" });

  if (termo) {
    const condicoes = [`nome.ilike.%${termo}%`, `comentario.ilike.%${termo}%`];
    if (idsPorUrl.length > 0) condicoes.push(`id.in.(${idsPorUrl.join(",")})`);
    query = query.or(condicoes.join(","));
  }

  const r = await consultar(() =>
    query.order("criado_em", { ascending: false }).range(...faixa(offset, limite)),
  );
  if (!r.ok) return r.resposta;

  const pastas = (r.dados ?? []) as unknown as LinhaPasta[];
  const total = r.total ?? pastas.length;

  if (pastas.length === 0) {
    return ok("Nenhuma pasta de links encontrada.", {
      pastas: [],
      total,
      offset,
      tem_mais: false,
    });
  }

  const itensRes = await consultar(() =>
    supabase
      .from("pastas_links_itens")
      .select("id, pasta_id, url")
      .in(
        "pasta_id",
        pastas.map((p) => p.id),
      )
      .order("criado_em", { ascending: true }),
  );
  if (!itensRes.ok) return itensRes.resposta;

  const itens = (itensRes.dados ?? []) as unknown as Array<{
    id: string;
    pasta_id: string;
    url: string;
  }>;

  const porPasta = new Map<string, Array<{ id: string; url: string }>>();
  for (const i of itens) {
    const lista = porPasta.get(i.pasta_id) ?? [];
    lista.push({ id: i.id, url: i.url });
    porPasta.set(i.pasta_id, lista);
  }

  const saida = pastas.map((p) => ({
    id: p.id,
    nome: p.nome,
    comentario: texto(p.comentario),
    criado_em: p.criado_em,
    links: porPasta.get(p.id) ?? [],
  }));

  const linhas = saida.map((p) => {
    const cabeca =
      `- Pasta: ${citar(p.nome, 120)}\n  id: ${p.id} · Criada em: ${dataBr(p.criado_em)}` +
      (texto(p.comentario) ? `\n  Comentário: ${rotulo(p.comentario, 200)}` : "");
    const links =
      p.links.length > 0
        ? p.links.map((l) => `    - ${citar(l.url, 300)} (id: ${l.id})`).join("\n")
        : "    (nenhum link nesta pasta)";
    return `${cabeca}\n  Links (${p.links.length}):\n${links}`;
  });

  const relato = [
    "Pastas de links:",
    "",
    linhas.join("\n"),
    "",
    linhaDePagina(pastas.length, total, offset),
    rodapeDeDados(),
  ].join("\n");

  return ok(relato, { pastas: saida, total, offset, tem_mais: offset + pastas.length < total });
}
