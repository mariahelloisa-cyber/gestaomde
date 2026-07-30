import { useMemo, useState } from "react";
import { Calendar as CalendarIcon, Check, ChevronDown, Clock, Eye, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  statusCor,
  statusPillStyle,
  prioridadeOrdem,
  prioridadePillStyle,
  complexidadePillStyle,
  rotuloData,
  type Prioridade,
  type Status,
} from "@/lib/mock-data";
import { TaskCard, isAtrasada, type TaskCardResponsavel, type TaskCardCliente } from "./task-card";
import type { PainelPublicoData, PainelPublicoTarefa } from "@/lib/painel-publico.functions";

const colunas: { status: Status; label: string; icon: typeof Clock }[] = [
  { status: "Pendente", label: "Pendentes", icon: Clock },
  { status: "Em Progresso", label: "Em Andamento", icon: Clock },
  { status: "Em Análise", label: "Em Análise", icon: Eye },
  { status: "Concluído", label: "Concluídas", icon: Check },
];

const PRIORIDADES: (Prioridade | "todas")[] = ["todas", "Alta", "Média", "Baixa", "Nenhuma"];

export function PainelPublicoTarefasView({ data }: { data: PainelPublicoData }) {
  const { tarefas, clientes, membros } = data;
  const [busca, setBusca] = useState("");
  const [clienteFiltro, setClienteFiltro] = useState<string | "todas">("todas");
  const [membroFiltro, setMembroFiltro] = useState<string | "todos">("todos");
  const [prioridadeFiltro, setPrioridadeFiltro] = useState<Prioridade | "todas">("todas");
  const [tarefaAberta, setTarefaAberta] = useState<PainelPublicoTarefa | null>(null);

  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const membroPorId = useMemo(() => new Map(membros.map((m) => [m.id, m])), [membros]);

  const clienteDaTarefa = (t: PainelPublicoTarefa): TaskCardCliente | null =>
    t.cliente_id ? (clientePorId.get(t.cliente_id) ?? null) : null;

  const responsaveisDaTarefa = (t: PainelPublicoTarefa): TaskCardResponsavel[] =>
    t.responsaveis.map((r) => ({
      id: r.id,
      nome: r.nome,
      iniciais: r.iniciais,
      cor: membroPorId.get(r.id)?.cor ?? "#7B68EE",
    }));

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return tarefas.filter((t) => {
      if (termo && !t.titulo.toLowerCase().includes(termo)) return false;
      if (clienteFiltro !== "todas" && t.cliente_id !== clienteFiltro) return false;
      if (membroFiltro !== "todos" && !t.responsaveis.some((r) => r.id === membroFiltro))
        return false;
      if (prioridadeFiltro !== "todas" && t.prioridade !== prioridadeFiltro) return false;
      return true;
    });
  }, [tarefas, busca, clienteFiltro, membroFiltro, prioridadeFiltro]);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1440px] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar tarefa..."
            className="h-9 w-full rounded-lg border border-border bg-[var(--surface-2)] pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
        </div>

        <FiltroPill label={prioridadeFiltro === "todas" ? "Todas Prioridades" : prioridadeFiltro}>
          {PRIORIDADES.map((p) => (
            <DropdownMenuItem key={p} onClick={() => setPrioridadeFiltro(p)} className="text-sm">
              {p === "todas" ? "Todas Prioridades" : p}
            </DropdownMenuItem>
          ))}
        </FiltroPill>

        <FiltroPill
          label={
            clienteFiltro === "todas"
              ? "Todas Empresas"
              : (clientePorId.get(clienteFiltro)?.nome_empresa ?? "Empresa")
          }
        >
          <DropdownMenuItem onClick={() => setClienteFiltro("todas")} className="text-sm">
            Todas Empresas
          </DropdownMenuItem>
          {clientes.map((c) => (
            <DropdownMenuItem key={c.id} onClick={() => setClienteFiltro(c.id)} className="text-sm">
              <span className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: c.cor }} />
              {c.nome_empresa}
            </DropdownMenuItem>
          ))}
        </FiltroPill>

        <FiltroPill
          label={
            membroFiltro === "todos"
              ? "Todos os Membros"
              : (membroPorId.get(membroFiltro)?.nome ?? "Membro")
          }
        >
          <DropdownMenuItem onClick={() => setMembroFiltro("todos")} className="text-sm">
            Todos os Membros
          </DropdownMenuItem>
          {membros.map((m) => (
            <DropdownMenuItem key={m.id} onClick={() => setMembroFiltro(m.id)} className="text-sm">
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

        <span className="ml-auto text-xs text-muted-foreground">{filtradas.length} tarefas</span>
      </div>

      <div className="flex flex-1 gap-4 overflow-x-auto p-5">
        {colunas.map((c) => {
          const lista = filtradas
            .filter((t) => t.status === c.status)
            .slice()
            .sort((a, b) => prioridadeOrdem[a.prioridade] - prioridadeOrdem[b.prioridade]);
          const cor = statusCor[c.status];
          const Icon = c.icon;
          return (
            <div
              key={c.status}
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
                <span className="text-xs font-medium text-muted-foreground">{lista.length}</span>
              </div>

              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                {lista.map((t) => (
                  <TaskCard
                    key={t.id}
                    tarefa={t}
                    cliente={clienteDaTarefa(t)}
                    responsaveis={responsaveisDaTarefa(t)}
                    onClick={() => setTarefaAberta(t)}
                  />
                ))}
                {lista.length === 0 && (
                  <div className="flex shrink-0 flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 py-8 text-xs text-muted-foreground">
                    <Icon className="h-5 w-5 opacity-40" />
                    Nenhuma tarefa
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {tarefaAberta && (
        <TarefaDetalheDialog
          tarefa={tarefaAberta}
          cliente={clienteDaTarefa(tarefaAberta)}
          responsaveis={responsaveisDaTarefa(tarefaAberta)}
          onClose={() => setTarefaAberta(null)}
        />
      )}
    </div>
  );
}

function TarefaDetalheDialog({
  tarefa,
  cliente,
  responsaveis,
  onClose,
}: {
  tarefa: PainelPublicoTarefa;
  cliente: TaskCardCliente | null;
  responsaveis: TaskCardResponsavel[];
  onClose: () => void;
}) {
  const atrasada = isAtrasada(tarefa);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogTitle className="pr-6">{tarefa.titulo}</DialogTitle>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
            style={statusPillStyle(tarefa.status)}
          >
            {tarefa.status}
          </span>
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
            style={prioridadePillStyle(tarefa.prioridade)}
          >
            {tarefa.prioridade}
          </span>
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
            style={complexidadePillStyle(tarefa.complexidade)}
          >
            {tarefa.complexidade}
          </span>
          {atrasada && (
            <span className="inline-flex items-center rounded-full bg-destructive/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">
              Atrasada
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {cliente && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cliente.cor }} />
              {cliente.nome_empresa}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <CalendarIcon className="h-3.5 w-3.5" />
            {rotuloData(tarefa.data_vencimento)}
          </span>
        </div>

        {tarefa.descricao && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {tarefa.descricao}
          </p>
        )}

        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Responsáveis
          </div>
          {responsaveis.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum responsável atribuído.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {responsaveis.map((r) => (
                <span
                  key={r.id}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1 text-xs"
                >
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                    style={{ backgroundColor: r.cor }}
                  >
                    {r.iniciais}
                  </span>
                  {r.nome}
                </span>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FiltroPill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-[var(--surface-2)] px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted">
        {label}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
