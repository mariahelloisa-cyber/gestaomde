import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Flag } from "lucide-react";
import { prioridadeCor } from "@/lib/mock-data";
import { useTasks, USUARIO_LOGADO_INICIAIS } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import { AddTaskDialog } from "./KanbanView";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function isoOf(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

export type CalendarScope = "geral" | "pessoal" | "cliente" | "sem-cliente";

export function CalendarView({
  clienteFilterId,
  scope = clienteFilterId ? "cliente" : "pessoal",
}: { clienteFilterId?: string; scope?: CalendarScope } = {}) {
  const { tarefas: todas, clientes, openTask, myIniciais, myId, meuStatusFilter, geralStatusFilter, geralEmpresaFilter } = useTasks();
  const tarefas = useMemo(() => {
    return todas.filter((t) => {
      const isLembrete = t.tipo === "lembrete";
      if (scope === "cliente") {
        return !isLembrete && t.cliente_id === clienteFilterId;
      }
      if (scope === "sem-cliente") {
        if (isLembrete) return false;
        if (geralStatusFilter && t.status !== geralStatusFilter) return false;
        if (geralEmpresaFilter !== "todas") return t.cliente_id === geralEmpresaFilter;
        return true;
      }
      if (scope === "geral") {
        // Tarefas + lembretes gerais (sem pessoais de ninguém)
        return !isLembrete || (t.escopo ?? "geral") === "geral";
      }
      // pessoal: minhas tarefas + lembretes gerais + lembretes pessoais do próprio usuário
      if (!isLembrete) {
        if (!t.responsaveis.some((r) => r.id === myId)) return false;
        if (meuStatusFilter && t.status !== meuStatusFilter) return false;
        return true;
      }
      const esc = t.escopo ?? "geral";
      return esc === "geral" || t.criado_por === (myIniciais || USUARIO_LOGADO_INICIAIS);
    });
  }, [todas, scope, clienteFilterId, myIniciais, myId, meuStatusFilter, geralStatusFilter, geralEmpresaFilter]);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [quickDate, setQuickDate] = useState<string | null>(null);

  const cells = useMemo(() => {
    const first = new Date(cursor);
    first.setDate(1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay()); // start on Sunday
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const todayIso = isoOf(new Date());
  const monthLabel = cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const tasksByDay = useMemo(() => {
    const map = new Map<string, typeof tarefas>();
    for (const t of tarefas) {
      const arr = map.get(t.data_vencimento) ?? [];
      arr.push(t);
      map.set(t.data_vencimento, arr);
    }
    return map;
  }, [tarefas]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-background px-5 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            className="rounded p-1 hover:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="min-w-[160px] text-center text-sm font-semibold capitalize">{monthLabel}</h2>
          <button
            onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            className="rounded p-1 hover:bg-muted"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={() => {
            const t = new Date();
            setCursor(new Date(t.getFullYear(), t.getMonth(), 1));
          }}
          className="rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-muted"
        >
          Hoje
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-border bg-[var(--surface-2)] text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-2">{w}</div>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-7 grid-rows-6 overflow-hidden">
        {cells.map((d, i) => {
          const iso = isoOf(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = iso === todayIso;
          const tasks = tasksByDay.get(iso) ?? [];
          return (
            <button
              key={i}
              onClick={() => setQuickDate(iso)}
              className={cn(
                "group flex flex-col gap-1 border-b border-r border-border p-1.5 text-left transition-colors hover:bg-muted/40",
                !inMonth && "bg-[var(--surface-1)] text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium",
                  isToday && "bg-primary text-primary-foreground",
                )}
              >
                {d.getDate()}
              </span>
              <div className="flex flex-col gap-0.5">
                {tasks.slice(0, 3).map((t) => {
                  const cliente = clientes.find((c) => c.id === t.cliente_id);
                  const isLembrete = t.tipo === "lembrete";
                  const cor = isLembrete ? "#8B5CF6" : (cliente?.cor ?? "#7B68EE");
                  return (
                    <div
                      key={t.id}
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openTask(t.id);
                      }}
                      className={cn(
                        "flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px]",
                        isLembrete && "border border-dashed",
                      )}
                      style={{
                        backgroundColor: `${cor}1A`,
                        color: cor,
                        borderColor: isLembrete ? `${cor}66` : undefined,
                      }}
                      title={t.titulo}
                    >
                      {isLembrete ? (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
                      ) : (
                        <Flag
                          className="h-2.5 w-2.5 shrink-0"
                          style={{ color: prioridadeCor[t.prioridade], fill: prioridadeCor[t.prioridade] }}
                        />
                      )}
                      <span className="truncate font-medium">{t.titulo}</span>
                    </div>
                  );
                })}
                {tasks.length > 3 && (
                  <span className="px-1 text-[10px] text-muted-foreground">+{tasks.length - 3} mais</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {quickDate && (
        <AddTaskDialog
          key={quickDate}
          defaultDate={quickDate}
          lockedClienteId={clienteFilterId ?? (scope === "sem-cliente" && geralEmpresaFilter !== "todas" ? geralEmpresaFilter : undefined)}
          semCliente={scope === "sem-cliente" && geralEmpresaFilter === "todas"}
          defaultReminderScope={scope === "pessoal" ? "pessoal" : "geral"}
          allowLembrete={scope !== "cliente" && scope !== "sem-cliente"}
          trigger={null}
          open
          onOpenChange={(o) => !o && setQuickDate(null)}
        />
      )}
    </div>
  );
}