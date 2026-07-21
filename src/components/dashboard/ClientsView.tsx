import { Crown, Diamond, Gem, Medal } from "lucide-react";
import type { Cliente } from "@/lib/mock-data";
import { useTasks } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import { AddClientDialog } from "./AddClientDialog";

type Plano = Cliente["plano"];

const PLANOS: { plano: Plano; subtitulo: string; icon: typeof Crown; classes: string; accent: string }[] = [
  {
    plano: "Diamond",
    subtitulo: "Clientes premium com cobertura total.",
    icon: Diamond,
    classes: "from-[#EDE9FE] to-[#DDD6FE] border-[#C4B5FD]",
    accent: "#7C3AED",
  },
  {
    plano: "Ouro",
    subtitulo: "Plano com prioridade alta.",
    icon: Crown,
    classes: "from-[#FEF3C7] to-[#FDE68A] border-[#FCD34D]",
    accent: "#D97706",
  },
  {
    plano: "Prata",
    subtitulo: "Plano intermediário.",
    icon: Medal,
    classes: "from-[#F1F5F9] to-[#E2E8F0] border-[#CBD5E1]",
    accent: "#64748B",
  },
  {
    plano: "Bronze",
    subtitulo: "Plano básico de entrada.",
    icon: Gem,
    classes: "from-[#FFEDD5] to-[#FED7AA] border-[#FDBA74]",
    accent: "#C2410C",
  },
];

export function ClientsView({ filtroStatus = "ativo" }: { filtroStatus?: "ativo" | "inativo" }) {
  const { clientes, setWorkspace, contarTarefasCliente } = useTasks();
  const filtrados = clientes.filter((c) => (c.status ?? "ativo") === filtroStatus);
  const ehInativos = filtroStatus === "inativo";

  return (
    <div className="px-6 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{ehInativos ? "Clientes inativos" : "Todos os clientes"}</h1>
          <p className="text-sm text-muted-foreground">
            {ehInativos
              ? "Clientes desativados — não entram no cálculo do caixa."
              : "Visão geral por plano de marketing. Clique em um cliente para abrir seu espaço."}
          </p>
        </div>
        {!ehInativos && <AddClientDialog />}
      </div>

      <div className="flex flex-col gap-6">
        {PLANOS.map((p) => {
          const lista = filtrados.filter((c) => c.plano === p.plano);
          if (lista.length === 0) return null;
          const Icon = p.icon;
          return (
            <section key={p.plano}>
              <div
                className={cn(
                  "mb-3 flex items-center gap-3 rounded-lg border bg-gradient-to-r px-4 py-3",
                  p.classes,
                )}
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-white/70 shadow-sm"
                  style={{ color: p.accent }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="flex-1">
                  <h2 className="text-sm font-semibold" style={{ color: p.accent }}>
                    {p.plano}
                  </h2>
                  <p className="text-[11px] font-medium text-black">{p.subtitulo}</p>
                </div>
                <span
                  className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium"
                  style={{ color: p.accent }}
                >
                  {lista.length} {lista.length === 1 ? "cliente" : "clientes"}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {lista.map((c) => {
                  const ativas = contarTarefasCliente(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => setWorkspace({ tipo: "cliente", clienteId: c.id })}
                      className="group flex items-center gap-3 rounded-lg border border-border bg-white p-3 text-left text-black shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md"
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white"
                        style={{ backgroundColor: c.cor }}
                      >
                        {c.nome_empresa.charAt(0)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-black">{c.nome_empresa}</p>
                        <p className="text-xs text-gray-600">
                          {ativas} {ativas === 1 ? "tarefa ativa" : "tarefas ativas"}
                        </p>
                      </div>
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: `${p.accent}1A`, color: p.accent }}
                      >
                        {c.plano}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {filtrados.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Nenhum cliente {ehInativos ? "inativo" : "ativo"} no momento.
          </div>
        )}
      </div>
    </div>
  );
}