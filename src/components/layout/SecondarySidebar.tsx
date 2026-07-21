import { useState } from "react";
import { ChevronDown, ChevronRight, CheckSquare, LayoutDashboard, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTasks } from "@/lib/tasks-store";
import { useAuth } from "@/lib/auth-context";

export function SecondarySidebar() {
  const [openMinhas, setOpenMinhas] = useState(true);
  const [openEspacos, setOpenEspacos] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const { contarMinhasPorStatus, clientesComMinhasTarefas, workspace, setWorkspace, membros, meuStatusFilter, setMeuStatusFilter, myCargo } = useTasks();
  const isAdminLike = myCargo === "Admin" || myCargo === "Supervisor";
  const { user } = useAuth();
  const meProfile = membros.find((m) => m.id === user?.id);
  const displayName = meProfile?.nome ?? user?.user_metadata?.nome ?? user?.email?.split("@")[0] ?? "Você";
  const clientes = clientesComMinhasTarefas();
  const activeClienteId = workspace.tipo === "cliente" ? workspace.clienteId : null;
  const dashboardActive = workspace.tipo === "dashboard";

  if (collapsed) {
    return (
      <aside className="flex h-screen w-10 flex-col items-center border-r border-primary-foreground/10 bg-primary py-2">
        <button
          onClick={() => setCollapsed(false)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
          aria-label="Expandir menu lateral"
          title="Expandir"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-primary-foreground/10 bg-primary">
      <div className="flex items-center justify-between gap-2 border-b border-primary-foreground/10 px-4 py-3">
        <h2 className="truncate text-sm font-semibold text-primary-foreground">{displayName}'s Workspace</h2>
        <button
          onClick={() => setCollapsed(true)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
          aria-label="Recolher menu lateral"
          title="Recolher"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {/* Dashboard */}
        {isAdminLike && (
        <button
          onClick={() => setWorkspace({ tipo: "dashboard" })}
          className={cn(
            "mb-3 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
            dashboardActive
              ? "bg-primary-foreground/15 text-primary-foreground"
              : "text-primary-foreground/90 hover:bg-primary-foreground/10",
          )}
        >
          <LayoutDashboard className="h-4 w-4 text-primary-foreground/70" />
          <span>Dashboard</span>
        </button>
        )}

        {/* Minhas Tarefas */}
        <div className="mb-3">
          <button
            onClick={() => {
              setWorkspace({ tipo: "tarefas" });
              setMeuStatusFilter(null);
              setOpenMinhas((v) => !v);
            }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-primary-foreground/90 hover:bg-primary-foreground/10"
          >
            {openMinhas ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <CheckSquare className="h-4 w-4 text-primary-foreground/70" />
            <span>Minhas Tarefas</span>
          </button>
          {openMinhas && (
            <div className="ml-7 mt-0.5 space-y-0.5">
              <SubItem
                dot="#9CA3AF"
                label="Pendentes"
                count={contarMinhasPorStatus("Pendente")}
                active={workspace.tipo === "tarefas" && meuStatusFilter === "Pendente"}
                onClick={() => {
                  setWorkspace({ tipo: "tarefas" });
                  setMeuStatusFilter(meuStatusFilter === "Pendente" ? null : "Pendente");
                }}
              />
              <SubItem
                dot="#3B82F6"
                label="Em Progresso"
                count={contarMinhasPorStatus("Em Progresso")}
                active={workspace.tipo === "tarefas" && meuStatusFilter === "Em Progresso"}
                onClick={() => {
                  setWorkspace({ tipo: "tarefas" });
                  setMeuStatusFilter(meuStatusFilter === "Em Progresso" ? null : "Em Progresso");
                }}
              />
              <SubItem
                dot="#22C55E"
                label="Concluídas"
                count={contarMinhasPorStatus("Concluído")}
                active={workspace.tipo === "tarefas" && meuStatusFilter === "Concluído"}
                onClick={() => {
                  setWorkspace({ tipo: "tarefas" });
                  setMeuStatusFilter(meuStatusFilter === "Concluído" ? null : "Concluído");
                }}
              />
            </div>
          )}
        </div>

        {/* Espaços */}
        <div>
          <div className="flex items-center justify-between px-2 py-1">
            <button
              onClick={() => setOpenEspacos((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/70 hover:text-primary-foreground"
            >
              {openEspacos ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Espaços
            </button>
          </div>

          {openEspacos && (
            <div className="mt-1 space-y-0.5">
              {clientes.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-primary-foreground/70">
                  Nenhum cliente com tarefas atribuídas a você.
                </p>
              )}
              {clientes.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setWorkspace({ tipo: "cliente", clienteId: c.id })}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    activeClienteId === c.id
                      ? "bg-primary-foreground/15 font-medium text-primary-foreground"
                      : "text-primary-foreground/90 hover:bg-primary-foreground/10",
                  )}
                >
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold text-white"
                    style={{ backgroundColor: c.cor }}
                  >
                    {c.nome_empresa.charAt(0)}
                  </span>
                  <span className="truncate">{c.nome_empresa}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function SubItem({ dot, label, count, active, onClick }: { dot: string; label: string; count: number; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between rounded-md px-2 py-1 text-sm transition-colors hover:bg-primary-foreground/10",
        active ? "font-semibold text-white shadow-sm" : "text-primary-foreground/90",
      )}
      style={active ? { backgroundColor: dot } : undefined}
    >
      <span className="flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: active ? "#fff" : dot }}
        />
        {label}
      </span>
      <span className={cn("text-xs", active ? "text-white/90" : "text-primary-foreground/70")}>
        {count}
      </span>
    </button>
  );
}
