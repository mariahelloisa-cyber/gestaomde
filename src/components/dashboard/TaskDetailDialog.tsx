import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarIcon,
  Check,
  ChevronDown,
  Flag,
  FolderKanban,
  ListChecks,
  Mic,
  Paperclip,
  Plus,
  Send,
  Share2,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  prioridadeCor,
  complexidadeCor,
  complexidadePillStyle,
  statusCor,
  prioridadePillStyle,
  type Complexidade,
  type Prioridade,
  type Status,
  type Tarefa,
} from "@/lib/mock-data";
import { useTasks, type AlteracoesChecklist } from "@/lib/tasks-store";
import { toast } from "sonner";
import { ShareDialog } from "./ShareDialog";
import { cn } from "@/lib/utils";

const STATUSES: Status[] = ["Pendente", "Em Progresso", "Em Análise", "Concluído"];
const PRIORIDADES: Prioridade[] = ["Alta", "Média", "Baixa", "Nenhuma"];
const COMPLEXIDADES: Complexidade[] = ["Fácil", "Média", "Difícil"];
const complexidadeIcon: Record<Complexidade, typeof SignalLow> = {
  Fácil: SignalLow,
  Média: SignalMedium,
  Difícil: SignalHigh,
};

function relativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `há ${d} d`;
  return format(new Date(iso), "dd 'de' MMM", { locale: ptBR });
}

type Responsavel = { id: string; nome: string; iniciais: string };
type ItemRascunho = { id: string; texto: string; concluido: boolean; novo?: boolean };

/** Cópia editável da tarefa: nada vai pro servidor até clicar em Salvar. */
interface Rascunho {
  tarefaId: string;
  titulo: string;
  descricao: string;
  status: Status;
  prioridade: Prioridade;
  complexidade: Complexidade;
  data_vencimento: string;
  projeto_id: string | null;
  responsaveis: Responsavel[];
  checklist: ItemRascunho[];
}

function rascunhoDe(t: Tarefa): Rascunho {
  return {
    tarefaId: t.id,
    titulo: t.titulo,
    descricao: t.descricao ?? "",
    status: t.status,
    prioridade: t.prioridade,
    complexidade: t.complexidade,
    data_vencimento: t.data_vencimento,
    projeto_id: t.projeto_id ?? null,
    responsaveis: t.responsaveis.map((r) => ({ id: r.id, nome: r.nome, iniciais: r.iniciais })),
    checklist: (t.checklist ?? []).map((i) => ({ ...i })),
  };
}

function calcularAlteracoes(t: Tarefa, r: Rascunho) {
  const patch: Partial<Tarefa> = {};
  const titulo = r.titulo.trim();
  if (titulo && titulo !== t.titulo) patch.titulo = titulo;
  if (r.descricao !== (t.descricao ?? "")) patch.descricao = r.descricao;
  if (r.status !== t.status) patch.status = r.status;
  if (r.prioridade !== t.prioridade) patch.prioridade = r.prioridade;
  if (r.complexidade !== t.complexidade) patch.complexidade = r.complexidade;
  if (r.data_vencimento !== t.data_vencimento) patch.data_vencimento = r.data_vencimento;
  if (r.projeto_id !== (t.projeto_id ?? null)) patch.projeto_id = r.projeto_id;
  const ids = (arr: Responsavel[]) =>
    arr
      .map((x) => x.id)
      .sort()
      .join(",");
  if (ids(r.responsaveis) !== ids(t.responsaveis)) patch.responsaveis = r.responsaveis;

  const originais = new Map((t.checklist ?? []).map((i) => [i.id, i]));
  const mantidos = new Set(r.checklist.filter((i) => !i.novo).map((i) => i.id));
  const checklist: AlteracoesChecklist = {
    adicionar: r.checklist
      .filter((i) => i.novo)
      .map((i) => ({ texto: i.texto, concluido: i.concluido })),
    alternar: r.checklist
      .filter((i) => !i.novo && originais.has(i.id))
      .filter((i) => originais.get(i.id)!.concluido !== i.concluido)
      .map((i) => ({ id: i.id, concluido: i.concluido })),
    remover: [...originais.keys()].filter((id) => !mantidos.has(id)),
  };

  const temAlteracao =
    Object.keys(patch).length > 0 ||
    checklist.adicionar.length > 0 ||
    checklist.alternar.length > 0 ||
    checklist.remover.length > 0;
  return { patch, checklist, temAlteracao };
}

export function TaskDetailDialog() {
  const {
    tarefas,
    clientes,
    projetos,
    selectedTaskId,
    closeTask,
    salvarTarefa,
    addComentario,
    removerTarefa,
    myCargo,
  } = useTasks();
  const tarefa = tarefas.find((t) => t.id === selectedTaskId) ?? null;
  const cliente = tarefa ? clientes.find((c) => c.id === tarefa.cliente_id) : null;
  const isAdmin = myCargo === "Admin";

  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [comentario, setComentario] = useState("");
  const [novoItem, setNovoItem] = useState("");
  const [compartilhando, setCompartilhando] = useState(false);

  // Abrir (ou reabrir) a tarefa sempre parte do que está salvo — fechar sem
  // salvar descarta o rascunho.
  useEffect(() => {
    setRascunho(tarefa ? rascunhoDe(tarefa) : null);
    if (tarefa) {
      setComentario("");
      setNovoItem("");
      setCompartilhando(false);
    }
  }, [tarefa?.id]);

  if (!tarefa) return null;

  const r = rascunho?.tarefaId === tarefa.id ? rascunho : rascunhoDe(tarefa);
  const editar = (patch: Partial<Rascunho>) => setRascunho({ ...r, ...patch });
  const { patch, checklist: alteracoesChecklist, temAlteracao } = calcularAlteracoes(tarefa, r);
  const podeSalvar = temAlteracao && !!r.titulo.trim() && !salvando;

  const checklist = r.checklist;
  const totalItens = checklist.length;
  const concluidosItens = checklist.filter((i) => i.concluido).length;
  const progresso = totalItens > 0 ? Math.round((concluidosItens / totalItens) * 100) : 0;

  const adicionarItem = () => {
    const v = novoItem.trim();
    if (!v) return;
    editar({
      checklist: [
        ...checklist,
        { id: `novo-${crypto.randomUUID()}`, texto: v, concluido: false, novo: true },
      ],
    });
    setNovoItem("");
  };

  const salvar = async () => {
    if (!podeSalvar) return;
    setSalvando(true);
    const ok = await salvarTarefa(tarefa.id, patch, alteracoesChecklist);
    setSalvando(false);
    if (ok) {
      toast.success("Alterações salvas");
      closeTask();
    }
  };

  const enviarComentario = () => {
    const v = comentario.trim();
    if (!v) return;
    const principal = tarefa.responsaveis[0] ?? { nome: "Você", iniciais: "EU" };
    addComentario(tarefa.id, {
      autor: { nome: principal.nome, iniciais: principal.iniciais, cor: "#7B68EE" },
      conteudo: v,
    });
    setComentario("");
  };

  return (
    <Dialog open onOpenChange={(o) => !o && closeTask()}>
      <DialogContent className="max-w-4xl gap-0 overflow-hidden p-0 sm:rounded-xl">
        <DialogTitle className="sr-only">{tarefa.titulo}</DialogTitle>

        {/* Cabeçalho */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <span className="text-xs text-muted-foreground">
            Espaço de equipe
            {cliente && (
              <>
                {" / "}
                <span className="font-medium text-foreground">{cliente.nome_empresa}</span>
              </>
            )}
          </span>
          <div className="ml-auto">
            <StatusDropdown
              status={r.status}
              onChange={(s) => editar({ status: s })}
              isAdmin={isAdmin}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-primary"
            title="Compartilhar por link (somente leitura)"
            onClick={() => setCompartilhando(true)}
          >
            <Share2 className="h-4 w-4" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="mr-8 h-8 w-8 text-muted-foreground hover:text-destructive"
                title={tarefa.tipo === "lembrete" ? "Excluir lembrete" : "Excluir tarefa"}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Excluir {tarefa.tipo === "lembrete" ? "lembrete" : "tarefa"}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação não pode ser desfeita.{" "}
                  {tarefa.tipo === "lembrete" ? "O lembrete" : "A tarefa"} e seus comentários serão
                  removidos permanentemente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    const id = tarefa.id;
                    closeTask();
                    removerTarefa(id);
                  }}
                >
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="grid max-h-[80vh] grid-cols-[1fr_280px] overflow-hidden">
          {/* Corpo principal */}
          <div className="flex flex-col overflow-y-auto px-6 py-5">
            <input
              value={r.titulo}
              onChange={(e) => editar({ titulo: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              placeholder="Título da tarefa"
              className="w-full border-0 bg-transparent text-2xl font-semibold leading-tight outline-none placeholder:text-muted-foreground"
            />

            <Textarea
              value={r.descricao}
              onChange={(e) => editar({ descricao: e.target.value })}
              placeholder="Escreva uma descrição..."
              className="mt-4 min-h-[120px] resize-none border-border/60 bg-[var(--surface-1)] text-sm shadow-none focus-visible:ring-1"
            />

            {/* Áudio (trazido de uma demanda externa aceita) */}
            {tarefa.audio?.url && (
              <div className="mt-4 rounded-md border border-border bg-[var(--surface-1)] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Mic className="h-3.5 w-3.5" />
                  Áudio da demanda
                </div>
                <audio controls src={tarefa.audio.url} className="w-full" />
              </div>
            )}

            {/* Vídeo (trazido de uma demanda externa aceita) */}
            {tarefa.video?.url && (
              <div className="mt-4 rounded-md border border-border bg-[var(--surface-1)] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Video className="h-3.5 w-3.5" />
                  Vídeo da demanda
                </div>
                <video controls src={tarefa.video.url} className="max-h-80 w-full rounded" />
              </div>
            )}

            {/* Anexos (enviados na criação da tarefa ou trazidos de uma demanda aceita) */}
            {(tarefa.anexos ?? []).length > 0 && (
              <div className="mt-4 rounded-md border border-border bg-[var(--surface-1)] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Paperclip className="h-3.5 w-3.5" />
                  Anexos
                </div>
                <ul className="flex flex-col gap-1">
                  {(tarefa.anexos ?? []).map((a) =>
                    a.url ? (
                      <li key={a.path}>
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-sm text-primary underline-offset-2 hover:underline"
                        >
                          {a.nome_arquivo}
                        </a>
                      </li>
                    ) : (
                      <li key={a.path} className="truncate text-sm text-muted-foreground">
                        {a.nome_arquivo}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}

            {/* Checklist */}
            <div className="mt-6">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ListChecks className="h-3.5 w-3.5" />
                Checklist
                {totalItens > 0 && (
                  <span className="normal-case tracking-normal text-muted-foreground/80">
                    ({concluidosItens}/{totalItens})
                  </span>
                )}
              </h3>

              {totalItens > 0 && (
                <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${progresso}%` }}
                  />
                </div>
              )}

              <div className="flex flex-col gap-0.5">
                {checklist.map((item) => (
                  <div
                    key={item.id}
                    className="group flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted/40"
                  >
                    <button
                      onClick={() =>
                        editar({
                          checklist: checklist.map((i) =>
                            i.id === item.id ? { ...i, concluido: !i.concluido } : i,
                          ),
                        })
                      }
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                        item.concluido
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {item.concluido && <Check className="h-3 w-3" />}
                    </button>
                    <span
                      className={cn(
                        "flex-1 text-sm",
                        item.concluido && "text-muted-foreground line-through",
                      )}
                    >
                      {item.texto}
                    </span>
                    <button
                      onClick={() =>
                        editar({ checklist: checklist.filter((i) => i.id !== item.id) })
                      }
                      className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover:opacity-100"
                      title="Remover item"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <input
                  value={novoItem}
                  onChange={(e) => setNovoItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      adicionarItem();
                    }
                  }}
                  placeholder="Adicionar item ao checklist..."
                  className="h-9 flex-1 rounded-md border border-border bg-[var(--surface-1)] px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                />
                <Button
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={adicionarItem}
                  disabled={!novoItem.trim()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Comentários */}
            <div className="mt-6">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Comentários
              </h3>
              <div className="flex flex-col gap-3">
                {(tarefa.comentarios ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum comentário ainda.</p>
                )}
                {(tarefa.comentarios ?? []).map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ backgroundColor: c.autor.cor ?? "#7B68EE" }}
                    >
                      {c.autor.iniciais}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{c.autor.nome}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {relativo(c.criado_em)}
                        </span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground/90">
                        {c.conteudo}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-md border border-border bg-background p-2 focus-within:ring-1 focus-within:ring-ring">
                <Textarea
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      enviarComentario();
                    }
                  }}
                  placeholder="Escreva um comentário..."
                  className="min-h-[60px] resize-none border-0 p-1 text-sm shadow-none focus-visible:ring-0"
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={enviarComentario} disabled={!comentario.trim()}>
                    <Send className="h-3.5 w-3.5" />
                    Enviar
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar metadados */}
          <aside className="flex flex-col gap-5 overflow-y-auto border-l border-border bg-[var(--surface-1)] px-4 py-5">
            <MetaRow label="Responsáveis">
              <ResponsavelPicker
                atuais={r.responsaveis}
                onChange={(arr) => editar({ responsaveis: arr })}
              />
            </MetaRow>

            <MetaRow label="Data de vencimento">
              <DatePickerField
                value={r.data_vencimento}
                onChange={(iso) => editar({ data_vencimento: iso })}
              />
            </MetaRow>

            <MetaRow label="Prioridade">
              <PrioridadeDropdown
                value={r.prioridade}
                onChange={(p) => editar({ prioridade: p })}
              />
            </MetaRow>

            <MetaRow label="Complexidade">
              <ComplexidadeDropdown
                value={r.complexidade}
                onChange={(c) => editar({ complexidade: c })}
              />
            </MetaRow>

            {cliente && (
              <MetaRow label="Cliente">
                <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cliente.cor }} />
                  {cliente.nome_empresa}
                </div>
              </MetaRow>
            )}

            <MetaRow label="Projeto">
              <ProjetoDropdown
                value={r.projeto_id}
                projetos={projetos}
                onChange={(id) => editar({ projeto_id: id })}
              />
            </MetaRow>
          </aside>
        </div>

        {/* Rodapé: nada do que foi editado acima vai pro servidor sem Salvar */}
        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          {temAlteracao && (
            <span className="text-xs text-muted-foreground">Alterações não salvas</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={!temAlteracao || salvando}
            onClick={() => setRascunho(rascunhoDe(tarefa))}
          >
            Descartar
          </Button>
          <Button size="sm" disabled={!podeSalvar} onClick={salvar}>
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </div>

        {compartilhando && (
          <ShareDialog
            alvo={{ tipo: "tarefa", tarefaId: tarefa.id, titulo: tarefa.titulo }}
            open
            onOpenChange={(o) => !o && setCompartilhando(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function StatusDropdown({
  status,
  onChange,
  isAdmin,
}: {
  status: Status;
  onChange: (s: Status) => void;
  isAdmin: boolean;
}) {
  const opcoes = isAdmin ? STATUSES : STATUSES.filter((s) => s !== "Concluído");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white"
          style={{ backgroundColor: statusCor[status] }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
          {status}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {opcoes.map((s) => (
          <DropdownMenuItem key={s} onClick={() => onChange(s)} className="gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusCor[s] }} />
            <span className="flex-1">{s}</span>
            {s === status && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PrioridadeDropdown({
  value,
  onChange,
}: {
  value: Prioridade;
  onChange: (p: Prioridade) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide shadow-sm transition-opacity hover:opacity-90"
          style={prioridadePillStyle(value)}
        >
          <Flag className="h-3.5 w-3.5" style={{ fill: "currentColor" }} />
          {value}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44">
        {PRIORIDADES.map((p) => (
          <DropdownMenuItem key={p} onClick={() => onChange(p)} className="gap-2">
            <Flag
              className="h-3.5 w-3.5"
              style={{ color: prioridadeCor[p], fill: prioridadeCor[p] }}
            />
            <span className="flex-1">{p}</span>
            {p === value && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ComplexidadeDropdown({
  value,
  onChange,
}: {
  value: Complexidade;
  onChange: (c: Complexidade) => void;
}) {
  const Icon = complexidadeIcon[value];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide shadow-sm transition-opacity hover:opacity-90"
          style={complexidadePillStyle(value)}
        >
          <Icon className="h-3.5 w-3.5" />
          {value}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44">
        {COMPLEXIDADES.map((c) => {
          const ItemIcon = complexidadeIcon[c];
          return (
            <DropdownMenuItem key={c} onClick={() => onChange(c)} className="gap-2">
              <ItemIcon className="h-3.5 w-3.5" style={{ color: complexidadeCor[c] }} />
              <span className="flex-1">{c}</span>
              {c === value && <Check className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjetoDropdown({
  value,
  projetos,
  onChange,
}: {
  value: string | null;
  projetos: { id: string; nome: string }[];
  onChange: (id: string | null) => void;
}) {
  const atual = projetos.find((p) => p.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm hover:bg-muted">
          <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
          {atual ? atual.nome : <span className="text-muted-foreground">Sem projeto</span>}
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        {projetos.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Nenhum projeto cadastrado ainda.
          </div>
        )}
        {projetos.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => onChange(p.id)} className="gap-2">
            <span className="flex-1">{p.nome}</span>
            {p.id === value && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
        {value && (
          <DropdownMenuItem onClick={() => onChange(null)} className="text-muted-foreground">
            Sem projeto
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ResponsavelPicker({
  atuais,
  onChange,
}: {
  atuais: { id: string; nome: string; iniciais: string }[];
  onChange: (arr: { id: string; nome: string; iniciais: string }[]) => void;
}) {
  const { membros } = useTasks();
  // Um inativo que já é responsável continua listado (para dar para tirar);
  // os outros inativos saem das opções.
  const opcoes = useMemo(
    () => membros.filter((m) => m.status !== "inativo" || atuais.some((r) => r.id === m.id)),
    [membros, atuais],
  );
  const toggle = (m: { id: string; nome: string; iniciais: string }) => {
    const exists = atuais.some((r) => r.id === m.id);
    onChange(
      exists
        ? atuais.filter((r) => r.id !== m.id)
        : [...atuais, { id: m.id, nome: m.nome, iniciais: m.iniciais }],
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-sm hover:bg-muted">
          {atuais.length === 0 ? (
            <span className="text-muted-foreground">Adicionar responsáveis</span>
          ) : (
            <>
              <div className="flex -space-x-1.5">
                {atuais.slice(0, 3).map((r) => {
                  const c = membros.find((m) => m.id === r.id)?.cor ?? "#7B68EE";
                  return (
                    <span
                      key={r.id}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-background"
                      style={{ backgroundColor: c }}
                    >
                      {r.iniciais}
                    </span>
                  );
                })}
              </div>
              <span>{atuais.length === 1 ? atuais[0].nome : `${atuais.length} responsáveis`}</span>
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        {opcoes.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={(e) => {
              e.preventDefault();
              toggle({ id: m.id, nome: m.nome, iniciais: m.iniciais });
            }}
            className="gap-2"
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
              style={{ backgroundColor: m.cor }}
            >
              {m.iniciais}
            </span>
            <span className="flex-1">{m.nome}</span>
            {m.status === "inativo" && (
              <span className="text-[10px] font-medium text-muted-foreground">Inativo</span>
            )}
            {atuais.some((r) => r.id === m.id) && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DatePickerField({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const parsed = value ? new Date(value.length === 10 ? value + "T00:00:00" : value) : null;
  const date = parsed && !isNaN(parsed.getTime()) ? parsed : null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm hover:bg-muted",
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          {date ? (
            format(date, "dd 'de' MMM, yyyy", { locale: ptBR })
          ) : (
            <span className="text-muted-foreground">Sem data</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date ?? undefined}
          onSelect={(d) => d && onChange(d.toISOString().slice(0, 10))}
          initialFocus
          locale={ptBR}
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}
