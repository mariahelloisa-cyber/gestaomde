import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Cake,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  Loader2,
  Share2,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { dataPorExtenso } from "@/lib/aniversariantes";
import {
  abrirWhatsAppComTexto,
  baixarComoArquivo,
  compartilharArte,
  compartilharArteComLegenda,
  copiarTexto,
  podeTerCompartilhamentoDeArquivo,
  salvarArquivo,
} from "@/lib/aniversariantes-share";
import { cn } from "@/lib/utils";

export interface MaterialAniversariante {
  nome: string;
  /** "YYYY-MM-DD" */
  data_comemoracao: string;
  mensagem: string;
  /** Em ordem; a primeira é a capa. Sempre com pelo menos um item. */
  imagens: { url: string | null; nome: string; tipo: string }[];
}

/**
 * Nomes de arquivo previsíveis pra quem vai anexar à mão no WhatsApp. Com mais
 * de uma arte, entra o sufixo -1, -2… na ordem da galeria, para a pasta de
 * downloads ficar na mesma sequência da tela.
 */
function nomesDeArquivo(material: MaterialAniversariante): string[] {
  const base =
    material.nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "aniversariante";
  const varias = material.imagens.length > 1;
  return material.imagens.map((img, i) => {
    const extensao = (img.nome.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".jpg").toLowerCase();
    const sufixo = varias ? `-${i + 1}` : "";
    return `${base}-${material.data_comemoracao}${sufixo}${extensao}`;
  });
}

/**
 * Artes em destaque, mensagem completa e as ações de envio. O mesmo componente
 * serve dentro do sistema e na página pública do link; o que muda é só o
 * `rodape`, onde a versão interna encaixa o status de publicação.
 *
 * O link do material não é gerado aqui: quem cuida disso é o ShareDialog, pelo
 * ícone de compartilhar na lista, que também controla validade e revogação.
 */
export function AniversarianteMaterial({
  material,
  rodape,
}: {
  material: MaterialAniversariante;
  rodape?: React.ReactNode;
}) {
  const [copiandoMensagem, setCopiandoMensagem] = useState(false);
  /** Qual dos dois envios está em andamento — null quando nenhum. */
  const [compartilhando, setCompartilhando] = useState<"so-arte" | "com-legenda" | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [mostrarManual, setMostrarManual] = useState(false);
  const [mensagemCopiada, setMensagemCopiada] = useState(false);
  const [imagemBaixada, setImagemBaixada] = useState(false);

  /** Todas as artes já baixadas, na ordem da galeria. */
  const [arquivosProntos, setArquivosProntos] = useState<File[] | null>(null);
  const [erroPreparo, setErroPreparo] = useState(false);

  const arquivos = nomesDeArquivo(material);
  const talvezCompartilhe = podeTerCompartilhamentoDeArquivo();
  const temImagem = material.imagens.some((i) => i.url);

  // Baixa as artes assim que o material abre, para que o clique em "Enviar"
  // possa chamar navigator.share sem nenhum await antes (ver comentário abaixo).
  // A chave serializada evita refazer o download a cada render.
  const chaveImagens = material.imagens.map((i) => i.url ?? "").join("|");
  useEffect(() => {
    const urls = chaveImagens.split("|");
    if (urls.every((u) => !u)) return;
    let cancelado = false;
    setArquivosProntos(null);
    setErroPreparo(false);
    Promise.all(
      material.imagens.map((img, i) =>
        img.url
          ? baixarComoArquivo(img.url, arquivos[i], img.tipo)
          : Promise.reject(new Error("sem url")),
      ),
    )
      .then((files) => {
        if (!cancelado) setArquivosProntos(files);
      })
      .catch(() => {
        if (!cancelado) setErroPreparo(true);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveImagens]);

  const copiarMensagem = async () => {
    setCopiandoMensagem(true);
    const ok = await copiarTexto(material.mensagem);
    setCopiandoMensagem(false);
    if (ok) {
      setMensagemCopiada(true);
      toast.success("Mensagem copiada com acentos, emojis e quebras de linha.");
      setTimeout(() => setMensagemCopiada(false), 2500);
    } else {
      toast.error("Não foi possível copiar. Selecione o texto da mensagem e copie à mão.");
    }
  };

  /** Salva uma arte específica, ou todas quando `indice` não vem. */
  const baixarImagem = async (indice?: number) => {
    if (!temImagem) return;
    setBaixando(true);
    try {
      const alvos = indice === undefined ? material.imagens.map((_, i) => i) : [indice];
      for (const i of alvos) {
        const img = material.imagens[i];
        if (!img?.url) continue;
        // Reaproveita o que já foi preparado para o compartilhamento.
        const file =
          arquivosProntos?.[i] ?? (await baixarComoArquivo(img.url, arquivos[i], img.tipo));
        salvarArquivo(file, arquivos[i]);
      }
      setImagemBaixada(true);
      toast.success(
        alvos.length === 1
          ? `Arte salva como "${arquivos[alvos[0]]}".`
          : `${alvos.length} artes salvas.`,
      );
      setTimeout(() => setImagemBaixada(false), 4000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao baixar a arte.");
    } finally {
      setBaixando(false);
    }
  };

  /**
   * Os dois envios, que diferem só em entregar o texto junto ou não (ver o
   * cabeçalho de aniversariantes-share).
   *
   * Duas sutilezas que a ordem das chamadas aqui resolve, e que valem para os
   * dois modos:
   *
   * - A cópia vem primeiro porque `clipboard.writeText` exige que o documento
   *   esteja focado, e a folha de compartilhamento rouba o foco assim que abre.
   *   Mesmo no modo "com legenda" a cópia é feita: se o WhatsApp mandar o texto
   *   separado, dá para refazer colando.
   * - Nenhuma delas é aguardada antes do share: o Safari do iPhone exige que
   *   `navigator.share` seja chamado ainda dentro da ativação do toque, e
   *   qualquer `await` no meio derruba a permissão (NotAllowedError). Pelo mesmo
   *   motivo o arquivo é baixado quando o material abre, não no clique.
   */
  const compartilhar = async (modo: "so-arte" | "com-legenda") => {
    if (!temImagem) return;

    if (!arquivosProntos || arquivosProntos.length === 0) {
      // Ainda baixando (ou o download falhou): sem os arquivos em mãos não dá
      // para chamar o share dentro do gesto, então vamos direto ao manual.
      setMostrarManual(true);
      toast.info(
        erroPreparo
          ? "Não deu para preparar as artes. Use o passo a passo manual."
          : "As artes ainda estão carregando. Tente de novo em instantes.",
      );
      return;
    }

    setCompartilhando(modo);
    void copiarTexto(material.mensagem);
    const resultado =
      modo === "so-arte"
        ? await compartilharArte({ files: arquivosProntos })
        : await compartilharArteComLegenda({
            files: arquivosProntos,
            mensagem: material.mensagem,
          });
    setCompartilhando(null);

    const varias = arquivosProntos.length > 1;
    if (resultado === "compartilhado") {
      toast.success(
        modo === "so-arte"
          ? `Mensagem copiada! No WhatsApp, cole no campo de legenda ${
              varias ? "do álbum " : ""
            }antes de enviar.`
          : "Enviado com a mensagem junto. Se ela tiver chegado separada da foto, a mensagem está copiada — dá para refazer pelo outro botão.",
        { duration: 7000 },
      );
    } else if (resultado === "sem-suporte") {
      setMostrarManual(true);
      toast.info("Este aparelho não anexa a imagem pelo navegador. Siga o passo a passo manual.");
    } else if (resultado === "erro") {
      setMostrarManual(true);
      toast.error("O compartilhamento falhou. Use o passo a passo manual.");
    }
    // "cancelado" é silencioso: a pessoa só fechou a folha.
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Cake className="h-4 w-4 text-primary" />
          {material.nome}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {dataPorExtenso(material.data_comemoracao)}
        </p>
      </div>

      {temImagem ? (
        <div className="space-y-2">
          {material.imagens.map((img, i) =>
            img.url ? (
              <div key={img.url} className="relative">
                <img
                  src={img.url}
                  alt={
                    material.imagens.length > 1
                      ? `Arte ${i + 1} de ${material.imagens.length} do aniversário de ${material.nome}`
                      : `Arte de aniversário de ${material.nome}`
                  }
                  className="w-full rounded-xl border border-border bg-muted object-contain"
                />
                {material.imagens.length > 1 && (
                  <>
                    <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">
                      {i + 1}/{material.imagens.length}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="absolute right-2 top-2 h-7 px-2"
                      onClick={() => baixarImagem(i)}
                      disabled={baixando}
                      title={`Baixar a arte ${i + 1}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ) : null,
          )}
        </div>
      ) : (
        <div className="flex h-48 items-center justify-center rounded-xl border border-border bg-muted text-xs text-muted-foreground">
          A arte não pôde ser carregada.
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-3">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Mensagem
        </p>
        {/* whitespace-pre-wrap preserva as quebras de linha como foram digitadas. */}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {material.mensagem}
        </p>
      </div>

      {/* Os dois envios ficam juntos e separados do resto: é a decisão de
          "como mandar", e cada um tem uma garantia diferente. */}
      <div className="space-y-2 rounded-xl border border-border bg-card p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Enviar ao grupo
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            onClick={() => compartilhar("so-arte")}
            disabled={!!compartilhando || !temImagem}
          >
            {compartilhando === "so-arte" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ClipboardPaste className="h-4 w-4" />
            )}
            Arte + colar legenda
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => compartilhar("com-legenda")}
            disabled={!!compartilhando || !temImagem}
          >
            {compartilhando === "com-legenda" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
            Arte + mensagem juntas
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground">Arte + colar legenda</strong> abre o
          WhatsApp com a arte anexada e a mensagem copiada: cole no campo de legenda e envia sempre
          numa mensagem só.{" "}
          <strong className="font-medium text-foreground">Arte + mensagem juntas</strong> entrega as
          duas de uma vez — quando o aparelho usa o texto como legenda, não precisa colar nada;
          quando não usa, a mensagem chega separada da foto.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="secondary"
          onClick={copiarMensagem}
          disabled={copiandoMensagem}
        >
          {mensagemCopiada ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          Copiar mensagem
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => baixarImagem()}
          disabled={baixando || !temImagem}
        >
          {baixando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : imagemBaixada ? (
            <Check className="h-4 w-4" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {material.imagens.length > 1
            ? `Baixar as ${material.imagens.length} artes`
            : "Baixar imagem"}
        </Button>
      </div>

      {/* A explicação dos dois envios já está no bloco acima; aqui só o aviso
          de quem não tem o compartilhamento de arquivo do navegador. */}
      {!talvezCompartilhe && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Este navegador não anexa a imagem direto no WhatsApp — os dois botões acima vão cair no
          passo a passo manual. Pelo celular funciona.
        </p>
      )}

      <button
        type="button"
        onClick={() => setMostrarManual((v) => !v)}
        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
      >
        {mostrarManual ? "Esconder o envio manual" : "Como enviar manualmente?"}
      </button>

      {mostrarManual && (
        <ol className="space-y-2 rounded-xl border border-dashed border-border bg-[var(--surface-1)] p-3 text-xs text-muted-foreground">
          <li className="flex items-center justify-between gap-2">
            <span>
              <strong className="text-foreground">1.</strong> Baixe a arte no aparelho.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => baixarImagem()}
              disabled={baixando || !temImagem}
            >
              {imagemBaixada ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Baixar
            </Button>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span>
              <strong className="text-foreground">2.</strong> Copie a mensagem.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={copiarMensagem}
              disabled={copiandoMensagem}
            >
              {mensagemCopiada ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              Copiar
            </Button>
          </li>
          <li>
            <strong className="text-foreground">3.</strong> No grupo do WhatsApp, anexe a imagem
            baixada e cole a mensagem no campo de legenda <em>antes</em> de enviar — assim a foto e
            o texto chegam numa mensagem só.
          </li>
          <li className="border-t border-border pt-2">
            Precisa só avisar o grupo?{" "}
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => abrirWhatsAppComTexto(material.mensagem)}
            >
              Abrir o WhatsApp com a mensagem
            </button>{" "}
            — manda apenas o texto, sem a imagem.
          </li>
        </ol>
      )}

      {rodape}
    </div>
  );
}

/** O mesmo material dentro de um modal, para o pop-up e a lista do sistema. */
export function AniversarianteMaterialDialog({
  material,
  open,
  onOpenChange,
  rodape,
}: {
  material: MaterialAniversariante | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rodape?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[90vh] overflow-y-auto sm:max-w-lg")}>
        <DialogTitle className="sr-only">
          {material ? `Material de ${material.nome}` : "Material do aniversariante"}
        </DialogTitle>
        {material && <AniversarianteMaterial material={material} rodape={rodape} />}
      </DialogContent>
    </Dialog>
  );
}

/** Etiqueta Pendente/Publicado usada na lista e no material. */
export function StatusPublicacao({
  publicado_em,
  publicado_por_nome,
}: {
  publicado_em: string | null;
  publicado_por_nome: string | null;
}) {
  if (!publicado_em) {
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
        Pendente
      </Badge>
    );
  }
  const quando = new Date(publicado_em).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  return (
    <Badge
      variant="outline"
      className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
      title={`Publicado por ${publicado_por_nome ?? "alguém da equipe"} em ${quando}`}
    >
      <Check className="mr-1 h-3 w-3" />
      Publicado
    </Badge>
  );
}
