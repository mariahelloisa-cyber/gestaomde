import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { PainelPublicoView } from "@/components/dashboard/PainelPublicoView";
import { getPainelPublicoData } from "@/lib/painel-publico.functions";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/painel-publico/$token")({
  head: () => ({
    meta: [
      { title: "Painel público" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PainelPublicoPage,
});

function PainelPublicoPage() {
  const { token } = Route.useParams();
  const fetchFn = useServerFn(getPainelPublicoData);

  const { data, isLoading, error } = useQuery({
    queryKey: ["painel-publico", token],
    queryFn: () => fetchFn({ data: { token } }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-8 p-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Link inválido ou expirado.</p>
      </div>
    );
  }

  return <PainelPublicoView data={data} />;
}
