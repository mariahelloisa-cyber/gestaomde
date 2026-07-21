import { Flag, Circle, CheckCircle2, Loader2, Eye, ClipboardList } from "lucide-react";
import { prioridadePillStyle, rotuloData, type Status } from "@/lib/mock-data";
import { useTasks } from "@/lib/tasks-store";

const statusIcon: Record<Status, typeof Circle> = {
  Pendente: Circle,
  "Em Progresso": Loader2,
  "Em Análise": Eye,
  "Concluído": CheckCircle2,
};

const statusIconColor: Record<Status, string> = {
  Pendente: "#F59E0B",
  "Em Progresso": "#3B82F6",
  "Em Análise": "#A855F7",
  "Concluído": "#22C55E",
};

export function TaskListView({ clienteFilterId, semCliente }: { clienteFilterId?: string; semCliente?: boolean } = {}) {
  const { tarefas, clientes, openTask, myId, meuStatusFilter } = useTasks();
  const apenasMinhas = !semCliente && !clienteFilterId;

  if (semCliente) {
    const list = tarefas.filter((t) => (t.tipo ?? "tarefa") === "tarefa" && !t.cliente_id);
    return (
      <div className="px-6 py-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-muted-foreground">
            <ClipboardList className="h-3 w-3" />
          </span>
          <h3 className="text-sm font-semibold">Tarefas gerais</h3>
          <span className="text-xs text-muted-foreground">{list.length}</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="grid grid-cols-[1fr_120px_120px_100px] gap-2 border-b border-border bg-[var(--surface-2)] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <div>Nome</div>
            <div>Responsável</div>
            <div>Vencimento</div>
            <div>Prioridade</div>
          </div>
          {list.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nenhuma tarefa geral. Use o botão "Adicionar Tarefa" no Quadro para criar.
            </div>
          )}
          {list.map((t) => {
            const SIcon = statusIcon[t.status];
            return (
              <div
                key={t.id}
                onClick={() => openTask(t.id)}
                className="task-surface grid cursor-pointer grid-cols-[1fr_120px_120px_100px] items-center gap-2 border-b border-border px-4 py-2.5 last:border-0 hover:bg-[oklch(0.96_0.01_285)]"
              >
                <div className="flex items-center gap-2.5">
                  <SIcon className="h-4 w-4" style={{ color: statusIconColor[t.status] }} />
                  <span className="text-sm">{t.titulo}</span>
                </div>
                <div>
                  <div className="flex -space-x-1.5">
                    {(t.responsaveis.length === 0
                      ? [{ id: "_", nome: "—", iniciais: "?" }]
                      : t.responsaveis.slice(0, 3)
                    ).map((r) => (
                      <div
                        key={r.id}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground ring-2 ring-background"
                        title={r.nome}
                      >
                        {r.iniciais}
                      </div>
                    ))}
                    {t.responsaveis.length > 3 && (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold ring-2 ring-background">
                        +{t.responsaveis.length - 3}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-foreground">{rotuloData(t.data_vencimento)}</div>
                <div className="text-xs">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={prioridadePillStyle(t.prioridade)}
                  >
                    <Flag className="h-2.5 w-2.5" style={{ fill: "currentColor" }} />
                    {t.prioridade}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const listaClientes = clienteFilterId
    ? clientes.filter((c) => c.id === clienteFilterId)
    : clientes;
  const minhasSemCliente = apenasMinhas
    ? tarefas.filter(
        (t) =>
          (t.tipo ?? "tarefa") === "tarefa" &&
          !t.cliente_id &&
          t.responsaveis.some((r) => r.id === myId) &&
          (!meuStatusFilter || t.status === meuStatusFilter),
      )
    : [];
  return (
    <div className="px-6 py-5">
      {apenasMinhas && minhasSemCliente.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-muted-foreground">
              <ClipboardList className="h-3 w-3" />
            </span>
            <h3 className="text-sm font-semibold">Sem cliente</h3>
            <span className="text-xs text-muted-foreground">{minhasSemCliente.length}</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="grid grid-cols-[1fr_120px_120px_100px] gap-2 border-b border-border bg-[var(--surface-2)] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <div>Nome</div>
              <div>Responsável</div>
              <div>Vencimento</div>
              <div>Prioridade</div>
            </div>
            {minhasSemCliente.map((t) => {
              const SIcon = statusIcon[t.status];
              return (
                <div
                  key={t.id}
                  onClick={() => openTask(t.id)}
                  className="task-surface grid cursor-pointer grid-cols-[1fr_120px_120px_100px] items-center gap-2 border-b border-border px-4 py-2.5 last:border-0 hover:bg-[oklch(0.96_0.01_285)]"
                >
                  <div className="flex items-center gap-2.5">
                    <SIcon className="h-4 w-4" style={{ color: statusIconColor[t.status] }} />
                    <span className="text-sm">{t.titulo}</span>
                  </div>
                  <div>
                    <div className="flex -space-x-1.5">
                      {(t.responsaveis.length === 0
                        ? [{ nome: "—", iniciais: "?" }]
                        : t.responsaveis.slice(0, 3)
                      ).map((r) => (
                        <div
                          key={r.iniciais}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground ring-2 ring-background"
                          title={r.nome}
                        >
                          {r.iniciais}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="text-xs text-foreground">{rotuloData(t.data_vencimento)}</div>
                  <div className="text-xs">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={prioridadePillStyle(t.prioridade)}
                    >
                      <Flag className="h-2.5 w-2.5" style={{ fill: "currentColor" }} />
                      {t.prioridade}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {listaClientes.map((cliente) => {
        const list = tarefas.filter((t) => {
          if ((t.tipo ?? "tarefa") !== "tarefa") return false;
          if (t.cliente_id !== cliente.id) return false;
          if (apenasMinhas && !t.responsaveis.some((r) => r.id === myId)) return false;
          if (apenasMinhas && meuStatusFilter && t.status !== meuStatusFilter) return false;
          return true;
        });
        if (list.length === 0) return null;
        return (
          <div key={cliente.id} className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <span
                className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold text-white"
                style={{ backgroundColor: cliente.cor }}
              >
                {cliente.nome_empresa.charAt(0)}
              </span>
              <h3 className="text-sm font-semibold">{cliente.nome_empresa}</h3>
              <span className="text-xs text-muted-foreground">{list.length}</span>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="grid grid-cols-[1fr_120px_120px_100px] gap-2 border-b border-border bg-[var(--surface-2)] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <div>Nome</div>
                <div>Responsável</div>
                <div>Vencimento</div>
                <div>Prioridade</div>
              </div>

              {list.map((t) => {
                const SIcon = statusIcon[t.status];
                return (
                  <div
                    key={t.id}
                    onClick={() => openTask(t.id)}
                    className="task-surface grid cursor-pointer grid-cols-[1fr_120px_120px_100px] items-center gap-2 border-b border-border px-4 py-2.5 last:border-0 hover:bg-[oklch(0.96_0.01_285)]"
                  >
                    <div className="flex items-center gap-2.5">
                      <SIcon className="h-4 w-4" style={{ color: statusIconColor[t.status] }} />
                      <span className="text-sm">{t.titulo}</span>
                    </div>
                    <div>
                      <div className="flex -space-x-1.5">
                        {(t.responsaveis.length === 0
                          ? [{ nome: "—", iniciais: "?" }]
                          : t.responsaveis.slice(0, 3)
                        ).map((r) => (
                          <div
                            key={r.iniciais}
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground ring-2 ring-background"
                            title={r.nome}
                          >
                            {r.iniciais}
                          </div>
                        ))}
                        {t.responsaveis.length > 3 && (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold ring-2 ring-background">
                            +{t.responsaveis.length - 3}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-foreground">{rotuloData(t.data_vencimento)}</div>
                    <div className="text-xs">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={prioridadePillStyle(t.prioridade)}
                      >
                        <Flag className="h-2.5 w-2.5" style={{ fill: "currentColor" }} />
                        {t.prioridade}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}