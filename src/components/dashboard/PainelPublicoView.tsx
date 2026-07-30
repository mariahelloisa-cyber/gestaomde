import { useMemo, useState } from "react";
import { LayoutDashboard, LayoutGrid } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PeriodFilter } from "./PeriodFilter";
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
import { PainelPublicoTarefasView } from "./PainelPublicoTarefasView";
import { calcPrazos, resolverPeriodo, type PeriodoPreset } from "@/lib/productivity";
import type { PainelPublicoData } from "@/lib/painel-publico.functions";
import { cn } from "@/lib/utils";

export function PainelPublicoView({ data }: { data: PainelPublicoData }) {
  const { tarefas, membros, projetos } = data;
  const [aba, setAba] = useState<"painel" | "tarefas">("painel");
  const [projetoSelecionadoId, setProjetoSelecionadoId] = useState("");
  const [membroSelecionadoId, setMembroSelecionadoId] = useState("");
  const [preset, setPreset] = useState<PeriodoPreset>("30d");
  const [customDe, setCustomDe] = useState("");
  const [customAte, setCustomAte] = useState("");
  const periodo = useMemo(
    () => resolverPeriodo(preset, { de: customDe, ate: customAte }),
    [preset, customDe, customAte],
  );

  const geralStatus = useMemo(() => calcStatus(tarefas), [tarefas]);
  const geralPrazos = useMemo(() => calcPrazos(tarefas), [tarefas]);

  const projetosOrdenados = useMemo(
    () => [...projetos].sort((a, b) => a.nome.localeCompare(b.nome)),
    [projetos],
  );
  const contagemProjetos = useMemo(
    () => contarTarefasPorProjeto(tarefas, projetos),
    [tarefas, projetos],
  );
  const projetoSelecionado = projetosOrdenados.find((p) => p.id === projetoSelecionadoId);
  const tarefasProjeto = useMemo(
    () => (projetoSelecionado ? tarefas.filter((t) => t.projeto_id === projetoSelecionado.id) : []),
    [tarefas, projetoSelecionado],
  );
  const statusProjeto = useMemo(() => calcStatus(tarefasProjeto), [tarefasProjeto]);
  const prazosProjeto = useMemo(() => calcPrazos(tarefasProjeto), [tarefasProjeto]);

  const membrosOrdenados = useMemo(
    () => [...membros].sort((a, b) => a.nome.localeCompare(b.nome)),
    [membros],
  );
  const membroSelecionado = membrosOrdenados.find((m) => m.id === membroSelecionadoId);
  const tarefasMembro = useMemo(
    () =>
      membroSelecionado
        ? tarefas.filter((t) => t.responsaveis.some((r) => r.id === membroSelecionado.id))
        : [],
    [tarefas, membroSelecionado],
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Painel público</h1>
          <p className="text-xs text-muted-foreground">
            Somente leitura — atualiza automaticamente
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-[var(--surface-2)] p-1">
          <TabButton
            active={aba === "painel"}
            onClick={() => setAba("painel")}
            icon={LayoutDashboard}
            label="Painel"
          />
          <TabButton
            active={aba === "tarefas"}
            onClick={() => setAba("tarefas")}
            icon={LayoutGrid}
            label="Tarefas"
          />
        </div>
      </header>

      {aba === "painel" ? (
        <div className="mx-auto w-full max-w-5xl space-y-8 p-6">
          <Section title="Visão Geral da Agência" subtitle="Todas as tarefas de todos os clientes">
            <ProgressoCard data={geralStatus} />
            <PrazosCard data={geralPrazos} />
          </Section>

          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Tarefas por Projeto</h2>
              <p className="text-xs text-muted-foreground">
                Quantidade de tarefas ativas em cada projeto
              </p>
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

          <section className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Produtividade por Membro
                </h2>
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
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
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
                    : "Selecione um membro acima para ver a produtividade individual."}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="min-h-[70vh] flex-1">
          <PainelPublicoTarefasView data={data} />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof LayoutDashboard;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
