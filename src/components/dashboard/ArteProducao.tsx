import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, ImageUp, Loader2, MessageSquareWarning, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelarUploadManual,
  concluirUploadManual,
  iniciarUploadManual,
  revisarArte,
  type listArtes,
} from "@/lib/arte.functions";
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

  const esperado = slidesEsperados(a.tipo, a.qtd_slides);
  const [envioAberto, setEnvioAberto] = useState(false);
  const [slots, setSlots] = useState<Array<File | null>>([]);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [revisao, setRevisao] = useState<{ decisao: Decisao; comentario: string } | null>(null);

  const invalidar = () => qc.invalidateQueries({ queryKey: ["artes"] });

  const versaoAtual = a.versoes[0] ?? null;
  const emRevisao =
    a.status === "aguardando_revisao" &&
    !!versaoAtual &&
    versaoAtual.imagens.some((i) => i.status === "gerada");
  const versaoAprovada =
    a.status === "concluida" ? a.versoes.find((v) => v.id === a.job_aprovado_id) : null;
  const podeEnviar = RECEBE_ARTE.includes(a.status) && !a.job_ativo_id;

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
    mutationFn: (v: { job_id: string; decisao: Decisao; comentario?: string }) =>
      revisarFn({ data: v }),
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

  return (
    <div className="mt-4 space-y-3 rounded-md border border-border bg-gray-50 p-3">
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
              : `Versão enviada por ${nomeDe(versaoMostrada.solicitado_por)} em ${dataHora(versaoMostrada.concluido_em)}`}
          </div>
          <div className="flex flex-wrap gap-2">
            {versaoMostrada.imagens.map((img) => (
              <a
                key={img.id}
                href={img.url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="w-32 overflow-hidden rounded-md border border-border bg-white text-[11px]"
              >
                {img.url ? (
                  <img
                    src={img.url}
                    alt={`Slide ${img.slide_index}`}
                    className="h-32 w-full object-contain"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-32 items-center justify-center text-gray-400">
                    sem prévia
                  </div>
                )}
                {esperado > 1 && (
                  <div className="px-1.5 py-1 text-gray-600">Slide {img.slide_index}</div>
                )}
              </a>
            ))}
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
              disabled={revisarMut.isPending}
              onClick={() => setRevisao({ decisao: "aprovada", comentario: "" })}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" /> Aprovar
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
                })
              }
            >
              {revisarMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
