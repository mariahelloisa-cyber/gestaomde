import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { garantirResponsaveisAtivos } from "./responsaveis.server";
import { liberarGeracoesTravadas } from "./arte-geracao-ia.server";
import { liberarComposicoesTravadas } from "./arte-foto-perfil.server";
import { ehComposicaoFotoPerfil } from "./arte/foto-perfil";
import {
  BUCKET_APROVADAS,
  BUCKET_ARQUIVOS,
  BUCKET_GERADAS,
  EXTENSAO,
  assinarLeitura,
  exigirAdmin,
  exigirEquipeInterna,
  listarArquivos,
  pathArquivo,
  removerObjetos,
  urlDeUpload,
  verificarObjeto,
} from "./arte.server";
import {
  ARQUIVO_MIMES,
  ARQUIVO_TAMANHO_MAX,
  ARTE_PRONTA_TAMANHO_MAX_MB,
  arquivoDeclaradoSchema,
  slidesEsperados,
  camposDe,
  camposParaExibir,
  dimensoesDe,
  direcaoCriativaDe,
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

/** Opções do formulário. Projetos só têm RLS para a equipe interna, então a
 * leitura é aqui no servidor e devolve o mínimo: id e nome.
 * O nível do cargo da foto de perfil é uma lista FIXA (NIVEIS_CARGO em
 * arte/tipos.ts), não vem das molduras cadastradas: a moldura é insumo da
 * geração, não define as opções do formulário. */
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

    // ai_generation_jobs tem DUAS relações com art_requests (jobs.art_request_id
    // e art_requests.job_aprovado_id): o embed precisa do nome da FK.
    const { data, error } = await context.supabase
      .from("art_requests")
      .select(
        "id, tipo, status, briefing, campos, largura_px, altura_px, medida_impressao, qtd_slides, data_comemorativa, max_geracoes, responsavel_id, status_alterado_por, status_alterado_em, aprovado_por, aprovado_em, job_aprovado_id, criado_em, projetos(nome), demandas_externas(id, solicitante_nome, solicitante_email, justificativa_recusa, tarefa_id), art_request_files(id, path, categoria, nome_arquivo, mime_type, confirmado), ai_generation_jobs!ai_generation_jobs_art_request_id_fkey(id, origem, status, solicitado_por, criado_em, concluido_em, lease_ate, erro, openai_response_id, parametros, ai_generations(id, slide_index, variacao, path, path_aprovado, status, largura, altura)), ai_generation_reviews(id, job_id, decisao, comentario, revisor_id, criado_em)",
      )
      .neq("status", "rascunho")
      .order("criado_em", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    // Só as 3 versões mais recentes de cada arte vão com imagem assinada.
    const versoesDe = (r: (typeof rows)[number]) =>
      [...r.ai_generation_jobs]
        .filter((j) => j.status === "concluido")
        .sort((a, b) => b.criado_em.localeCompare(a.criado_em))
        .slice(0, 3);
    const gens = rows.flatMap((r) => versoesDe(r).flatMap((j) => j.ai_generations));
    const [urls, urlsGeradas, urlsAprovadas] = await Promise.all([
      assinarLeitura(
        rows.flatMap((r) => r.art_request_files.filter((f) => f.confirmado).map((f) => f.path)),
      ),
      assinarLeitura(
        gens.map((g) => g.path),
        BUCKET_GERADAS,
      ),
      assinarLeitura(
        gens.flatMap((g) => (g.path_aprovado ? [g.path_aprovado] : [])),
        BUCKET_APROVADAS,
      ),
    ]);

    const agora = new Date().toISOString();
    return rows.map((r) => {
      const ativo = r.ai_generation_jobs.find(
        (j) => j.status === "na_fila" || j.status === "processando",
      );
      // Geração com IA que passou do lease foi abandonada: a próxima ação
      // (gerar ou enviar) a encerra, então não bloqueia a tela.
      const iaTravada = ativo?.origem === "ia" && !!ativo.lease_ate && ativo.lease_ate < agora;
      // Montagem de foto de perfil: origem 'manual', mas roda no servidor em
      // segundos — não é um envio do navegador para descartar.
      const ativoComposicao = !!ativo && ehComposicaoFotoPerfil(ativo.parametros);
      const composicaoTravada = ativoComposicao && (!ativo.lease_ate || ativo.lease_ate < agora);
      // O job mais recente da arte, se for uma geração com IA que falhou ou
      // foi abandonada: a tela explica o que houve e oferece tentar de novo.
      const ultimo = [...r.ai_generation_jobs].sort((x, y) =>
        y.criado_em.localeCompare(x.criado_em),
      )[0];
      const ultimoIaFalhou =
        ultimo?.origem === "ia" &&
        (ultimo.status === "falhou" ||
          (ultimo.status === "processando" && !!ultimo.lease_ate && ultimo.lease_ate < agora));
      return {
        id: r.id,
        tipo: r.tipo as TipoArte,
        status: r.status,
        briefing: r.briefing,
        qtd_slides: r.qtd_slides,
        largura_px: r.largura_px,
        altura_px: r.altura_px,
        aprovado_por: r.aprovado_por,
        aprovado_em: r.aprovado_em,
        job_aprovado_id: r.job_aprovado_id,
        // Envio manual que ficou aberto (ex.: aba fechada no meio do upload) —
        // a tela oferece descartar, senão o índice de job ativo bloqueia novos envios.
        job_ativo_id: ativo && ativo.origem === "manual" && !ativoComposicao ? ativo.id : null,
        compondo_foto: ativoComposicao && !composicaoTravada,
        gerando_ia: ativo?.origem === "ia" && !iaTravada,
        falha_ia: ultimoIaFalhou
          ? {
              job_id: ultimo.id,
              criado_em: ultimo.criado_em,
              erro: ultimo.erro || "Geração interrompida (tempo esgotado).",
              // A OpenAI respondeu (e cobrou), mas a gravação não terminou.
              openai_respondeu: !!ultimo.openai_response_id,
            }
          : null,
        geracoes_ia: {
          usadas: r.ai_generation_jobs.filter(
            (j) => j.origem === "ia" && j.status !== "falhou" && j.status !== "cancelado",
          ).length,
          max: r.max_geracoes,
        },
        versoes: versoesDe(r).map((j) => ({
          id: j.id,
          origem: j.origem,
          /** Foto de perfil montada no modelo (sem IA). */
          composicao: ehComposicaoFotoPerfil(j.parametros),
          solicitado_por: j.solicitado_por,
          concluido_em: j.concluido_em,
          imagens: [...j.ai_generations]
            .sort((a, b) => a.slide_index - b.slide_index || a.variacao - b.variacao)
            .map((g) => ({
              id: g.id,
              slide_index: g.slide_index,
              variacao: g.variacao,
              largura: g.largura,
              altura: g.altura,
              status: g.status,
              url: g.path_aprovado
                ? (urlsAprovadas.get(g.path_aprovado) ?? null)
                : (urlsGeradas.get(g.path) ?? null),
            })),
        })),
        revisoes: [...r.ai_generation_reviews].sort((a, b) =>
          b.criado_em.localeCompare(a.criado_em),
        ),
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
      };
    });
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
        descricao: [
          resumoParaDemanda(art, projetoNome),
          direcaoCriativaDe(art.tipo) && `Direção criativa: ${direcaoCriativaDe(art.tipo)}`,
          "Arquivos e andamento na aba Artes.",
        ]
          .filter(Boolean)
          .join("\n\n"),
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

const STATUS_EM_ANDAMENTO = ["aceita", "em_geracao", "aguardando_revisao", "ajustes"];

/**
 * Exclusão DEFINITIVA de uma arte em andamento (só Admin/Supervisor).
 *
 * Apaga a demanda externa — o CASCADE leva art_request, arquivos enviados,
 * jobs, gerações e revisões —, a tarefa criada no aceite e todos os arquivos
 * no Storage (enviados, gerados, brutos e aprovados). Some também do portal
 * do solicitante. Recusa se houver geração ou envio rodando, para nenhum
 * arquivo ser gravado depois da exclusão.
 */
export const excluirDemandaArte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ art_request_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await exigirAdmin(context.userId);

    const { data: art, error } = await supabaseAdmin
      .from("art_requests")
      .select(
        "id, status, demanda_id, demandas_externas(tarefa_id), art_request_files(path), ai_generation_jobs!ai_generation_jobs_art_request_id_fkey(id, origem, status, lease_ate)",
      )
      .eq("id", data.art_request_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!art || !art.demanda_id) throw new Error("Demanda de arte não encontrada.");
    if (!STATUS_EM_ANDAMENTO.includes(art.status)) {
      throw new Error("Só dá para excluir uma arte em andamento.");
    }

    const agora = new Date().toISOString();
    const ativo = art.ai_generation_jobs.find(
      (j) =>
        (j.status === "na_fila" || j.status === "processando") &&
        // Geração com IA que passou do lease já foi abandonada.
        !(j.origem === "ia" && j.lease_ate && j.lease_ate < agora),
    );
    if (ativo) {
      throw new Error(
        ativo.origem === "ia"
          ? "Há uma geração com IA em andamento. Espere terminar para excluir."
          : "Há um envio de arte em andamento. Descarte o envio antes de excluir.",
      );
    }

    // Lista os arquivos ANTES de apagar as linhas; o Storage é limpo depois,
    // para uma falha no banco não deixar linhas apontando para nada.
    const [geradas, aprovadas] = await Promise.all([
      listarArquivos(BUCKET_GERADAS, art.id),
      listarArquivos(BUCKET_APROVADAS, art.id),
    ]);
    const enviados = art.art_request_files.map((f) => f.path);
    const tarefaId = (art.demandas_externas as { tarefa_id: string | null } | null)?.tarefa_id;

    const { error: errDem } = await supabaseAdmin
      .from("demandas_externas")
      .delete()
      .eq("id", art.demanda_id);
    if (errDem) throw new Error(errDem.message);

    if (tarefaId) {
      const { error: errTar } = await supabaseAdmin.from("tarefas").delete().eq("id", tarefaId);
      if (errTar) console.error("[arte] não excluiu a tarefa", tarefaId, errTar.message);
    }

    await Promise.all([
      removerObjetos(enviados, BUCKET_ARQUIVOS),
      removerObjetos(geradas, BUCKET_GERADAS),
      removerObjetos(aprovadas, BUCKET_APROVADAS),
    ]);

    return { ok: true, arquivos_removidos: enviados.length + geradas.length + aprovadas.length };
  });

/* ===========================================================================
 * Arte pronta enviada pela equipe (sem IA) -> revisão -> entrega
 * =========================================================================== */

const MB = 1024 * 1024;
const STATUS_RECEBE_ARTE = ["aceita", "ajustes", "aguardando_revisao"];

type ArquivoManual = { slide_index: number; path: string; mime_type: string };

const iniciarManualSchema = z.object({
  art_request_id: z.string().uuid(),
  arquivos: z
    .array(
      z.object({
        slide_index: z.number().int().min(1).max(10),
        mime_type: z.enum(ARQUIVO_MIMES),
        tamanho_bytes: z
          .number()
          .int()
          .min(1)
          .max(ARTE_PRONTA_TAMANHO_MAX_MB * MB),
      }),
    )
    .min(1)
    .max(10),
});

/**
 * Passo 1: abre um job com origem 'manual' (gravado com service role — a
 * coluna origem não é gravável pelo membro) e devolve uma URL assinada por
 * slide. O job nasce 'processando', então o índice "um job ativo por demanda"
 * da Fase 1 impede dois envios simultâneos para a mesma arte.
 */
export const iniciarUploadManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => iniciarManualSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);

    const { data: art, error } = await supabase
      .from("art_requests")
      .select("id, tipo, status, qtd_slides")
      .eq("id", data.art_request_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!art) throw new Error("Demanda de arte não encontrada.");
    if (!STATUS_RECEBE_ARTE.includes(art.status)) {
      throw new Error("Só dá para enviar arte de uma demanda aceita.");
    }

    const esperado = slidesEsperados(art.tipo, art.qtd_slides);
    const slides = new Set(data.arquivos.map((a) => a.slide_index));
    const completo =
      data.arquivos.length === esperado &&
      slides.size === esperado &&
      Array.from({ length: esperado }, (_, i) => i + 1).every((s) => slides.has(s));
    if (!completo) {
      throw new Error(
        esperado === 1
          ? "Envie uma imagem."
          : `Envie uma imagem para cada um dos ${esperado} slides.`,
      );
    }

    // Geração com IA ou montagem abandonada (passou do lease) não pode travar
    // o envio manual.
    await liberarGeracoesTravadas(art.id);
    await liberarComposicoesTravadas(art.id);

    const jobId = crypto.randomUUID();
    const arquivos: ArquivoManual[] = data.arquivos.map((a) => ({
      slide_index: a.slide_index,
      mime_type: a.mime_type,
      path: `${art.id}/${jobId}/s${String(a.slide_index).padStart(2, "0")}-v1.${EXTENSAO[a.mime_type]}`,
    }));

    const { error: errJob } = await supabaseAdmin.from("ai_generation_jobs").insert({
      id: jobId,
      art_request_id: art.id,
      origem: "manual",
      status: "processando",
      solicitado_por: userId,
      iniciado_em: new Date().toISOString(),
      insumos: { arquivos },
    });
    if (errJob) {
      if (errJob.code === "23505") throw new Error("Já há um envio em andamento para esta arte.");
      throw new Error(errJob.message);
    }

    try {
      const uploads = await Promise.all(
        arquivos.map(async (a) => ({
          slide_index: a.slide_index,
          ...(await urlDeUpload(BUCKET_GERADAS, a.path)),
        })),
      );
      return { job_id: jobId, uploads };
    } catch (e) {
      await supabaseAdmin
        .from("ai_generation_jobs")
        .update({ status: "falhou", erro: "Falha ao preparar o upload." })
        .eq("id", jobId);
      throw e;
    }
  });

async function jobManualAberto(jobId: string) {
  const { data: job, error } = await supabaseAdmin
    .from("ai_generation_jobs")
    .select("id, art_request_id, origem, status, insumos")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job || job.origem !== "manual" || job.status !== "processando") {
    throw new Error("Envio não encontrado ou já encerrado.");
  }
  const lista = (job.insumos as { arquivos?: ArquivoManual[] } | null)?.arquivos ?? [];
  const arquivos = lista.filter(
    (a) => typeof a.path === "string" && a.path.startsWith(`${job.art_request_id}/${job.id}/`),
  );
  return { job, arquivos };
}

/** Passo 3: confere os arquivos, registra as imagens e põe a arte em revisão. */
export const concluirUploadManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ job_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);
    const { job, arquivos } = await jobManualAberto(data.job_id);

    try {
      for (const a of arquivos) {
        await verificarObjeto(a.path, a.mime_type, ARTE_PRONTA_TAMANHO_MAX_MB * MB, BUCKET_GERADAS);
      }
      const { error: errGen } = await supabaseAdmin.from("ai_generations").insert(
        arquivos.map((a) => ({
          job_id: job.id,
          art_request_id: job.art_request_id,
          slide_index: a.slide_index,
          variacao: 1,
          path: a.path,
          mime_type: a.mime_type,
        })),
      );
      if (errGen) throw new Error(errGen.message);

      const { error: errJob } = await supabaseAdmin
        .from("ai_generation_jobs")
        .update({ status: "concluido" })
        .eq("id", job.id);
      if (errJob) throw new Error(errJob.message);
    } catch (e) {
      await supabaseAdmin
        .from("ai_generation_jobs")
        .update({
          status: "falhou",
          erro: e instanceof Error ? e.message.slice(0, 500) : "falhou",
        })
        .eq("id", job.id);
      await removerObjetos(
        arquivos.map((a) => a.path),
        BUCKET_GERADAS,
      );
      throw e;
    }

    // Versão anterior ainda sem decisão deixa de valer: só a nova vai para revisão.
    await supabaseAdmin
      .from("ai_generations")
      .update({ status: "descartada" })
      .eq("art_request_id", job.art_request_id)
      .eq("status", "gerada")
      .neq("job_id", job.id);

    // Com o JWT do membro: o trigger registra quem mandou para revisão.
    const { error: errArt } = await supabase
      .from("art_requests")
      .update({ status: "aguardando_revisao" })
      .eq("id", job.art_request_id)
      .in("status", STATUS_RECEBE_ARTE);
    if (errArt) throw new Error(errArt.message);

    return { ok: true };
  });

/** Desfaz um envio interrompido (falha de upload no navegador). */
export const cancelarUploadManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ job_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await exigirEquipeInterna(context.userId);
    const { job, arquivos } = await jobManualAberto(data.job_id);
    await supabaseAdmin
      .from("ai_generation_jobs")
      .update({ status: "cancelado", cancelado_por: context.userId })
      .eq("id", job.id);
    await removerObjetos(
      arquivos.map((a) => a.path),
      BUCKET_GERADAS,
    );
    return { ok: true };
  });

const revisarSchema = z
  .object({
    job_id: z.string().uuid(),
    decisao: z.enum(["aprovada", "ajuste_solicitado", "recusada"]),
    comentario: z.string().trim().max(2000).optional(),
    /** Aprovação de versão com variações: a escolhida de cada slide. */
    generation_ids: z.array(z.string().uuid()).min(1).max(10).optional(),
  })
  .refine((d) => d.decisao !== "ajuste_solicitado" || !!d.comentario, {
    message: "Descreva o ajuste pedido.",
    path: ["comentario"],
  });

/**
 * Revisão por qualquer membro interno ativo.
 *
 * Aprovar: copia as imagens para approved-arts, registra a revisão, marca as
 * imagens e conclui a arte. A conclusão passa pelo trigger da Fase 1, que só
 * aceita 'concluida' com uma revisão 'aprovada' deste job — então mesmo um
 * bug aqui não entrega arte sem aprovação.
 *
 * Pedir ajuste / recusar versão: registra a revisão e devolve a arte para
 * 'ajustes' (a demanda continua; a equipe envia outra versão).
 */
export const revisarArte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => revisarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirEquipeInterna(userId);

    const { data: job, error } = await supabase
      .from("ai_generation_jobs")
      .select(
        "id, art_request_id, status, ai_generations(id, slide_index, path, mime_type, status)",
      )
      .eq("id", data.job_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job || job.status !== "concluido") throw new Error("Versão não encontrada.");

    const { data: art, error: errArt } = await supabase
      .from("art_requests")
      .select("id, tipo, status, qtd_slides, demandas_externas(tarefa_id)")
      .eq("id", job.art_request_id)
      .maybeSingle();
    if (errArt) throw new Error(errArt.message);
    if (!art || art.status !== "aguardando_revisao") {
      throw new Error("Esta arte não está aguardando revisão.");
    }

    const imagens = job.ai_generations.filter((g) => g.status === "gerada");
    if (imagens.length === 0) throw new Error("Esta versão já foi revisada ou substituída.");
    const ids = imagens.map((g) => g.id);

    if (data.decisao !== "aprovada") {
      const { error: errRev } = await supabase.from("ai_generation_reviews").insert({
        art_request_id: art.id,
        job_id: job.id,
        decisao: data.decisao,
        generation_ids: ids,
        comentario: data.comentario || null,
      });
      if (errRev) throw new Error(errRev.message);
      await supabase.from("ai_generations").update({ status: "recusada" }).in("id", ids);
      const { error: errSt } = await supabase
        .from("art_requests")
        .update({ status: "ajustes" })
        .eq("id", art.id)
        .eq("status", "aguardando_revisao");
      if (errSt) throw new Error(errSt.message);
      return { ok: true };
    }

    // Versão com variações (IA): aprova só a escolhida de cada slide; as
    // outras viram 'descartada'. Versão manual (uma por slide) aprova tudo.
    const escolhidas = data.generation_ids
      ? imagens.filter((g) => data.generation_ids!.includes(g.id))
      : imagens;
    if (data.generation_ids && escolhidas.length !== data.generation_ids.length) {
      throw new Error("A variação escolhida não é desta versão. Recarregue a página.");
    }
    const esperado = slidesEsperados(art.tipo, art.qtd_slides);
    const slides = new Set(escolhidas.map((g) => g.slide_index));
    const comVariacoes = new Set(imagens.map((g) => g.slide_index)).size < imagens.length;
    if (escolhidas.length !== esperado || slides.size !== esperado) {
      throw new Error(
        comVariacoes
          ? "Escolha uma variação para aprovar."
          : "Esta versão está incompleta: falta imagem de algum slide.",
      );
    }
    const naoEscolhidas = imagens.filter((g) => !escolhidas.includes(g)).map((g) => g.id);

    // 1) Cópia para approved-arts. Remove antes para o retry ser idempotente.
    for (const g of escolhidas) {
      const destino = `${art.id}/${g.id}.${EXTENSAO[g.mime_type] ?? "png"}`;
      await supabaseAdmin.storage.from(BUCKET_APROVADAS).remove([destino]);
      const { error: errCopia } = await supabaseAdmin.storage
        .from(BUCKET_GERADAS)
        .copy(g.path, destino, { destinationBucket: BUCKET_APROVADAS });
      if (errCopia) throw new Error(`Falha ao copiar a arte aprovada: ${errCopia.message}`);
      // path_aprovado não é gravável pelo membro (GRANT da Fase 1).
      const { error: errPath } = await supabaseAdmin
        .from("ai_generations")
        .update({ path_aprovado: destino })
        .eq("id", g.id);
      if (errPath) throw new Error(errPath.message);
    }

    // 2) Revisão e status, com o JWT do membro (autoria registrada por trigger).
    const { error: errRev } = await supabase.from("ai_generation_reviews").insert({
      art_request_id: art.id,
      job_id: job.id,
      decisao: "aprovada",
      generation_ids: escolhidas.map((g) => g.id),
      comentario: data.comentario || null,
    });
    if (errRev) throw new Error(errRev.message);

    const { error: errGen } = await supabase
      .from("ai_generations")
      .update({ status: "aprovada" })
      .in(
        "id",
        escolhidas.map((g) => g.id),
      );
    if (errGen) throw new Error(errGen.message);
    if (naoEscolhidas.length > 0) {
      const { error: errDesc } = await supabase
        .from("ai_generations")
        .update({ status: "descartada" })
        .in("id", naoEscolhidas);
      if (errDesc) throw new Error(errDesc.message);
    }

    const { error: errFim } = await supabase
      .from("art_requests")
      .update({ job_aprovado_id: job.id, status: "concluida" })
      .eq("id", art.id)
      .eq("status", "aguardando_revisao");
    if (errFim) throw new Error(errFim.message);

    // 3) A tarefa criada no aceite acompanha a entrega. Não bloqueia a
    //    aprovação se a RLS de tarefas não deixar este membro editá-la.
    const tarefaId = (art.demandas_externas as { tarefa_id: string | null } | null)?.tarefa_id;
    if (tarefaId) {
      const { error: errTar } = await supabase
        .from("tarefas")
        .update({ status: "Concluído" })
        .eq("id", tarefaId);
      if (errTar) console.error("[arte] não concluiu a tarefa", tarefaId, errTar.message);
    }

    return { ok: true };
  });

/**
 * Download para o SOLICITANTE: só da própria demanda, só com a arte
 * 'concluida', só os arquivos aprovados. Links de 5 minutos, gerados na hora
 * do clique — nunca vão na listagem.
 */
export const linksArteAprovada = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ demanda_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: art, error } = await supabaseAdmin
      .from("art_requests")
      .select("id, tipo, status, job_aprovado_id")
      .eq("demanda_id", data.demanda_id)
      .eq("solicitante_user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!art || art.status !== "concluida" || !art.job_aprovado_id) {
      throw new Error("A arte ainda não está disponível.");
    }

    const { data: gens, error: errGen } = await supabaseAdmin
      .from("ai_generations")
      .select("slide_index, path_aprovado, mime_type")
      .eq("job_id", art.job_aprovado_id)
      .eq("status", "aprovada")
      .not("path_aprovado", "is", null)
      .order("slide_index");
    if (errGen) throw new Error(errGen.message);
    if (!gens || gens.length === 0) throw new Error("A arte ainda não está disponível.");

    const base = rotuloTipo(art.tipo)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .toLowerCase();
    return Promise.all(
      gens.map(async (g) => {
        const ext = EXTENSAO[g.mime_type] ?? "png";
        const nome =
          gens.length > 1
            ? `${base}-slide-${String(g.slide_index).padStart(2, "0")}.${ext}`
            : `${base}.${ext}`;
        const { data: signed, error: errUrl } = await supabaseAdmin.storage
          .from(BUCKET_APROVADAS)
          .createSignedUrl(g.path_aprovado!, 60 * 5, { download: nome });
        if (errUrl || !signed) throw new Error("Falha ao gerar o link de download.");
        return { nome, url: signed.signedUrl };
      }),
    );
  });
