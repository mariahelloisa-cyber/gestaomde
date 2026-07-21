import { Search, List, LayoutGrid, Calendar, Flag, ChevronDown, CalendarDays, CalendarPlus, User, Circle, Filter, Tag, Archive, MessageSquare, UserPlus, Plus } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { prioridadeCor, statusCor } from "@/lib/mock-data";

type View = "Lista" | "Quadro" | "Calendário";

const tabs: { key: View; icon: typeof List }[] = [
  { key: "Lista", icon: List },
  { key: "Quadro", icon: LayoutGrid },
  { key: "Calendário", icon: Calendar },
];

export function DashboardHeader({ view, onViewChange, extraActions }: { view: View; onViewChange: (v: View) => void; extraActions?: React.ReactNode }) {
  const [query, setQuery] = useState("");

  return (
    <header className="border-b border-border bg-background">
      {/* Global search */}
      <div className="flex items-center justify-center px-6 py-4">
        <div className="relative w-full max-w-2xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar clientes ou tarefas..."
            className="h-10 w-full rounded-lg border border-border bg-[var(--surface-2)] pl-9 pr-3 text-sm outline-none transition-all placeholder:text-muted-foreground focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20"
          />
        </div>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 border-t border-border px-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onViewChange(t.key)}
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-2.5 text-sm transition-colors",
              view === t.key ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.key}
            {view === t.key && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
        <FiltroMenu />
        {extraActions}
      </div>
    </header>
  );
}

type FiltroDef = {
  key: string;
  label: string;
  icon: typeof Circle;
  render: () => React.ReactNode;
};

function FiltroMenu() {
  const [search, setSearch] = useState("");

  const filtros: FiltroDef[] = [
    {
      key: "encerramento",
      label: "Data de Encerramento",
      icon: CalendarDays,
      render: () =>
        ["Hoje", "Esta semana", "Este mês", "Sem data"].map((o) => (
          <DropdownMenuItem key={o} className="text-sm">{o}</DropdownMenuItem>
        )),
    },
    {
      key: "criacao",
      label: "Data de Criação",
      icon: CalendarPlus,
      render: () =>
        ["Últimos 7 dias", "Últimos 30 dias", "Personalizado"].map((o) => (
          <DropdownMenuItem key={o} className="text-sm">{o}</DropdownMenuItem>
        )),
    },
    {
      key: "responsavel",
      label: "Responsável",
      icon: User,
      render: () =>
        ["Helloisa", "Não atribuído"].map((o) => (
          <DropdownMenuItem key={o} className="text-sm">{o}</DropdownMenuItem>
        )),
    },
    {
      key: "prioridade",
      label: "Prioridade",
      icon: Flag,
      render: () =>
        (Object.keys(prioridadeCor) as Array<keyof typeof prioridadeCor>).map((p) => (
          <DropdownMenuItem key={p} className="text-sm">
            <Flag className="mr-2 h-3.5 w-3.5" style={{ color: prioridadeCor[p], fill: prioridadeCor[p] }} />
            {p}
          </DropdownMenuItem>
        )),
    },
    {
      key: "status",
      label: "Status",
      icon: Circle,
      render: () =>
        (Object.keys(statusCor) as Array<keyof typeof statusCor>).map((s) => (
          <DropdownMenuItem key={s} className="text-sm">
            <span className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: statusCor[s] }} />
            {s}
          </DropdownMenuItem>
        )),
    },
  ];

  const filtrados = filtros.filter((f) =>
    f.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        Filtro
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-2">
        <DropdownMenuLabel className="px-1 pb-2 text-xs text-muted-foreground">Selecionar filtro</DropdownMenuLabel>
        <div className="relative mb-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar..."
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <DropdownMenuSeparator />
        <div className="max-h-72 overflow-y-auto">
          {filtrados.map((f) => (
            <DropdownMenuSub key={f.key}>
              <DropdownMenuSubTrigger className="text-sm">
                <f.icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                {f.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="w-52">
                  <DropdownMenuLabel className="text-xs">{f.label}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {f.render()}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          ))}
          {filtrados.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhum filtro encontrado</div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}