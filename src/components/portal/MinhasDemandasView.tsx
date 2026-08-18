import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Calendar, FileText, Inbox, Mic, Video } from "lucide-react";
import { listMinhasDemandas } from "@/lib/demandas.functions";
import { statusPillStyle, type Status } from "@/lib/mock-data";

type MinhaDemanda = Awaited<ReturnType<typeof listMinhasDemandas>>[number];

/**
 * Rótulo de "quando foi enviada" com base no dia-calendário (não na fração do
 * dia já passada) — evita marcar um envio de hoje à noite como "Amanhã".
 */
function rotuloEnviada(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const hoje = new Date();
  const dMeiaNoite = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const hojeMeiaNoite = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const diffDias = Math.round((dMeiaNoite.getTime() - hojeMeiaNoite.getTime()) / 86400000);
  if (diffDias === 0) return "hoje";
  if (diffDias === -1) return "ontem";
  if (diffDias > -7 && diffDias < 0) return `há ${-diffDias} dias`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

function badgeFor(d: MinhaDemanda): {
  label: string;
  style: { backgroundColor: string; color: string };
} {
  if (d.status === "recusada") {
    return { label: "Recusada", style: { backgroundColor: "#EF4444", color: "#fff" } };
  }
  if (d.status === "aceita") {
    if (d.tarefa_status) {
      return { label: d.tarefa_status, style: statusPillStyle(d.tarefa_status as Status) };
    }
    return { label: "Aceita", style: { backgroundColor: "#3B82F6", color: "#fff" } };
  }
  // "pendente" ou "transferida": ainda não foi triada pela equipe.
  return { label: "Em análise", style: { backgroundColor: "#F59E0B", color: "#fff" } };
}

export function MinhasDemandasView() {
  const fetchFn = useServerFn(listMinhasDemandas);
  const { data: demandas = [], isLoading } = useQuery({
    queryKey: ["minhas-demandas"],
    queryFn: () => fetchFn(),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-white p-8 text-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  if (demandas.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-white p-12 text-center">
        <Inbox className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Você ainda não enviou nenhuma demanda.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {demandas.map((d) => {
        const badge = badgeFor(d);
        return (
          <div
            key={d.id}
            className="rounded-lg border border-border bg-white p-5 text-black shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
                style={badge.style}
              >
                {badge.label}
              </span>
              <span className="text-xs text-gray-500">Enviada {rotuloEnviada(d.criado_em)}</span>
            </div>

            {d.prazo_sugerido && (
              <div className="mt-2 flex items-center gap-1 text-xs text-gray-600">
                <Calendar className="h-3 w-3" />
                Prazo sugerido: {new Date(d.prazo_sugerido).toLocaleDateString("pt-BR")}
              </div>
            )}

            <p className="mt-3 whitespace-pre-wrap text-sm text-black">{d.descricao}</p>

            {d.status === "recusada" && d.justificativa_recusa && (
              <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                Motivo da recusa: {d.justificativa_recusa}
              </p>
            )}

            {d.audio && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-gray-50 px-3 py-2">
                <Mic className="h-4 w-4 shrink-0 text-gray-500" />
                <audio controls src={d.audio.url ?? undefined} className="h-9 min-w-0 flex-1" />
              </div>
            )}

            {d.video && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-gray-50 px-3 py-2">
                <Video className="h-4 w-4 shrink-0 text-gray-500" />
                <video
                  controls
                  src={d.video.url ?? undefined}
                  className="max-h-64 min-w-0 flex-1 rounded"
                />
              </div>
            )}

            {d.anexos.length > 0 && (
              <div className="mt-4 space-y-1">
                <div className="text-xs font-medium text-gray-600">Anexos</div>
                <ul className="space-y-1">
                  {d.anexos.map((a, i) => (
                    <li key={i}>
                      <a
                        href={a.url ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-md border border-border bg-gray-50 px-3 py-2 text-sm text-black hover:bg-gray-100"
                      >
                        <FileText className="h-4 w-4 text-gray-500" />
                        <span className="truncate">{a.nome_arquivo}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
