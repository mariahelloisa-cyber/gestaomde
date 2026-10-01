import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Link2, Loader2, Send, Share2, Trash2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  criarCompartilhamento,
  listarCompartilhamentos,
  revogarCompartilhamento,
  type CompartilhamentoResumo,
} from "@/lib/compartilhamento.functions";
import type { Status } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export type ShareAlvo =
  | { tipo: "tarefa"; tarefaId: string; titulo: string }
  | {
      tipo: "coluna";
      status: Status;
      /** Rótulo da coluna como aparece no Kanban ("Em Andamento"). */
      titulo: string;
      clienteId?: string | null;
      membroId?: string | null;
      /** Contexto mostrado no dialog: empresa e/ou responsável do filtro atual. */
      contexto?: string | null;
    }
  | { tipo: "aniversariante"; aniversarianteId: string; titulo: string };

/** Cada tipo de alvo tem a sua página pública. */
const ROTA_PUBLICA: Record<ShareAlvo["tipo"], string> = {
  tarefa: "compartilhado",
  coluna: "compartilhado",
  aniversariante: "aniversariante",
};

const VALIDADES: { label: string; dias: 7 | 30 | null }[] = [
  { label: "7 dias", dias: 7 },
  { label: "30 dias", dias: 30 },
  { label: "Sem prazo", dias: null },
];

/** Gera e administra o link somente-leitura de uma tarefa ou de uma coluna
 * inteira, pronto pra colar no WhatsApp, Instagram etc. */
export function ShareDialog({
  alvo,
  open,
  onOpenChange,
}: {
  alvo: ShareAlvo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const listarFn = useServerFn(listarCompartilhamentos);
  const criarFn = useServerFn(criarCompartilhamento);
  const revogarFn = useServerFn(revogarCompartilhamento);

  const [link, setLink] = useState<CompartilhamentoResumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [validade, setValidade] = useState<7 | 30 | null>(30);
  const [copiado, setCopiado] = useState(false);

  const payloadAlvo =
    alvo.tipo === "tarefa"
      ? { tipo: "tarefa" as const, tarefaId: alvo.tarefaId }
      : alvo.tipo === "aniversariante"
        ? { tipo: "aniversariante" as const, aniversarianteId: alvo.aniversarianteId }
        : {
            tipo: "coluna" as const,
            status: alvo.status,
            clienteId: alvo.clienteId ?? null,
            membroId: alvo.membroId ?? null,
          };
  const chaveAlvo = JSON.stringify(payloadAlvo);

  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setCarregando(true);
    setCopiado(false);
    listarFn({ data: payloadAlvo })
      .then((links) => {
        if (!cancelado) setLink(links[0] ?? null);
      })
      .catch((e) => {
        if (!cancelado) toast.error(e instanceof Error ? e.message : "Falha ao carregar o link.");
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chaveAlvo]);

  const url =
    link && typeof window !== "undefined"
      ? `${window.location.origin}/${ROTA_PUBLICA[alvo.tipo]}/${link.token}`
      : "";

  const mensagem =
    alvo.tipo === "tarefa"
      ? `Tarefa: ${alvo.titulo}\n${url}`
      : alvo.tipo === "aniversariante"
        ? `Material de aniversário de ${alvo.titulo}\n${url}`
        : `Tarefas em "${alvo.titulo}"${alvo.contexto ? ` — ${alvo.contexto}` : ""}\n${url}`;

  const gerar = async () => {
    setOcupado(true);
    try {
      const novo = await criarFn({ data: { ...payloadAlvo, expiraEmDias: validade } });
      setLink(novo);
      toast.success("Link criado! Agora é só enviar.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar o link.");
    } finally {
      setOcupado(false);
    }
  };

  const copiar = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      toast.success("Link copiado!");
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o link e copie manualmente.");
    }
  };

  const revogar = async () => {
    if (!link) return;
    setOcupado(true);
    try {
      await revogarFn({ data: { id: link.id } });
      setLink(null);
      toast.success("Link desativado. Quem tinha o link perdeu o acesso.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao desativar o link.");
    } finally {
      setOcupado(false);
    }
  };

  const compartilharNativo = async () => {
    if (typeof navigator === "undefined" || !navigator.share) return;
    try {
      await navigator.share({ title: alvo.titulo, text: mensagem, url });
    } catch {
      /* usuário cancelou a folha de compartilhamento */
    }
  };

  const temShareNativo = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" />
            {alvo.tipo === "tarefa"
              ? "Compartilhar tarefa"
              : alvo.tipo === "aniversariante"
                ? "Compartilhar material"
                : "Compartilhar bloco"}
          </DialogTitle>
          <DialogDescription>
            {alvo.tipo === "tarefa" ? (
              <>
                Quem receber o link vê <strong>{alvo.titulo}</strong> em modo somente leitura, sem
                precisar de conta e sem poder editar nada.
              </>
            ) : alvo.tipo === "aniversariante" ? (
              <>
                Quem receber o link vê e baixa a arte e a mensagem de{" "}
                <strong>{alvo.titulo}</strong>, sem acessar o resto do sistema. O link manda só o
                material — a foto com legenda no WhatsApp sai pelos botões de envio do
                material.
              </>
            ) : (
              <>
                Quem receber o link vê as tarefas da coluna <strong>{alvo.titulo}</strong>
                {alvo.contexto ? ` (${alvo.contexto})` : ""} em modo somente leitura, atualizadas
                automaticamente.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {carregando ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : link ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={url}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button type="button" variant="secondary" onClick={copiar} title="Copiar link">
                {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  window.open(
                    `https://wa.me/?text=${encodeURIComponent(mensagem)}`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                <Send className="h-4 w-4" />
                WhatsApp
              </Button>
              {temShareNativo ? (
                <Button type="button" variant="secondary" onClick={compartilharNativo}>
                  <Share2 className="h-4 w-4" />
                  Mais opções
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir link
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {link.expira_em
                ? `Expira em ${format(new Date(link.expira_em), "dd/MM/yyyy", { locale: ptBR })}.`
                : "Sem prazo de expiração."}{" "}
              {link.acessos > 0
                ? `${link.acessos} ${link.acessos === 1 ? "visualização" : "visualizações"}.`
                : "Ainda sem visualizações."}
            </p>

            <Button
              type="button"
              variant="ghost"
              className="w-full text-destructive hover:text-destructive"
              onClick={revogar}
              disabled={ocupado}
            >
              {ocupado ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Desativar link
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">O link vale por</p>
              <div className="flex gap-2">
                {VALIDADES.map((v) => (
                  <button
                    key={v.label}
                    type="button"
                    onClick={() => setValidade(v.dias)}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                      validade === v.dias
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            <Button type="button" className="w-full" onClick={gerar} disabled={ocupado}>
              {ocupado ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              Gerar link de visualização
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
