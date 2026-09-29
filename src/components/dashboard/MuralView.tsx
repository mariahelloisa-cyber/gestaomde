import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Bell,
  Calendar as CalendarIcon,
  Check,
  FolderKanban,
  GripVertical,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import {
  CORES_MURAL,
  adicionarTarefasMural,
  atualizarQuadroMural,
  criarQuadroMural,
  excluirQuadroMural,
  listMural,
  moverItemMural,
  removerItemMural,
  type MuralData,
  type MuralItem,
  type MuralQuadro,
} from "@/lib/mural.functions";
import { useTasks } from "@/lib/tasks-store";
import { passaFiltros } from "@/lib/filtros";
import { isFinalizada, rotuloData, statusCor, type Tarefa } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { TaskCard } from "./task-card";
import { AddTaskDialog } from "./KanbanView";
import { ShareDialog, type ShareAlvo } from "./ShareDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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

/* Mural: quadros pessoais (só a própria pessoa vê). Cada quadro guarda tarefas
 * em que ela é responsável e lembretes pessoais criados ali. Arrastar move o
 * item entre quadros / reordena — nunca muda o status da tarefa.
 *
 * Ids do drag-and-drop: "q:<quadro>" (quadro, para reordenar quadros),
 * "c:<quadro>" (área de itens do quadro, para soltar em quadro vazio) e
 * "i:<item>" (item). */

const LEMBRETE_COR = "#8B5CF6";

/** quadroId -> ids dos itens visíveis, na ordem da tela. */
type Ordem = Record<string, string[]>;

function posicaoEntre(antes?: number, depois?: number): number {
  if (antes !== undefined && depois !== undefined) return (antes + depois) / 2;
  if (antes !== undefined) return antes + 1;
  if (depois !== undefined) return depois - 1;
  return 1;
}

function quadroDoItem(itemId: string, o: Ordem): string | undefined {
  return Object.keys(o).find((q) => o[q].includes(itemId));
}

export function MuralView() {
  const qc = useQueryClient();
  const { tarefas, myId, meuStatusFilter, meusFiltros, openTask, removerTarefa } = useTasks();

  const listFn = useServerFn(listMural);
  const criarQuadroFn = useServerFn(criarQuadroMural);
  const atualizarQuadroFn = useServerFn(atualizarQuadroMural);
  const excluirQuadroFn = useServerFn(excluirQuadroMural);
  const adicionarFn = useServerFn(adicionarTarefasMural);
  const moverFn = useServerFn(moverItemMural);
  const removerItemFn = useServerFn(removerItemMural);

  const { data, isLoading, error } = useQuery({ queryKey: ["mural"], queryFn: () => listFn() });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["mural"] });
  const falhou = (msg: string) => (e: unknown) => {
    toast.error(e instanceof Error ? e.message : msg);
    invalidar();
  };

  const criarQuadroMut = useMutation({
    mutationFn: (v: { nome: string; cor: string }) => criarQuadroFn({ data: v }),
    onSuccess: invalidar,
    onError: falhou("Falha ao criar quadro"),
  });
  const atualizarQuadroMut = useMutation({
    mutationFn: (v: { id: string; nome?: string; cor?: string; posicao?: number }) =>
      atualizarQuadroFn({ data: v }),
    onSuccess: invalidar,
    onError: falhou("Falha ao atualizar quadro"),
  });
  const excluirQuadroMut = useMutation({
    mutationFn: (id: string) => excluirQuadroFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Quadro excluído");
      invalidar();
      // Lembretes do quadro foram apagados junto.
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: falhou("Falha ao excluir quadro"),
  });
  const adicionarMut = useMutation({
    mutationFn: (v: { quadroId: string; tarefaIds: string[] }) => adicionarFn({ data: v }),
    onSuccess: invalidar,
    onError: falhou("Falha ao adicionar tarefas"),
  });
  const moverMut = useMutation({
    mutationFn: (v: { id: string; quadroId: string; posicao: number }) => moverFn({ data: v }),
    onError: falhou("Falha ao mover item"),
  });
  const removerItemMut = useMutation({
    mutationFn: (id: string) => removerItemFn({ data: { id } }),
    onSuccess: invalidar,
    onError: falhou("Falha ao remover do quadro"),
  });

  const quadros = useMemo(
    () => [...(data?.quadros ?? [])].sort((a, b) => a.posicao - b.posicao),
    [data],
  );
  const itens = useMemo(() => data?.itens ?? [], [data]);
  const itemPorId = useMemo(() => new Map(itens.map((i) => [i.id, i])), [itens]);
  const tarefaPorId = useMemo(() => new Map(tarefas.map((t) => [t.id, t])), [tarefas]);

  const ordemBase: Ordem = useMemo(() => {
    const o: Ordem = Object.fromEntries(quadros.map((q) => [q.id, [] as string[]]));
    for (const i of [...itens].sort((a, b) => a.posicao - b.posicao)) {
      const t = tarefaPorId.get(i.tarefa_id);
      if (!t || !o[i.quadro_id]) continue;
      const isLembrete = t.tipo === "lembrete";
      // Se a pessoa deixou de ser responsável, a tarefa some do Mural dela.
      if (!isLembrete && !t.responsaveis.some((r) => r.id === myId)) continue;
      if (!isLembrete && meuStatusFilter && t.status !== meuStatusFilter) continue;
      if (!passaFiltros(t, meusFiltros)) continue;
      o[i.quadro_id].push(i.id);
    }
    return o;
  }, [quadros, itens, tarefaPorId, myId, meuStatusFilter, meusFiltros]);

  const [dragOrdem, setDragOrdem] = useState<Ordem | null>(null);
  const [ativo, setAtivo] = useState<string | null>(null);
  const ordem = dragOrdem ?? ordemBase;
  const ordemRef = useRef(ordem);
  ordemRef.current = ordem;

  // Mouse: arrasta depois de 6px (clique simples abre o item). Toque: segurar
  // ~0,2s para arrastar, senão o gesto rola a tela normalmente.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const collision: CollisionDetection = useCallback((args) => {
    const ativoId = String(args.active.id);
    if (ativoId.startsWith("q:")) {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith("q:")),
      });
    }
    const alvos = args.droppableContainers.filter((c) => !String(c.id).startsWith("q:"));
    const sob = pointerWithin({ ...args, droppableContainers: alvos });
    const hits = sob.length > 0 ? sob : rectIntersection({ ...args, droppableContainers: alvos });
    const item = hits.find((h) => String(h.id).startsWith("i:"));
    if (item) return [item];
    const area = hits.find((h) => String(h.id).startsWith("c:"));
    if (!area) return [];
    // Sobre a área do quadro mas fora de um card: mira o card mais próximo.
    const doQuadro = ordemRef.current[String(area.id).slice(2)] ?? [];
    const cards = alvos.filter(
      (c) => String(c.id).startsWith("i:") && doQuadro.includes(String(c.id).slice(2)),
    );
    return cards.length > 0 ? closestCenter({ ...args, droppableContainers: cards }) : [area];
  }, []);

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setAtivo(id);
    if (id.startsWith("i:")) setDragOrdem(ordemBase);
  };

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const ativoId = String(active.id);
    if (!ativoId.startsWith("i:")) return;
    const itemId = ativoId.slice(2);
    const overId = String(over.id);
    setDragOrdem((prev) => {
      const o = prev ?? ordemBase;
      const de = quadroDoItem(itemId, o);
      const para = overId.startsWith("i:") ? quadroDoItem(overId.slice(2), o) : overId.slice(2);
      if (!de || !para || de === para || !o[para]) return prev;
      const destino = o[para];
      let idx = destino.length;
      if (overId.startsWith("i:")) {
        const r = active.rect.current.translated;
        const abaixo = !!r && r.top > over.rect.top + over.rect.height / 2;
        idx = destino.indexOf(overId.slice(2)) + (abaixo ? 1 : 0);
      }
      return {
        ...o,
        [de]: o[de].filter((x) => x !== itemId),
        [para]: [...destino.slice(0, idx), itemId, ...destino.slice(idx)],
      };
    });
  };

  const fimDoDrag = () => {
    setAtivo(null);
    setDragOrdem(null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    const ativoId = String(active.id);
    const overId = over ? String(over.id) : null;

    if (ativoId.startsWith("q:")) {
      fimDoDrag();
      if (!overId || !overId.startsWith("q:") || overId === ativoId) return;
      const de = quadros.findIndex((q) => q.id === ativoId.slice(2));
      const para = quadros.findIndex((q) => q.id === overId.slice(2));
      if (de < 0 || para < 0) return;
      const novos = arrayMove(quadros, de, para);
      const posicao = posicaoEntre(novos[para - 1]?.posicao, novos[para + 1]?.posicao);
      const id = ativoId.slice(2);
      qc.setQueryData<MuralData>(["mural"], (d) =>
        d ? { ...d, quadros: d.quadros.map((q) => (q.id === id ? { ...q, posicao } : q)) } : d,
      );
      atualizarQuadroMut.mutate({ id, posicao });
      return;
    }

    const itemId = ativoId.slice(2);
    const o = ordemRef.current;
    const destino = quadroDoItem(itemId, o);
    const original = itemPorId.get(itemId);
    if (!overId || !destino || !original) {
      fimDoDrag();
      return;
    }
    let lista = o[destino];
    if (overId.startsWith("i:")) {
      const overItem = overId.slice(2);
      if (overItem !== itemId && lista.includes(overItem)) {
        lista = arrayMove(lista, lista.indexOf(itemId), lista.indexOf(overItem));
      }
    }
    const inalterado =
      destino === original.quadro_id && lista.join() === (ordemBase[destino] ?? []).join();
    if (inalterado) {
      fimDoDrag();
      return;
    }
    const idx = lista.indexOf(itemId);
    const posicao = posicaoEntre(
      itemPorId.get(lista[idx - 1])?.posicao,
      itemPorId.get(lista[idx + 1])?.posicao,
    );
    // Otimista: a tela já fica no lugar novo enquanto o servidor salva.
    qc.setQueryData<MuralData>(["mural"], (d) =>
      d
        ? {
            ...d,
            itens: d.itens.map((i) =>
              i.id === itemId ? { ...i, quadro_id: destino, posicao } : i,
            ),
          }
        : d,
    );
    fimDoDrag();
    moverMut.mutate({ id: itemId, quadroId: destino, posicao });
  };

  /* ---------- diálogos ---------- */
  const [quadroDialog, setQuadroDialog] = useState<
    { modo: "novo" } | { modo: "editar"; quadro: MuralQuadro } | null
  >(null);
  const [excluindoQuadro, setExcluindoQuadro] = useState<MuralQuadro | null>(null);
  const [lembreteEm, setLembreteEm] = useState<string | null>(null);
  const [adicionandoEm, setAdicionandoEm] = useState<string | null>(null);
  const [compartilhando, setCompartilhando] = useState<ShareAlvo | null>(null);
  const [excluindoLembrete, setExcluindoLembrete] = useState<Tarefa | null>(null);

  const lembretesNoQuadro = (quadroId: string) =>
    itens.filter(
      (i) => i.quadro_id === quadroId && tarefaPorId.get(i.tarefa_id)?.tipo === "lembrete",
    ).length;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-sm text-muted-foreground">
        Carregando Mural…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center text-sm text-destructive">
        Não foi possível carregar o Mural: {error instanceof Error ? error.message : "erro"}
      </div>
    );
  }

  const itemAtivo = ativo?.startsWith("i:") ? itemPorId.get(ativo.slice(2)) : undefined;
  const tarefaAtiva = itemAtivo ? tarefaPorId.get(itemAtivo.tarefa_id) : undefined;
  const quadroAtivo = ativo?.startsWith("q:")
    ? quadros.find((q) => q.id === ativo.slice(2))
    : undefined;

  return (
    <>
      {quadros.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
            <StickyNote className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Seu Mural está vazio</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Crie quadros para organizar suas tarefas e lembretes do seu jeito. Só você vê o seu
              Mural.
            </p>
          </div>
          <Button onClick={() => setQuadroDialog({ modo: "novo" })}>
            <Plus className="mr-1.5 h-4 w-4" /> Novo quadro
          </Button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={fimDoDrag}
        >
          <div className="flex h-full gap-4 overflow-x-auto p-5">
            <SortableContext
              items={quadros.map((q) => `q:${q.id}`)}
              strategy={horizontalListSortingStrategy}
            >
              {quadros.map((q) => (
                <QuadroColuna
                  key={q.id}
                  quadro={q}
                  itemIds={ordem[q.id] ?? []}
                  itemPorId={itemPorId}
                  tarefaPorId={tarefaPorId}
                  onNovoLembrete={() => setLembreteEm(q.id)}
                  onAdicionarTarefas={() => setAdicionandoEm(q.id)}
                  onEditar={() => setQuadroDialog({ modo: "editar", quadro: q })}
                  onExcluir={() => setExcluindoQuadro(q)}
                  onAbrir={(t) => openTask(t.id)}
                  onCompartilhar={(t) =>
                    setCompartilhando({ tipo: "tarefa", tarefaId: t.id, titulo: t.titulo })
                  }
                  onRemover={(i) => removerItemMut.mutate(i.id)}
                  onExcluirLembrete={(t) => setExcluindoLembrete(t)}
                />
              ))}
            </SortableContext>
            <button
              onClick={() => setQuadroDialog({ modo: "novo" })}
              className="flex h-12 w-72 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:w-80"
            >
              <Plus className="h-4 w-4" /> Novo quadro
            </button>
          </div>

          <DragOverlay>
            {tarefaAtiva ? (
              <div className="w-72 rotate-2 cursor-grabbing sm:w-[18.5rem]">
                <MuralCard tarefa={tarefaAtiva} />
              </div>
            ) : quadroAtivo ? (
              <div
                className="w-72 rotate-1 cursor-grabbing rounded-xl border border-border bg-[var(--surface-2)] px-3.5 py-2.5 text-sm font-semibold shadow-lg sm:w-80"
                style={{ color: quadroAtivo.cor, borderTop: `3px solid ${quadroAtivo.cor}` }}
              >
                {quadroAtivo.nome}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {quadroDialog && (
        <QuadroDialog
          titulo={quadroDialog.modo === "novo" ? "Novo quadro" : "Editar quadro"}
          inicial={quadroDialog.modo === "editar" ? quadroDialog.quadro : undefined}
          salvando={criarQuadroMut.isPending || atualizarQuadroMut.isPending}
          onClose={() => setQuadroDialog(null)}
          onSalvar={async (v) => {
            if (quadroDialog.modo === "novo") await criarQuadroMut.mutateAsync(v);
            else await atualizarQuadroMut.mutateAsync({ id: quadroDialog.quadro.id, ...v });
            setQuadroDialog(null);
          }}
        />
      )}

      {excluindoQuadro && (
        <AlertDialog open onOpenChange={(o) => !o && setExcluindoQuadro(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir o quadro “{excluindoQuadro.nome}”?</AlertDialogTitle>
              <AlertDialogDescription>
                As tarefas só saem do quadro e continuam existindo normalmente.
                {lembretesNoQuadro(excluindoQuadro.id) > 0 && (
                  <>
                    {" "}
                    <strong className="text-foreground">
                      {lembretesNoQuadro(excluindoQuadro.id) === 1
                        ? "O lembrete deste quadro será apagado"
                        : `Os ${lembretesNoQuadro(excluindoQuadro.id)} lembretes deste quadro serão apagados`}{" "}
                      permanentemente.
                    </strong>
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  excluirQuadroMut.mutate(excluindoQuadro.id);
                  setExcluindoQuadro(null);
                }}
              >
                Excluir quadro
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {excluindoLembrete && (
        <AlertDialog open onOpenChange={(o) => !o && setExcluindoLembrete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir o lembrete “{excluindoLembrete.titulo}”?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação não pode ser desfeita. O lembrete também sai da Agenda.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  removerTarefa(excluindoLembrete.id);
                  setExcluindoLembrete(null);
                }}
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {lembreteEm && (
        <AddTaskDialog
          key={lembreteEm}
          muralQuadroId={lembreteEm}
          trigger={null}
          open
          onOpenChange={(o) => !o && setLembreteEm(null)}
        />
      )}

      {adicionandoEm && (
        <AdicionarTarefasDialog
          quadro={quadros.find((q) => q.id === adicionandoEm)}
          tarefasNoMural={new Set(itens.map((i) => i.tarefa_id))}
          salvando={adicionarMut.isPending}
          onClose={() => setAdicionandoEm(null)}
          onAdicionar={async (tarefaIds) => {
            await adicionarMut.mutateAsync({ quadroId: adicionandoEm, tarefaIds });
            setAdicionandoEm(null);
          }}
        />
      )}

      {compartilhando && (
        <ShareDialog
          alvo={compartilhando}
          open
          onOpenChange={(o) => !o && setCompartilhando(null)}
        />
      )}
    </>
  );
}

/* ---------------- Coluna (quadro) ---------------- */

function QuadroColuna({
  quadro,
  itemIds,
  itemPorId,
  tarefaPorId,
  onNovoLembrete,
  onAdicionarTarefas,
  onEditar,
  onExcluir,
  onAbrir,
  onCompartilhar,
  onRemover,
  onExcluirLembrete,
}: {
  quadro: MuralQuadro;
  itemIds: string[];
  itemPorId: Map<string, MuralItem>;
  tarefaPorId: Map<string, Tarefa>;
  onNovoLembrete: () => void;
  onAdicionarTarefas: () => void;
  onEditar: () => void;
  onExcluir: () => void;
  onAbrir: (t: Tarefa) => void;
  onCompartilhar: (t: Tarefa) => void;
  onRemover: (i: MuralItem) => void;
  onExcluirLembrete: (t: Tarefa) => void;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `q:${quadro.id}` });
  const { setNodeRef: setAreaRef, isOver } = useDroppable({ id: `c:${quadro.id}` });
  const cor = quadro.cor;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-[var(--surface-2)] sm:w-80",
        isDragging && "opacity-40",
      )}
    >
      <div
        className="flex items-center justify-between gap-2 px-2.5 py-2.5"
        style={{
          backgroundColor: `color-mix(in oklab, ${cor} 14%, transparent)`,
          borderBottom: `1px solid color-mix(in oklab, ${cor} 30%, transparent)`,
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
            title="Arraste para reordenar o quadro"
            aria-label={`Reordenar quadro ${quadro.nome}`}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
          <span className="truncate text-sm font-semibold" style={{ color: cor }}>
            {quadro.nome}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">{itemIds.length}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Adicionar"
              >
                <Plus className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={onNovoLembrete} className="gap-2">
                <Bell className="h-3.5 w-3.5" /> Novo lembrete
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onAdicionarTarefas} className="gap-2">
                <ListPlus className="h-3.5 w-3.5" /> Adicionar tarefas existentes
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Opções do quadro"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onEditar} className="gap-2">
                <Pencil className="h-3.5 w-3.5" /> Renomear / cor
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onExcluir}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir quadro
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        ref={setAreaRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors",
          isOver && "bg-muted/40",
        )}
      >
        <SortableContext
          items={itemIds.map((i) => `i:${i}`)}
          strategy={verticalListSortingStrategy}
        >
          {itemIds.map((id) => {
            const item = itemPorId.get(id);
            const tarefa = item ? tarefaPorId.get(item.tarefa_id) : undefined;
            if (!item || !tarefa) return null;
            return (
              <ItemArrastavel
                key={id}
                item={item}
                tarefa={tarefa}
                onAbrir={() => onAbrir(tarefa)}
                onCompartilhar={() => onCompartilhar(tarefa)}
                onRemover={() => onRemover(item)}
                onExcluirLembrete={() => onExcluirLembrete(tarefa)}
              />
            );
          })}
        </SortableContext>
        {itemIds.length === 0 && (
          <div className="flex shrink-0 flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 py-8 text-xs text-muted-foreground">
            <StickyNote className="h-5 w-5 opacity-40" />
            Arraste itens para cá
          </div>
        )}
        <div className="mt-1 flex gap-1">
          <button
            onClick={onNovoLembrete}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Bell className="h-3.5 w-3.5" /> Lembrete
          </button>
          <button
            onClick={onAdicionarTarefas}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ListPlus className="h-3.5 w-3.5" /> Tarefas
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Item ---------------- */

function ItemArrastavel({
  item,
  tarefa,
  onAbrir,
  onCompartilhar,
  onRemover,
  onExcluirLembrete,
}: {
  item: MuralItem;
  tarefa: Tarefa;
  onAbrir: () => void;
  onCompartilhar: () => void;
  onRemover: () => void;
  onExcluirLembrete: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: `i:${item.id}`,
  });
  const isLembrete = tarefa.tipo === "lembrete";

  // O menu não pode iniciar arrasto nem abrir o item.
  const pararEvento = (e: React.SyntheticEvent) => e.stopPropagation();
  const menu = (
    <span onMouseDown={pararEvento} onTouchStart={pararEvento} onClick={pararEvento}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="rounded p-0.5 text-muted-foreground opacity-70 hover:bg-muted hover:text-foreground hover:opacity-100"
            aria-label="Ações do item"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={onAbrir}>Abrir</DropdownMenuItem>
          <DropdownMenuItem onClick={onCompartilhar} className="gap-2">
            <Share2 className="h-3.5 w-3.5" /> Compartilhar link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isLembrete ? (
            <DropdownMenuItem
              onClick={onExcluirLembrete}
              className="gap-2 text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Excluir lembrete
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onRemover} className="gap-2">
              <X className="h-3.5 w-3.5" /> Remover do quadro
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-manipulation", isDragging && "opacity-30")}
      {...attributes}
      {...listeners}
    >
      <MuralCard tarefa={tarefa} onClick={onAbrir} acoes={menu} />
    </div>
  );
}

function MuralCard({
  tarefa,
  onClick,
  acoes,
}: {
  tarefa: Tarefa;
  onClick?: () => void;
  acoes?: React.ReactNode;
}) {
  const { clientes, membros, projetos } = useTasks();

  if (tarefa.tipo === "lembrete") {
    const projeto = tarefa.projeto_id ? projetos.find((p) => p.id === tarefa.projeto_id) : null;
    return (
      <div
        onClick={onClick}
        className="task-surface cursor-grab rounded-md border border-dashed p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
        style={{ borderColor: `${LEMBRETE_COR}80` }}
      >
        <div className="mb-1.5 flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: LEMBRETE_COR, backgroundColor: `${LEMBRETE_COR}1F` }}
          >
            <Bell className="h-2.5 w-2.5" strokeWidth={2.5} />
            Lembrete
          </span>
          {acoes && <div className="ml-auto flex shrink-0 items-center">{acoes}</div>}
        </div>
        <p className="mb-1 break-words text-sm font-medium leading-snug">{tarefa.titulo}</p>
        {tarefa.descricao && (
          <p className="mb-2 truncate text-xs text-muted-foreground">{tarefa.descricao}</p>
        )}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarIcon className="h-3 w-3" />
            {tarefa.data_vencimento ? rotuloData(tarefa.data_vencimento) : "Sem data"}
          </span>
          {projeto && (
            <span className="flex min-w-0 items-center gap-1">
              <FolderKanban className="h-3 w-3 shrink-0" />
              <span className="truncate">{projeto.nome}</span>
            </span>
          )}
        </div>
      </div>
    );
  }

  const cliente = clientes.find((c) => c.id === tarefa.cliente_id);
  const responsaveis = tarefa.responsaveis.map((r) => ({
    ...r,
    cor: membros.find((m) => m.id === r.id)?.cor ?? "#7B68EE",
  }));
  return (
    <TaskCard
      tarefa={tarefa}
      cliente={cliente}
      responsaveis={responsaveis}
      mostrarStatus
      acoes={acoes}
      onClick={onClick}
    />
  );
}

/* ---------------- Diálogos ---------------- */

function QuadroDialog({
  titulo,
  inicial,
  salvando,
  onClose,
  onSalvar,
}: {
  titulo: string;
  inicial?: { nome: string; cor: string };
  salvando: boolean;
  onClose: () => void;
  onSalvar: (v: { nome: string; cor: string }) => Promise<void>;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [cor, setCor] = useState<string>(inicial?.cor ?? CORES_MURAL[0]);
  const salvar = () => {
    if (!nome.trim() || salvando) return;
    onSalvar({ nome: nome.trim(), cor }).catch(() => undefined);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>Só você vê os quadros do seu Mural.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            autoFocus
            value={nome}
            maxLength={80}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && salvar()}
            placeholder="Nome do quadro"
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

function AdicionarTarefasDialog({
  quadro,
  tarefasNoMural,
  salvando,
  onClose,
  onAdicionar,
}: {
  quadro?: MuralQuadro;
  tarefasNoMural: Set<string>;
  salvando: boolean;
  onClose: () => void;
  onAdicionar: (tarefaIds: string[]) => Promise<void>;
}) {
  const { tarefas, clientes, myId } = useTasks();
  const [busca, setBusca] = useState("");
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());

  // Só tarefas da própria pessoa, ainda fora do Mural (uma tarefa fica em um
  // quadro só) e que não foram para "Finalizados".
  const disponiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return tarefas
      .filter(
        (t) =>
          (t.tipo ?? "tarefa") === "tarefa" &&
          t.responsaveis.some((r) => r.id === myId) &&
          !tarefasNoMural.has(t.id) &&
          !isFinalizada(t) &&
          (!q || t.titulo.toLowerCase().includes(q)),
      )
      .sort((a, b) => (a.data_vencimento || "9999").localeCompare(b.data_vencimento || "9999"));
  }, [tarefas, myId, tarefasNoMural, busca]);

  const alternar = (id: string) =>
    setSelecionadas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar tarefas{quadro ? ` em “${quadro.nome}”` : ""}</DialogTitle>
          <DialogDescription>
            Suas tarefas que ainda não estão em nenhum quadro do Mural.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar tarefa..."
            className="pl-9"
          />
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {disponiveis.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma tarefa disponível.
            </p>
          ) : (
            <ul className="space-y-1">
              {disponiveis.map((t) => {
                const cliente = clientes.find((c) => c.id === t.cliente_id);
                return (
                  <li key={t.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted">
                      <Checkbox
                        checked={selecionadas.has(t.id)}
                        onCheckedChange={() => alternar(t.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{t.titulo}</p>
                        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: statusCor[t.status] }}
                          />
                          {t.status}
                          {cliente && <> · {cliente.nome_empresa}</>}
                          {t.data_vencimento && <> · {rotuloData(t.data_vencimento)}</>}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={selecionadas.size === 0 || salvando}
            onClick={() => onAdicionar([...selecionadas]).catch(() => undefined)}
          >
            {salvando
              ? "Adicionando…"
              : `Adicionar${selecionadas.size > 0 ? ` (${selecionadas.size})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
