import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Calendar, Download, FileText, Inbox, Loader2, Mic, Palette, Video } from "lucide-react";
import { listMinhasDemandas } from "@/lib/demandas.functions";
import { linksArteAprovada } from "@/lib/arte.functions";
import { rotuloTipo } from "@/lib/arte/tipos";
import { Button } from "@/components/ui/button";
import { dataCurta, statusPillStyle, type Status } from "@/lib/mock-data";

type MinhaDemanda = Awaited<ReturnType<typeof listMinhasDemandas>>[number];

/**
 * Rótulo de "quando foi enviada" com base no dia-calendário (não na fração do
 * dia já passada) — evita marcar um envio de hoje à noite como "Amanhã".
 *
 * Acima de uma semana usamos a data cheia ("em 27/08/2026") em vez de "27 de
 * ago": o formato abreviado foi lido por solicitantes como "há 27 anos".
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
  return `em ${d.toLocaleDateString("pt-BR")}`;
} 
const ARTE_BADGE: Record<string, { backgroundColor: string; color: string }> = {
  "Em análise": { backgroundColor: "#F59E0B", color: "#fff" },
  "Em produção": { backgroundColor: "#3B82F6", color: "#fff" },
  Concluída: { backgroundColor: "#10B981", color: "#fff" },
  Recusada: { backgroundColor: "#EF4444", color: "#fff" },
  Cancelada: { backgroundColor: "#6B7280", color: "#fff" },
};

function badgeFor(d: MinhaDemanda): {
  label: string;
  style: { backgroundColor: string; color: string };
} {
  // Arte: o status vem do art_request (as etapas internas aparecem todas
  // como "Em produção"), nunca da tarefa.
  if (d.arte) {
    const label = d.arte.status_solicitante;
    return { label, style: ARTE_BADGE[label] ?? ARTE_BADGE["Em análise"] };
  }
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

/** Download da arte aprovada. Os links (5 min) são pedidos ao servidor só no
 * clique: ele confere dono e status 'concluida' antes de assinar. */
function BaixarArte({ demandaId }: { demandaId: string }) {
  const linksFn = useServerFn(linksArteAprovada);
  const [links, setLinks] = useState<Array<{ nome: string; url: string }> | null>(null);
  const [carregando, setCarregando] = useState(false);

  const baixar = async () => {
    setCarregando(true);
    try {
      const r = await linksFn({ data: { demanda_id: demandaId } });
      if (r.length === 1) {
        window.location.href = r[0].url;
      } else {
        setLinks(r);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível baixar a arte.");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="space-y-2 pt-1">
      <Button size="sm" onClick={baixar} disabled={carregando}>
        {carregando ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-1.5 h-4 w-4" />
        )}
        Baixar arte
      </Button>
      {links && (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.nome}>
              <a
                href={l.url}
                className="flex items-center gap-2 rounded-md border border-border bg-gray-50 px-3 py-2 text-sm text-black hover:bg-gray-100"
              >
                <Download className="h-4 w-4 text-gray-500" />
                <span className="truncate">{l.nome}</span>
              </a>
            </li>
          ))}
          <li className="text-[11px] text-gray-500">Os links valem por 5 minutos.</li>
        </ul>
      )}
    </div>
  );
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
                Prazo sugerido: {dataCurta(d.prazo_sugerido)}
              </div>
            )}

            {d.arte ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Palette className="h-4 w-4 text-gray-500" />
                  <span className="font-semibold text-black">{rotuloTipo(d.arte.tipo)}</span>
                  {d.arte.projeto_nome && (
                    <span className="text-gray-600">• {d.arte.projeto_nome}</span>
                  )}
                </div>
                <dl className="grid gap-x-4 gap-y-1 text-xs text-gray-700 sm:grid-cols-2">
                  {d.arte.detalhes.map((c) => (
                    <div key={c.rotulo} className="min-w-0">
                      <dt className="inline font-medium text-gray-500">{c.rotulo}: </dt>
                      <dd className="inline break-words">{c.valor}</dd>
                    </div>
                  ))}
                </dl>
                {d.arte.briefing && (
                  <p className="whitespace-pre-wrap text-sm text-black">{d.arte.briefing}</p>
                )}
                {d.arte.status_solicitante === "Em produção" && (
                  <p className="text-xs text-gray-500">
                    A arte fica disponível aqui depois de aprovada pela equipe.
                  </p>
                )}
                {d.arte.status_solicitante === "Concluída" && <BaixarArte demandaId={d.id} />}
                {d.arte.arquivos.length > 0 && (
                  <ul className="space-y-1 pt-1">
                    {d.arte.arquivos.map((a, i) => (
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
                )}
              </div>
            ) : (
              <p className="mt-3 whitespace-pre-wrap text-sm text-black">{d.descricao}</p>
            )}

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
