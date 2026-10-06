import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { CategoriaArquivo } from "./arte/tipos";

/* Helpers só de servidor do módulo de artes. Tudo que toca storage usa
 * service role: os buckets de arte não têm policy nenhuma (Fase 1), então o
 * único caminho é URL assinada emitida aqui depois da checagem de permissão. */

export const BUCKET_ARQUIVOS = "art-request-files";

/** Mesma regra das policies (eh_equipe_interna: Admin/Membro/Supervisor ATIVO),
 * chamada no banco para não duplicar a definição em TypeScript. */
export async function exigirEquipeInterna(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("eh_equipe_interna", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Apenas a equipe interna pode fazer isso.");
}

const EXTENSAO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Formato imposto pelo trigger de art_request_files. */
export function pathArquivo(
  solicitanteId: string,
  artRequestId: string,
  categoria: CategoriaArquivo,
  mime: string,
): string {
  return `${solicitanteId}/${artRequestId}/${categoria}/${crypto.randomUUID()}.${EXTENSAO[mime] ?? "bin"}`;
}

export async function removerObjetos(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabaseAdmin.storage.from(BUCKET_ARQUIVOS).remove(paths);
  if (error) console.error("[arte] falha ao remover objetos do storage", error);
}

/** URLs de leitura de curta duração (1h), no mesmo padrão de demandas-anexos. */
export async function assinarLeitura(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_ARQUIVOS)
    .createSignedUrls(paths, 60 * 60);
  if (error) throw new Error(error.message);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
  }
  return out;
}

function confereAssinatura(mime: string, b: Uint8Array): boolean {
  if (mime === "image/jpeg")
    return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === "image/png") {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return b.length >= 8 && sig.every((v, i) => b[i] === v);
  }
  if (mime === "image/webp") {
    const ascii = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
    return b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
  }
  return false;
}

/** Lê só os primeiros bytes do objeto (Range) para conferir o tipo real.
 * O allowed_mime_types do bucket confere apenas o content-type DECLARADO. */
async function primeirosBytes(path: string): Promise<Uint8Array> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_ARQUIVOS)
    .createSignedUrl(path, 60);
  if (error || !data) throw new Error(error?.message ?? "Falha ao ler o arquivo enviado.");
  const res = await fetch(data.signedUrl, { headers: { Range: "bytes=0-15" } });
  if (!res.ok || !res.body) throw new Error("Falha ao ler o arquivo enviado.");
  // Se o servidor ignorar o Range, lê só o primeiro pedaço e cancela o resto.
  const reader = res.body.getReader();
  const { value } = await reader.read();
  await reader.cancel().catch(() => {});
  return value ?? new Uint8Array();
}

/** Confere que o objeto existe, respeita o limite e é mesmo do tipo declarado.
 * Devolve o tamanho real em bytes. */
export async function verificarObjeto(
  path: string,
  mimeDeclarado: string,
  tamanhoMax: number,
): Promise<number> {
  const { data: info, error } = await supabaseAdmin.storage.from(BUCKET_ARQUIVOS).info(path);
  if (error || !info) throw new Error("Um dos arquivos não chegou. Tente enviar de novo.");
  const tamanho = info.size ?? 0;
  if (tamanho <= 0 || tamanho > tamanhoMax)
    throw new Error("Um dos arquivos passa do tamanho permitido.");
  const bytes = await primeirosBytes(path);
  if (!confereAssinatura(mimeDeclarado, bytes)) {
    throw new Error("Um dos arquivos não é uma imagem JPG, PNG ou WebP válida.");
  }
  return tamanho;
}
