/**
 * Como a arte chega ao grupo como MÍDIA com a mensagem de LEGENDA.
 *
 * Legenda de verdade só existe num lugar: o campo de legenda da tela de anexo
 * do WhatsApp. Nenhuma API web alcança esse campo — nem a Web Share, que só
 * entrega os dados e deixa o app decidir o que fazer com eles.
 *
 * Daí os DOIS caminhos de envio oferecidos na interface, que existem porque
 * têm garantias diferentes — não por indecisão:
 *
 * 1. `compartilharArte` — `navigator.share({ files })` SEM `text`. O WhatsApp
 *    abre direto na tela de anexo, com o campo de legenda vazio e aguardando. A
 *    mensagem já foi para a área de transferência, então é uma colada e envia.
 *    Resultado idêntico em qualquer aparelho: mensagem única, foto com legenda.
 *    Custa um "colar".
 *
 * 2. `compartilharArteComLegenda` — `navigator.share({ files, text })`. Entrega
 *    os dois e deixa o WhatsApp decidir. Quando ele usa o texto como legenda
 *    (comum no Android), sai tudo pronto sem colar nada. Quando não usa, o
 *    texto vira mensagem separada — no Windows, ANTES da foto; no iOS, às vezes
 *    descartado. Por isso a mensagem também vai para a área de transferência
 *    aqui: se a legenda não vier, dá para colar.
 *
 * Requisitos dos dois: contexto seguro (HTTPS), gesto do usuário e suporte a
 * arquivos — Android Chrome, iOS Safari/Chrome 15+, Edge/Chrome no Windows. NÃO
 * funciona no Firefox desktop.
 *
 * Fora isso:
 *
 * - `https://wa.me/?text=...` abre o WhatsApp só com texto. Não envia imagem.
 *   Serve para mandar o link do material, nunca a foto com legenda.
 * - Baixar a arte + copiar a mensagem e anexar à mão é o plano B honesto para
 *   qualquer aparelho sem Web Share de arquivos.
 */

export type ResultadoCompartilhamento = "compartilhado" | "cancelado" | "sem-suporte" | "erro";

/**
 * O navegador consegue compartilhar ESTES arquivos pela folha do sistema?
 *
 * Pergunta pelo conjunto inteiro, porque o suporte a vários arquivos de uma vez
 * é mais restrito do que a um só: há navegador que aceita uma imagem e recusa
 * um álbum. `compartilharArte` usa o retorno para cair no plano B quando for o
 * caso, em vez de enviar só parte da galeria.
 */
export function suportaCompartilharArquivo(files: File[]): boolean {
  if (typeof navigator === "undefined") return false;
  if (files.length === 0) return false;
  if (typeof navigator.share !== "function") return false;
  if (typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

/** Detecção sem ter o arquivo em mãos — para decidir o rótulo do botão antes do clique. */
export function podeTerCompartilhamentoDeArquivo(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.share === "function" && typeof navigator.canShare === "function";
}

/** Baixa a arte do bucket/endpoint e devolve um File pronto pro compartilhamento. */
export async function baixarComoArquivo(
  url: string,
  nomeArquivo: string,
  tipo: string,
): Promise<File> {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error("Não foi possível carregar a imagem.");
  const blob = await resposta.blob();
  return new File([blob], nomeArquivo, { type: blob.type || tipo });
}

/** Salva o arquivo no aparelho. */
export function salvarArquivo(file: File | Blob, nomeArquivo: string): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revogar de imediato cancela o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Copia texto preservando acentos, emojis e quebras de linha. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cai no plano B abaixo */
  }
  // Plano B para contextos sem permissão de clipboard (http, webviews antigas).
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Entrega a arte ao WhatsApp como mídia, e SÓ a arte: assim ele abre na tela de
 * anexo com o campo de legenda esperando a colagem (ver o cabeçalho deste
 * arquivo). Devolve "sem-suporte" quando o aparelho não aceita arquivos — aí a
 * interface oferece o fluxo manual.
 *
 * `title` não vai junto de propósito: alguns alvos de compartilhamento o tratam
 * como texto e o transformam numa mensagem separada, que é justamente o que
 * estamos evitando.
 */
export async function compartilharArte(opcoes: {
  files: File[];
}): Promise<ResultadoCompartilhamento> {
  const { files } = opcoes;
  if (!suportaCompartilharArquivo(files)) return "sem-suporte";
  try {
    // Várias artes vão de uma vez: o WhatsApp monta um álbum, com um único
    // campo de legenda para o conjunto.
    await navigator.share({ files });
    return "compartilhado";
  } catch (e) {
    // AbortError = a pessoa fechou a folha de compartilhamento.
    if (e instanceof DOMException && e.name === "AbortError") return "cancelado";
    return "erro";
  }
}

/**
 * Entrega a arte E a mensagem na mesma folha de compartilhamento, deixando o
 * WhatsApp decidir se o texto vira legenda ou mensagem separada (ver o cabeçalho
 * deste arquivo). Sem colar nada quando dá certo; sem garantia de formato.
 */
export async function compartilharArteComLegenda(opcoes: {
  files: File[];
  mensagem: string;
}): Promise<ResultadoCompartilhamento> {
  const { files, mensagem } = opcoes;
  if (!suportaCompartilharArquivo(files)) return "sem-suporte";
  try {
    // Sem `title`: vários alvos o tratam como mais um texto e acabam gerando
    // uma terceira mensagem.
    await navigator.share({ files, text: mensagem });
    return "compartilhado";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "cancelado";
    return "erro";
  }
}

/** Abre o WhatsApp com um texto. Útil pro link do material — nunca para a arte. */
export function abrirWhatsAppComTexto(texto: string): void {
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
}
