import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, LayoutGrid, MoreHorizontal, Pencil, Plus, StickyNote, Trash2 } from "lucide-react";
import {
  CORES_MURAL,
  atualizarMural,
  criarMural,
  excluirMural,
  listMurais,
  type MuralResumo,
} from "@/lib/mural.functions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* Lista dos murais da pessoa — a primeira tela da aba Mural. Entrar em um
 * mural abre os quadros dele (MuralView). Só o dono vê os próprios murais. */

type Edicao = { modo: "novo" } | { modo: "editar"; mural: MuralResumo };

export function MuraisView({ onAbrir }: { onAbrir: (muralId: string) => void }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listMurais);
  const criarFn = useServerFn(criarMural);
  const atualizarFn = useServerFn(atualizarMural);
  const excluirFn = useServerFn(excluirMural);

  const { data, isLoading, error } = useQuery({
    queryKey: ["murais"],
    queryFn: () => listFn(),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["murais"] });
  const falhou = (msg: string) => (e: unknown) => {
    toast.error(e instanceof Error ? e.message : msg);
    invalidar();
  };

  const criarMut = useMutation({
    mutationFn: (v: { nome: string; cor: string; descricao: string | null }) =>
      criarFn({ data: v }),
    onSuccess: invalidar,
    onError: falhou("Falha ao criar mural"),
  });
  const atualizarMut = useMutation({
    mutationFn: (v: { id: string; nome: string; cor: string; descricao: string | null }) =>
      atualizarFn({ data: v }),
    onSuccess: invalidar,
    onError: falhou("Falha ao atualizar mural"),
  });
  const excluirMut = useMutation({
    mutationFn: (id: string) => excluirFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Mural excluído");
      invalidar();
      // Lembretes que estavam nos quadros do mural foram apagados junto.
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: falhou("Falha ao excluir mural"),
  });

  const murais = useMemo(() => data ?? [], [data]);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [excluindo, setExcluindo] = useState<MuralResumo | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-sm text-muted-foreground">
        Carregando seus murais…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center text-sm text-destructive">
        Não foi possível carregar seus murais: {error instanceof Error ? error.message : "erro"}
      </div>
    );
  }

  return (
    <>
      {murais.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
            <StickyNote className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Você ainda não tem murais</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Crie um mural para cada assunto e, dentro dele, os quadros com suas tarefas e
              lembretes. Só você vê os seus murais.
            </p>
          </div>
          <Button onClick={() => setEdicao({ modo: "novo" })}>
            <Plus className="mr-1.5 h-4 w-4" /> Novo mural
          </Button>
        </div>
      ) : (
        <div className="h-full overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Meus murais</h2>
              <p className="text-xs text-muted-foreground">
                {murais.length === 1 ? "1 mural" : `${murais.length} murais`} · só você vê
              </p>
            </div>
            <Button size="sm" onClick={() => setEdicao({ modo: "novo" })}>
              <Plus className="mr-1.5 h-4 w-4" /> Novo mural
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {murais.map((m) => (
              <MuralCard
                key={m.id}
                mural={m}
                onAbrir={() => onAbrir(m.id)}
                onEditar={() => setEdicao({ modo: "editar", mural: m })}
                onExcluir={() => setExcluindo(m)}
              />
            ))}
            <button
              onClick={() => setEdicao({ modo: "novo" })}
              className="flex min-h-[7.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-5 w-5" /> Novo mural
            </button>
          </div>
        </div>
      )}

      {edicao && (
        <MuralDialog
          titulo={edicao.modo === "novo" ? "Novo mural" : "Editar mural"}
          inicial={edicao.modo === "editar" ? edicao.mural : undefined}
          salvando={criarMut.isPending || atualizarMut.isPending}
          onClose={() => setEdicao(null)}
          onSalvar={async (v) => {
            if (edicao.modo === "novo") await criarMut.mutateAsync(v);
            else await atualizarMut.mutateAsync({ id: edicao.mural.id, ...v });
            setEdicao(null);
          }}
        />
      )}

      {excluindo && (
        <AlertDialog open onOpenChange={(o) => !o && setExcluindo(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir o mural “{excluindo.nome}”?</AlertDialogTitle>
              <AlertDialogDescription>
                {excluindo.quadros > 0 && (
                  <>
                    {excluindo.quadros === 1
                      ? "O quadro dele será excluído"
                      : `Os ${excluindo.quadros} quadros dele serão excluídos`}
                    .{" "}
                  </>
                )}
                As tarefas só saem do mural e continuam existindo normalmente.{" "}
                <strong className="text-foreground">
                  Os lembretes criados nos quadros deste mural serão apagados permanentemente.
                </strong>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  excluirMut.mutate(excluindo.id);
                  setExcluindo(null);
                }}
              >
                Excluir mural
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

function MuralCard({
  mural,
  onAbrir,
  onEditar,
  onExcluir,
}: {
  mural: MuralResumo;
  onAbrir: () => void;
  onEditar: () => void;
  onExcluir: () => void;
}) {
  const pararEvento = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir();
        }
      }}
      className="flex min-h-[7.5rem] cursor-pointer flex-col gap-2 rounded-xl border border-border bg-[var(--surface-2)] p-3.5 text-left shadow-sm transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ borderTop: `3px solid ${mural.cor}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: mural.cor }} />
          <span className="truncate text-sm font-semibold" style={{ color: mural.cor }}>
            {mural.nome}
          </span>
        </div>
        <span onClick={pararEvento} onKeyDown={pararEvento}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Opções do mural ${mural.nome}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onEditar} className="gap-2">
                <Pencil className="h-3.5 w-3.5" /> Editar mural
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onExcluir}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir mural
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      {mural.descricao && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{mural.descricao}</p>
      )}

      <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <LayoutGrid className="h-3.5 w-3.5" />
          {mural.quadros === 1 ? "1 quadro" : `${mural.quadros} quadros`}
        </span>
        <span className="flex items-center gap-1">
          <StickyNote className="h-3.5 w-3.5" />
          {mural.itens === 1 ? "1 item" : `${mural.itens} itens`}
        </span>
      </div>
    </div>
  );
}

function MuralDialog({
  titulo,
  inicial,
  salvando,
  onClose,
  onSalvar,
}: {
  titulo: string;
  inicial?: { nome: string; cor: string; descricao: string | null };
  salvando: boolean;
  onClose: () => void;
  onSalvar: (v: { nome: string; cor: string; descricao: string | null }) => Promise<void>;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [cor, setCor] = useState<string>(inicial?.cor ?? CORES_MURAL[0]);

  const salvar = () => {
    if (!nome.trim() || salvando) return;
    onSalvar({ nome: nome.trim(), cor, descricao: descricao.trim() || null }).catch(
      () => undefined,
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>Só você vê os seus murais.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            autoFocus
            value={nome}
            maxLength={80}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && salvar()}
            placeholder="Nome do mural"
          />
          <Textarea
            value={descricao}
            maxLength={280}
            rows={3}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição (opcional)"
          />
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Cor
            </div>
            <div className="flex flex-wrap gap-2">
              {CORES_MURAL.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCor(c)}
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-full ring-offset-2 ring-offset-background transition-shadow",
                    cor === c && "ring-2",
                  )}
                  style={{ backgroundColor: c, ["--tw-ring-color" as string]: c }}
                  aria-label={`Cor ${c}`}
                >
                  {cor === c && <Check className="h-4 w-4 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={!nome.trim() || salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
