import { createFileRoute } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { AniversariantePublicoView } from "@/components/dashboard/AniversariantePublicoView";
import { getAniversarianteCompartilhado } from "@/lib/aniversariantes.functions";

/**
 * Página pública do material de um aniversariante.
 *
 * Usa `loader` (e não só useQuery como as outras páginas de link) porque a
 * prévia do WhatsApp lê og:title/og:image do HTML renderizado no servidor — com
 * busca só no cliente, os metadados chegariam vazios. A prévia é um extra: ela
 * mostra a arte no cartãozinho do link, mas NÃO equivale a enviar a foto com
 * legenda, que acontece pelos botões de envio do material.
 */
export const Route = createFileRoute("/aniversariante/$token")({
  loader: ({ params }) => getAniversarianteCompartilhado({ data: { token: params.token } }),
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Material de aniversário" },
          { name: "robots", content: "noindex, nofollow" },
        ],
      };
    }
    const titulo = `Aniversário de ${loaderData.nome}`;
    // Primeira linha da mensagem como descrição: sem vazar o texto inteiro no cartão.
    const descricao = loaderData.mensagem.split("\n").find((l) => l.trim().length > 0) ?? titulo;
    return {
      meta: [
        { title: titulo },
        { name: "robots", content: "noindex, nofollow" },
        { name: "description", content: descricao },
        { property: "og:type", content: "article" },
        { property: "og:title", content: titulo },
        { property: "og:description", content: descricao },
        { property: "og:image", content: loaderData.capa_url_absoluta },
        { property: "og:image:alt", content: `Arte de aniversário de ${loaderData.nome}` },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: titulo },
        { name: "twitter:description", content: descricao },
        { name: "twitter:image", content: loaderData.capa_url_absoluta },
      ],
    };
  },
  errorComponent: LinkInvalido,
  component: AniversariantePublicoPage,
});

function LinkInvalido() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
      <Lock className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">Link inválido, revogado ou expirado.</p>
      <p className="text-xs text-muted-foreground">
        Peça um link novo a quem compartilhou este material.
      </p>
    </div>
  );
}

function AniversariantePublicoPage() {
  const data = Route.useLoaderData();
  return <AniversariantePublicoView data={data} />;
}
