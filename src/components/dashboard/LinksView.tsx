import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listPastasLinks,
  createPastaLinks,
  updatePastaLinks,
  deletePastaLinks,
  addLinkToPasta,
  deleteLinkFromPasta,
} from "@/lib/links.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Folder, FolderPlus, Link2, Plus, Pencil, Trash2, ExternalLink, X, ChevronDown, ChevronRight } from "lucide-react";

type Pasta = Awaited<ReturnType<typeof listPastasLinks>>[number];

function normalizarUrl(url: string): string {
  const t = url.trim();
  if (!t) return t;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function LinksView() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPastasLinks);
  const createFn = useServerFn(createPastaLinks);
  const updateFn = useServerFn(updatePastaLinks);
  const deleteFn = useServerFn(deletePastaLinks);
  const addLinkFn = useServerFn(addLinkToPasta);
  const deleteLinkFn = useServerFn(deleteLinkFromPasta);

  const { data: pastas = [], isLoading } = useQuery({
    queryKey: ["pastas-links"],
    queryFn: () => listFn(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["pastas-links"] });

  const [novaPastaOpen, setNovaPastaOpen] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoComentario, setNovoComentario] = useState("");
  const createMut = useMutation({
    mutationFn: (vars: { nome: string; comentario?: string }) => createFn({ data: vars }),
    onSuccess: () => {
      toast.success("Pasta criada.");
      setNovaPastaOpen(false);
      setNovoNome("");
      setNovoComentario("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao criar pasta."),
  });

  const [editState, setEditState] = useState<{ id: string; nome: string; comentario: string } | null>(null);
  const updateMut = useMutation({
    mutationFn: (vars: { id: string; nome: string; comentario: string }) =>
      updateFn({ data: { id: vars.id, nome: vars.nome, comentario: vars.comentario || null } }),
    onSuccess: () => {
      toast.success("Pasta atualizada.");
      setEditState(null);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar pasta."),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Pasta excluída.");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao excluir pasta."),
  });

  const addLinkMut = useMutation({
    mutationFn: (vars: { pasta_id: string; url: string }) => addLinkFn({ data: vars }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao adicionar link."),
  });

  const deleteLinkMut = useMutation({
    mutationFn: (id: string) => deleteLinkFn({ data: { id } }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao remover link."),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Links</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pastas para guardar links de trabalho, organizados por assunto.
          </p>
        </div>
        <Button onClick={() => setNovaPastaOpen(true)}>
          <FolderPlus className="mr-1.5 h-4 w-4" /> Nova pasta
        </Button>
      </header>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : pastas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Folder className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma pasta criada ainda.</p>
        </div>
      ) : (
        <div className="grid items-start gap-4 sm:grid-cols-2">
          {pastas.map((p) => (
            <PastaCard
              key={p.id}
              pasta={p}
              onEdit={() => setEditState({ id: p.id, nome: p.nome, comentario: p.comentario ?? "" })}
              onDelete={() => deleteMut.mutate(p.id)}
              onAddLink={(url) => addLinkMut.mutate({ pasta_id: p.id, url: normalizarUrl(url) })}
              onDeleteLink={(id) => deleteLinkMut.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* Nova pasta */}
      <Dialog open={novaPastaOpen} onOpenChange={setNovaPastaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova pasta</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pasta-nome">Nome</Label>
              <Input id="pasta-nome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pasta-comentario">Comentário (opcional)</Label>
              <Textarea
                id="pasta-comentario"
                rows={3}
                value={novoComentario}
                onChange={(e) => setNovoComentario(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovaPastaOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => novoNome.trim() && createMut.mutate({ nome: novoNome.trim(), comentario: novoComentario.trim() || undefined })}
              disabled={!novoNome.trim() || createMut.isPending}
            >
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar pasta */}
      <Dialog open={!!editState} onOpenChange={(o) => !o && setEditState(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar pasta</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-nome">Nome</Label>
              <Input
                id="edit-nome"
                value={editState?.nome ?? ""}
                onChange={(e) => setEditState((s) => (s ? { ...s, nome: e.target.value } : s))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-comentario">Comentário (opcional)</Label>
              <Textarea
                id="edit-comentario"
                rows={3}
                value={editState?.comentario ?? ""}
                onChange={(e) => setEditState((s) => (s ? { ...s, comentario: e.target.value } : s))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditState(null)}>Cancelar</Button>
            <Button
              onClick={() => editState?.nome.trim() && updateMut.mutate(editState)}
              disabled={!editState?.nome.trim() || updateMut.isPending}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PastaCard({
  pasta,
  onEdit,
  onDelete,
  onAddLink,
  onDeleteLink,
}: {
  pasta: Pasta;
  onEdit: () => void;
  onDelete: () => void;
  onAddLink: (url: string) => void;
  onDeleteLink: (id: string) => void;
}) {
  const [novoLink, setNovoLink] = useState("");
  const [expanded, setExpanded] = useState(false);

  const submitLink = () => {
    if (!novoLink.trim()) return;
    onAddLink(novoLink.trim());
    setNovoLink("");
  };

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
          <Folder className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="truncate text-base font-semibold">{pasta.nome}</h3>
          <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
            {pasta.links.length}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-600 hover:text-black" onClick={onEdit} title="Editar pasta">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-600 hover:text-destructive" title="Excluir pasta">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir pasta "{pasta.nome}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  Isso apaga a pasta e todos os {pasta.links.length} link(s) guardados nela. Ação permanente.
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

      {pasta.comentario && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-black/70">{pasta.comentario}</p>
      )}

      {expanded && (
        <>
          <div className="mt-4 space-y-1.5">
            {pasta.links.length === 0 ? (
              <p className="text-xs text-gray-500">Nenhum link ainda.</p>
            ) : (
              pasta.links.map((l) => (
                <div key={l.id} className="flex items-center gap-2 rounded-md border border-border bg-gray-50 px-2.5 py-1.5">
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-sm text-primary hover:underline"
                    title={l.url}
                  >
                    {l.url}
                  </a>
                  <ExternalLink className="h-3 w-3 shrink-0 text-gray-400" />
                  <button
                    onClick={() => onDeleteLink(l.id)}
                    className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-destructive"
                    title="Remover link"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Input
              value={novoLink}
              onChange={(e) => setNovoLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitLink();
                }
              }}
              placeholder="Colar um link e apertar Enter..."
              className="h-8 text-sm"
            />
            <Button size="icon" className="h-8 w-8 shrink-0" onClick={submitLink} title="Adicionar link">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
