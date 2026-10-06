import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { garantirResponsaveisAtivos } from "./responsaveis.server";
import {
  BUCKET_ARQUIVOS,
  assinarLeitura,
  exigirEquipeInterna,
  pathArquivo,
  removerObjetos,
  verificarObjeto,
} from "./arte.server";
import {
  ARQUIVO_TAMANHO_MAX,
  arquivoDeclaradoSchema,
  camposDe,
  camposParaExibir,
  dimensoesDe,
  rotuloTipo,
  solicitacaoArteSchema,
  validarArquivos,
  type CategoriaArquivo,
  type SolicitacaoArte,
  type TipoArte,
} from "./arte/tipos";

/* ===========================================================================
 * Portal externo
 * =========================================================================== */

/** Molduras de foto de perfil cadastradas pela agência (brand_assets). */
async function tiposDeCargo(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("brand_assets")
    .select("valor")
    .eq("tipo", "moldura_cargo")
    .is("cliente_id", null)
    .eq("ativo", true);
  if (error) throw new Error(error.message);
  const nomes = (data ?? [])
    .map((r) => String((r.valor as { tipo_cargo?: unknown } | null)?.tipo_cargo ?? "").trim())
    .filter(Boolean);
  return Array.from(new Set(nomes)).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Opções do formulário. Projetos só têm RLS para a equipe interna, então a
 * leitura é aqui no servidor e devolve o mínimo: id e nome. */
export const listOpcoesFormularioArte = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("projetos")
      .select("id, nome")
      .order("nome", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      projetos: (data ?? []).map((p) => ({ id: p.id, nome: p.nome })),
      // Vazio enquanto a lista oficial de cargos não for cadastrada; o
      // formulário cai para texto livre nesse caso.
      tiposCargo: await tiposDeCargo(),
    };
  });

const iniciarSchema = z.object({
  dados: solicitacaoArteSchema,
  arquivos: z.array(arquivoDeclaradoSchema).max(16),
});

/**
 * Passo 1 de 3: valida tudo, cria o art_request como 'rascunho' e devolve URLs
 * assinadas de upload — uma por arquivo, com o path já decidido aqui. O
 * navegador nunca escolhe onde o arquivo vai parar.
 */
export const iniciarSolicitacaoArte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => iniciarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const dados = data.dados as SolicitacaoArte;

    const erroArquivos = validarArquivos(dados.tipo, data.arquivos);
    if (erroArquivos) throw new Error(erroArquivos);

    let projetoId: string | null = null;
    if ("projeto_id" in dados) {
      const { data: projeto, error } = await supabaseAdmin
        .from("projetos")
        .select("id")
        .eq("id", dados.projeto_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!projeto) throw new Error("Empresa não encontrada. Recarregue a página.");
      projetoId = projeto.id;
    }

    if (dados.tipo === "foto_perfil") {
      const cargos = await tiposDeCargo();
      if (
        cargos.length > 0 &&
        !cargos.some(
          (c) => c.toLocaleLowerCase("pt-BR") === dados.tipo_cargo.toLocaleLowerCase("pt-BR"),
        )
      ) {
        throw new Error("Tipo de cargo inválido.");
      }
    }

    // Um formulário aberto por vez: rascunhos anteriores (abas fechadas,
    // envios interrompidos) são descartados junto com os arquivos.
    const { data: antigos } = await supabaseAdmin
      .from("art_requests")
      .select("id, art_request_files(path)")
      .eq("solicitante_user_id", userId)
      .eq("status", "rascunho");
    if (antigos && antigos.length > 0) {
      await removerObjetos(antigos.flatMap((r) => r.art_request_files.map((f) => f.path)));
      await supabaseAdmin
        .from("art_requests")
        .delete()
        .in(
          "id",
          antigos.map((r) => r.id),
        );
    }

    const dim = dimensoesDe(dados);
    const { data: art, error: errArt } = await supabaseAdmin
      .from("art_requests")
      .insert({
        solicitante_user_id: userId,
        projeto_id: projetoId,
        tipo: dados.tipo,
        status: "rascunho",
        briefing: "briefing" in dados ? dados.briefing : null,
        campos: camposDe(dados),
        largura_px: dim.largura_px,
        altura_px: dim.altura_px,
        medida_impressao: dim.medida_impressao,
        qtd_slides: dados.tipo === "carrossel" ? dados.qtd_slides : 1,
        data_comemorativa: dados.tipo === "feed_data_comemorativa" ? dados.data : null,
      })
      .select("id")
      .single();
    if (errArt || !art) throw new Error(errArt?.message ?? "Falha ao registrar a solicitação.");

    try {
      const linhas = data.arquivos.map((a) => ({
        art_request_id: art.id,
        categoria: a.categoria,
        path: pathArquivo(userId, art.id, a.categoria as CategoriaArquivo, a.mime_type),
        nome_arquivo: a.nome_arquivo,
        mime_type: a.mime_type,
        tamanho_bytes: a.tamanho_bytes,
        enviado_por: userId,
      }));
      if (linhas.length > 0) {
        const { error } = await supabaseAdmin.from("art_request_files").insert(linhas);
        if (error) throw new Error(error.message);
      }

      const uploads = await Promise.all(
        linhas.map(async (l, indice) => {
          const { data: signed, error } = await supabaseAdmin.storage
            .from(BUCKET_ARQUIVOS)
            .createSignedUploadUrl(l.path);
          if (error || !signed) throw new Error(error?.message ?? "Falha ao preparar o upload.");
          return { indice, path: signed.path, token: signed.token };
        }),
      );

      return { art_request_id: art.id, uploads };
    } catch (e) {
      await supabaseAdmin.from("art_requests").delete().eq("id", art.id);
      throw e;
    }
  });

/** Texto da coluna demandas_externas.descricao (NOT NULL): um resumo legível
 * para quem olhar a demanda fora da aba Artes. */
function resumoParaDemanda(
  row: {
    tipo: string;
    briefing: string | null;
    campos: unknown;
    qtd_slides: number;
    data_comemorativa: string | null;
    largura_px: number;
    altura_px: number;
    medida_impressao: unknown;
  },
  projetoNome: string | null,
): string {
  const linhas = [`Arte: ${rotuloTipo(row.tipo)}`];
  if (projetoNome) linhas.push(`Empresa: ${projetoNome}`);
  for (const c of camposParaExibir(row)) linhas.push(`${c.rotulo}: ${c.valor}`);
  if (row.briefing) linhas.push("", row.briefing);
  return linhas.join("\n").slice(0, 5000);
}

/**
 * Passo 3 de 3 (o 2 é o upload direto pela URL assinada): confere os arquivos
 * no storage, cria a demanda do tipo 'arte' e tira o art_request do rascunho.
 */
export const enviarSolicitacaoArte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ art_request_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;

    const { data: art, error } = await supabaseAdmin
      .from("art_requests")
      .select(
        "id, tipo, status, briefing, campos, qtd_slides, data_comemorativa, largura_px, altura_px, medida_impressao, projetos(nome), art_request_files(id, path, categoria, mime_type)",
      )
      .eq("id", data.art_request_id)
      .eq("solicitante_user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!art || art.status !== "rascunho") {
      throw new Error("Solicitação não encontrada ou já enviada. Recarregue a página.");
    }

    const erroArquivos = validarArquivos(
      art.tipo as TipoArte,
      art.art_request_files as Array<{ categoria: CategoriaArquivo }>,
    );
    if (erroArquivos) throw new Error(erroArquivos);

    for (const f of art.art_request_files) {
      const tamanho = await verificarObjeto(f.path, f.mime_type, ARQUIVO_TAMANHO_MAX);
      const { error: errConf } = await supabaseAdmin
        .from("art_request_files")
        .update({ confirmado: true, tamanho_bytes: tamanho })
        .eq("id", f.id);
      if (errConf) throw new Error(errConf.message);
    }

    const { data: perfil } = await supabaseAdmin
      .from("demandas_externas_usuarios")
      .select("nome, email")
      .eq("id", userId)
      .maybeSingle();
    const emailClaims = typeof claims.email === "string" ? claims.email : null;
    const nome = perfil?.nome || emailClaims?.split("@")[0] || "Solicitante";

    const projetoNome = (art.projetos as { nome: string } | null)?.nome ?? null;
    const { data: demanda, error: errDem } = await supabaseAdmin
      .from("demandas_externas")
      .insert({
        solicitante_nome: nome,
        solicitante_email: perfil?.email ?? emailClaims,
        solicitante_user_id: userId,
        responsavel_id: null,
        descricao: resumoParaDemanda(art, projetoNome),
        tipo: "arte",
        status: "pendente",
      })
      .select("id")
      .single();
    if (errDem || !demanda) throw new Error(errDem?.message ?? "Falha ao registrar a demanda.");

    const { error: errLink } = await supabaseAdmin
      .from("art_requests")
      .update({ demanda_id: demanda.id, status: "enviada" })
      .eq("id", art.id)
      .eq("status", "rascunho");
    if (errLink) {
      await supabaseAdmin.from("demandas_externas").delete().eq("id", demanda.id);
      throw new Error(errLink.message);
    }

    return { demanda_id: demanda.id };
  });

/* ===========================================================================
 * Equipe interna
 * =========================================================================== */

/** Fila de artes para a equipe. Lida com o JWT do membro: a RLS da Fase 1
 * (eh_equipe_interna) é quem decide o que aparece; a checagem explícita acima
 * só dá uma mensagem clara em vez de lista vazia. */
export const listArtes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirEquipeInterna(context.userId);

    const { data, error } = await context.supabase
      .from("art_requests")
      .select(
        "id, tipo, status, briefing, campos, largura_px, altura_px, medida_impressao, qtd_slides, data_comemorativa, responsavel_id, status_alterado_por, status_alterado_em, criado_em, projetos(nome), demandas_externas(id, solicitante_nome, solicitante_email, justificativa_recusa, tarefa_id), art_request_files(id, path, categoria, nome_arquivo, mime_type, confirmado)",
      )
      .neq("status", "rascunho")
      .order("criado_em", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const urls = await assinarLeitura(
      rows.flatMap((r) => r.art_request_files.filter((f) => f.confirmado).map((f) => f.path)),
    );

    return rows.map((r) => ({
      id: r.id,
      tipo: r.tipo as TipoArte,
      status: r.status,
      briefing: r.briefing,
      detalhes: camposParaExibir(r),
      projeto_nome: (r.projetos as { nome: string } | null)?.nome ?? null,
      demanda: r.demandas_externas as {
        id: string;
        solicitante_nome: string;
        solicitante_email: string | null;
        justificativa_recusa: string | null;
        tarefa_id: string | null;
      } | null,
      responsavel_id: r.responsavel_id,
      status_alterado_por: r.status_alterado_por,
      status_alterado_em: r.status_alterado_em,
      criado_em: r.criado_em,
      arquivos: r.art_request_files
        .filter((f) => f.confirmado)
        .map((f) => ({
          id: f.id,
          categoria: f.categoria as CategoriaArquivo,
          nome_arquivo: f.nome_arquivo,
          url: urls.get(f.path) ?? null,
        })),
    }));
  });

const aceitarArteSchema = z.object({
  art_request_id: z.string().uuid(),
  responsavel_id: z.string().uuid(),
});

/**
 * Aceite pela equipe interna (qualquer membro ativo, não só admin).
 *
 * Por que server function e não UPDATE por RLS: demandas_externas só é
 * atualizável por "responsável ou admin", e abrir isso para a equipe toda
 * valeria também para as demandas gerais. Aqui o servidor confere
 * eh_equipe_interna e só então grava demandas_externas com service role.
 *
 * O status do art_request é gravado com o JWT do membro, então o trigger da
 * Fase 1 registra quem aceitou (status_alterado_por) e quando.
 */
export const aceitarDemandaArte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => aceitarArteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);
    await exigirEquipeInterna(data.responsavel_id).catch(() => {
      throw new Error("O responsável precisa ser da equipe interna ativa.");
    });
    await garantirResponsaveisAtivos([data.responsavel_id]);

    const { data: art, error } = await supabase
      .from("art_requests")
      .select(
        "id, tipo, status, briefing, campos, qtd_slides, data_comemorativa, largura_px, altura_px, medida_impressao, projeto_id, projetos(nome), demandas_externas(id, solicitante_nome, prazo_sugerido, status, tarefa_id)",
      )
      .eq("id", data.art_request_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const demanda = art?.demandas_externas as {
      id: string;
      solicitante_nome: string;
      prazo_sugerido: string | null;
      status: string;
      tarefa_id: string | null;
    } | null;
    if (!art || !demanda) throw new Error("Demanda de arte não encontrada.");
    if (
      art.status !== "enviada" ||
      (demanda.status !== "pendente" && demanda.status !== "transferida")
    ) {
      throw new Error("Esta demanda de arte já foi triada.");
    }

    const projetoNome = (art.projetos as { nome: string } | null)?.nome ?? null;
    const { data: tarefa, error: errTar } = await supabase
      .from("tarefas")
      .insert({
        titulo: `Arte — ${rotuloTipo(art.tipo)} — ${demanda.solicitante_nome}`.slice(0, 200),
        descricao: `${resumoParaDemanda(art, projetoNome)}\n\nArquivos e andamento na aba Artes.`,
        status: "Pendente",
        prioridade: "Média",
        data_vencimento: demanda.prazo_sugerido
          ? new Date(`${demanda.prazo_sugerido}T23:59:59.000-03:00`).toISOString()
          : null,
        tipo: "tarefa",
        escopo: "geral",
        criado_por: userId,
        projeto_id: art.projeto_id,
      })
      .select("id")
      .single();
    if (errTar || !tarefa) throw new Error(errTar?.message ?? "Falha ao criar tarefa");

    try {
      const { error: errResp } = await supabase
        .from("tarefa_responsaveis")
        .insert({ tarefa_id: tarefa.id, usuario_id: data.responsavel_id });
      if (errResp) throw new Error(errResp.message);

      const { error: errArt } = await supabase
        .from("art_requests")
        .update({ status: "aceita", responsavel_id: data.responsavel_id })
        .eq("id", art.id)
        .eq("status", "enviada");
      if (errArt) throw new Error(errArt.message);
    } catch (e) {
      await supabase.from("tarefas").delete().eq("id", tarefa.id);
      throw e;
    }

    const { error: errDem } = await supabaseAdmin
      .from("demandas_externas")
      .update({
        status: "aceita",
        tarefa_id: tarefa.id,
        responsavel_id: data.responsavel_id,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", demanda.id);
    if (errDem) throw new Error(errDem.message);

    return { tarefa_id: tarefa.id };
  });

const recusarArteSchema = z.object({
  art_request_id: z.string().uuid(),
  justificativa: z.string().trim().max(1000).optional(),
});

/** Recusa: mesmo efeito da recusa de demanda geral (sai da fila, arquivos são
 * apagados, quem enviou continua vendo como recusada), com o autor registrado. */
export const recusarDemandaArte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => recusarArteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);

    const { data: art, error } = await supabase
      .from("art_requests")
      .select("id, status, demanda_id, art_request_files(path)")
      .eq("id", data.art_request_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!art || !art.demanda_id) throw new Error("Demanda de arte não encontrada.");
    if (art.status !== "enviada") throw new Error("Esta demanda de arte já foi triada.");

    const { error: errArt } = await supabase
      .from("art_requests")
      .update({ status: "recusada" })
      .eq("id", art.id)
      .eq("status", "enviada");
    if (errArt) throw new Error(errArt.message);

    const { error: errDem } = await supabaseAdmin
      .from("demandas_externas")
      .update({
        status: "recusada",
        justificativa_recusa: data.justificativa || null,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", art.demanda_id);
    if (errDem) throw new Error(errDem.message);

    await removerObjetos(art.art_request_files.map((f) => f.path));
    await supabaseAdmin.from("art_request_files").delete().eq("art_request_id", art.id);

    return { ok: true };
  });
