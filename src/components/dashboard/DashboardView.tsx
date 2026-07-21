import { useMemo } from "react";
import { useTasks } from "@/lib/tasks-store";
import { Skeleton } from "@/components/ui/skeleton";
import type { Tarefa, Status } from "@/lib/mock-data";

type PrazoBucket = "no-prazo" | "prestes" | "expirada";

function classificarPrazo(t: Tarefa): PrazoBucket | null {
  if (!t.data_vencimento) return null;
  const venc = new Date(t.data_vencimento).getTime();
  const agora = Date.now();
  const diffH = (venc - agora) / 36e5;
  if (t.status !== "Concluído" && diffH < 0) return "expirada";
  if (diffH <= 48) return "prestes";
  return "no-prazo";
}

function calcStatus(list: Tarefa[]) {
  const total = list.length || 1;
  const counts: Record<Status, number> = {
    Pendente: list.filter((t) => t.status === "Pendente").length,
    "Em Progresso": list.filter((t) => t.status === "Em Progresso").length,
    "Concluído": list.filter((t) => t.status === "Concluído").length,
  };
  return {
    total: list.length,
    counts,
    pct: {
      Pendente: Math.round((counts.Pendente / total) * 100),
      "Em Progresso": Math.round((counts["Em Progresso"] / total) * 100),
      "Concluído": Math.round((counts["Concluído"] / total) * 100),
    },
  };
}

function calcPrazos(list: Tarefa[]) {
  const buckets = { "no-prazo": 0, prestes: 0, expirada: 0 } as Record<PrazoBucket, number>;
  for (const t of list) {
    const b = classificarPrazo(t);
    if (b) buckets[b]++;
  }
  const total = (buckets["no-prazo"] + buckets.prestes + buckets.expirada) || 1;
  return {
    counts: buckets,
    total: total === 1 && buckets["no-prazo"] + buckets.prestes + buckets.expirada === 0 ? 0 : total,
    pct: {
      "no-prazo": Math.round((buckets["no-prazo"] / total) * 100),
      prestes: Math.round((buckets.prestes / total) * 100),
      expirada: Math.round((buckets.expirada / total) * 100),
    },
  };
}

const statusColors: Record<Status, string> = {
  Pendente: "#F59E0B",
  "Em Progresso": "#3B82F6",
  "Concluído": "#22C55E",
};

const prazoColors: Record<PrazoBucket, string> = {
  "no-prazo": "#22C55E",
  prestes: "#FBBF24",
  expirada: "#EF4444",
};

export function DashboardView({ apenasMinhas = false }: { apenasMinhas?: boolean } = {}) {
  const { tarefas, myId, loading } = useTasks();

  const todas = useMemo(
    () => tarefas.filter((t) => (t.tipo ?? "tarefa") === "tarefa"),
    [tarefas],
  );
  const minhas = useMemo(
    () => todas.filter((t) => t.responsaveis.some((r) => r.id === myId)),
    [todas, myId],
  );

  const geralStatus = useMemo(() => calcStatus(todas), [todas]);
  const geralPrazos = useMemo(() => calcPrazos(todas), [todas]);
  const meuStatus = useMemo(() => calcStatus(minhas), [minhas]);
  const meuPrazos = useMemo(() => calcPrazos(minhas), [minhas]);

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
      {!apenasMinhas && (
        <Section title="Visão Geral da Agência" subtitle="Todas as tarefas de todos os clientes">
          <ProgressoCard data={geralStatus} />
          <PrazosCard data={geralPrazos} />
        </Section>
      )}
      <Section title="Minha Visão" subtitle="Tarefas atribuídas a você">
        <ProgressoCard data={meuStatus} />
        <PrazosCard data={meuPrazos} />
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur-xl">
      <h3 className="mb-5 text-[15px] font-semibold text-card-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Donut({ segments, total, label }: { segments: { color: string; value: number }[]; total: number; label: string }) {
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

function Legend({ rows }: { rows: { color: string; label: string; count: number; pct: number }[] }) {
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

function ProgressoCard({ data }: { data: ReturnType<typeof calcStatus> }) {
  return (
    <Card title="Progresso">
      <div className="flex items-center gap-8">
        <Donut
          label="Tarefas"
          total={data.total}
          segments={[
            { color: statusColors["Concluído"], value: data.counts["Concluído"] },
            { color: statusColors["Em Progresso"], value: data.counts["Em Progresso"] },
            { color: statusColors.Pendente, value: data.counts.Pendente },
          ]}
        />
        <Legend
          rows={[
            { color: statusColors["Concluído"], label: "Concluído", count: data.counts["Concluído"], pct: data.pct["Concluído"] },
            { color: statusColors["Em Progresso"], label: "Em Progresso", count: data.counts["Em Progresso"], pct: data.pct["Em Progresso"] },
            { color: statusColors.Pendente, label: "Pendente", count: data.counts.Pendente, pct: data.pct.Pendente },
          ]}
        />
      </div>
    </Card>
  );
}

function PrazosCard({ data }: { data: ReturnType<typeof calcPrazos> }) {
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