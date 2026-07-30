import type { Tarefa } from "./mock-data";

export type PeriodoPreset = "todos" | "hoje" | "7d" | "30d" | "90d" | "este-mes" | "mes-anterior" | "personalizado";

export const PERIODO_PRESETS: { value: PeriodoPreset; label: string }[] = [
  { value: "todos", label: "Todo o período" },
  { value: "hoje", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "90d", label: "Últimos 90 dias" },
  { value: "este-mes", label: "Este mês" },
  { value: "mes-anterior", label: "Mês anterior" },
  { value: "personalizado", label: "Período personalizado" },
];

export interface Periodo {
  de: string; // ISO YYYY-MM-DD, inclusive
  ate: string; // ISO YYYY-MM-DD, inclusive
}

function isoOf(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

/** Resolve um preset (ou período personalizado) para limites de data inclusivos. */
export function resolverPeriodo(preset: PeriodoPreset, personalizado?: { de: string; ate: string }): Periodo {
  const hoje = new Date();
  const ate = isoOf(hoje);

  switch (preset) {
    case "todos":
      return { de: "0000-01-01", ate: "9999-12-31" };
    case "hoje":
      return { de: ate, ate };
    case "7d": {
      const d = new Date(hoje);
      d.setDate(d.getDate() - 6);
      return { de: isoOf(d), ate };
    }
    case "30d": {
      const d = new Date(hoje);
      d.setDate(d.getDate() - 29);
      return { de: isoOf(d), ate };
    }
    case "90d": {
      const d = new Date(hoje);
      d.setDate(d.getDate() - 89);
      return { de: isoOf(d), ate };
    }
    case "este-mes": {
      const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      return { de: isoOf(inicio), ate };
    }
    case "mes-anterior": {
      const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
      return { de: isoOf(inicio), ate: isoOf(fim) };
    }
    case "personalizado":
      return {
        de: personalizado?.de || ate,
        ate: personalizado?.ate || ate,
      };
  }
}

function dentroDoPeriodo(iso: string | null | undefined, periodo: Periodo): boolean {
  if (!iso) return false;
  const dia = iso.slice(0, 10);
  return dia >= periodo.de && dia <= periodo.ate;
}

export interface MetricasProdutividade {
  atribuidas: number;
  concluidas: number;
  taxaConclusao: number; // 0–100
}

/**
 * Métricas de produtividade de um membro no período selecionado.
 * - "atribuidas": usa a data em que o membro foi designado responsável
 *   (tarefa_responsaveis.criado_em), não a data de criação da tarefa em si.
 * - "concluidas": usa tarefas.concluido_em, preservado mesmo que o status
 *   atual da tarefa já não seja mais "Concluído" no momento da consulta
 *   (nesse caso concluido_em já teria sido zerado pelo banco na reabertura).
 */
interface TarefaProdutividadeLike {
  responsaveis: { id: string; atribuido_em?: string }[];
  status: Tarefa["status"];
  concluido_em?: string | null;
}

export function calcularProdutividade(
  tarefasDoMembro: TarefaProdutividadeLike[],
  membroId: string,
  periodo: Periodo,
): MetricasProdutividade {
  let atribuidas = 0;
  let concluidas = 0;

  for (const t of tarefasDoMembro) {
    const resp = t.responsaveis.find((r) => r.id === membroId);
    if (resp && dentroDoPeriodo(resp.atribuido_em, periodo)) atribuidas++;
    if (t.status === "Concluído" && dentroDoPeriodo(t.concluido_em, periodo)) concluidas++;
  }

  const taxaConclusao = atribuidas > 0 ? (concluidas / atribuidas) * 100 : 0;
  return { atribuidas, concluidas, taxaConclusao };
}

export type PrazoBucket = "no-prazo" | "prestes" | "expirada";

export const prazoColors: Record<PrazoBucket, string> = {
  "no-prazo": "#22C55E",
  prestes: "#FBBF24",
  expirada: "#EF4444",
};

export const PRAZO_LABELS: Record<PrazoBucket, string> = {
  "no-prazo": "No Prazo",
  prestes: "Prestes a Expirar",
  expirada: "Expiradas",
};

interface TarefaPrazoLike {
  status: Tarefa["status"];
  data_vencimento: string;
}

export function classificarPrazo(t: TarefaPrazoLike): PrazoBucket | null {
  if (!t.data_vencimento) return null;
  const venc = new Date(t.data_vencimento).getTime();
  const agora = Date.now();
  const diffH = (venc - agora) / 36e5;
  if (t.status !== "Concluído" && diffH < 0) return "expirada";
  if (diffH <= 48) return "prestes";
  return "no-prazo";
}

export interface MetricasPrazos {
  counts: Record<PrazoBucket, number>;
  total: number;
  pct: Record<PrazoBucket, number>;
}

export function calcPrazos(list: TarefaPrazoLike[]): MetricasPrazos {
  const buckets = { "no-prazo": 0, prestes: 0, expirada: 0 } as Record<PrazoBucket, number>;
  for (const t of list) {
    const b = classificarPrazo(t);
    if (b) buckets[b]++;
  }
  const total = buckets["no-prazo"] + buckets.prestes + buckets.expirada;
  const divisor = total || 1;
  return {
    counts: buckets,
    total,
    pct: {
      "no-prazo": Math.round((buckets["no-prazo"] / divisor) * 100),
      prestes: Math.round((buckets.prestes / divisor) * 100),
      expirada: Math.round((buckets.expirada / divisor) * 100),
    },
  };
}
