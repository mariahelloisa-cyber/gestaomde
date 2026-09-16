import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { CompartilhadoView } from "@/components/dashboard/CompartilhadoView";
import { getCompartilhamento } from "@/lib/compartilhamento.functions";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/compartilhado/$token")({
  head: () => ({
    meta: [{ title: "Tarefa compartilhada" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: CompartilhadoPage,
});

function CompartilhadoPage() {
  const { token } = Route.useParams();
  const fetchFn = useServerFn(getCompartilhamento);

  const { data, isLoading, error } = useQuery({
    queryKey: ["compartilhado", token],
    queryFn: () => fetchFn({ data: { token } }),
    refetchInterval: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
        <Lock className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          {error instanceof Error && error.message.includes("expirou")
            ? "Este link expirou."
            : "Link inválido ou revogado."}
        </p>
        <p className="text-xs text-muted-foreground">
          Peça um novo link a quem compartilhou esta tarefa.
        </p>
      </div>
    );
  }

  return <CompartilhadoView data={data} />;
}
