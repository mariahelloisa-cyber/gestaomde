import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProjetos } from "@/lib/projetos.functions";
import { useTasks } from "@/lib/tasks-store";
import { statusCor } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { FolderKanban, FolderPlus, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";

type Projeto = Awaited<ReturnType<typeof listProjetos>>[number];

export function ProjectsView() {
  const qc = useQueryClient();
  const listFn = useServerFn(listProjetos);
  const { addProjeto, renomearProjeto, removerProjeto, openTask } = useTasks();

  const { data: projetos = [], isLoading } = useQuery({
    queryKey: ["projetos"],
    queryFn: () => listFn(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["projetos"] });

  const [novoOpen, setNovoOpen] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [salvandoNovo, setSalvandoNovo] = useState(false);

  const criar = async () => {
    if (!novoNome.trim()) return;
    setSalvandoNovo(true);
    try {
      await addProjeto(novoNome.trim());
      setNovoOpen(false);
      setNovoNome("");
      invalidate();
    } finally {
      setSalvandoNovo(false);
    }
  };

  const [editState, setEditState] = useState<{ id: string; nome: string } | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Projetos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Categorias de tarefas da agência, independentes do cliente.
          </p>
        </div>
        <Button onClick={() => setNovoOpen(true)}>
          <FolderPlus className="mr-1.5 h-4 w-4" /> Novo projeto
        </Button>
      </header>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : projetos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <FolderKanban className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Nenhum projeto criado ainda.</p>
        </div>
      ) : (
        <div className="grid items-start gap-4 sm:grid-cols-2">
          {projetos.map((p) => (
            <ProjetoCard
              key={p.id}
              projeto={p}
              onEdit={() => setEditState({ id: p.id, nome: p.nome })}
              onDelete={() => {
                removerProjeto(p.id);
                invalidate();
              }}
              onOpenTask={openTask}
            />
          ))}
        </div>
      )}

      {/* Novo projeto */}
      <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo projeto</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="projeto-nome">Nome</Label>
            <Input
              id="projeto-nome"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criar()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovoOpen(false)}>Cancelar</Button>
            <Button onClick={criar} disabled={!novoNome.trim() || salvandoNovo}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar projeto */}
      <Dialog open={!!editState} onOpenChange={(o) => !o && setEditState(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar projeto</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="edit-projeto-nome">Nome</Label>
            <Input
              id="edit-projeto-nome"
              value={editState?.nome ?? ""}
              onChange={(e) => setEditState((s) => (s ? { ...s, nome: e.target.value } : s))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditState(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!editState?.nome.trim()) return;
                renomearProjeto(editState.id, editState.nome.trim());
                setEditState(null);
                invalidate();
              }}
              disabled={!editState?.nome.trim()}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProjetoCard({
  projeto,
  onEdit,
  onDelete,
  onOpenTask,
}: {
  projeto: Projeto;
  onEdit: () => void;
  onDelete: () => void;
  onOpenTask: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-white p-5 text-black shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-500" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-500" />
          )}
          <FolderKanban className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="truncate text-base font-semibold">{projeto.nome}</h3>
          <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
            {projeto.tarefas.length}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-600 hover:text-black" onClick={onEdit} title="Editar projeto">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-600 hover:text-destructive" title="Excluir projeto">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir projeto "{projeto.nome}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  As {projeto.tarefas.length} tarefa(s) vinculadas não são apagadas, apenas ficam sem projeto. Ação permanente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-1.5">
          {projeto.tarefas.length === 0 ? (
            <p className="text-xs text-gray-500">Nenhuma tarefa vinculada ainda.</p>
          ) : (
            projeto.tarefas.map((t) => (
              <button
                key={t.id}
                onClick={() => onOpenTask(t.id)}
                className="flex w-full items-center gap-2 rounded-md border border-border bg-gray-50 px-2.5 py-1.5 text-left hover:bg-gray-100"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: statusCor[t.status as keyof typeof statusCor] ?? "#9CA3AF" }} />
                <span className="min-w-0 flex-1 truncate text-sm">{t.titulo}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
