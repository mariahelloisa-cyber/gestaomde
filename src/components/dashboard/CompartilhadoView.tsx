import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Bell,
  Calendar as CalendarIcon,
  Check,
  Clock,
  Eye,
  FolderKanban,
  ListChecks,
  Lock,
  MessageSquare,
  Mic,
  Paperclip,
  Video,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  statusCor,
  statusPillStyle,
  prioridadeOrdem,
  prioridadePillStyle,
  complexidadePillStyle,
  rotuloData,
  type Status,
} from "@/lib/mock-data";
import { TaskCard, isAtrasada } from "./task-card";
import type { CompartilhadoPayload, CompartilhadoTarefa } from "@/lib/compartilhamento.functions";

const colunaIcon: Record<Status, typeof Clock> = {
  Pendente: Clock,
  "Em Progresso": Clock,
  "Em Análise": Eye,
  Concluído: Check,
};

/** Página de um link compartilhado: uma tarefa ou uma coluna inteira do Kanban,
 * somente leitura, sem nenhuma ação de edição. */
export function CompartilhadoView({ data }: { data: CompartilhadoPayload }) {
  const [tarefaAberta, setTarefaAberta] = useState<CompartilhadoTarefa | null>(null);
  const tarefaUnica = data.tipo === "tarefa" ? (data.tarefas[0] ?? null) : null;
  const cor = data.status ? statusCor[data.status] : "var(--primary)";
  const Icon = data.status ? colunaIcon[data.status] : Clock;

  const lista = [...data.tarefas].sort(
    (a, b) => prioridadeOrdem[a.prioridade] - prioridadeOrdem[b.prioridade],
  );

  return (
    <div className="flex min-h-screen flex-col bg-[var(--surface-1)]">
      <header className="border-b border-border bg-background px-5 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-foreground">{data.titulo}</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Somente leitura
              </span>
              {data.subtitulo && <span>· {data.subtitulo}</span>}
              {data.tipo === "coluna" && (
                <span>
                  · {lista.length} {lista.length === 1 ? "tarefa" : "tarefas"}
                </span>
              )}
              {data.expira_em && (
                <span>
                  · Link válido até{" "}
                  {format(new Date(data.expira_em), "dd/MM/yyyy", { locale: ptBR })}
                </span>
              )}
            </p>
          </div>
          {data.status && (
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
              style={statusPillStyle(data.status)}
            >
              <Icon className="h-3 w-3" strokeWidth={2.5} />
              {data.status}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 p-5">
        {tarefaUnica ? (
          <div className="rounded-xl border border-border bg-background p-5 shadow-sm">
            <DetalheTarefa tarefa={tarefaUnica} />
          </div>
        ) : lista.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-sm text-muted-foreground">
            <Icon className="h-6 w-6 opacity-40" />
            Nenhuma tarefa nesta etapa no momento.
          </div>
        ) : (
          <div
            className="overflow-hidden rounded-xl border border-border bg-[var(--surface-2)]"
            style={{ borderTop: `3px solid ${cor}` }}
          >
            <div className="flex flex-col gap-2 p-3">
              {lista.map((t) => (
                <TaskCard
                  key={t.id}
                  tarefa={t}
                  cliente={t.cliente}
                  responsaveis={t.responsaveis}
                  onClick={() => setTarefaAberta(t)}
                />
              ))}
            </div>
            <p className="border-t border-border px-4 py-2.5 text-center text-xs text-muted-foreground">
              Toque em uma tarefa para ver os detalhes
            </p>
          </div>
        )}
      </main>

      {tarefaAberta && (
        <Dialog open onOpenChange={(o) => !o && setTarefaAberta(null)}>
          <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
            <DialogTitle className="sr-only">{tarefaAberta.titulo}</DialogTitle>
            <DetalheTarefa tarefa={tarefaAberta} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function DetalheTarefa({ tarefa }: { tarefa: CompartilhadoTarefa }) {
  const atrasada = isAtrasada(tarefa);
  const feitos = tarefa.checklist.filter((i) => i.concluido).length;
  const progresso =
    tarefa.checklist.length > 0 ? Math.round((feitos / tarefa.checklist.length) * 100) : 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="pr-6 text-xl font-semibold leading-snug text-foreground">{tarefa.titulo}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {tarefa.tipo === "lembrete" ? (
            <span
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "#8B5CF6", backgroundColor: "#8B5CF61F" }}
            >
              <Bell className="h-3 w-3" />
              Lembrete
            </span>
          ) : (
            <>
              <span
                className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
                style={statusPillStyle(tarefa.status)}
              >
                {tarefa.status}
              </span>
              <span
                className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
                style={prioridadePillStyle(tarefa.prioridade)}
              >
                {tarefa.prioridade}
              </span>
              <span
                className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
                style={complexidadePillStyle(tarefa.complexidade)}
              >
                {tarefa.complexidade}
              </span>
            </>
          )}
          {atrasada && tarefa.tipo !== "lembrete" && (
            <span className="inline-flex items-center rounded-full bg-destructive/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">
              Atrasada
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        {tarefa.cliente && (
          <span className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: tarefa.cliente.cor }}
            />
            {tarefa.cliente.nome_empresa}
          </span>
        )}
        {tarefa.projeto && (
          <span className="flex items-center gap-1.5">
            <FolderKanban className="h-3.5 w-3.5" />
            {tarefa.projeto}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <CalendarIcon className="h-3.5 w-3.5" />
          {tarefa.data_vencimento ? rotuloData(tarefa.data_vencimento) : "Sem data"}
        </span>
      </div>

      {tarefa.descricao && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {tarefa.descricao}
        </p>
      )}

      {tarefa.tipo !== "lembrete" && (
        <Bloco titulo="Responsáveis">
          {tarefa.responsaveis.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum responsável atribuído.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tarefa.responsaveis.map((r) => (
                <span
                  key={r.id}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1 text-xs"
                >
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                    style={{ backgroundColor: r.cor }}
                  >
                    {r.iniciais}
                  </span>
                  {r.nome}
                </span>
              ))}
            </div>
          )}
        </Bloco>
      )}

      {tarefa.checklist.length > 0 && (
        <Bloco titulo="Checklist" icone={ListChecks} extra={`${feitos}/${tarefa.checklist.length}`}>
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${progresso}%` }} />
          </div>
          <ul className="flex flex-col gap-1.5">
            {tarefa.checklist.map((i) => (
              <li key={i.id} className="flex items-start gap-2 text-sm">
                <span
                  className={
                    i.concluido
                      ? "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-primary bg-primary text-primary-foreground"
                      : "mt-0.5 h-4 w-4 shrink-0 rounded border border-border"
                  }
                >
                  {i.concluido && <Check className="h-3 w-3" />}
                </span>
                <span className={i.concluido ? "text-muted-foreground line-through" : ""}>
                  {i.texto}
                </span>
              </li>
            ))}
          </ul>
        </Bloco>
      )}

      {tarefa.audio?.url && (
        <Bloco titulo="Áudio" icone={Mic}>
          <audio controls src={tarefa.audio.url} className="w-full" />
        </Bloco>
      )}

      {tarefa.video?.url && (
        <Bloco titulo="Vídeo" icone={Video}>
          <video controls src={tarefa.video.url} className="max-h-80 w-full rounded" />
        </Bloco>
      )}

      {tarefa.anexos.length > 0 && (
        <Bloco titulo="Anexos" icone={Paperclip}>
          <ul className="flex flex-col gap-1">
            {tarefa.anexos.map((a, i) =>
              a.url ? (
                <li key={`${a.nome_arquivo}-${i}`}>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-sm text-primary underline-offset-2 hover:underline"
                  >
                    {a.nome_arquivo}
                  </a>
                </li>
              ) : (
                <li
                  key={`${a.nome_arquivo}-${i}`}
                  className="truncate text-sm text-muted-foreground"
                >
                  {a.nome_arquivo}
                </li>
              ),
            )}
          </ul>
        </Bloco>
      )}

      {tarefa.comentarios.length > 0 && (
        <Bloco titulo="Comentários" icone={MessageSquare} extra={String(tarefa.comentarios.length)}>
          <div className="flex flex-col gap-3">
            {tarefa.comentarios.map((c) => (
              <div key={c.id} className="flex gap-2.5">
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  style={{ backgroundColor: c.autor.cor }}
                >
                  {c.autor.iniciais}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-foreground">{c.autor.nome}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {format(new Date(c.criado_em), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">
                    {c.conteudo}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Bloco>
      )}
    </div>
  );
}

function Bloco({
  titulo,
  icone: Icone,
  extra,
  children,
}: {
  titulo: string;
  icone?: typeof ListChecks;
  extra?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {Icone && <Icone className="h-3.5 w-3.5" />}
        {titulo}
        {extra && <span className="normal-case tracking-normal opacity-80">({extra})</span>}
      </h3>
      {children}
    </div>
  );
}
