import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  ChevronDown,
  ClipboardList,
  LayoutGrid,
  Search,
} from "lucide-react";
import { useTasks } from "@/lib/tasks-store";
import { statusCor, type Prioridade, type Status } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type View = "Quadro" | "Calendário";

const tabs: { key: View; label: string; icon: typeof LayoutGrid }[] = [
  { key: "Quadro", label: "Kanban", icon: LayoutGrid },
  { key: "Calendário", label: "Agenda", icon: CalendarIcon },
];

const statusOrdem: Status[] = ["Pendente", "Em Progresso", "Em Análise", "Concluído"];

export function TarefasHeader({
  view,
  onViewChange,
  extraActions,
  mode = "minhas",
}: {
  view: View;
  onViewChange: (v: View) => void;
  extraActions?: React.ReactNode;
  mode?: "minhas" | "geral";
}) {
  const {
    tarefas,
    clientes,
    membros,
    myId,
    myNome,
    myEmail,
    myAvatar,
    myIniciais,
    contarMinhasPorStatus,
    contarGeraisPorStatus,
    meuStatusFilter,
    setMeuStatusFilter,
    geralStatusFilter,
    setGeralStatusFilter,
    geralEmpresaFilter,
    setGeralEmpresaFilter,
    geralMembroFilter,
    setGeralMembroFilter,
  } = useTasks();

  const [busca, setBusca] = useState("");
  const [prioridade, setPrioridade] = useState<Prioridade | "todas">("todas");
  const [empresa, setEmpresa] = useState<string | "todas">("todas");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");

  const statusFilter = mode === "geral" ? geralStatusFilter : meuStatusFilter;
  const setStatusFilter = mode === "geral" ? setGeralStatusFilter : setMeuStatusFilter;
  const contarPorStatus = mode === "geral" ? contarGeraisPorStatus : contarMinhasPorStatus;

  const totalMinhas = useMemo(
    () =>
      tarefas.filter(
        (t) => (t.tipo ?? "tarefa") === "tarefa" && t.responsaveis.some((r) => r.id === myId),
      ).length,
    [tarefas, myId],
  );

  const adminIds = useMemo(
    () => new Set(membros.filter((m) => m.cargo === "Admin").map((m) => m.id)),
    [membros],
  );

  const totalGerais = useMemo(
    () =>
      tarefas.filter(
        (t) =>
          (t.tipo ?? "tarefa") === "tarefa" &&
          !t.responsaveis.some((r) => adminIds.has(r.id)) &&
          (geralEmpresaFilter === "todas" || t.cliente_id === geralEmpresaFilter) &&
          (geralMembroFilter === "todos" || t.responsaveis.some((r) => r.id === geralMembroFilter)),
      ).length,
    [tarefas, adminIds, geralEmpresaFilter, geralMembroFilter],
  );

  const empresasComMinhas = useMemo(() => {
    const ids = new Set(
      tarefas
        .filter(
          (t) => (t.tipo ?? "tarefa") === "tarefa" && t.responsaveis.some((r) => r.id === myId),
        )
        .map((t) => t.cliente_id)
        .filter(Boolean) as string[],
    );
    return clientes.filter((c) => ids.has(c.id));
  }, [tarefas, clientes, myId]);

  const empresasAtivas = useMemo(
    () => clientes.filter((c) => (c.status ?? "ativo") === "ativo"),
    [clientes],
  );

  return (
    <header className="border-b border-border bg-background">
      {/* Perfil + badges */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Voltar"
            onClick={() => history.back()}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="relative shrink-0">
            {mode === "geral" ? (
              <div className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground ring-2 ring-primary/40">
                <ClipboardList className="h-5 w-5" />
              </div>
            ) : myAvatar ? (
              <img
                src={myAvatar}
                alt={myNome}
                className="h-11 w-11 rounded-full object-cover ring-2 ring-primary/40"
              />
            ) : (
              <div className="grid h-11 w-11 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground ring-2 ring-primary/40">
                {myIniciais}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold leading-tight text-foreground">
              {mode === "geral" ? "Tarefas Gerais" : myNome || "Minhas tarefas"}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {mode === "geral" ? "Tarefas de toda a agência" : myEmail}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {statusOrdem.map((s) => {
            const count = contarPorStatus(s);
            const cor = statusCor[s];
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(active ? null : s)}
                title={s}
                className={cn(
                  "inline-flex h-8 min-w-[56px] items-center justify-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-all",
                  active && "shadow-sm",
                )}
                style={{
                  color: cor,
                  backgroundColor: active
                    ? `color-mix(in oklab, ${cor} 22%, transparent)`
                    : `color-mix(in oklab, ${cor} 10%, transparent)`,
                  borderColor: `color-mix(in oklab, ${cor} 40%, transparent)`,
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cor }} />
                {count}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar tarefa..."
            className="h-9 w-full rounded-lg border border-border bg-[var(--surface-2)] pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
        </div>

        <FiltroPill label={prioridade === "todas" ? "Todas Prioridades" : prioridade}>
          {(["todas", "Alta", "Média", "Baixa", "Nenhuma"] as const).map((p) => (
            <DropdownMenuItem key={p} onClick={() => setPrioridade(p)} className="text-sm">
              {p === "todas" ? "Todas Prioridades" : p}
            </DropdownMenuItem>
          ))}
        </FiltroPill>

        <FiltroPill
          label={statusFilter ?? "Todos Status"}
          swatch={statusFilter ? statusCor[statusFilter] : undefined}
        >
          <DropdownMenuItem onClick={() => setStatusFilter(null)} className="text-sm">
            Todos Status
          </DropdownMenuItem>
          {statusOrdem.map((s) => (
            <DropdownMenuItem key={s} onClick={() => setStatusFilter(s)} className="text-sm">
              <span
                className="mr-2 h-2 w-2 rounded-full"
                style={{ backgroundColor: statusCor[s] }}
              />
              {s}
            </DropdownMenuItem>
          ))}
        </FiltroPill>

        <FiltroPill
          label={
            mode === "geral"
              ? geralEmpresaFilter === "todas"
                ? "Todas Empresas"
                : (clientes.find((c) => c.id === geralEmpresaFilter)?.nome_empresa ?? "Empresa")
              : empresa === "todas"
                ? "Todas Empresas"
                : (clientes.find((c) => c.id === empresa)?.nome_empresa ?? "Empresa")
          }
        >
          <DropdownMenuItem
            onClick={() =>
              mode === "geral" ? setGeralEmpresaFilter("todas") : setEmpresa("todas")
            }
            className="text-sm"
          >
            Todas Empresas
          </DropdownMenuItem>
          {(mode === "geral" ? empresasAtivas : empresasComMinhas).map((c) => (
            <DropdownMenuItem
              key={c.id}
              onClick={() => (mode === "geral" ? setGeralEmpresaFilter(c.id) : setEmpresa(c.id))}
              className="text-sm"
            >
              <span className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: c.cor }} />
              {c.nome_empresa}
            </DropdownMenuItem>
          ))}
        </FiltroPill>

        {mode === "geral" && (
          <FiltroPill
            label={
              geralMembroFilter === "todos"
                ? "Todos os Membros"
                : (membros.find((m) => m.id === geralMembroFilter)?.nome ?? "Membro")
            }
          >
            <DropdownMenuItem onClick={() => setGeralMembroFilter("todos")} className="text-sm">
              Todos os Membros
            </DropdownMenuItem>
            {membros.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onClick={() => setGeralMembroFilter(m.id)}
                className="text-sm"
              >
                <span
                  className="mr-2 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                  style={{ backgroundColor: m.cor }}
                >
                  {m.iniciais}
                </span>
                {m.nome}
              </DropdownMenuItem>
            ))}
          </FiltroPill>
        )}

        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-[var(--surface-2)] px-2 py-1.5 text-xs">
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Filtrar por data:</span>
          <input
            type="date"
            value={dataDe}
            onChange={(e) => setDataDe(e.target.value)}
            className="w-[112px] bg-transparent text-xs outline-none"
          />
          <span className="text-muted-foreground">até</span>
          <input
            type="date"
            value={dataAte}
            onChange={(e) => setDataAte(e.target.value)}
            className="w-[112px] bg-transparent text-xs outline-none"
          />
        </div>

        <div className="ml-auto text-xs text-muted-foreground">
          {mode === "geral" ? totalGerais : totalMinhas} tarefas
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 border-t border-border px-4 py-2">
        {tabs.map((t) => {
          const active = view === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onViewChange(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
        {extraActions && <div className="ml-auto">{extraActions}</div>}
      </div>
    </header>
  );
}

function FiltroPill({
  label,
  swatch,
  children,
}: {
  label: string;
  swatch?: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-[var(--surface-2)] px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted">
        {swatch && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: swatch }} />}
        {label}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
