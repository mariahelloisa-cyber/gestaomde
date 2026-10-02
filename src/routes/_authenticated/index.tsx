import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PrimarySidebar } from "@/components/layout/PrimarySidebar";
import { SecondarySidebar } from "@/components/layout/SecondarySidebar";
import { TarefasHeader } from "@/components/dashboard/TarefasHeader";
import { KanbanView, AddTaskDialog } from "@/components/dashboard/KanbanView";
import { CalendarView } from "@/components/dashboard/CalendarView";
import { MuralView } from "@/components/dashboard/MuralView";
import { TasksProvider, useTasks } from "@/lib/tasks-store";
import { TaskDetailDialog } from "@/components/dashboard/TaskDetailDialog";
import { ClientsView } from "@/components/dashboard/ClientsView";
import { ClientFocusView } from "@/components/dashboard/ClientFocusView";
import { MembersView } from "@/components/dashboard/MembersView";
import { FinancialView } from "@/components/dashboard/FinancialView";
import { PlansView } from "@/components/dashboard/PlansView";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { DemandasView } from "@/components/dashboard/DemandasView";
import { LinksView } from "@/components/dashboard/LinksView";
import { FinalizadosView } from "@/components/dashboard/FinalizadosView";
import { IdeiasView } from "@/components/dashboard/IdeiasView";
import { ProjectsView } from "@/components/dashboard/ProjectsView";
import { OrganogramaView } from "@/components/dashboard/OrganogramaView";
import { AniversariantesView } from "@/components/dashboard/AniversariantesView";
import { AniversariantesPopupAutomatico } from "@/components/dashboard/AniversariantesPopup";
import { ClientPortal } from "@/components/portal/ClientPortal";
import { getMyPortalContext } from "@/lib/data.functions";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Painel — Agência" },
      { name: "description", content: "Sistema de gestão de tarefas e clientes da agência." },
      { property: "og:title", content: "Painel — Agência" },
      { property: "og:description", content: "Sistema de gestão de tarefas e clientes da agência." },
    ],
  }),
  // Qual mural está aberto na aba Mural. Fica na URL para o voltar do
  // navegador funcionar e o link de um mural poder ser guardado.
  validateSearch: (search: Record<string, unknown>): { mural?: string } => ({
    mural: typeof search.mural === "string" ? search.mural : undefined,
  }),
  component: Index,
});

function Index() {
  const ctxFn = useServerFn(getMyPortalContext);
  const { data: ctx, isLoading } = useQuery({ queryKey: ["portal-ctx"], queryFn: () => ctxFn() });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Carregando...
      </div>
    );
  }

  if (ctx?.cargo === "Cliente") {
    return <ClientPortal />;
  }

  return (
    <TasksProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <PrimarySidebar />
        <SecondarySidebar />
        <main className="flex flex-1 flex-col overflow-hidden">
          <WorkspaceContent />
        </main>
        <TaskDetailDialog />
        {/* Lembrete das publicações do dia: abre sozinho no primeiro acesso de
            cada membro e some quando não há aniversariante hoje. */}
        <AniversariantesDoDia />
      </div>
    </TasksProvider>
  );
}

function AniversariantesDoDia() {
  const { setWorkspace } = useTasks();
  return (
    <AniversariantesPopupAutomatico
      onVerTodos={() => setWorkspace({ tipo: "aniversariantes" })}
    />
  );
}

function WorkspaceContent() {
  const { workspace, mainView, setMainView, myCargo } = useTasks();
  const isAdminLike = myCargo === "Admin" || myCargo === "Supervisor";
  const blockedForMembro =
    !isAdminLike &&
    (workspace.tipo === "financeiro" ||
      workspace.tipo === "demandas" ||
      workspace.tipo === "finalizados");

  if (workspace.tipo === "dashboard") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <DashboardView apenasMinhas={!isAdminLike} />
      </div>
    );
  }

  if (blockedForMembro) {
    return (
      <>
        <TarefasHeader view={mainView} onViewChange={setMainView} />
        <div key={mainView} className="flex-1 animate-in fade-in-50 overflow-y-auto bg-[var(--surface-1)] duration-200">
          {mainView === "Quadro" && <KanbanView />}
          {mainView === "Calendário" && <CalendarView scope="pessoal" />}
          {mainView === "Mural" && <MuralView />}
        </div>
      </>
    );
  }

  if (workspace.tipo === "tarefas-gerais") {
    const criarTarefaButton = (
      <AddTaskDialog
        semCliente
        trigger={
          <button className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/90">
            <Plus className="h-3.5 w-3.5" />
            Criar tarefa
          </button>
        }
      />
    );
    // Mural é só de Minhas Tarefas: aqui cai para o Kanban.
    const viewGeral = mainView === "Mural" ? "Quadro" : mainView;
    return (
      <>
        <TarefasHeader view={viewGeral} onViewChange={setMainView} extraActions={criarTarefaButton} mode="geral" />
        <div key={viewGeral} className="flex-1 animate-in fade-in-50 overflow-y-auto bg-[var(--surface-1)] duration-200">
          {viewGeral === "Quadro" && <KanbanView semCliente />}
          {viewGeral === "Calendário" && <CalendarView scope="sem-cliente" />}
        </div>
      </>
    );
  }

  if (workspace.tipo === "todos-clientes") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <ClientsView filtroStatus="ativo" />
      </div>
    );
  }

  if (workspace.tipo === "clientes-inativos") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <ClientsView filtroStatus="inativo" />
      </div>
    );
  }

  if (workspace.tipo === "financeiro") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <FinancialView />
      </div>
    );
  }

  if (workspace.tipo === "planos") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <PlansView />
      </div>
    );
  }

  if (workspace.tipo === "membros") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <MembersView />
      </div>
    );
  }

  if (workspace.tipo === "organograma") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <OrganogramaView />
      </div>
    );
  }

  if (workspace.tipo === "calendario-geral") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <CalendarView scope="geral" />
      </div>
    );
  }

  if (workspace.tipo === "demandas") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <DemandasView />
      </div>
    );
  }

  if (workspace.tipo === "links") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <LinksView />
      </div>
    );
  }

  if (workspace.tipo === "finalizados") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <FinalizadosView />
      </div>
    );
  }

  if (workspace.tipo === "ideias") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <IdeiasView />
      </div>
    );
  }

  if (workspace.tipo === "projetos") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <ProjectsView />
      </div>
    );
  }

  if (workspace.tipo === "aniversariantes") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <AniversariantesView />
      </div>
    );
  }

  if (workspace.tipo === "cliente") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <ClientFocusView clienteId={workspace.clienteId} />
      </div>
    );
  }

  return (
    <>
      <TarefasHeader view={mainView} onViewChange={setMainView} />
      <div key={mainView} className="flex-1 animate-in fade-in-50 overflow-y-auto bg-[var(--surface-1)] duration-200">
        {mainView === "Quadro" && <KanbanView />}
        {mainView === "Calendário" && <CalendarView scope="pessoal" />}
        {mainView === "Mural" && <MuralView />}
      </div>
    </>
  );
}
