import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listIdeias, createIdeia, avaliarIdeia, deleteIdeia } from "@/lib/ideias.functions";
import { useTasks } from "@/lib/tasks-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Lightbulb, Plus, Trophy, Check, X, Clock, Trash2 } from "lucide-react";

type Ideia = Awaited<ReturnType<typeof listIdeias>>[number];

export function IdeiasView() {
  const { membros, myCargo, myId } = useTasks();
  const isAdmin = myCargo === "Admin";
  const qc = useQueryClient();
  const listFn = useServerFn(listIdeias);
  const createFn = useServerFn(createIdeia);
  const avaliarFn = useServerFn(avaliarIdeia);
  const deleteFn = useServerFn(deleteIdeia);

  const { data: ideias = [], isLoading } = useQuery({
    queryKey: ["ideias"],
    queryFn: () => listFn(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["ideias"] });

  const [novaOpen, setNovaOpen] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novaDescricao, setNovaDescricao] = useState("");
  const createMut = useMutation({
    mutationFn: (vars: { titulo: string; descricao?: string }) => createFn({ data: vars }),
    onSuccess: () => {
      toast.success("Ideia enviada! Os Admins foram notificados.");
      setNovaOpen(false);
      setNovoTitulo("");
      setNovaDescricao("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao enviar ideia."),
  });

  const avaliarMut = useMutation({
    mutationFn: (vars: { id: string; decisao: "aceita" | "rejeitada"; pontos?: number }) => avaliarFn({ data: vars }),
    onSuccess: (_r, vars) => {
      toast.success(vars.decisao === "aceita" ? "Ideia aceita!" : "Ideia rejeitada.");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao avaliar ideia."),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Ideia excluída.");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao excluir ideia."),
  });

  const canDelete = (i: Ideia) => isAdmin || (i.criado_por === myId && i.status === "pendente");

  const ranking = useMemo(() => {
    const map = new Map<string, { nome: string; pontos: number; ideias: number }>();
    for (const i of ideias) {
      if (i.status !== "aceita" || !i.pontos) continue;
      const atual = map.get(i.criado_por) ?? { nome: i.autor, pontos: 0, ideias: 0 };
      atual.pontos += i.pontos;
      atual.ideias += 1;
      map.set(i.criado_por, atual);
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.pontos - a.pontos);
  }, [ideias]);

  const pendentes = ideias.filter((i) => i.status === "pendente");

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ideias</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sugestões da equipe. Ideias aceitas rendem pontos que se acumulam pra quem sugeriu.
          </p>
        </div>
        <Button onClick={() => setNovaOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Nova ideia
        </Button>
      </header>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : (
        <>
          {/* Ranking */}
          {ranking.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Trophy className="h-4 w-4" /> Ranking de pontos
              </h2>
              <div className="overflow-hidden rounded-lg border border-border bg-white text-black shadow-sm">
                {ranking.map((r, idx) => {
                  const membro = membros.find((m) => m.id === r.id);
                  return (
                    <div key={r.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                      <span className="w-5 shrink-0 text-center text-sm font-semibold text-gray-400">{idx + 1}</span>
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                        style={{ backgroundColor: membro?.cor ?? "#7B68EE" }}
                      >
                        {membro?.iniciais ?? r.nome.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{r.nome}</div>
                        <div className="text-xs text-gray-500">
                          {r.ideias} {r.ideias === 1 ? "ideia aceita" : "ideias aceitas"}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                        {r.pontos} pts
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Pendentes */}
          {pendentes.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" /> Aguardando avaliação · {pendentes.length}
              </h2>
              <div className="space-y-3">
                {pendentes.map((i) => (
                  <IdeiaCard
                    key={i.id}
                    ideia={i}
                    isAdmin={isAdmin}
                    podeExcluir={canDelete(i)}
                    onAvaliar={avaliarMut.mutate}
                    onExcluir={() => deleteMut.mutate(i.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Histórico */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Histórico · {ideias.length}</h2>
            {ideias.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
                <Lightbulb className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">Nenhuma ideia enviada ainda.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border bg-white text-black shadow-sm">
                {ideias.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{i.titulo}</span>
                        {statusBadge(i.status)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {i.autor} · {new Date(i.criado_em).toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                    {i.status === "aceita" && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                        +{i.pontos} pts
                      </span>
                    )}
                    {canDelete(i) && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-gray-500 hover:text-destructive" title="Excluir ideia">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir "{i.titulo}"?</AlertDialogTitle>
                            <AlertDialogDescription>Esta ação é permanente.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMut.mutate(i.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Nova ideia */}
      <Dialog open={novaOpen} onOpenChange={setNovaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova ideia</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ideia-titulo">Título</Label>
              <Input id="ideia-titulo" value={novoTitulo} onChange={(e) => setNovoTitulo(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ideia-descricao">Descrição (opcional)</Label>
              <Textarea
                id="ideia-descricao"
                rows={4}
                value={novaDescricao}
                onChange={(e) => setNovaDescricao(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovaOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => novoTitulo.trim() && createMut.mutate({ titulo: novoTitulo.trim(), descricao: novaDescricao.trim() || undefined })}
              disabled={!novoTitulo.trim() || createMut.isPending}
            >
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function statusBadge(status: Ideia["status"]) {
  if (status === "aceita") return <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">Aceita</Badge>;
  if (status === "rejeitada") return <Badge variant="destructive">Rejeitada</Badge>;
  return <Badge variant="outline">Pendente</Badge>;
}

function IdeiaCard({
  ideia,
  isAdmin,
  podeExcluir,
  onAvaliar,
  onExcluir,
}: {
  ideia: Ideia;
  isAdmin: boolean;
  podeExcluir: boolean;
  onAvaliar: (vars: { id: string; decisao: "aceita" | "rejeitada"; pontos?: number }) => void;
  onExcluir: () => void;
}) {
  const [pontosOpen, setPontosOpen] = useState(false);
  const [pontos, setPontos] = useState("");

  return (
    <div className="rounded-lg border border-border bg-white p-4 text-black shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{ideia.titulo}</h3>
          <p className="text-xs text-gray-500">
            {ideia.autor} · {new Date(ideia.criado_em).toLocaleDateString("pt-BR")}
          </p>
        </div>
        {podeExcluir && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-gray-500 hover:text-destructive" title="Excluir ideia">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir "{ideia.titulo}"?</AlertDialogTitle>
                <AlertDialogDescription>Esta ação é permanente.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onExcluir}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      {ideia.descricao && <p className="mt-2 whitespace-pre-wrap text-sm text-black/70">{ideia.descricao}</p>}

      {isAdmin && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Dialog open={pontosOpen} onOpenChange={setPontosOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Aceitar "{ideia.titulo}"</DialogTitle>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="pontos">Quantos pontos essa ideia vale?</Label>
                <Input
                  id="pontos"
                  type="number"
                  min={1}
                  value={pontos}
                  onChange={(e) => setPontos(e.target.value)}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPontosOpen(false)}>Cancelar</Button>
                <Button
                  onClick={() => {
                    const n = Number(pontos);
                    if (!n || n < 1) return;
                    onAvaliar({ id: ideia.id, decisao: "aceita", pontos: n });
                    setPontosOpen(false);
                    setPontos("");
                  }}
                  disabled={!pontos || Number(pontos) < 1}
                >
                  Confirmar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button size="sm" onClick={() => setPontosOpen(true)}>
            <Check className="mr-1 h-3.5 w-3.5" /> Aceitar
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive">
                <X className="mr-1 h-3.5 w-3.5" /> Rejeitar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Rejeitar "{ideia.titulo}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  A ideia continua no histórico marcada como rejeitada, sem pontos.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onAvaliar({ id: ideia.id, decisao: "rejeitada" })}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Rejeitar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
