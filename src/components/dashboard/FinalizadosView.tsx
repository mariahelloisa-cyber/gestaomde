import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Trophy } from "lucide-react";
import { useTasks } from "@/lib/tasks-store";
import { isFinalizada, rotuloData, type Tarefa } from "@/lib/mock-data";

export function FinalizadosView() {
  const { tarefas, clientes, membros } = useTasks();

  const finalizadas = useMemo(
    () => tarefas.filter((t) => (t.tipo ?? "tarefa") === "tarefa" && isFinalizada(t)),
    [tarefas],
  );

  const porMembro = useMemo(() => {
    const map = new Map<string, Tarefa[]>();
    for (const t of finalizadas) {
      for (const r of t.responsaveis) {
        const arr = map.get(r.id) ?? [];
        arr.push(t);
        map.set(r.id, arr);
      }
    }
    const semResponsavel = finalizadas.filter((t) => t.responsaveis.length === 0);

    const grupos = membros
      .map((m) => ({ membro: m, tarefas: map.get(m.id) ?? [] }))
      .filter((g) => g.tarefas.length > 0)
      .sort((a, b) => b.tarefas.length - a.tarefas.length);

    return { grupos, semResponsavel };
  }, [finalizadas, membros]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Finalizados</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tarefas concluídas há mais de 7 dias, agrupadas por responsável — uma forma de medir a produtividade de cada um.
        </p>
      </header>

      {finalizadas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Trophy className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Nenhuma tarefa finalizada ainda. Tarefas concluídas aparecem aqui 7 dias depois.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {porMembro.grupos.map((g) => (
            <MembroGrupo key={g.membro.id} nome={g.membro.nome} iniciais={g.membro.iniciais} cor={g.membro.cor} tarefas={g.tarefas} clientes={clientes} />
          ))}
          {porMembro.semResponsavel.length > 0 && (
            <MembroGrupo
              nome="Sem responsável"
              iniciais="—"
              cor="#9CA3AF"
              tarefas={porMembro.semResponsavel}
              clientes={clientes}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MembroGrupo({
  nome,
  iniciais,
  cor,
  tarefas,
  clientes,
}: {
  nome: string;
  iniciais: string;
  cor: string;
  tarefas: Tarefa[];
  clientes: { id: string; nome_empresa: string }[];
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-white text-black shadow-sm">
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
      >
        {aberto ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />}
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: cor }}
        >
          {iniciais}
        </div>
        <span className="flex-1 truncate text-sm font-medium">{nome}</span>
        <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          {tarefas.length} {tarefas.length === 1 ? "tarefa" : "tarefas"}
        </span>
      </button>

      {aberto && (
        <div className="border-t border-border">
          {tarefas
            .slice()
            .sort((a, b) => new Date(b.concluido_em ?? 0).getTime() - new Date(a.concluido_em ?? 0).getTime())
            .map((t) => {
              const cliente = clientes.find((c) => c.id === t.cliente_id);
              return (
                <div key={t.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{t.titulo}</div>
                    {cliente && <div className="truncate text-xs text-gray-500">{cliente.nome_empresa}</div>}
                  </div>
                  <div className="shrink-0 text-xs text-gray-500">
                    {t.concluido_em ? `Concluída ${rotuloData(t.concluido_em.slice(0, 10))}` : ""}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
