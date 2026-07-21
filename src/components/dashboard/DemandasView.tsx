import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listDemandas,
  aceitarDemanda,
  recusarDemanda,
  transferirDemanda,
} from "@/lib/demandas.functions";
import { useTasks } from "@/lib/tasks-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Check, X, ArrowRightLeft, Calendar, Mail, Inbox, Copy, ExternalLink } from "lucide-react";

type Demanda = Awaited<ReturnType<typeof listDemandas>>[number];

export function DemandasView() {
  const { membros } = useTasks();
  const qc = useQueryClient();
  const fetchFn = useServerFn(listDemandas);
  const aceitarFn = useServerFn(aceitarDemanda);
  const recusarFn = useServerFn(recusarDemanda);
  const transferirFn = useServerFn(transferirDemanda);

  const { data: demandas = [], isLoading } = useQuery({
    queryKey: ["demandas"],
    queryFn: () => fetchFn(),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["demandas"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const aceitarMut = useMutation({
    mutationFn: (vars: { id: string; responsavel_id: string }) =>
      aceitarFn({ data: vars }),
    onSuccess: () => { toast.success("Demanda aceita — tarefa criada."); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const [aceitarState, setAceitarState] = useState<{ id: string; responsavel_id: string } | null>(null);

  const [recusaOpen, setRecusaOpen] = useState<string | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const recusarMut = useMutation({
    mutationFn: (vars: { id: string; justificativa?: string }) => recusarFn({ data: vars }),
    onSuccess: () => {
      toast.success("Demanda recusada.");
      setRecusaOpen(null);
      setJustificativa("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const [transferirState, setTransferirState] = useState<{ id: string; novo: string } | null>(null);
  const transferirMut = useMutation({
    mutationFn: (vars: { id: string; novo_responsavel_id: string }) => transferirFn({ data: vars }),
    onSuccess: () => {
      toast.success("Demanda transferida.");
      setTransferirState(null);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const nomePor = (id: string | null) => (id ? membros.find((m) => m.id === id)?.nome ?? "—" : "—");

  const publicUrl =
    typeof window !== "undefined" ? `${window.location.origin}/demandas/nova` : "/demandas/nova";

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Link copiado!");
    } catch {
      toast.error("Não foi possível copiar. Copie manualmente.");
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <header className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Demandas Solicitadas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Solicitações enviadas pelo portal externo.
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-muted-foreground">
              Link público para envio de demandas
            </div>
            <div className="mt-1 truncate font-mono text-sm">{publicUrl}</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={copiarLink}>
              <Copy className="mr-1 h-4 w-4" /> Copiar link
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" /> Abrir
              </a>
            </Button>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : demandas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Inbox className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma demanda recebida ainda.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {demandas.map((d: Demanda) => (
            <DemandaCard
              key={d.id}
              d={d}
              nomeResponsavel={nomePor(d.responsavel_id)}
              onAceitar={() => setAceitarState({ id: d.id, responsavel_id: d.responsavel_id ?? "" })}
              onAbrirRecusa={() => setRecusaOpen(d.id)}
              onAbrirTransferir={() => setTransferirState({ id: d.id, novo: "" })}
              busy={aceitarMut.isPending}
            />
          ))}
        </div>
      )}

      {/* Aceitar — escolher responsável */}
      <Dialog open={!!aceitarState} onOpenChange={(o) => !o && setAceitarState(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Designar responsável</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Escolha quem vai cuidar desta demanda. Uma tarefa será criada e atribuída a essa pessoa.
          </p>
          <Select
            value={aceitarState?.responsavel_id ?? ""}
            onValueChange={(v) => setAceitarState((s) => (s ? { ...s, responsavel_id: v } : s))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Escolha o responsável" />
            </SelectTrigger>
            <SelectContent>
              {membros.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAceitarState(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!aceitarState?.responsavel_id) return;
                aceitarMut.mutate(
                  { id: aceitarState.id, responsavel_id: aceitarState.responsavel_id },
                  { onSuccess: () => setAceitarState(null) },
                );
              }}
              disabled={!aceitarState?.responsavel_id || aceitarMut.isPending}
            >
              Aceitar e designar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recusar */}
      <Dialog open={!!recusaOpen} onOpenChange={(o) => !o && setRecusaOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recusar demanda</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Justificativa (opcional)"
            rows={4}
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            maxLength={2000}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecusaOpen(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() =>
                recusaOpen && recusarMut.mutate({ id: recusaOpen, justificativa: justificativa.trim() || undefined })
              }
              disabled={recusarMut.isPending}
            >
              Recusar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transferir */}
      <Dialog open={!!transferirState} onOpenChange={(o) => !o && setTransferirState(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferir demanda</DialogTitle>
          </DialogHeader>
          <Select
            value={transferirState?.novo ?? ""}
            onValueChange={(v) => setTransferirState((s) => (s ? { ...s, novo: v } : s))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Escolha o novo responsável" />
            </SelectTrigger>
            <SelectContent>
              {membros.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferirState(null)}>Cancelar</Button>
            <Button
              onClick={() =>
                transferirState?.novo &&
                transferirMut.mutate({ id: transferirState.id, novo_responsavel_id: transferirState.novo })
              }
              disabled={!transferirState?.novo || transferirMut.isPending}
            >
              Transferir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function statusBadge(s: Demanda["status"]) {
  const map: Record<Demanda["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pendente: { label: "Pendente", variant: "outline" },
    aceita: { label: "Aceita", variant: "default" },
    recusada: { label: "Recusada", variant: "destructive" },
    transferida: { label: "Transferida", variant: "secondary" },
  };
  const v = map[s];
  return <Badge variant={v.variant}>{v.label}</Badge>;
}

function DemandaCard({
  d,
  nomeResponsavel,
  onAceitar,
  onAbrirRecusa,
  onAbrirTransferir,
  busy,
}: {
  d: Demanda;
  nomeResponsavel: string;
  onAceitar: () => void;
  onAbrirRecusa: () => void;
  onAbrirTransferir: () => void;
  busy: boolean;
}) {
  const isPendente = d.status === "pendente";
  return (
    <div className="rounded-lg border border-border bg-white text-black p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{d.solicitante_nome}</h3>
            {statusBadge(d.status)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-600">
            {d.solicitante_email && (
              <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{d.solicitante_email}</span>
            )}
            {d.prazo_sugerido && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Prazo: {new Date(d.prazo_sugerido).toLocaleDateString("pt-BR")}
              </span>
            )}
            <span>Responsável: <strong className="text-black">{nomeResponsavel}</strong></span>
          </div>
        </div>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm text-black">{d.descricao}</p>

      {d.justificativa_recusa && (
        <div className="mt-3 rounded-md border border-border bg-gray-100 p-3 text-xs text-gray-700">
          <strong>Justificativa:</strong> {d.justificativa_recusa}
        </div>
      )}

      {d.anexos.length > 0 && (
        <div className="mt-4 space-y-1">
          <div className="text-xs font-medium text-gray-600">Anexos</div>
          <ul className="space-y-1">
            {d.anexos.map((a, i) => (
              <li key={i}>
                <a
                  href={a.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-md border border-border bg-gray-50 px-3 py-2 text-sm text-black hover:bg-gray-100"
                >
                  <FileText className="h-4 w-4 text-gray-500" />
                  <span className="truncate">{a.nome_arquivo}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isPendente && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={onAceitar} disabled={busy}>
            <Check className="mr-1 h-4 w-4" /> Aceitar
          </Button>
          <Button size="sm" variant="outline" onClick={onAbrirTransferir}>
            <ArrowRightLeft className="mr-1 h-4 w-4" /> Passar para outro
          </Button>
          <Button size="sm" variant="destructive" onClick={onAbrirRecusa}>
            <X className="mr-1 h-4 w-4" /> Recusar
          </Button>
        </div>
      )}

      {d.status === "aceita" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onAceitar} disabled={busy}>
            <Check className="mr-1 h-4 w-4" /> Recriar tarefa
          </Button>
          <p className="text-xs text-gray-500 self-center">
            Use caso a tarefa correspondente tenha sido excluída.
          </p>
        </div>
      )}
    </div>
  );
}