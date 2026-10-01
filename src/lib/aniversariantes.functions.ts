import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import {
  BUCKET_ANIVERSARIANTES,
  caminhoImagemPublica,
  dataHojeSaoPaulo,
  intervaloDoMes,
} from "./aniversariantes";
import { resolverLinkAniversariante } from "./aniversariantes.server";

/** Endereço público do sistema, usado nos metadados (og:image) do link. */
const SITE_URL = "https://xn--gestomde-uza.tec.br";

/** Validade das signed URLs da arte dentro do app. */
const SIGNED_URL_SEG = 60 * 60;

/* ---------------- Tipos compartilhados com o front ---------------- */

/** Uma arte do aniversariante, como está gravada no jsonb `imagens`. */
export interface ImagemAniversariante {
  path: string;
  nome: string;
  tipo: string;
}

/** A mesma arte já pronta para a tela: com a URL assinada do bucket privado. */
export interface ImagemComUrl extends ImagemAniversariante {
  /** Signed URL de 1h; a lista é recarregada antes de expirar. */
  url: string | null;
}

export interface Aniversariante {
  id: string;
  nome: string;
  /** "YYYY-MM-DD" — data civil, sem fuso. */
  data_comemoracao: string;
  /** Sempre com pelo menos um item. O primeiro é a capa: miniatura e og:image. */
  imagens: ImagemComUrl[];
  mensagem: string;
  publicado_em: string | null;
  publicado_por: string | null;
  publicado_por_nome: string | null;
  criado_por: string | null;
  criado_por_nome: string | null;
  criado_em: string;
}

/** O que o pop-up precisa: os aniversariantes de hoje e quais este usuário ainda não viu. */
export interface AniversariantesDeHoje {
  /** A data usada no cálculo ("YYYY-MM-DD" em America/Sao_Paulo). */
  hoje: string;
  aniversariantes: Aniversariante[];
  /** Ids que faltam ser vistos por quem está logado — vazio quando o pop-up não deve abrir. */
  nao_vistos: string[];
}

const COLUNAS =
  "id, nome, data_comemoracao, imagens, mensagem, publicado_em, publicado_por, criado_por, criado_em";

type LinhaAniversariante = {
  id: string;
  nome: string;
  data_comemoracao: string;
  imagens: unknown;
  mensagem: string;
  publicado_em: string | null;
  publicado_por: string | null;
  criado_por: string | null;
  criado_em: string;
};

/** Lê o jsonb da coluna descartando o que não tiver os três campos esperados. */
export function lerImagens(bruto: unknown): ImagemAniversariante[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.flatMap((i) => {
    const img = i as Partial<ImagemAniversariante> | null;
    if (!img?.path || !img.nome || !img.tipo) return [];
    return [{ path: img.path, nome: img.nome, tipo: img.tipo }];
  });
}

/** Hidrata as linhas com as signed URLs das artes e os nomes da equipe. */
async function montar(
  rows: LinhaAniversariante[],
  nomePorId: Map<string, string>,
): Promise<Aniversariante[]> {
  return Promise.all(
    rows.map(async ({ imagens, ...r }) => ({
      ...r,
      // Bucket privado: cada carregamento gera URLs novas.
      imagens: await Promise.all(
        lerImagens(imagens).map(async (img) => {
          const { data: signed } = await supabaseAdmin.storage
            .from(BUCKET_ANIVERSARIANTES)
            .createSignedUrl(img.path, SIGNED_URL_SEG);
          return { ...img, url: signed?.signedUrl ?? null };
        }),
      ),
      publicado_por_nome: r.publicado_por ? (nomePorId.get(r.publicado_por) ?? null) : null,
      criado_por_nome: r.criado_por ? (nomePorId.get(r.criado_por) ?? null) : null,
    })),
  );
}

async function nomesDaEquipe(supabase: SupabaseClient<Database>): Promise<Map<string, string>> {
  const { data } = await supabase.from("perfis_usuarios").select("id, nome");
  return new Map((data ?? []).map((p) => [p.id, p.nome]));
}

/* ---------------- Listagem e gestão (autenticado) ---------------- */

const listarSchema = z.object({
  ano: z.number().int().min(2000).max(2100),
  /** 1-12, ou null para o ano inteiro. */
  mes: z.number().int().min(1).max(12).nullish(),
});

/** Lista o mês (ou o ano) escolhido. Todo membro interno enxerga — quem pode
 * cadastrar/editar é decidido pelo RLS na hora de gravar. */
export const listarAniversariantes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => listarSchema.parse(input))
  .handler(async ({ data, context }): Promise<Aniversariante[]> => {
    const { supabase } = context;
    const { inicio, fim } = data.mes
      ? intervaloDoMes(data.ano, data.mes)
      : { inicio: `${data.ano}-01-01`, fim: `${data.ano}-12-31` };

    const [listaRes, nomePorId] = await Promise.all([
      supabase
        .from("aniversariantes")
        .select(COLUNAS)
        .gte("data_comemoracao", inicio)
        .lte("data_comemoracao", fim)
        .order("data_comemoracao", { ascending: true })
        .order("nome", { ascending: true }),
      nomesDaEquipe(supabase),
    ]);
    if (listaRes.error) throw new Error(listaRes.error.message);

    return montar((listaRes.data ?? []) as LinhaAniversariante[], nomePorId);
  });

/** Meses/anos que já têm cadastro, para o seletor de período não oferecer vazio. */
export const listarPeriodosAniversariantes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ano: number; mes: number; total: number }[]> => {
    const { data, error } = await context.supabase
      .from("aniversariantes")
      .select("data_comemoracao")
      .order("data_comemoracao", { ascending: false });
    if (error) throw new Error(error.message);

    const contagem = new Map<string, number>();
    for (const r of data ?? []) {
      const chave = (r.data_comemoracao as string).slice(0, 7); // "YYYY-MM"
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    }
    return [...contagem.entries()]
      .map(([chave, total]) => ({
        ano: Number(chave.slice(0, 4)),
        mes: Number(chave.slice(5, 7)),
        total,
      }))
      .sort((a, b) => b.ano - a.ano || b.mes - a.mes);
  });

/** Os aniversariantes de hoje (fuso de Brasília) e os que faltam ser vistos por
 * quem está logado. `nao_vistos` vazio = o pop-up não abre. */
export const getAniversariantesDeHoje = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AniversariantesDeHoje> => {
    const { supabase, userId } = context;
    const hoje = dataHojeSaoPaulo();

    const { data: rows, error } = await supabase
      .from("aniversariantes")
      .select(COLUNAS)
      .eq("data_comemoracao", hoje)
      .order("nome", { ascending: true });
    if (error) throw new Error(error.message);

    const lista = (rows ?? []) as LinhaAniversariante[];
    if (lista.length === 0) return { hoje, aniversariantes: [], nao_vistos: [] };

    const ids = lista.map((r) => r.id);
    const [vistasRes, nomePorId] = await Promise.all([
      supabase
        .from("aniversariante_visualizacoes")
        .select("aniversariante_id")
        .eq("usuario_id", userId)
        .in("aniversariante_id", ids),
      nomesDaEquipe(supabase),
    ]);
    const vistos = new Set((vistasRes.data ?? []).map((v) => v.aniversariante_id));

    return {
      hoje,
      aniversariantes: await montar(lista, nomePorId),
      nao_vistos: ids.filter((id) => !vistos.has(id)),
    };
  });

/** Registra a visualização do pop-up SÓ para quem está logado: fechar numa conta
 * não dispensa o pop-up das outras. */
export const marcarAniversariantesVistos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("aniversariante_visualizacoes").upsert(
      data.ids.map((id) => ({ usuario_id: userId, aniversariante_id: id })),
      { onConflict: "usuario_id,aniversariante_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const imagemSchema = z.object({
  path: z.string().min(1).max(400),
  nome: z.string().min(1).max(260),
  tipo: z.string().min(1).max(100),
});

/** Mesmo limite do CHECK no banco (ver 20261001160000). */
export const MAX_IMAGENS = 10;

const imagensSchema = z.array(imagemSchema).min(1, "Envie pelo menos uma arte.").max(MAX_IMAGENS);

const criarSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  /** "YYYY-MM-DD" com ano: o planejamento é mensal e não se repete sozinho. */
  data_comemoracao: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data no formato AAAA-MM-DD."),
  // Sem .trim(): acentos, emojis e quebras de linha vão pro banco como foram digitados.
  mensagem: z
    .string()
    .min(1)
    .max(4000)
    .refine((m) => m.trim().length > 0, "Escreva a mensagem."),
  /** Em ordem de exibição; a primeira é a capa. */
  imagens: imagensSchema,
});

export const criarAniversariante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => criarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: novo, error } = await supabase
      .from("aniversariantes")
      .insert({
        nome: data.nome,
        data_comemoracao: data.data_comemoracao,
        imagens: data.imagens,
        mensagem: data.mensagem,
        criado_por: userId,
      })
      .select("id")
      .single();
    if (error) {
      // RLS barra quem não é Admin/Supervisor.
      throw new Error(
        error.message.includes("row-level security")
          ? "Só Admin e Supervisor podem cadastrar aniversariantes."
          : error.message,
      );
    }
    return { id: novo.id };
  });

const editarSchema = z.object({
  id: z.string().uuid(),
  nome: z.string().trim().min(1).max(120).optional(),
  data_comemoracao: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data no formato AAAA-MM-DD.")
    .optional(),
  mensagem: z
    .string()
    .min(1)
    .max(4000)
    .refine((m) => m.trim().length > 0, "Escreva a mensagem.")
    .optional(),
  /**
   * A lista COMPLETA de artes depois da edição, na ordem final. Só é enviada
   * quando a galeria mudou; as artes que saíram são apagadas do bucket.
   */
  imagens: imagensSchema.optional(),
});

export const editarAniversariante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => editarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: atual, error: erroAtual } = await supabase
      .from("aniversariantes")
      .select("imagens")
      .eq("id", data.id)
      .maybeSingle();
    if (erroAtual) throw new Error(erroAtual.message);
    if (!atual) throw new Error("Aniversariante não encontrado.");

    const patch: Database["public"]["Tables"]["aniversariantes"]["Update"] = {};
    if (data.nome !== undefined) patch.nome = data.nome;
    if (data.data_comemoracao !== undefined) patch.data_comemoracao = data.data_comemoracao;
    if (data.mensagem !== undefined) patch.mensagem = data.mensagem;
    if (data.imagens) patch.imagens = data.imagens;
    if (Object.keys(patch).length === 0) return { ok: true };

    // RLS em UPDATE filtra silenciosamente em vez de dar erro: conferimos o retorno.
    const { data: alteradas, error } = await supabase
      .from("aniversariantes")
      .update(patch)
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!alteradas || alteradas.length === 0) {
      throw new Error("Só Admin e Supervisor podem editar aniversariantes.");
    }

    // As artes removidas só saem do bucket depois que o banco já gravou a lista
    // nova — se a ordem fosse inversa, uma falha no update deixaria o registro
    // apontando para arquivos que não existem mais.
    if (data.imagens) {
      const mantidos = new Set(data.imagens.map((i) => i.path));
      const removidos = lerImagens(atual.imagens)
        .map((i) => i.path)
        .filter((p) => !mantidos.has(p));
      if (removidos.length > 0) {
        await supabaseAdmin.storage.from(BUCKET_ANIVERSARIANTES).remove(removidos);
      }
    }
    return { ok: true };
  });

export const excluirAniversariante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: apagadas, error } = await supabase
      .from("aniversariantes")
      .delete()
      .eq("id", data.id)
      .select("id, imagens");
    if (error) throw new Error(error.message);
    if (!apagadas || apagadas.length === 0) {
      throw new Error("Só Admin e Supervisor podem excluir aniversariantes.");
    }
    // Os links compartilhados e as visualizações saem por ON DELETE CASCADE;
    // as artes precisam ser removidas à mão do bucket.
    const paths = apagadas.flatMap((a) => lerImagens(a.imagens).map((i) => i.path));
    if (paths.length > 0) {
      await supabaseAdmin.storage.from(BUCKET_ANIVERSARIANTES).remove(paths);
    }
    return { ok: true };
  });

/** "Marcar como publicado" / desfazer. Ação manual de qualquer membro interno —
 * nunca disparada por um clique em "Compartilhar". */
export const marcarPublicado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), publicado: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("marcar_aniversariante_publicado", {
      _id: data.id,
      _publicado: data.publicado,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Leitura pública pelo link (sem login) ---------------- */

export interface AniversarianteCompartilhado {
  nome: string;
  data_comemoracao: string;
  mensagem: string;
  /** Em ordem; a primeira é a capa. Cada `url` é o endpoint estável do link. */
  imagens: { nome: string; tipo: string; url: string }[];
  /** Absoluta e apontando para a capa — é o og:image da prévia. */
  capa_url_absoluta: string;
  expira_em: string | null;
}

/** Origem da requisição atual, para montar URLs absolutas no SSR. */
function origemDaRequisicao(): string {
  try {
    const request = getRequest();
    const host = request?.headers?.get("host");
    if (host) {
      const proto =
        request.headers.get("x-forwarded-proto") ??
        (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    /* fora de um contexto de requisição */
  }
  return SITE_URL;
}

/** Sem autenticação — validado só pelo token opaco. Devolve exclusivamente o
 * material daquele aniversariante: nome, data, arte e mensagem. Nada de quem
 * cadastrou, quem publicou, equipe, clientes ou qualquer dado interno. */
export const getAniversarianteCompartilhado = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<AniversarianteCompartilhado> => {
    const link = await resolverLinkAniversariante(data.token);
    if (!link) throw new Error("Link inválido, revogado ou expirado.");

    const { data: a, error } = await supabaseAdmin
      .from("aniversariantes")
      .select("nome, data_comemoracao, mensagem, imagens")
      .eq("id", link.aniversarianteId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!a) throw new Error("Este material não existe mais.");

    // Contador informativo para quem gerou o link; falha aqui não derruba a página.
    void supabaseAdmin
      .from("compartilhamentos")
      .update({ acessos: link.acessos + 1, ultimo_acesso_em: new Date().toISOString() })
      .eq("id", link.linkId)
      .then(() => undefined);

    // A página pública não recebe os paths do bucket: cada arte é buscada pelo
    // índice, através do endpoint que revalida o token a cada requisição.
    const imagens = lerImagens(a.imagens).map((img, i) => ({
      nome: img.nome,
      tipo: img.tipo,
      url: caminhoImagemPublica(data.token, i),
    }));

    return {
      nome: a.nome,
      data_comemoracao: a.data_comemoracao,
      mensagem: a.mensagem,
      imagens,
      capa_url_absoluta: `${origemDaRequisicao()}${caminhoImagemPublica(data.token, 0)}`,
      expira_em: link.expira_em,
    };
  });
