import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Clock,
  Eye,
  FileText,
  Flag,
  FolderKanban,
  Lock,
  Paperclip,
  Plus,
  User,
  X,
} from "lucide-react";
import {
  prioridadeCor,
  prioridadeOrdem,
  complexidadeCor,
  complexidadePillStyle,
  statusCor,
  statusPillStyle,
  prioridadePillStyle,
  isFinalizada,
  type Complexidade,
  type Prioridade,
  type Status,
  type Tarefa,
  type TipoItem,
  type EscopoItem,
} from "@/lib/mock-data";
import { useTasks, USUARIO_LOGADO_INICIAIS } from "@/lib/tasks-store";
import { TaskCard, complexidadeIcon } from "./task-card";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

const colunas: { status: Status; label: string; icon: typeof Clock }[] = [
  { status: "Pendente", label: "Pendentes", icon: Clock },
  { status: "Em Progresso", label: "Em Andamento", icon: Clock },
  { status: "Em Análise", label: "Em Análise", icon: Eye },
  { status: "Concluído", label: "Concluídas", icon: Check },
];

export function KanbanView({
  clienteFilterId,
  semCliente,
}: { clienteFilterId?: string; semCliente?: boolean } = {}) {
  const {
    tarefas,
    membros,
    updateTarefa,
    openTask,
    myId,
    myCargo,
    meuStatusFilter,
    geralStatusFilter,
    geralEmpresaFilter,
    geralMembroFilter,
  } = useTasks();
  const apenasMinhas = !semCliente && !clienteFilterId;
  const isAdmin = myCargo === "Admin";
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Tarefas de Admins ficam de fora da aba "Tarefas" geral (compartilhada entre
  // todo mundo) — só aparecem em "Minhas Tarefas" do próprio Admin responsável.
  const adminIds = useMemo(
    () => new Set(membros.filter((m) => m.cargo === "Admin").map((m) => m.id)),
    [membros],
  );
  // No escopo "geral" (semCliente) os filtros de empresa e membro vêm do
  const empresaEfetiva =
    semCliente && geralEmpresaFilter !== "todas" ? geralEmpresaFilter : undefined;

  const onDrop = (status: Status) => {
    if (!draggingId) return;
    if (status === "Concluído" && !isAdmin) {
      toast.error("Apenas Admins podem marcar tarefas como concluídas.");
      setDraggingId(null);
      return;
    }
    updateTarefa(draggingId, { status });
    setDraggingId(null);
  };

  return (
    <div className="flex h-full gap-4 overflow-x-auto p-5">
      {colunas.map((c) => {
        const list = tarefas.filter((t) => {
          if ((t.tipo ?? "tarefa") !== "tarefa" || t.status !== c.status) return false;
          if (isFinalizada(t)) return false;
          if (semCliente) {
            if (t.responsaveis.some((r) => adminIds.has(r.id))) return false;
            if (geralStatusFilter && t.status !== geralStatusFilter) return false;
            if (empresaEfetiva && t.cliente_id !== empresaEfetiva) return false;
            if (
              geralMembroFilter !== "todos" &&
              !t.responsaveis.some((r) => r.id === geralMembroFilter)
            )
              return false;
            return true;
          }
          if (clienteFilterId) return t.cliente_id === clienteFilterId;
          if (apenasMinhas) {
            if (!t.responsaveis.some((r) => r.id === myId)) return false;
            if (meuStatusFilter && t.status !== meuStatusFilter) return false;
          }
          return true;
        });
        list.sort((a, b) => prioridadeOrdem[a.prioridade] - prioridadeOrdem[b.prioridade]);
        const cor = statusCor[c.status];
        const Icon = c.icon;
        return (
          <div
            key={c.status}
            onDragOver={(e) => {
              if (c.status !== "Concluído" || isAdmin) e.preventDefault();
            }}
            onDrop={() => onDrop(c.status)}
            className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-[var(--surface-2)]"
          >
            <div
              className="flex items-center justify-between px-3.5 py-2.5"
              style={{
                backgroundColor: `color-mix(in oklab, ${cor} 14%, transparent)`,
                borderBottom: `1px solid color-mix(in oklab, ${cor} 30%, transparent)`,
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full"
                  style={{ backgroundColor: cor, color: "#fff" }}
                >
                  <Icon className="h-3 w-3" strokeWidth={2.5} />
                </span>
                <span className="text-sm font-semibold" style={{ color: cor }}>
                  {c.label}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">{list.length}</span>
                {(c.status !== "Concluído" || isAdmin) && (
                  <AddTaskDialog
                    defaultStatus={c.status}
                    compact
                    lockedClienteId={clienteFilterId ?? empresaEfetiva}
                    semCliente={semCliente && !empresaEfetiva}
                  />
                )}
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
              {list.map((t) => (
                <CardTarefa
                  key={t.id}
                  tarefa={t}
                  onDragStart={() => setDraggingId(t.id)}
                  onDragEnd={() => setDraggingId(null)}
                  onOpen={() => openTask(t.id)}
                />
              ))}
              {list.length === 0 && (
                <div className="flex shrink-0 flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 py-8 text-xs text-muted-foreground">
                  <Icon className="h-5 w-5 opacity-40" />
                  Arraste tarefas aqui
                </div>
              )}
              {(c.status !== "Concluído" || isAdmin) && (
                <AddTaskDialog
                  defaultStatus={c.status}
                  lockedClienteId={clienteFilterId ?? empresaEfetiva}
                  semCliente={semCliente && !empresaEfetiva}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CardTarefa({
  tarefa,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  tarefa: Tarefa;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const { clientes, membros } = useTasks();
  const cliente = clientes.find((c) => c.id === tarefa.cliente_id);
  const responsaveisComCor = tarefa.responsaveis.map((r) => ({
    ...r,
    cor: membros.find((m) => m.id === r.id)?.cor ?? "#7B68EE",
  }));

  return (
    <TaskCard
      tarefa={tarefa}
      cliente={cliente}
      responsaveis={responsaveisComCor}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    />
  );
}

export function AddTaskDialog({
  defaultStatus = "Pendente",
  defaultDate,
  lockedClienteId,
  defaultReminderScope = "geral",
  compact,
  trigger,
  open: controlledOpen,
  onOpenChange,
  allowLembrete = false,
  semCliente = false,
}: {
  defaultStatus?: Status;
  defaultDate?: string;
  lockedClienteId?: string;
  defaultReminderScope?: EscopoItem;
  compact?: boolean;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  allowLembrete?: boolean;
  semCliente?: boolean;
}) {
  const { addTarefa, clientes, projetos } = useTasks();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (o: boolean) => {
    onOpenChange?.(o);
    if (controlledOpen === undefined) setInternalOpen(o);
  };
  const [tipo, setTipo] = useState<TipoItem>("tarefa");
  const [escopo, setEscopo] = useState<EscopoItem>(defaultReminderScope);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [clienteId, setClienteId] = useState(
    semCliente ? "" : (lockedClienteId ?? clientes[0]?.id ?? ""),
  );
  // O diálogo monta assim que o Kanban aparece — antes de "clientes" terminar
  // de carregar do servidor. Sem isso, quem abrisse a tela recém-carregada
  // ficava com clienteId="" travado pra sempre (o useState acima só roda uma
  // vez) e o botão "Criar Tarefa" continuava desabilitado silenciosamente.
  useEffect(() => {
    if (semCliente) return;
    if (lockedClienteId) {
      setClienteId(lockedClienteId);
      return;
    }
    setClienteId((atual) =>
      atual && clientes.some((c) => c.id === atual) ? atual : (clientes[0]?.id ?? ""),
    );
  }, [clientes, lockedClienteId, semCliente]);
  const [projetoId, setProjetoId] = useState("");
  const [data, setData] = useState<string>(defaultDate ?? "");
  const [status, setStatus] = useState<Status>(defaultStatus);
  const [prioridade, setPrioridade] = useState<Prioridade>("Nenhuma");
  const [complexidade, setComplexidade] = useState<Complexidade>("Média");
  const [responsaveis, setResponsaveis] = useState<
    { id: string; nome: string; iniciais: string }[]
  >([]);
  const [anexos, setAnexos] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clienteAtual = clientes.find((c) => c.id === clienteId);
  const isLembrete = tipo === "lembrete";

  const submit = () => {
    if (!titulo.trim()) return;
    addTarefa({
      cliente_id: isLembrete || semCliente ? "" : clienteId,
      projeto_id: isLembrete ? null : projetoId || null,
      titulo: titulo.trim(),
      status: isLembrete ? "Pendente" : status,
      prioridade: isLembrete ? "Nenhuma" : prioridade,
      complexidade: isLembrete ? "Média" : complexidade,
      responsaveis: isLembrete ? [] : responsaveis,
      data_vencimento: data || "",
      descricao: descricao.trim() || undefined,
      tipo,
      escopo: isLembrete ? escopo : undefined,
      criado_por: USUARIO_LOGADO_INICIAIS,
    });
    setTitulo("");
    setDescricao("");
    setAnexos([]);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger !== null && (
        <SheetTrigger asChild>
          {trigger ??
            (compact ? (
              <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                <Plus className="h-4 w-4" />
              </button>
            ) : (
              <button className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                <Plus className="h-3.5 w-3.5" />
                Adicionar Tarefa
              </button>
            ))}
        </SheetTrigger>
      )}
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl [&>button]:hidden"
      >
        <SheetTitle className="sr-only">Nova tarefa</SheetTitle>

        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 pt-5">
          <div className="flex items-end gap-4">
            {(allowLembrete
              ? (["tarefa", "lembrete"] as TipoItem[])
              : (["tarefa"] as TipoItem[])
            ).map((t) => (
              <button key={t} onClick={() => setTipo(t)} className="relative pb-1">
                <span
                  className={cn(
                    "text-xs font-medium uppercase tracking-wide",
                    tipo === t ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {t === "tarefa" ? "Nova tarefa" : "Novo lembrete"}
                </span>
                {tipo === t && (
                  <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-foreground" />
                )}
              </button>
            ))}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Corpo rolável */}
        <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
          {/* Título */}
          <input
            autoFocus
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder={isLembrete ? "Título do lembrete" : "Título da tarefa"}
            className="w-full border-0 bg-transparent text-2xl font-bold leading-tight outline-none placeholder:text-foreground/40"
          />

          {/* Status badge */}
          {!isLembrete && (
            <div className="mt-3">
              <StatusPill status={status} onChange={setStatus} />
            </div>
          )}

          {/* Contexto: cliente / projeto / escopo */}
          {!isLembrete && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!semCliente && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      disabled={!!lockedClienteId}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-foreground/80 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
                      {clienteAtual?.nome_empresa ?? "Cliente"}
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {clientes.map((c) => (
                      <DropdownMenuItem
                        key={c.id}
                        onClick={() => setClienteId(c.id)}
                        className="gap-2"
                      >
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.cor }} />
                        <span className="flex-1">{c.nome_empresa}</span>
                        {c.id === clienteId && <Check className="h-3.5 w-3.5" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-foreground/80 hover:bg-muted">
                    <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
                    {projetos.find((p) => p.id === projetoId)?.nome ?? "Projeto"}
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {projetos.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum projeto cadastrado ainda.
                    </div>
                  )}
                  {projetos.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => setProjetoId(p.id)}
                      className="gap-2"
                    >
                      <span className="flex-1">{p.nome}</span>
                      {p.id === projetoId && <Check className="h-3.5 w-3.5" />}
                    </DropdownMenuItem>
                  ))}
                  {projetoId && (
                    <DropdownMenuItem
                      onClick={() => setProjetoId("")}
                      className="text-muted-foreground"
                    >
                      Nenhum projeto
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          {isLembrete && (
            <div className="mt-4">
              <EscopoPill value={escopo} onChange={setEscopo} />
            </div>
          )}

          {/* Cards de metadados — 2 colunas */}
          <div className="mt-6 grid grid-cols-2 gap-3">
            {!isLembrete && (
              <MetaCard label="Prioridade">
                <PrioridadePill value={prioridade} onChange={setPrioridade} />
              </MetaCard>
            )}
            {!isLembrete && (
              <MetaCard label="Complexidade">
                <ComplexidadePill value={complexidade} onChange={setComplexidade} />
              </MetaCard>
            )}
            <MetaCard label="Prazo">
              <DataPill value={data} onChange={setData} />
            </MetaCard>
            <MetaCard label="Criado por">
              <span className="text-sm text-foreground/90">{USUARIO_LOGADO_INICIAIS}</span>
            </MetaCard>
          </div>

          {/* Colaboradores */}
          {!isLembrete && (
            <div className="mt-4 rounded-lg border border-border bg-[var(--surface-1)] p-4">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                Colaboradores atribuídos ({responsaveis.length})
              </div>
              <ResponsavelPill value={responsaveis} onChange={setResponsaveis} />
            </div>
          )}

          {/* Descrição */}
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Descrição
            </div>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Adicionar descrição"
              rows={4}
              className="w-full resize-none rounded-lg border border-border bg-[var(--surface-1)] p-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* Anexos */}
          <div className="mt-4 rounded-lg border border-border bg-[var(--surface-1)] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5" />
                Anexos
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/25"
              >
                <Paperclip className="h-3.5 w-3.5" />
                Anexar
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files) setAnexos((prev) => [...prev, ...Array.from(files)]);
                  e.target.value = "";
                }}
              />
            </div>
            {anexos.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {anexos.map((a, i) => (
                  <li key={i} className="truncate">
                    • {a.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Rodapé fixo */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3">
          <button
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!titulo.trim()}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isLembrete ? "Criar Lembrete" : "Criar Tarefa"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MetaCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-[var(--surface-1)] p-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

/* ---------------- Pílulas ---------------- */

const STATUSES: Status[] = ["Pendente", "Em Progresso", "Em Análise", "Concluído"];
const PRIORIDADES: Prioridade[] = ["Alta", "Média", "Baixa", "Nenhuma"];
const COMPLEXIDADES: Complexidade[] = ["Fácil", "Média", "Difícil"];

function pillBase(active?: boolean) {
  return cn(
    "inline-flex h-7 items-center gap-1.5 rounded-full bg-muted/70 px-2.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-muted",
    active && "bg-muted",
  );
}

function StatusPill({ status, onChange }: { status: Status; onChange: (s: Status) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold uppercase tracking-wide shadow-sm transition-opacity hover:opacity-90"
          style={statusPillStyle(status)}
        >
          {status}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {STATUSES.map((s) => (
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

function ResponsavelPill({
  value,
  onChange,
}: {
  value: { id: string; nome: string; iniciais: string }[];
  onChange: (m: { id: string; nome: string; iniciais: string }[]) => void;
}) {
  const { membros } = useTasks();
  const toggle = (m: { id: string; nome: string; iniciais: string }) => {
    const exists = value.some((r) => r.id === m.id);
    onChange(exists ? value.filter((r) => r.id !== m.id) : [...value, m]);
  };
  const label =
    value.length === 0
      ? "Responsáveis"
      : value.length === 1
        ? value[0].nome
        : `${value.length} responsáveis`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={pillBase()}>
          {value.length === 0 ? (
            <User className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <div className="flex -space-x-1.5">
              {value.slice(0, 3).map((r) => {
                const c = membros.find((m) => m.id === r.id)?.cor ?? "#7B68EE";
                return (
                  <span
                    key={r.id}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white ring-1 ring-background"
                    style={{ backgroundColor: c }}
                  >
                    {r.iniciais}
                  </span>
                );
              })}
            </div>
          )}
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {membros.map((m) => (
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
            {value.some((r) => r.id === m.id) && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DataPill({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const parsed = value ? new Date(value.length === 10 ? value + "T00:00:00" : value) : null;
  const date = parsed && !isNaN(parsed.getTime()) ? parsed : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={pillBase()}>
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          Data de vencimento{date ? `: ${format(date, "dd 'de' MMM", { locale: ptBR })}` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => d && onChange(d.toISOString().slice(0, 10))}
          initialFocus
          locale={ptBR}
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}

function PrioridadePill({
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
          className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold uppercase tracking-wide shadow-sm transition-opacity hover:opacity-90"
          style={prioridadePillStyle(value)}
        >
          <Flag className="h-3 w-3" style={{ fill: "currentColor" }} />
          {value === "Nenhuma" ? "Prioridade" : value}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
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

function ComplexidadePill({
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
          className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold uppercase tracking-wide shadow-sm transition-opacity hover:opacity-90"
          style={complexidadePillStyle(value)}
        >
          <Icon className="h-3.5 w-3.5" />
          {value}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
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

function EscopoPill({ value, onChange }: { value: EscopoItem; onChange: (e: EscopoItem) => void }) {
  const opts: { id: EscopoItem; label: string; desc: string; Icon: typeof Eye }[] = [
    { id: "geral", label: "Geral", desc: "Visível para toda a equipe", Icon: Eye },
    { id: "pessoal", label: "Pessoal", desc: "Apenas você verá este lembrete", Icon: Lock },
  ];
  const current = opts.find((o) => o.id === value)!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={pillBase()}>
          <current.Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {current.label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {opts.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => onChange(o.id)} className="gap-2">
            <o.Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="flex flex-1 flex-col">
              <span className="text-sm">{o.label}</span>
              <span className="text-[11px] text-muted-foreground">{o.desc}</span>
            </div>
            {o.id === value && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
