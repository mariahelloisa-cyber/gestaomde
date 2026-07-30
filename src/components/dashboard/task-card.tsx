import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Calendar as CalendarIcon,
  Minus,
  SignalHigh,
  SignalLow,
  SignalMedium,
  User,
} from "lucide-react";
import {
  prioridadeCor,
  complexidadeCor,
  rotuloData,
  type Complexidade,
  type Prioridade,
  type Status,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";

/** Card de tarefa e avatar stack, puros — reaproveitados pelo Kanban autenticado
 * (com drag-and-drop e clique pra abrir o detalhe) e pelo painel público
 * (somente leitura, sem handlers). */

export const prioridadeIcon: Record<Prioridade, typeof ArrowUp> = {
  Alta: ArrowUp,
  Média: ArrowRight,
  Baixa: ArrowDown,
  Nenhuma: Minus,
};

export const complexidadeIcon: Record<Complexidade, typeof SignalLow> = {
  Fácil: SignalLow,
  Média: SignalMedium,
  Difícil: SignalHigh,
};

interface TaskCardTarefaLike {
  status: Status;
  data_vencimento: string;
}

export function isAtrasada(t: TaskCardTarefaLike): boolean {
  if (t.status === "Concluído" || !t.data_vencimento) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = new Date(
    t.data_vencimento.length === 10 ? `${t.data_vencimento}T00:00:00` : t.data_vencimento,
  );
  return venc.getTime() < hoje.getTime();
}

export interface TaskCardResponsavel {
  id: string;
  nome: string;
  iniciais: string;
  cor: string;
}

export function AvatarStack({ responsaveis }: { responsaveis: TaskCardResponsavel[] }) {
  if (responsaveis.length === 0) {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
        <User className="h-3 w-3" />
      </div>
    );
  }
  const visiveis = responsaveis.slice(0, 3);
  const extras = responsaveis.length - visiveis.length;
  return (
    <div className="flex -space-x-1.5">
      {visiveis.map((r) => (
        <div
          key={r.id}
          title={r.nome}
          className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-background"
          style={{ backgroundColor: r.cor }}
        >
          {r.iniciais}
        </div>
      ))}
      {extras > 0 && (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground ring-2 ring-background">
          +{extras}
        </div>
      )}
    </div>
  );
}

export interface TaskCardTarefa {
  titulo: string;
  descricao?: string;
  prioridade: Prioridade;
  complexidade: Complexidade;
  status: Status;
  data_vencimento: string;
}

export interface TaskCardCliente {
  nome_empresa: string;
  cor: string;
}

export function TaskCard({
  tarefa,
  cliente,
  responsaveis,
  draggable,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  tarefa: TaskCardTarefa;
  cliente?: TaskCardCliente | null;
  responsaveis: TaskCardResponsavel[];
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onClick?: () => void;
}) {
  const atrasada = isAtrasada(tarefa);
  const PrioIcon = prioridadeIcon[tarefa.prioridade];
  const prioCor = prioridadeCor[tarefa.prioridade];
  const ComplexIcon = complexidadeIcon[tarefa.complexidade];
  const complexCor = complexidadeCor[tarefa.complexidade];

  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={onClick}
      className={cn(
        "task-surface group shrink-0 overflow-hidden rounded-md border border-border p-3 shadow-sm transition-shadow hover:shadow-md",
        draggable && "cursor-grab active:cursor-grabbing",
        onClick && "cursor-pointer",
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
          style={{
            color: prioCor,
            backgroundColor: `color-mix(in oklab, ${prioCor} 16%, transparent)`,
            borderColor: `color-mix(in oklab, ${prioCor} 45%, transparent)`,
          }}
        >
          <PrioIcon className="h-2.5 w-2.5 shrink-0" strokeWidth={2.5} />
          {tarefa.prioridade}
        </span>
        <span
          className="inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
          style={{
            color: complexCor,
            backgroundColor: `color-mix(in oklab, ${complexCor} 16%, transparent)`,
            borderColor: `color-mix(in oklab, ${complexCor} 45%, transparent)`,
          }}
        >
          <ComplexIcon className="h-2.5 w-2.5 shrink-0" strokeWidth={2.5} />
          {tarefa.complexidade}
        </span>
        {atrasada && (
          <span className="inline-flex shrink-0 items-center rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
            Atrasada
          </span>
        )}
      </div>
      <p className="mb-1 break-words text-sm font-medium leading-snug">{tarefa.titulo}</p>
      {cliente && (
        <p className="mb-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: cliente.cor }}
          />
          <span className="min-w-0 truncate">{cliente.nome_empresa}</span>
        </p>
      )}
      {tarefa.descricao && (
        <p className="mb-2.5 truncate text-xs text-muted-foreground">{tarefa.descricao}</p>
      )}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarIcon className="h-3 w-3" />
          {rotuloData(tarefa.data_vencimento)}
        </span>
        <AvatarStack responsaveis={responsaveis} />
      </div>
    </div>
  );
}
