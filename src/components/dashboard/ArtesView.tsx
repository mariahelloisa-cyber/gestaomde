import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Check, Inbox, Mail, Palette, X } from "lucide-react";
import { aceitarDemandaArte, listArtes, recusarDemandaArte } from "@/lib/arte.functions";
import {
  CATEGORIA_ROTULO,
  STATUS_INTERNO_ROTULO,
  rotuloTipo,
  type StatusArte,
} from "@/lib/arte/tipos";
import { useTasks } from "@/lib/tasks-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Arte = Awaited<ReturnType<typeof listArtes>>[number];

const ABAS = {
  fila: { rotulo: "Aguardando aceite", status: ["enviada"] },
  andamento: {
    rotulo: "Em andamento",
    status: ["aceita", "em_geracao", "aguardando_revisao", "ajustes"],
  },
  encerradas: { rotulo: "Encerradas", status: ["concluida", "recusada", "cancelada"] },
} as const;
type Aba = keyof typeof ABAS;

const STATUS_COR: Record<string, string> = {
  enviada: "#F59E0B",
  aceita: "#3B82F6",
  em_geracao: "#6366F1",
  aguardando_revisao: "#8B5CF6",
  ajustes: "#F97316",
  concluida: "#10B981",
  recusada: "#EF4444",
  cancelada: "#6B7280",
};

function dataHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function ArtesView() {
  const { membros, membrosAtivos } = useTasks();
  const qc = useQueryClient();
  const listFn = useServerFn(listArtes);
  const aceitarFn = useServerFn(aceitarDemandaArte);
  const recusarFn = useServerFn(recusarDemandaArte);

  const [aba, setAba] = useState<Aba>("fila");
  const [aceitar, setAceitar] = useState<{ id: string; responsavel_id: string } | null>(null);
  const [recusar, setRecusar] = useState<{ id: string; justificativa: string } | null>(null);

  const {
    data: artes = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({ queryKey: ["artes"], queryFn: () => listFn() });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["artes"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const aceitarMut = useMutation({
    mutationFn: (v: { art_request_id: string; responsavel_id: string }) => aceitarFn({ data: v }),
    onSuccess: () => {
      toast.success("Arte aceita — tarefa criada.");
      setAceitar(null);
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao aceitar."),
  });

  const recusarMut = useMutation({
    mutationFn: (v: { art_request_id: string; justificativa?: string }) => recusarFn({ data: v }),
    onSuccess: () => {
      toast.success("Solicitação recusada.");
      setRecusar(null);
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao recusar."),
  });

  const contagem = useMemo(() => {
    const c: Record<Aba, number> = { fila: 0, andamento: 0, encerradas: 0 };
    for (const a of artes) {
      for (const k of Object.keys(ABAS) as Aba[]) {
        if ((ABAS[k].status as readonly string[]).includes(a.status)) c[k]++;
      }
    }
    return c;
  }, [artes]);

  const visiveis = artes.filter((a) => (ABAS[aba].status as readonly string[]).includes(a.status));
  const nomeDe = (id: string | null) =>
    id ? (membros.find((m) => m.id === id)?.nome ?? "—") : "—";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Palette className="h-6 w-6 text-primary" /> Artes
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Solicitações de arte enviadas pelo portal externo.
        </p>
      </header>

      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {(Object.keys(ABAS) as Aba[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setAba(k)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              aba === k ? "bg-background text-foreground shadow" : "text-muted-foreground",
            )}
          >
            {ABAS[k].rotulo} ({contagem[k]})
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : isError ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-8 text-center text-sm">
          <p className="text-muted-foreground">
            {error instanceof Error ? error.message : "Não foi possível carregar as artes."}
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : visiveis.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Inbox className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Nada por aqui.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visiveis.map((a) => (
            <ArteCard
              key={a.id}
              a={a}
              nomeResponsavel={nomeDe(a.responsavel_id)}
              nomeQuemAlterou={nomeDe(a.status_alterado_por)}
              onAceitar={() => setAceitar({ id: a.id, responsavel_id: "" })}
              onRecusar={() => setRecusar({ id: a.id, justificativa: "" })}
              ocupado={aceitarMut.isPending || recusarMut.isPending}
            />
          ))}
        </div>
      )}

      <Dialog open={!!aceitar} onOpenChange={(o) => !o && setAceitar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aceitar solicitação de arte</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Escolha quem vai cuidar desta arte. Uma tarefa será criada e atribuída a essa pessoa.
          </p>
          <Select
            value={aceitar?.responsavel_id ?? ""}
            onValueChange={(v) => setAceitar((s) => (s ? { ...s, responsavel_id: v } : s))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Escolha o responsável" />
            </SelectTrigger>
            <SelectContent>
              {membrosAtivos.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAceitar(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() =>
                aceitar?.responsavel_id &&
                aceitarMut.mutate({
                  art_request_id: aceitar.id,
                  responsavel_id: aceitar.responsavel_id,
                })
              }
              disabled={!aceitar?.responsavel_id || aceitarMut.isPending}
            >
              {aceitarMut.isPending ? "Aceitando…" : "Aceitar e designar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!recusar} onOpenChange={(o) => !o && setRecusar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recusar solicitação de arte?</AlertDialogTitle>
            <AlertDialogDescription>
              A solicitação sai da fila e os arquivos enviados são apagados. Quem enviou continua
              vendo o pedido, marcado como recusado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            rows={3}
            maxLength={1000}
            placeholder="Motivo (opcional, aparece para quem enviou)"
            value={recusar?.justificativa ?? ""}
            onChange={(e) => setRecusar((s) => (s ? { ...s, justificativa: e.target.value } : s))}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (!recusar) return;
                recusarMut.mutate({
                  art_request_id: recusar.id,
                  justificativa: recusar.justificativa.trim() || undefined,
                });
              }}
              disabled={recusarMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {recusarMut.isPending ? "Recusando…" : "Recusar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ArteCard({
  a,
  nomeResponsavel,
  nomeQuemAlterou,
  onAceitar,
  onRecusar,
  ocupado,
}: {
  a: Arte;
  nomeResponsavel: string;
  nomeQuemAlterou: string;
  onAceitar: () => void;
  onRecusar: () => void;
  ocupado: boolean;
}) {
  const status = a.status as StatusArte;
  return (
    <div className="rounded-lg border border-border bg-white p-5 text-black shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: STATUS_COR[status] ?? "#6B7280" }}
        >
          {STATUS_INTERNO_ROTULO[status] ?? status}
        </span>
        <span className="text-sm font-semibold">{rotuloTipo(a.tipo)}</span>
        <span className="text-xs text-gray-500">• enviada em {dataHora(a.criado_em)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-600">
        <span className="font-medium text-black">{a.demanda?.solicitante_nome ?? "—"}</span>
        {a.demanda?.solicitante_email && (
          <span className="flex items-center gap-1">
            <Mail className="h-3 w-3" />
            {a.demanda.solicitante_email}
          </span>
        )}
        {a.projeto_nome && (
          <span className="flex items-center gap-1">
            <Building2 className="h-3 w-3" />
            {a.projeto_nome}
          </span>
        )}
        {status !== "enviada" && (
          <span>
            Responsável: <strong className="text-black">{nomeResponsavel}</strong>
          </span>
        )}
      </div>

      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-gray-700 sm:grid-cols-2">
        {a.detalhes.map((c) => (
          <div key={c.rotulo} className="min-w-0">
            <dt className="inline font-medium text-gray-500">{c.rotulo}: </dt>
            <dd className="inline whitespace-pre-wrap break-words">{c.valor}</dd>
          </div>
        ))}
      </dl>

      {a.briefing && <p className="mt-3 whitespace-pre-wrap text-sm text-black">{a.briefing}</p>}

      {status === "recusada" && a.demanda?.justificativa_recusa && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          Motivo da recusa: {a.demanda.justificativa_recusa}
        </p>
      )}

      {a.arquivos.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {a.arquivos.map((f) => (
            <a
              key={f.id}
              href={f.url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              title={f.nome_arquivo}
              className="group w-28 overflow-hidden rounded-md border border-border bg-gray-50 text-[11px] hover:bg-gray-100"
            >
              {f.url ? (
                <img
                  src={f.url}
                  alt={f.nome_arquivo}
                  className="h-20 w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-20 items-center justify-center text-gray-400">
                  sem prévia
                </div>
              )}
              <div className="truncate px-1.5 py-1 text-gray-600">
                {CATEGORIA_ROTULO[f.categoria]}
              </div>
            </a>
          ))}
        </div>
      )}

      {status !== "enviada" && a.status_alterado_em && (
        <p className="mt-3 text-[11px] text-gray-500">
          {STATUS_INTERNO_ROTULO[status] ?? status} por {nomeQuemAlterou} em{" "}
          {dataHora(a.status_alterado_em)}
        </p>
      )}

      {status === "enviada" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={onAceitar} disabled={ocupado}>
            <Check className="mr-1 h-4 w-4" /> Aceitar
          </Button>
          <Button size="sm" variant="destructive" onClick={onRecusar} disabled={ocupado}>
            <X className="mr-1 h-4 w-4" /> Recusar
          </Button>
        </div>
      )}
    </div>
  );
}
