import { useState } from "react";
import { ArrowLeft, Plus, Calendar as CalendarIcon, LayoutGrid, Power, Trash2, Pencil } from "lucide-react";
import { useTasks } from "@/lib/tasks-store";
import { CalendarView } from "./CalendarView";
import { KanbanView, AddTaskDialog } from "./KanbanView";
import { cn } from "@/lib/utils";
import { EditClientDialog } from "./EditClientDialog";
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

export function ClientFocusView({ clienteId }: { clienteId: string }) {
  const { clientes, setWorkspace, contarTarefasCliente, setClienteStatus, removerCliente } = useTasks();
  const cliente = clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  const ativas = contarTarefasCliente(clienteId);
  const [aba, setAba] = useState<"quadro" | "calendario">("quadro");
  const ehInativo = (cliente.status ?? "ativo") === "inativo";
  const voltar = () => setWorkspace({ tipo: ehInativo ? "clientes-inativos" : "todos-clientes" });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-background px-6 py-4">
        <button
          onClick={voltar}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold text-white"
          style={{ backgroundColor: cliente.cor }}
        >
          {cliente.nome_empresa.charAt(0)}
        </span>
        <div className="flex-1">
          <h1 className="text-lg font-semibold leading-tight">{cliente.nome_empresa}</h1>
          <p className="text-xs text-muted-foreground">
            Plano {cliente.plano} · {ativas} {ativas === 1 ? "tarefa ativa" : "tarefas ativas"}
          </p>
        </div>
        <AddTaskDialog
          lockedClienteId={clienteId}
          trigger={
            <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90">
              <Plus className="h-3.5 w-3.5" />
              Adicionar Tarefa
            </button>
          }
        />
        <EditClientDialog
          cliente={cliente}
          trigger={
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
              title="Editar informações do cliente"
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar
            </button>
          }
        />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted",
                ehInativo && "text-emerald-600 hover:text-emerald-700",
              )}
              title={ehInativo ? "Reativar cliente" : "Desativar cliente"}
            >
              <Power className="h-3.5 w-3.5" />
              {ehInativo ? "Reativar" : "Desativar"}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {ehInativo ? `Reativar ${cliente.nome_empresa}?` : `Desativar ${cliente.nome_empresa}?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {ehInativo
                  ? "O cliente voltará para a lista de ativos e o plano voltará a ser contabilizado no caixa."
                  : "O cliente sairá da listagem principal, irá para Clientes Inativos e o valor do plano deixa de entrar no caixa."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setClienteStatus(cliente.id, ehInativo ? "ativo" : "inativo");
                  voltar();
                }}
              >
                Confirmar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
              title="Excluir cliente"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir {cliente.nome_empresa}?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação é permanente. Todas as tarefas e lançamentos financeiros vinculados a este cliente também serão removidos.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  removerCliente(cliente.id);
                  voltar();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="flex items-center gap-1 border-b border-border bg-background px-4">
        {([
          { id: "quadro", label: "Quadro", Icon: LayoutGrid },
          { id: "calendario", label: "Calendário", Icon: CalendarIcon },
        ] as const).map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              aba === id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {aba === "quadro" && <KanbanView clienteFilterId={clienteId} />}
        {aba === "calendario" && <CalendarView clienteFilterId={clienteId} />}
      </div>
    </div>
  );
}