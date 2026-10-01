import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BUCKET_ANIVERSARIANTES } from "@/lib/aniversariantes";
import { resolverLinkAniversariante } from "@/lib/aniversariantes.server";
import { lerImagens } from "@/lib/aniversariantes.functions";

/**
 * Serve a arte de um link compartilhado de aniversariante.
 *
 * O bucket é privado, então nem a página pública nem o WhatsApp conseguem ler o
 * objeto direto. Este endpoint é o único caminho: valida o token opaco (o mesmo
 * de public.compartilhamentos, com revogação e expiração) e devolve os bytes.
 *
 * Diferente de uma signed URL, é um endereço ESTÁVEL — serve de og:image na
 * prévia do link e continua funcionando quando a pessoa abre a página semanas
 * depois. Revogar o compartilhamento derruba a imagem junto.
 */
export const Route = createFileRoute("/api/public/aniversariante-imagem/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const token = params.token;
        // O token é um uuid; qualquer outra coisa nem chega ao banco.
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
          return new Response("Not found", { status: 404 });
        }

        // ?i=N escolhe a arte dentro da galeria; sem o parâmetro, a capa.
        const indice = Number(new URL(request.url).searchParams.get("i") ?? "0");
        if (!Number.isInteger(indice) || indice < 0) {
          return new Response("Not found", { status: 404 });
        }

        const link = await resolverLinkAniversariante(token);
        if (!link) return new Response("Not found", { status: 404 });

        const { data: aniversariante } = await supabaseAdmin
          .from("aniversariantes")
          .select("imagens")
          .eq("id", link.aniversarianteId)
          .maybeSingle();
        if (!aniversariante) return new Response("Not found", { status: 404 });

        const imagem = lerImagens(aniversariante.imagens)[indice];
        if (!imagem) return new Response("Not found", { status: 404 });

        const { data: arquivo, error } = await supabaseAdmin.storage
          .from(BUCKET_ANIVERSARIANTES)
          .download(imagem.path);
        if (error || !arquivo) return new Response("Not found", { status: 404 });

        return new Response(arquivo, {
          headers: {
            "content-type": imagem.tipo || "image/jpeg",
            // Cache curto: o link pode ser revogado a qualquer momento.
            "cache-control": "public, max-age=300",
            "x-robots-tag": "noindex, nofollow",
          },
        });
      },
    },
  },
});
