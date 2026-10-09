import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dimensoesDoCabecalho } from "./arte-referencias-ia.server";

/* Normalização da arte gerada para o tamanho EXATO de entrega.
 *
 * A OpenAI só gera lados múltiplos de 16 e proporção até 3:1, então a bruta
 * sai um pouco maior que o pedido (ex.: 1088x1440 para 1080x1440). Quem
 * reduz e corta é a transformação de imagem do Supabase Storage (resize
 * "cover", corte central, PNG de volta com format "origin"), por URL
 * assinada do bucket privado.
 *
 * Por que não no Worker: decodificar, redimensionar e recodificar duas PNGs em
 * JS estourou o limite do Worker em produção (2026-10-09): o processo morria
 * na segunda variação, depois de a OpenAI já ter cobrado. Aqui o Worker só
 * baixa bytes prontos e lê o cabeçalho.
 *
 * Limites da transformação (docs do Supabase, conferidos em 2026-10-09):
 * plano Pro ou acima; lado de saída de 1 a 2500 px; origem até 25 MB e 50 MP;
 * NÃO amplia (pedir maior que a origem devolve o tamanho da origem) — por isso
 * tamanhoDeGeracao gera sempre cobrindo o tamanho de entrega, e o resultado é
 * conferido aqui. Custo: 100 imagens de origem por ciclo no Pro, depois
 * US$ 5 por 1.000. */

const TIMEOUT_MS = 60_000;

export async function normalizarNoStorage(
  bucket: string,
  path: string,
  largura: number,
  altura: number,
): Promise<Uint8Array<ArrayBuffer>> {
  let ultimoErro = "";
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 120, {
      transform: { width: largura, height: altura, resize: "cover", format: "origin" },
    });
    if (error || !data) {
      ultimoErro = error?.message ?? "sem URL";
      continue;
    }
    try {
      const resp = await fetch(data.signedUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!resp.ok) {
        ultimoErro = `HTTP ${resp.status}`;
        continue;
      }
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const dims = dimensoesDoCabecalho(bytes);
      const ehPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e;
      if (!ehPng || !dims) {
        ultimoErro = "a transformação não devolveu PNG";
        continue;
      }
      if (dims.largura !== largura || dims.altura !== altura) {
        // Não é falha passageira (ex.: origem menor que o pedido): não repete.
        throw new Error(
          `a transformação devolveu ${dims.largura}×${dims.altura} em vez de ${largura}×${altura}`,
        );
      }
      return bytes;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("a transformação devolveu")) {
        throw new Error(`Falha ao ajustar o tamanho final: ${e.message}.`);
      }
      ultimoErro = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`Falha ao ajustar o tamanho final da arte: ${ultimoErro}.`);
}
