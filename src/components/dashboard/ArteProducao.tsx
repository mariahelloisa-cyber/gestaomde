import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CheckCircle2,
  ImageUp,
  Loader2,
  MessageSquareWarning,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelarUploadManual,
  concluirUploadManual,
  iniciarUploadManual,
  revisarArte,
  type listArtes,
} from "@/lib/arte.functions";
import { gerarArteComIA, resumoGeracaoIA } from "@/lib/arte-geracao-ia.functions";
import { GERACAO_VARIACOES, podeGerarComIA } from "@/lib/arte/geracao";
import { ARQUIVO_MIMES, ARTE_PRONTA_TAMANHO_MAX_MB, slidesEsperados } from "@/lib/arte/tipos";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Arte = Awaited<ReturnType<typeof listArtes>>[number];
type Decisao = "aprovada" | "ajuste_solicitado" | "recusada";

const BUCKET = "ai-generated-arts";
const RECEBE_ARTE = ["aceita", "ajustes", "aguardando_revisao"];

const DECISAO_ROTULO: Record<string, string> = {
  aprovada: "Aprovada",
  ajuste_solicitado: "Ajuste pedido",
  recusada: "Versão recusada",
};

function dataHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Produção da arte na aba Artes: envio de arte pronta, revisão e histórico. */
export function ArteProducao({ a, nomeDe }: { a: Arte; nomeDe: (id: string | null) => string }) {
  const qc = useQueryClient();
  const iniciarFn = useServerFn(iniciarUploadManual);
  const concluirFn = useServerFn(concluirUploadManual);
  const cancelarFn = useServerFn(cancelarUploadManual);
  const revisarFn = useServerFn(revisarArte);
  const gerarFn = useServerFn(gerarArteComIA);
  const resumoIAFn = useServerFn(resumoGeracaoIA);

  const esperado = slidesEsperados(a.tipo, a.qtd_slides);
  const [envioAberto, setEnvioAberto] = useState(false);
  const [slots, setSlots] = useState<Array<File | null>>([]);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [revisao, setRevisao] = useState<{ decisao: Decisao; comentario: string } | null>(null);
  const [confirmarIA, setConfirmarIA] = useState(false);
  /** Variação escolhida por slide (versões geradas com IA). */
  const [escolhidas, setEscolhidas] = useState<Record<number, string>>({});

  const invalidar = () => qc.invalidateQueries({ queryKey: ["artes"] });

  const versaoAtual = a.versoes[0] ?? null;
  const emRevisao =
    a.status === "aguardando_revisao" &&
    !!versaoAtual &&
    versaoAtual.imagens.some((i) => i.status === "gerada");
  const versaoAprovada =
    a.status === "concluida" ? a.versoes.find((v) => v.id === a.job_aprovado_id) : null;

  const gerarMut = useMutation({
    mutationFn: () => gerarFn({ data: { art_request_id: a.id } }),
    onSuccess: (r) => {
      toast.success(
        `${r.imagens} variaç${r.imagens === 1 ? "ão gerada" : "ões geradas"} e enviada${r.imagens === 1 ? "" : "s"} para revisão.`,
      );
      setConfirmarIA(false);
      setEscolhidas({});
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao gerar com IA."),
    onSettled: invalidar,
  });

  const resumoIA = useQuery({
    queryKey: ["artes", "resumo-ia", a.id],
    queryFn: () => resumoIAFn({ data: { art_request_id: a.id } }),
    enabled: confirmarIA,
    staleTime: 0,
  });

  const gerando = gerarMut.isPending || a.gerando_ia;
  const podeEnviar = RECEBE_ARTE.includes(a.status) && !a.job_ativo_id && !gerando;
  const podeGerar =
    podeEnviar && podeGerarComIA(a.tipo) && a.geracoes_ia.usadas < a.geracoes_ia.max;

  const abrirEnvio = () => {
    setSlots(Array.from({ length: esperado }, () => null));
    setEnvioAberto(true);
  };

  const escolherArquivo = (idx: number, file: File | undefined) => {
    if (!file) return;
    if (!(ARQUIVO_MIMES as readonly string[]).includes(file.type)) {
      toast.error(`"${file.name}": use PNG, JPG ou WebP.`);
      return;
    }
    if (file.size > ARTE_PRONTA_TAMANHO_MAX_MB * 1024 * 1024) {
      toast.error(`"${file.name}" passa de ${ARTE_PRONTA_TAMANHO_MAX_MB} MB.`);
      return;
    }
    setSlots((prev) => prev.map((f, i) => (i === idx ? file : f)));
  };

  const enviar = async () => {
    if (slots.some((f) => !f)) {
      toast.error(esperado === 1 ? "Escolha a imagem." : "Escolha uma imagem para cada slide.");
      return;
    }
    const files = slots as File[];
    let jobId: string | null = null;
    try {
      setEtapa("Preparando…");
      const r = await iniciarFn({
        data: {
          art_request_id: a.id,
          arquivos: files.map((f, i) => ({
            slide_index: i + 1,
            mime_type: f.type as (typeof ARQUIVO_MIMES)[number],
            tamanho_bytes: f.size,
          })),
        },
      });
      jobId = r.job_id;
      for (const [n, u] of r.uploads.entries()) {
        setEtapa(`Enviando (${n + 1}/${r.uploads.length})…`);
        const file = files[u.slide_index - 1];
        const { error } = await supabase.storage
          .from(BUCKET)
          .uploadToSignedUrl(u.path, u.token, file, { contentType: file.type });
        if (error) throw new Error(`Falha no upload de "${file.name}": ${error.message}`);
      }
      setEtapa("Conferindo…");
      await concluirFn({ data: { job_id: r.job_id } });
      jobId = null;
      toast.success("Arte enviada para revisão.");
      setEnvioAberto(false);
    } catch (e) {
      // concluirUploadManual já desfaz o job quando a falha é dele; aqui cobre
      // falha de upload no navegador.
      if (jobId) await cancelarFn({ data: { job_id: jobId } }).catch(() => {});
      toast.error(e instanceof Error ? e.message : "Falha ao enviar a arte.");
    } finally {
      setEtapa(null);
      invalidar();
    }
  };

  const descartarMut = useMutation({
    mutationFn: (job_id: string) => cancelarFn({ data: { job_id } }),
    onSuccess: () => toast.success("Envio descartado."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao descartar."),
    onSettled: invalidar,
  });

  const revisarMut = useMutation({
    mutationFn: (v: {
      job_id: string;
      decisao: Decisao;
      comentario?: string;
      generation_ids?: string[];
    }) => revisarFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(
        v.decisao === "aprovada"
          ? "Arte aprovada e liberada para o solicitante."
          : "Revisão registrada.",
      );
      setRevisao(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro na revisão."),
    onSettled: invalidar,
  });

  if (a.status === "enviada" || a.status === "recusada" || a.status === "cancelada") return null;

  const versaoMostrada = versaoAprovada ?? versaoAtual;
  const imagensMostradas = versaoAprovada
    ? versaoAprovada.imagens.filter((i) => i.status === "aprovada")
    : (versaoMostrada?.imagens ?? []);
  const temVariacoes =
    !!versaoAtual &&
    new Set(versaoAtual.imagens.map((i) => i.slide_index)).size < versaoAtual.imagens.length;
  // Só vale a escolha que ainda aponta para uma imagem desta versão (outra
  // pessoa pode ter gerado uma versão nova enquanto a tela estava aberta).
  const idsEmRevisao = new Set(
    (versaoAtual?.imagens ?? []).filter((i) => i.status === "gerada").map((i) => i.id),
  );
  const escolhidasValidas = Object.values(escolhidas).filter((id) => idsEmRevisao.has(id));
  const escolhaCompleta = !temVariacoes || escolhidasValidas.length === esperado;
  const resumo = resumoIA.data;
  const estouraTeto =
    !!resumo && resumo.gastoHojeUsd + resumo.estimativaUsd > resumo.limiteDiarioUsd;

  return (
    <div className="mt-4 space-y-3 rounded-md border border-border bg-gray-50 p-3">
      {gerando && (
        <div className="flex items-center gap-2 text-xs text-violet-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Gerando {GERACAO_VARIACOES} variações com IA… pode levar de 1 a 3 minutos.
        </div>
      )}
      {a.job_ativo_id && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-700">
          <span>Há um envio de arte em andamento (ou interrompido).</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-gray-300 bg-white text-black"
            disabled={descartarMut.isPending}
            onClick={() => a.job_ativo_id && descartarMut.mutate(a.job_ativo_id)}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Descartar envio
          </Button>
        </div>
      )}

      {versaoMostrada ? (
        <div>
          <div className="mb-2 text-xs font-medium text-gray-600">
            {versaoAprovada
              ? `Arte aprovada${a.aprovado_por ? ` por ${nomeDe(a.aprovado_por)}` : ""} em ${dataHora(a.aprovado_em)}`
              : `${versaoMostrada.origem === "ia" ? "Gerada com IA" : "Versão enviada"} por ${nomeDe(versaoMostrada.solicitado_por)} em ${dataHora(versaoMostrada.concluido_em)}`}
          </div>
          {emRevisao && temVariacoes && (
            <p className="mb-2 text-xs text-gray-600">
              Clique na variação que deve ser aprovada. Só ela chega ao solicitante.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {imagensMostradas.map((img) => {
              const selecionavel = emRevisao && temVariacoes && img.status === "gerada";
              const escolhida = escolhidas[img.slide_index] === img.id;
              const legenda = [
                esperado > 1 ? `Slide ${img.slide_index}` : null,
                temVariacoes && !versaoAprovada ? `Variação ${img.variacao}` : null,
                img.largura && img.altura ? `${img.largura}×${img.altura}` : null,
              ].filter(Boolean);
              const previa = img.url ? (
                <img
                  src={img.url}
                  alt={`Slide ${img.slide_index}, variação ${img.variacao}`}
                  className="h-32 w-full object-contain"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-32 items-center justify-center text-gray-400">
                  sem prévia
                </div>
              );
              return (
                <div
                  key={img.id}
                  className={`w-32 overflow-hidden rounded-md border bg-white text-[11px] ${
                    escolhida ? "border-violet-600 ring-2 ring-violet-500" : "border-border"
                  }`}
                >
                  {selecionavel ? (
                    <button
                      type="button"
                      className="block w-full"
                      aria-pressed={escolhida}
                      onClick={() => setEscolhidas((s) => ({ ...s, [img.slide_index]: img.id }))}
                    >
                      {previa}
                    </button>
                  ) : (
                    <a href={img.url ?? "#"} target="_blank" rel="noopener noreferrer">
                      {previa}
                    </a>
                  )}
                  <div className="flex items-center justify-between gap-1 px-1.5 py-1 text-gray-600">
                    <span className="truncate">{legenda.join(" · ")}</span>
                    {selecionavel && img.url && (
                      <a
                        href={img.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-violet-700 hover:underline"
                      >
                        abrir
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-500">Nenhuma arte enviada ainda.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {emRevisao && versaoAtual && (
          <>
            <Button
              size="sm"
              disabled={revisarMut.isPending || !escolhaCompleta}
              title={escolhaCompleta ? undefined : "Escolha uma variação"}
              onClick={() => setRevisao({ decisao: "aprovada", comentario: "" })}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" />
              {temVariacoes ? "Aprovar variação escolhida" : "Aprovar"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-gray-300 bg-white text-black hover:bg-gray-100"
              disabled={revisarMut.isPending}
              onClick={() => setRevisao({ decisao: "ajuste_solicitado", comentario: "" })}
            >
              <MessageSquareWarning className="mr-1 h-4 w-4" /> Pedir ajuste
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={revisarMut.isPending}
              onClick={() => setRevisao({ decisao: "recusada", comentario: "" })}
            >
              <X className="mr-1 h-4 w-4" /> Recusar versão
            </Button>
          </>
        )}
        {podeGerar && (
          <Button
            size="sm"
            variant="outline"
            className="border-violet-300 bg-white text-violet-800 hover:bg-violet-50"
            onClick={() => setConfirmarIA(true)}
          >
            <Sparkles className="mr-1 h-4 w-4" /> Gerar com IA
          </Button>
        )}
        {podeEnviar && (
          <Button
            size="sm"
            variant="outline"
            className="border-gray-300 bg-white text-black hover:bg-gray-100"
            onClick={abrirEnvio}
          >
            <ImageUp className="mr-1 h-4 w-4" />
            {a.versoes.length > 0 ? "Enviar nova versão" : "Enviar arte pronta"}
          </Button>
        )}
      </div>
      {podeGerarComIA(a.tipo) && RECEBE_ARTE.includes(a.status) && (
        <p className="text-[11px] text-gray-500">
          Gerações com IA nesta arte: {a.geracoes_ia.usadas} de {a.geracoes_ia.max}.
        </p>
      )}

      {a.revisoes.length > 0 && (
        <ul className="space-y-1 border-t border-border pt-2 text-[11px] text-gray-600">
          {a.revisoes.slice(0, 5).map((r) => (
            <li key={r.id}>
              <strong className="text-gray-800">{DECISAO_ROTULO[r.decisao] ?? r.decisao}</strong>{" "}
              por {nomeDe(r.revisor_id)} em {dataHora(r.criado_em)}
              {r.comentario && <span className="whitespace-pre-wrap"> — {r.comentario}</span>}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={envioAberto} onOpenChange={(o) => !etapa && setEnvioAberto(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {esperado > 1 ? "Enviar slides do carrossel" : "Enviar arte pronta"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            PNG, JPG ou WebP, até {ARTE_PRONTA_TAMANHO_MAX_MB} MB. A arte vai para revisão e só
            chega ao solicitante depois de aprovada.
          </p>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {slots.map((f, i) => (
              <label
                key={i}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-dashed border-border px-3 py-2 text-sm hover:bg-muted"
              >
                <span className="shrink-0 font-medium">
                  {esperado > 1 ? `Slide ${i + 1}` : "Imagem"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {f ? f.name : "Selecionar arquivo"}
                </span>
                <input
                  type="file"
                  accept={ARQUIVO_MIMES.join(",")}
                  className="hidden"
                  disabled={!!etapa}
                  onChange={(e) => {
                    escolherArquivo(i, e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={!!etapa} onClick={() => setEnvioAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={enviar} disabled={!!etapa}>
              {etapa ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {etapa ?? "Enviar para revisão"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!revisao}
        onOpenChange={(o) => !o && !revisarMut.isPending && setRevisao(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {revisao?.decisao === "aprovada"
                ? "Aprovar e liberar para o solicitante?"
                : revisao?.decisao === "ajuste_solicitado"
                  ? "Pedir ajuste"
                  : "Recusar esta versão"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {revisao?.decisao === "aprovada"
              ? "A demanda é concluída e o solicitante passa a poder baixar a arte."
              : "A arte volta para produção; envie uma nova versão depois."}
          </p>
          <Textarea
            rows={3}
            maxLength={2000}
            placeholder={
              revisao?.decisao === "ajuste_solicitado"
                ? "O que precisa mudar? (obrigatório)"
                : "Comentário (opcional)"
            }
            value={revisao?.comentario ?? ""}
            onChange={(e) => setRevisao((s) => (s ? { ...s, comentario: e.target.value } : s))}
          />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={revisarMut.isPending}
              onClick={() => setRevisao(null)}
            >
              Cancelar
            </Button>
            <Button
              variant={revisao?.decisao === "recusada" ? "destructive" : "default"}
              disabled={
                revisarMut.isPending ||
                (revisao?.decisao === "ajuste_solicitado" && !revisao.comentario.trim())
              }
              onClick={() =>
                revisao &&
                versaoAtual &&
                revisarMut.mutate({
                  job_id: versaoAtual.id,
                  decisao: revisao.decisao,
                  comentario: revisao.comentario.trim() || undefined,
                  generation_ids:
                    revisao.decisao === "aprovada" && temVariacoes ? escolhidasValidas : undefined,
                })
              }
            >
              {revisarMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmarIA} onOpenChange={(o) => !gerarMut.isPending && setConfirmarIA(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar arte com IA?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              A IA cria {GERACAO_VARIACOES} variações usando o briefing, a ficha de marca da empresa
              e referências do acervo. O resultado vai para revisão interna e só chega ao
              solicitante depois de aprovado.
            </p>
            {resumoIA.isLoading && <p>Calculando custo…</p>}
            {resumoIA.error && (
              <p className="text-red-600">
                {resumoIA.error instanceof Error ? resumoIA.error.message : "Erro ao consultar."}
              </p>
            )}
            {resumo && (
              <ul className="space-y-0.5 text-xs">
                <li>
                  Custo estimado: <strong>~US$ {resumo.estimativaUsd.toFixed(2)}</strong>
                </li>
                <li>
                  Gasto hoje: US$ {resumo.gastoHojeUsd.toFixed(2)} de US${" "}
                  {resumo.limiteDiarioUsd.toFixed(2)}
                </li>
                <li>
                  Gerações nesta arte: {resumo.geracoesUsadas} de {resumo.geracoesMax}
                </li>
                <li>
                  Gerada em {resumo.tamanhoGerado.largura}×{resumo.tamanhoGerado.altura} px (
                  {resumo.modelo})
                </li>
              </ul>
            )}
            {resumo && !resumo.configurado && (
              <p className="text-red-600">OPENAI_API_KEY não está configurada no servidor.</p>
            )}
            {estouraTeto && (
              <p className="text-red-600">Esta geração passaria do teto diário. Tente amanhã.</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={gerarMut.isPending}
              onClick={() => setConfirmarIA(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={
                gerarMut.isPending || !resumo || !resumo.configurado || estouraTeto || gerando
              }
              onClick={() => gerarMut.mutate()}
            >
              {gerarMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {gerarMut.isPending ? "Gerando…" : "Gerar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
