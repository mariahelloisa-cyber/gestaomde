import { useMemo } from "react";
import type { Projeto } from "@/lib/tasks-store";
import { calcularProdutividade, calcPrazos, prazoColors, type Periodo } from "@/lib/productivity";
import type { Status } from "@/lib/mock-data";

/** Componentes de gráfico e funções de agregação puras do dashboard — sem
 * data-fetching, reaproveitados tanto pela área logada (DashboardView) quanto
 * pelo painel público (PainelPublicoView). */

interface TarefaStatusLike {
  status: Status;
}

export function calcStatus(list: TarefaStatusLike[]) {
  const total = list.length || 1;
  const counts: Record<Status, number> = {
    Pendente: list.filter((t) => t.status === "Pendente").length,
    "Em Progresso": list.filter((t) => t.status === "Em Progresso").length,
    "Em Análise": list.filter((t) => t.status === "Em Análise").length,
    "Concluído": list.filter((t) => t.status === "Concluído").length,
  };
  return {
    total: list.length,
    counts,
    pct: {
      Pendente: Math.round((counts.Pendente / total) * 100),
      "Em Progresso": Math.round((counts["Em Progresso"] / total) * 100),
      "Em Análise": Math.round((counts["Em Análise"] / total) * 100),
      "Concluído": Math.round((counts["Concluído"] / total) * 100),
    },
  };
}

export const statusColors: Record<Status, string> = {
  Pendente: "#F59E0B",
  "Em Progresso": "#3B82F6",
  "Em Análise": "#A855F7",
  "Concluído": "#22C55E",
};

export interface ProjetoContagem {
  id: string;
  nome: string;
  total: number;
}

interface TarefaProjetoLike {
  projeto_id?: string | null;
}

export function contarTarefasPorProjeto(list: TarefaProjetoLike[], projetos: Projeto[]): ProjetoContagem[] {
  const porId = new Map<string, number>();
  let semProjeto = 0;
  for (const t of list) {
    if (t.projeto_id) porId.set(t.projeto_id, (porId.get(t.projeto_id) ?? 0) + 1);
    else semProjeto++;
  }
  const linhas: ProjetoContagem[] = projetos.map((p) => ({
    id: p.id,
    nome: p.nome,
    total: porId.get(p.id) ?? 0,
  }));
  if (semProjeto > 0) linhas.push({ id: "__sem_projeto__", nome: "Sem projeto", total: semProjeto });
  return linhas.sort((a, b) => b.total - a.total);
}

/** Arredonda para cima até um número "redondo" (1/2/5 x 10^n), pra servir de eixo do gráfico. */
function tetoAmigavel(valor: number): number {
  if (valor <= 5) return 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(valor)));
  const resto = valor / magnitude;
  const passo = resto <= 1 ? 1 : resto <= 2 ? 2 : resto <= 5 ? 5 : 10;
  return passo * magnitude;
}

interface TarefaProdutividadeBlockLike {
  responsaveis: { id: string; atribuido_em?: string }[];
  status: Status;
  concluido_em?: string | null;
  data_vencimento: string;
}

export function MemberProductivityBlock({
  tarefasDoMembro,
  membroId,
  periodo,
}: {
  tarefasDoMembro: TarefaProdutividadeBlockLike[];
  membroId: string;
  periodo: Periodo;
}) {
  const metricas = useMemo(
    () => calcularProdutividade(tarefasDoMembro, membroId, periodo),
    [tarefasDoMembro, membroId, periodo],
  );
  const status = useMemo(() => calcStatus(tarefasDoMembro), [tarefasDoMembro]);
  const prazos = useMemo(() => calcPrazos(tarefasDoMembro), [tarefasDoMembro]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Atribuídas no período" value={String(metricas.atribuidas)} />
        <StatTile label="Concluídas no período" value={String(metricas.concluidas)} accent={statusColors["Concluído"]} />
        <StatTile
          label="Taxa de conclusão"
          value={`${metricas.taxaConclusao.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ProgressoCard data={status} />
        <PrazosCard data={prazos} />
      </div>
    </div>
  );
}

export function StatTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className="mt-1 text-2xl font-semibold tabular-nums text-foreground"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

export function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur-xl">
      <h3 className="mb-5 text-[15px] font-semibold text-card-foreground">{title}</h3>
      {children}
    </div>
  );
}

export function Donut({ segments, total, label }: { segments: { color: string; value: number }[]; total: number; label: string }) {
  const size = 170;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = total > 1 ? 3 : 0;
  let offset = 0;
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {total > 0 &&
          visible.map((s, i) => {
            const len = Math.max((s.value / total) * c - gap, 0);
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
              />
            );
            offset += len + gap;
            return el;
          })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tracking-tight text-foreground">{total}</span>
        <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

export function Legend({ rows }: { rows: { color: string; label: string; count: number; pct: number }[] }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2.5">
            <span
              className="h-2.5 w-2.5 rounded-full ring-4"
              style={{ backgroundColor: r.color, boxShadow: `0 0 0 3px ${r.color}33` }}
            />
            <span className="text-muted-foreground">{r.label}</span>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tabular-nums text-foreground">{r.count}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{r.pct}%</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function ProgressoCard({ data }: { data: ReturnType<typeof calcStatus> }) {
  return (
    <Card title="Progresso">
      <div className="flex items-center gap-8">
        <Donut
          label="Tarefas"
          total={data.total}
          segments={[
            { color: statusColors["Concluído"], value: data.counts["Concluído"] },
            { color: statusColors["Em Análise"], value: data.counts["Em Análise"] },
            { color: statusColors["Em Progresso"], value: data.counts["Em Progresso"] },
            { color: statusColors.Pendente, value: data.counts.Pendente },
          ]}
        />
        <Legend
          rows={[
            { color: statusColors["Concluído"], label: "Concluído", count: data.counts["Concluído"], pct: data.pct["Concluído"] },
            { color: statusColors["Em Análise"], label: "Em Análise", count: data.counts["Em Análise"], pct: data.pct["Em Análise"] },
            { color: statusColors["Em Progresso"], label: "Em Progresso", count: data.counts["Em Progresso"], pct: data.pct["Em Progresso"] },
            { color: statusColors.Pendente, label: "Pendente", count: data.counts.Pendente, pct: data.pct.Pendente },
          ]}
        />
      </div>
    </Card>
  );
}

export function ProjetosBarChart({ rows }: { rows: ProjetoContagem[] }) {
  const maiorValor = Math.max(1, ...rows.map((r) => r.total));
  const teto = tetoAmigavel(maiorValor);
  const marcas = 4;
  const passo = teto / marcas;

  return (
    <div>
      <div className="grid grid-cols-[1fr_9rem] gap-x-3">
        <div className="relative">
          <div className="pointer-events-none absolute inset-0 flex justify-between">
            {Array.from({ length: marcas + 1 }).map((_, i) => (
              <span key={i} className="h-full w-px bg-border/40" />
            ))}
          </div>
          <div className="relative space-y-2.5 py-0.5">
            {rows.map((r) => (
              <div key={r.id} className="flex h-7 items-center">
                {r.total > 0 ? (
                  <div
                    className="flex h-full min-w-[2.25rem] items-center justify-end rounded-md pr-2 text-xs font-semibold text-white shadow-sm"
                    style={{
                      width: `${Math.max((r.total / teto) * 100, 4)}%`,
                      background: "linear-gradient(90deg, #14b8a6, #3b82f6)",
                    }}
                  >
                    {r.total}
                  </div>
                ) : (
                  <span className="pl-1 text-xs text-muted-foreground">0</span>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-2.5 py-0.5">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex h-7 items-center truncate text-xs text-foreground/90"
              title={r.nome}
            >
              {r.nome}
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[1fr_9rem] gap-x-3">
        <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
          {Array.from({ length: marcas + 1 }).map((_, i) => (
            <span key={i}>{Math.round(passo * i)}</span>
          ))}
        </div>
        <div />
      </div>
    </div>
  );
}

export function PrazosCard({ data }: { data: ReturnType<typeof calcPrazos> }) {
  return (
    <Card title="Prazos">
      <div className="flex items-center gap-8">
        <Donut
          label="Tarefas"
          total={data.total}
          segments={[
            { color: prazoColors["no-prazo"], value: data.counts["no-prazo"] },
            { color: prazoColors.prestes, value: data.counts.prestes },
            { color: prazoColors.expirada, value: data.counts.expirada },
          ]}
        />
        <Legend
          rows={[
            { color: prazoColors["no-prazo"], label: "No Prazo", count: data.counts["no-prazo"], pct: data.pct["no-prazo"] },
            { color: prazoColors.prestes, label: "Prestes a Expirar", count: data.counts.prestes, pct: data.pct.prestes },
            { color: prazoColors.expirada, label: "Expiradas", count: data.counts.expirada, pct: data.pct.expirada },
          ]}
        />
      </div>
    </Card>
  );
}
