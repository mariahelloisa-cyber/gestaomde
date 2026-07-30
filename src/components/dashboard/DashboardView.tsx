import { useMemo, useState } from "react";
import { useTasks } from "@/lib/tasks-store";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodFilter } from "./PeriodFilter";
import { ReportDialog } from "./ReportDialog";
import {
  calcStatus,
  contarTarefasPorProjeto,
  Card,
  Section,
  ProgressoCard,
  PrazosCard,
  ProjetosBarChart,
  MemberProductivityBlock,
} from "./dashboard-charts";
import { calcPrazos, resolverPeriodo, type PeriodoPreset } from "@/lib/productivity";

export function DashboardView({ apenasMinhas = false }: { apenasMinhas?: boolean } = {}) {
  const { tarefas, myId, loading, membros, projetos } = useTasks();
  const [membroSelecionadoId, setMembroSelecionadoId] = useState<string>("");
  const [projetoSelecionadoId, setProjetoSelecionadoId] = useState<string>("");
  const [preset, setPreset] = useState<PeriodoPreset>("30d");
  const [customDe, setCustomDe] = useState("");
  const [customAte, setCustomAte] = useState("");
  const periodo = useMemo(
    () => resolverPeriodo(preset, { de: customDe, ate: customAte }),
    [preset, customDe, customAte],
  );

  const todas = useMemo(
    () => tarefas.filter((t) => (t.tipo ?? "tarefa") === "tarefa"),
    [tarefas],
  );
  const minhas = useMemo(
    () => todas.filter((t) => t.responsaveis.some((r) => r.id === myId)),
    [todas, myId],
  );

  const membrosOrdenados = useMemo(
    () => [...membros].sort((a, b) => a.nome.localeCompare(b.nome)),
    [membros],
  );
  const membroSelecionado = membrosOrdenados.find((m) => m.id === membroSelecionadoId);
  const tarefasMembro = useMemo(
    () =>
      membroSelecionado
        ? todas.filter((t) => t.responsaveis.some((r) => r.id === membroSelecionado.id))
        : [],
    [todas, membroSelecionado],
  );

  const geralStatus = useMemo(() => calcStatus(todas), [todas]);
  const geralPrazos = useMemo(() => calcPrazos(todas), [todas]);

  const projetosOrdenados = useMemo(
    () => [...projetos].sort((a, b) => a.nome.localeCompare(b.nome)),
    [projetos],
  );
  const contagemProjetos = useMemo(() => contarTarefasPorProjeto(todas, projetos), [todas, projetos]);
  const projetoSelecionado = projetosOrdenados.find((p) => p.id === projetoSelecionadoId);
  const tarefasProjeto = useMemo(
    () => (projetoSelecionado ? todas.filter((t) => t.projeto_id === projetoSelecionado.id) : []),
    [todas, projetoSelecionado],
  );
  const statusProjeto = useMemo(() => calcStatus(tarefasProjeto), [tarefasProjeto]);
  const prazosProjeto = useMemo(() => calcPrazos(tarefasProjeto), [tarefasProjeto]);

  if (loading) {
    return (
      <div className="space-y-8 p-6">
        {[0, 1].map((s) => (
          <div key={s} className="space-y-3">
            <Skeleton className="h-5 w-48" />
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-56 w-full rounded-xl" />
              <Skeleton className="h-56 w-full rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6">
      <div className="flex justify-end">
        <ReportDialog apenasMinhas={apenasMinhas} />
      </div>

      {!apenasMinhas && (
        <Section title="Visão Geral da Agência" subtitle="Todas as tarefas de todos os clientes">
          <ProgressoCard data={geralStatus} />
          <PrazosCard data={geralPrazos} />
        </Section>
      )}

      {!apenasMinhas && (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Tarefas por Projeto</h2>
            <p className="text-xs text-muted-foreground">Quantidade de tarefas ativas em cada projeto</p>
          </div>

          <Card title="Volume por Projeto">
            {contagemProjetos.length > 0 ? (
              <ProjetosBarChart rows={contagemProjetos} />
            ) : (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Nenhum projeto cadastrado ainda.
              </div>
            )}
          </Card>

          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">Detalhamento por Projeto</h3>
              <Select value={projetoSelecionadoId} onValueChange={setProjetoSelecionadoId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Selecione um projeto" />
                </SelectTrigger>
                <SelectContent>
                  {projetosOrdenados.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {projetoSelecionado ? (
              <div className="grid gap-4 md:grid-cols-2">
                <ProgressoCard data={statusProjeto} />
                <PrazosCard data={prazosProjeto} />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {projetosOrdenados.length === 0
                  ? "Nenhum projeto cadastrado ainda."
                  : "Selecione um projeto acima para ver finalizadas, em andamento, em análise, pendentes e atrasadas."}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Produtividade</h2>
            <p className="text-xs text-muted-foreground">
              Compare tarefas recebidas x concluídas no período selecionado
            </p>
          </div>
          <PeriodFilter
            preset={preset}
            onPresetChange={setPreset}
            customDe={customDe}
            customAte={customAte}
            onCustomChange={(de, ate) => {
              setCustomDe(de);
              setCustomAte(ate);
            }}
          />
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Minha Visão</h3>
          <MemberProductivityBlock tarefasDoMembro={minhas} membroId={myId} periodo={periodo} />
        </div>

        {!apenasMinhas && (
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">Visão por Membro</h3>
              <Select value={membroSelecionadoId} onValueChange={setMembroSelecionadoId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Selecione um membro" />
                </SelectTrigger>
                <SelectContent>
                  {membrosOrdenados.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {membroSelecionado ? (
              <MemberProductivityBlock
                tarefasDoMembro={tarefasMembro}
                membroId={membroSelecionado.id}
                periodo={periodo}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {membrosOrdenados.length === 0
                  ? "Nenhum membro cadastrado ainda."
                  : "Selecione um membro acima para ver o dashboard individual."}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
