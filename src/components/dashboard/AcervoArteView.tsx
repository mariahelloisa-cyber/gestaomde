import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getFichaMarca,
  iniciarUploadAcervo,
  listAcervoArte,
  removerArquivoFicha,
  removerReferencia,
  renomearLogoFicha,
  salvarArquivoFicha,
  salvarModeloFotoPerfil,
  salvarReferencia,
  salvarTextosFicha,
} from "@/lib/arte-acervo.functions";
import {
  ARQUIVO_MIMES,
  ASSET_TEXTO_MAX,
  FICHA_ARQUIVO_MIMES,
  MARCA_TAMANHO_MAX_MB,
  MOLDURA_MIMES,
  NIVEIS_CARGO,
  NIVEL_CARGO_CONFIG,
  REFERENCIA_TAMANHO_MAX_MB,
  SUGESTOES_VERSAO_LOGO,
  TIPOS_ARTE_REFERENCIA,
  TIPOS_CONFIG,
  mimeDoArquivo,
  rotuloTipo,
  type CampoArquivoFicha,
  type NivelCargo,
  type TipoArte,
  type TipoAsset,
} from "@/lib/arte/tipos";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/* Acervo do módulo de artes (aba Artes).
 *   - Referências: GLOBAIS, por tipo de arte (a "pasta" feed, panfleto…).
 *   - Marcas das empresas: identidade visual POR EMPRESA (logo, cores,
 *     slogan, briefing, fonte, elementos).
 *   - Modelos de foto de perfil: as 4 molduras por nível do cargo, da
 *     agência (sem empresa), em seção própria.
 * Uploads por URL assinada emitida pelo servidor; leitura por URL assinada
 * de 1h. Nenhum acesso direto a bucket. */

const AGENCIA = "__agencia";
const TODOS = "__todos";
const HEX = /^#[0-9A-Fa-f]{6}$/;
const MB = 1024 * 1024;

type Acervo = Awaited<ReturnType<typeof listAcervoArte>>;

function separarTags(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function useAcervo() {
  const fn = useServerFn(listAcervoArte);
  return useQuery({ queryKey: ["arte-acervo"], queryFn: () => fn() });
}

/** Sobe um arquivo para o acervo: URL assinada do servidor + upload direto. */
function useUploadAcervo() {
  const iniciarFn = useServerFn(iniciarUploadAcervo);
  return async (
    file: File,
    destino:
      | { destino: "referencia"; tipo_arte: TipoArte }
      | { destino: "marca"; projeto_id: string | null; tipo: TipoAsset },
    bucket: string,
  ) => {
    const mime = mimeDoArquivo(file);
    const signed = await iniciarFn({
      data: { ...destino, mime_type: mime, tamanho_bytes: file.size } as never,
    });
    const { error } = await supabase.storage
      .from(bucket)
      .uploadToSignedUrl(signed.path, signed.token, file, { contentType: mime });
    if (error) throw new Error(`Falha no upload: ${error.message}`);
    return { path: signed.path, mime_type: mime };
  };
}

function Estado({ query }: { query: ReturnType<typeof useAcervo> }) {
  if (query.isLoading)
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-8 text-center text-sm">
      <p className="text-muted-foreground">
        {query.error instanceof Error ? query.error.message : "Não foi possível carregar."}
      </p>
      <Button size="sm" variant="outline" onClick={() => query.refetch()}>
        Tentar de novo
      </Button>
    </div>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">
          {t}
        </span>
      ))}
    </div>
  );
}

function BotaoRemover({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      title="Remover"
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 text-gray-400 hover:text-red-600"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

/* =========================================================================
 * Referências globais (por tipo de arte)
 * ========================================================================= */

export function ReferenciasArte() {
  const query = useAcervo();
  const qc = useQueryClient();
  const subir = useUploadAcervo();
  const salvarFn = useServerFn(salvarReferencia);
  const removerFn = useServerFn(removerReferencia);

  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<TipoArte | "">("");
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [tags, setTags] = useState("");
  const [descricao, setDescricao] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<typeof TODOS | TipoArte>(TODOS);
  const [filtroCategoria, setFiltroCategoria] = useState(TODOS);

  const removerMut = useMutation({
    mutationFn: (id: string) => removerFn({ data: { id } }),
    onSuccess: () => toast.success("Referência removida."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao remover."),
    onSettled: () => qc.invalidateQueries({ queryKey: ["arte-acervo"] }),
  });

  const refs = useMemo(() => query.data?.referencias ?? [], [query.data]);
  const porTipo = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of refs) for (const t of r.tipos_arte) c.set(t, (c.get(t) ?? 0) + 1);
    return c;
  }, [refs]);
  const categorias = useMemo(
    () =>
      Array.from(new Set(refs.map((r) => r.categoria).filter((c): c is string => !!c))).sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [refs],
  );
  const lista = refs.filter(
    (r) =>
      (filtroTipo === TODOS || r.tipos_arte.includes(filtroTipo)) &&
      (filtroCategoria === TODOS || r.categoria === filtroCategoria),
  );

  if (!query.data) return <Estado query={query} />;

  const abrirNova = () => {
    // Já começa na "pasta" que está sendo vista.
    if (filtroTipo !== TODOS) setTipo(filtroTipo);
    setAberto((v) => !v);
  };

  const limpar = () => {
    setTitulo("");
    setTags("");
    setDescricao("");
    setArquivo(null);
  };

  const salvar = async () => {
    if (!tipo) return toast.error("Escolha o tipo de arte.");
    if (!arquivo) return toast.error("Escolha a imagem de referência.");
    if (!(ARQUIVO_MIMES as readonly string[]).includes(arquivo.type))
      return toast.error("Use PNG, JPG ou WebP.");
    if (arquivo.size > REFERENCIA_TAMANHO_MAX_MB * MB)
      return toast.error(`A imagem passa de ${REFERENCIA_TAMANHO_MAX_MB} MB.`);

    setSalvando(true);
    try {
      const up = await subir(arquivo, { destino: "referencia", tipo_arte: tipo }, "art-references");
      await salvarFn({
        data: {
          tipo_arte: tipo,
          titulo: titulo.trim() || undefined,
          categoria: categoria.trim() || undefined,
          tags: separarTags(tags),
          descricao: descricao.trim() || undefined,
          path: up.path,
          mime_type: up.mime_type as (typeof ARQUIVO_MIMES)[number],
        },
      });
      toast.success("Referência cadastrada.");
      limpar();
      setAberto(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar a referência.");
    } finally {
      setSalvando(false);
      qc.invalidateQueries({ queryKey: ["arte-acervo"] });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Referências globais de arte</h2>
          <p className="text-xs text-muted-foreground">
            Valem para todas as empresas, separadas por tipo de arte. A identidade de cada empresa
            fica em Marcas das empresas.
          </p>
        </div>
        <Button onClick={abrirNova}>
          <Plus className="mr-1 h-4 w-4" /> Nova referência
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {([TODOS, ...TIPOS_ARTE_REFERENCIA] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFiltroTipo(t)}
            className={cn(
              "rounded-full border border-border px-3 py-1 text-xs transition-colors",
              filtroTipo === t
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted",
            )}
          >
            {t === TODOS
              ? `Todas (${refs.length})`
              : `${TIPOS_CONFIG[t].rotulo} (${porTipo.get(t) ?? 0})`}
          </button>
        ))}
      </div>

      {categorias.length > 0 && (
        <div className="w-56 space-y-1">
          <Label className="text-xs">Categoria</Label>
          <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas as categorias</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {aberto && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Tipo de arte *</Label>
              <Select
                value={tipo}
                onValueChange={(v) => setTipo(v as TipoArte)}
                disabled={salvando}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o tipo" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_ARTE_REFERENCIA.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIPOS_CONFIG[t].rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Categoria</Label>
              <Input
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                maxLength={80}
                list="arte-categorias"
                placeholder="Ex: institucional, promoção"
              />
              <datalist id="arte-categorias">
                {categorias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Título (opcional)</Label>
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-1">
              <Label>Tags (separadas por vírgula)</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="minimalista, foto grande, fundo claro"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Observações / estilo</Label>
            <Textarea
              rows={3}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={2000}
              placeholder="O que vale aproveitar desta referência: composição, hierarquia, tipografia…"
            />
          </div>
          <div className="space-y-1">
            <Label>Imagem *</Label>
            <Input
              type="file"
              accept={ARQUIVO_MIMES.join(",")}
              disabled={salvando}
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              PNG, JPG ou WebP, até {REFERENCIA_TAMANHO_MAX_MB} MB.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={salvando} onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button disabled={salvando} onClick={salvar}>
              {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar referência
            </Button>
          </div>
        </div>
      )}

      {lista.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Nenhuma referência
          {filtroTipo !== TODOS ? ` de ${TIPOS_CONFIG[filtroTipo].rotulo.toLowerCase()}` : ""}{" "}
          cadastrada.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lista.map((r) => (
            <div
              key={r.id}
              className="overflow-hidden rounded-lg border border-border bg-white text-black"
            >
              <a href={r.url ?? "#"} target="_blank" rel="noopener noreferrer">
                {r.url ? (
                  <img
                    src={r.url}
                    alt={r.titulo}
                    className="h-40 w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center text-xs text-gray-400">
                    sem prévia
                  </div>
                )}
              </a>
              <div className="space-y-1 p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold">{r.titulo}</span>
                  <BotaoRemover
                    disabled={removerMut.isPending}
                    onClick={() => {
                      if (confirm("Remover esta referência?")) removerMut.mutate(r.id);
                    }}
                  />
                </div>
                <div className="text-gray-600">
                  {r.tipos_arte.map(rotuloTipo).join(", ")}
                  {r.categoria ? ` • ${r.categoria}` : ""}
                </div>
                <Tags tags={r.tags} />
                {r.descricao && <p className="whitespace-pre-wrap text-gray-700">{r.descricao}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
 * Marcas das empresas — ficha única de branding por empresa
 *
 * O usuário escolhe a empresa e edita a ficha; o tipo de cada registro em
 * brand_assets é decidido pelo sistema conforme o campo. Textos são salvos
 * juntos ("Salvar ficha"); arquivos são salvos na hora do envio.
 * ========================================================================= */

type Ficha = Awaited<ReturnType<typeof getFichaMarca>>;
type ArquivoFicha = Ficha["logos"][number];

function Secao({
  titulo,
  ajuda,
  children,
}: {
  titulo: string;
  ajuda?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">{titulo}</h3>
        {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
      </div>
      {children}
    </section>
  );
}

export function FichaMarca() {
  const query = useAcervo();
  const [projetoId, setProjetoId] = useState("");

  if (!query.data) return <Estado query={query} />;
  const { projetos } = query.data;
  const projeto = projetos.find((p) => p.id === projetoId);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Marcas das empresas</h2>
        <p className="text-xs text-muted-foreground">
          Ficha de identidade visual de cada empresa: logo, cores, tags, slogan, briefing, fonte e
          elementos. É o que a IA vai usar para aplicar a marca nas artes.
        </p>
      </div>

      <div className="w-72 space-y-1">
        <Label className="text-xs">Empresa</Label>
        <Select value={projetoId} onValueChange={setProjetoId}>
          <SelectTrigger>
            <SelectValue placeholder="Escolha a empresa" />
          </SelectTrigger>
          <SelectContent>
            {projetos.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {projeto ? (
        <FichaDaEmpresa key={projeto.id} projetoId={projeto.id} nomeEmpresa={projeto.nome} />
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Escolha uma empresa para ver ou editar a ficha de marca.
        </div>
      )}
    </div>
  );
}

function FichaDaEmpresa({ projetoId, nomeEmpresa }: { projetoId: string; nomeEmpresa: string }) {
  const fichaFn = useServerFn(getFichaMarca);
  const q = useQuery({
    queryKey: ["ficha-marca", projetoId],
    queryFn: () => fichaFn({ data: { projeto_id: projetoId } }),
  });

  if (q.isLoading)
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Carregando a ficha…
      </div>
    );
  if (!q.data)
    return (
      <div className="space-y-3 rounded-lg border border-border bg-card p-8 text-center text-sm">
        <p className="text-muted-foreground">
          {q.error instanceof Error ? q.error.message : "Não foi possível carregar a ficha."}
        </p>
        <Button size="sm" variant="outline" onClick={() => q.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  return <FichaForm projetoId={projetoId} nomeEmpresa={nomeEmpresa} ficha={q.data} />;
}

function FichaForm({
  projetoId,
  nomeEmpresa,
  ficha,
}: {
  projetoId: string;
  nomeEmpresa: string;
  ficha: Ficha;
}) {
  const qc = useQueryClient();
  const salvarTextosFn = useServerFn(salvarTextosFicha);

  // Estado local nasce da ficha salva; o componente é remontado ao trocar de empresa.
  const [paleta, setPaleta] = useState<string[]>(ficha.paleta);
  const [novaCor, setNovaCor] = useState("#000000");
  const [tags, setTags] = useState(ficha.tags.join(", "));
  const [slogan, setSlogan] = useState(ficha.slogan);
  const [briefing, setBriefing] = useState(ficha.briefing);
  const [fonteNome, setFonteNome] = useState(ficha.fonte_nome);

  const tagsLista = separarTags(tags);
  const alterado =
    paleta.join() !== ficha.paleta.join() ||
    tagsLista.join() !== ficha.tags.join() ||
    slogan.trim() !== ficha.slogan ||
    briefing.trim() !== ficha.briefing ||
    fonteNome.trim() !== ficha.fonte_nome;

  const salvarMut = useMutation({
    mutationFn: () =>
      salvarTextosFn({
        data: {
          projeto_id: projetoId,
          paleta,
          tags: tagsLista,
          slogan: slogan.trim(),
          briefing: briefing.trim(),
          fonte_nome: fonteNome.trim(),
        },
      }),
    onSuccess: () => toast.success(`Ficha de ${nomeEmpresa} salva.`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao salvar a ficha."),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ficha-marca", projetoId] }),
  });

  const adicionarCor = () => {
    const cor = novaCor.trim().toUpperCase();
    if (!HEX.test(cor)) return toast.error("Cor no formato #RRGGBB.");
    if (paleta.includes(cor)) return toast.error("Essa cor já está na paleta.");
    if (paleta.length >= 20) return toast.error("No máximo 20 cores.");
    setPaleta((p) => [...p, cor]);
  };

  return (
    <div className="space-y-4">
      <Secao
        titulo="Logos"
        ajuda="Todas as versões da logo, cada uma com um nome: com nome, sem nome, versão branca… PNG, JPG, WebP ou SVG."
      >
        <LogosMarca projetoId={projetoId} logos={ficha.logos} />
      </Secao>

      <div className="grid gap-4 lg:grid-cols-2">
        <Secao titulo="Paleta de cores" ajuda="Cores oficiais da marca, na ordem de importância.">
          {paleta.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {paleta.map((c) => (
                <span
                  key={c}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-1 pr-2 text-xs"
                >
                  <span
                    className="h-5 w-5 rounded-full border border-gray-300"
                    style={{ backgroundColor: c }}
                  />
                  {c}
                  <button
                    type="button"
                    title="Remover cor"
                    onClick={() => setPaleta((p) => p.filter((x) => x !== c))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma cor cadastrada.</p>
          )}
          <div className="flex gap-2">
            <input
              type="color"
              value={HEX.test(novaCor) ? novaCor : "#000000"}
              onChange={(e) => setNovaCor(e.target.value.toUpperCase())}
              className="h-9 w-12 cursor-pointer rounded border border-border bg-background"
            />
            <Input
              value={novaCor}
              onChange={(e) => setNovaCor(e.target.value)}
              maxLength={7}
              className="w-28"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  adicionarCor();
                }
              }}
            />
            <Button type="button" variant="outline" onClick={adicionarCor}>
              <Plus className="mr-1 h-4 w-4" /> Adicionar
            </Button>
          </div>
        </Secao>

        <div className="space-y-4">
          <Secao titulo="Slogan">
            <Input
              value={slogan}
              onChange={(e) => setSlogan(e.target.value)}
              maxLength={ASSET_TEXTO_MAX.slogan}
              placeholder="Ex: Educação que transforma"
            />
          </Secao>
          <Secao titulo="Tags da marca" ajuda="Separadas por vírgula.">
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="jovem, tecnologia, acolhedor"
            />
            <Tags tags={tagsLista} />
          </Secao>
        </div>
      </div>

      <Secao
        titulo="Briefing da marca"
        ajuda="Público, tom de voz, o que a marca comunica e o que evitar. É o texto que a IA vai ler."
      >
        <Textarea
          rows={12}
          value={briefing}
          onChange={(e) => setBriefing(e.target.value)}
          maxLength={ASSET_TEXTO_MAX.briefing}
          className="text-sm leading-relaxed"
        />
        <div className="text-right text-xs text-muted-foreground">
          {briefing.length}/{ASSET_TEXTO_MAX.briefing}
        </div>
      </Secao>

      <div className="grid gap-4 lg:grid-cols-2">
        <Secao titulo="Briefing completo (opcional)" ajuda="Documento em PDF.">
          <CampoArquivo
            projetoId={projetoId}
            campo="briefing_documento"
            atual={ficha.briefing_documento}
          />
        </Secao>
        <Secao titulo="Fonte (opcional)" ajuda="Nome da fonte e/ou arquivo (TTF, OTF, WOFF).">
          <Input
            value={fonteNome}
            onChange={(e) => setFonteNome(e.target.value)}
            maxLength={120}
            placeholder="Ex: Montserrat"
          />
          <CampoArquivo projetoId={projetoId} campo="fonte" atual={ficha.fonte_arquivo} />
        </Secao>
      </div>

      <Secao
        titulo="Elementos visuais (opcional)"
        ajuda="Grafismos, ícones, texturas próprias da empresa. PNG, JPG, WebP ou SVG."
      >
        <ElementosVisuais projetoId={projetoId} elementos={ficha.elementos} />
      </Secao>

      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-[var(--surface-1)] py-3">
        <span className="text-xs text-muted-foreground">
          {alterado
            ? "Há alterações não salvas em cores, tags, slogan, briefing ou fonte."
            : "Arquivos são salvos na hora do envio."}
        </span>
        <Button disabled={!alterado || salvarMut.isPending} onClick={() => salvarMut.mutate()}>
          {salvarMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Salvar ficha
        </Button>
      </div>
    </div>
  );
}

/** Envia um arquivo da ficha: URL assinada do servidor, upload direto, registro. */
function useEnviarArquivoFicha(projetoId: string) {
  const qc = useQueryClient();
  const subir = useUploadAcervo();
  const salvarFn = useServerFn(salvarArquivoFicha);
  return async (campo: CampoArquivoFicha, file: File, versao?: string) => {
    const mime = mimeDoArquivo(file);
    if (!(FICHA_ARQUIVO_MIMES[campo] as readonly string[]).includes(mime))
      throw new Error(`"${file.name}": formato não aceito aqui.`);
    if (file.size > MARCA_TAMANHO_MAX_MB * MB)
      throw new Error(`"${file.name}" passa de ${MARCA_TAMANHO_MAX_MB} MB.`);
    try {
      const up = await subir(
        file,
        { destino: "marca", projeto_id: projetoId, tipo: campo },
        "brand-assets",
      );
      await salvarFn({
        data: {
          projeto_id: projetoId,
          campo,
          path: up.path,
          mime_type: up.mime_type,
          nome_arquivo: file.name.slice(0, 200),
          versao,
        },
      });
    } finally {
      qc.invalidateQueries({ queryKey: ["ficha-marca", projetoId] });
    }
  };
}

function useRemoverArquivoFicha(projetoId: string) {
  const qc = useQueryClient();
  const removerFn = useServerFn(removerArquivoFicha);
  return useMutation({
    mutationFn: (id: string) => removerFn({ data: { id } }),
    onSuccess: () => toast.success("Arquivo removido."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao remover."),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ficha-marca", projetoId] }),
  });
}

function CampoArquivo({
  projetoId,
  campo,
  atual,
}: {
  projetoId: string;
  campo: Exclude<CampoArquivoFicha, "elemento_visual" | "logo">;
  atual: ArquivoFicha | null;
}) {
  const enviar = useEnviarArquivoFicha(projetoId);
  const remover = useRemoverArquivoFicha(projetoId);
  const [enviando, setEnviando] = useState(false);

  const escolher = async (file: File | undefined) => {
    if (!file) return;
    setEnviando(true);
    try {
      await enviar(campo, file);
      toast.success(atual ? "Arquivo substituído." : "Arquivo enviado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no envio.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-2">
      {atual && (
        <a
          href={atual.url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{atual.nome}</span>
        </a>
      )}
      <div className="flex flex-wrap gap-2">
        <label
          className={cn(
            "inline-flex cursor-pointer items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted",
            enviando && "pointer-events-none opacity-60",
          )}
        >
          {enviando ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-4 w-4" />
          )}
          {atual ? "Substituir" : "Enviar arquivo"}
          <input
            type="file"
            accept={
              FICHA_ARQUIVO_MIMES[campo].join(",") +
              (campo === "fonte" ? ",.ttf,.otf,.woff,.woff2" : "")
            }
            className="hidden"
            onChange={(e) => {
              void escolher(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {atual && (
          <Button
            size="sm"
            variant="ghost"
            disabled={remover.isPending}
            onClick={() => {
              if (confirm("Remover este arquivo?")) remover.mutate(atual.id);
            }}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Remover
          </Button>
        )}
      </div>
    </div>
  );
}

/** Várias versões de logo por empresa, cada uma com nome editável. */
function LogosMarca({ projetoId, logos }: { projetoId: string; logos: ArquivoFicha[] }) {
  const enviar = useEnviarArquivoFicha(projetoId);
  const remover = useRemoverArquivoFicha(projetoId);
  const [versao, setVersao] = useState("");
  const [enviando, setEnviando] = useState(false);

  const escolher = async (file: File | undefined) => {
    if (!file) return;
    const nome = versao.trim();
    if (!nome) {
      toast.error("Dê um nome à versão antes de enviar (ex.: Com nome, Versão branca).");
      return;
    }
    setEnviando(true);
    try {
      await enviar("logo", file, nome);
      toast.success(`Logo "${nome}" adicionada.`);
      setVersao("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no envio.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-3">
      {logos.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {logos.map((l) => (
            <LogoCard key={l.id} projetoId={projetoId} logo={l} remover={remover} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma logo cadastrada.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={versao}
          onChange={(e) => setVersao(e.target.value)}
          maxLength={80}
          list="logo-versoes"
          placeholder="Nome da versão (ex.: Versão branca)"
          className="w-64"
          disabled={enviando}
        />
        <datalist id="logo-versoes">
          {SUGESTOES_VERSAO_LOGO.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <label
          className={cn(
            "inline-flex cursor-pointer items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted",
            enviando && "pointer-events-none opacity-60",
          )}
        >
          {enviando ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-1.5 h-4 w-4" />
          )}
          Adicionar logo
          <input
            type="file"
            accept={FICHA_ARQUIVO_MIMES.logo.join(",")}
            className="hidden"
            onChange={(e) => {
              void escolher(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}

function LogoCard({
  projetoId,
  logo,
  remover,
}: {
  projetoId: string;
  logo: ArquivoFicha;
  remover: ReturnType<typeof useRemoverArquivoFicha>;
}) {
  const qc = useQueryClient();
  const renomearFn = useServerFn(renomearLogoFicha);
  const [nome, setNome] = useState(logo.nome);

  const renomear = useMutation({
    mutationFn: (versao: string) => renomearFn({ data: { id: logo.id, versao } }),
    onSuccess: () => toast.success("Nome da versão atualizado."),
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Erro ao renomear.");
      setNome(logo.nome);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["ficha-marca", projetoId] }),
  });

  const salvarNome = () => {
    const v = nome.trim();
    if (v === logo.nome) return;
    if (!v) {
      setNome(logo.nome);
      return;
    }
    renomear.mutate(v);
  };

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      {/* Fundo cinza para a versão branca também aparecer. */}
      <a href={logo.url ?? "#"} target="_blank" rel="noopener noreferrer" className="block">
        {logo.url ? (
          <img
            src={logo.url}
            alt={logo.nome}
            className="h-24 w-full bg-gray-300 object-contain p-2"
            loading="lazy"
          />
        ) : (
          <div className="flex h-24 items-center justify-center bg-gray-300 text-xs text-gray-500">
            sem prévia
          </div>
        )}
      </a>
      <div className="flex items-center gap-1 p-1.5">
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={salvarNome}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          maxLength={80}
          list="logo-versoes"
          className="h-8 text-xs"
          title="Nome da versão (clique para editar)"
          disabled={renomear.isPending}
        />
        <button
          type="button"
          title="Remover logo"
          disabled={remover.isPending}
          onClick={() => {
            if (confirm(`Remover a logo "${logo.nome}"?`)) remover.mutate(logo.id);
          }}
          className="shrink-0 p-1 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ElementosVisuais({
  projetoId,
  elementos,
}: {
  projetoId: string;
  elementos: ArquivoFicha[];
}) {
  const enviar = useEnviarArquivoFicha(projetoId);
  const remover = useRemoverArquivoFicha(projetoId);
  const [enviando, setEnviando] = useState<string | null>(null);

  const escolher = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const lista = Array.from(files).slice(0, 20);
    let ok = 0;
    for (const [i, file] of lista.entries()) {
      setEnviando(`Enviando ${i + 1}/${lista.length}…`);
      try {
        await enviar("elemento_visual", file);
        ok++;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Falha no envio de "${file.name}".`);
      }
    }
    setEnviando(null);
    if (ok) toast.success(`${ok} elemento(s) adicionado(s).`);
  };

  return (
    <div className="space-y-3">
      {elementos.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {elementos.map((el) => (
            <div
              key={el.id}
              className="group relative overflow-hidden rounded-md border border-border bg-gray-100"
            >
              <a href={el.url ?? "#"} target="_blank" rel="noopener noreferrer" title={el.nome}>
                {el.url ? (
                  <img
                    src={el.url}
                    alt={el.nome}
                    className="h-24 w-full object-contain p-1.5"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-24 items-center justify-center text-xs text-gray-400">
                    sem prévia
                  </div>
                )}
              </a>
              <button
                type="button"
                title="Remover"
                disabled={remover.isPending}
                onClick={() => {
                  if (confirm("Remover este elemento?")) remover.mutate(el.id);
                }}
                className="absolute right-1 top-1 rounded bg-white/90 p-1 text-gray-500 opacity-0 shadow transition-opacity hover:text-red-600 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum elemento cadastrado.</p>
      )}
      <label
        className={cn(
          "inline-flex cursor-pointer items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted",
          enviando && "pointer-events-none opacity-60",
        )}
      >
        {enviando ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Plus className="mr-1.5 h-4 w-4" />
        )}
        {enviando ?? "Adicionar elementos"}
        <input
          type="file"
          multiple
          accept={FICHA_ARQUIVO_MIMES.elemento_visual.join(",")}
          className="hidden"
          onChange={(e) => {
            void escolher(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

/* =========================================================================
 * Modelos de foto de perfil (agência)
 *
 * A foto de perfil usa sempre o mesmo modelo; só muda a moldura, uma por
 * nível do cargo. Aqui não existe empresa: as 4 molduras são da agência.
 * ========================================================================= */

export function ModelosFotoPerfil() {
  const query = useAcervo();
  const qc = useQueryClient();
  const subir = useUploadAcervo();
  const salvarFn = useServerFn(salvarModeloFotoPerfil);

  const [editando, setEditando] = useState<NivelCargo | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);

  if (!query.data) return <Estado query={query} />;

  // Uma moldura ativa por nível (garantido pelo índice da Fase 1). Linhas
  // antigas sem nivel_cargo caem no tipo_cargo, que tem o mesmo valor.
  const porNivel = new Map<string, Acervo["assets"][number]>();
  for (const a of query.data.assets) {
    if (a.tipo !== "moldura_cargo" || !a.ativo || a.projeto_id) continue;
    const v = (a.valor ?? {}) as Record<string, unknown>;
    const nivel = String(v.nivel_cargo ?? v.tipo_cargo ?? "").toLowerCase();
    if (nivel) porNivel.set(nivel, a);
  }
  const cadastrados = NIVEIS_CARGO.filter((n) => porNivel.has(n)).length;

  const abrir = (n: NivelCargo) => {
    setArquivo(null);
    setEditando(n);
  };

  const salvar = async () => {
    if (!editando) return;
    if (!arquivo) return toast.error("Escolha o arquivo da moldura.");
    const mime = mimeDoArquivo(arquivo);
    if (!(MOLDURA_MIMES as readonly string[]).includes(mime))
      return toast.error("Use PNG, WebP ou SVG (a moldura precisa de fundo transparente).");
    if (arquivo.size > MARCA_TAMANHO_MAX_MB * MB)
      return toast.error(`O arquivo passa de ${MARCA_TAMANHO_MAX_MB} MB.`);

    setSalvando(true);
    try {
      const up = await subir(
        arquivo,
        { destino: "marca", projeto_id: null, tipo: "moldura_cargo" },
        "brand-assets",
      );
      const r = await salvarFn({
        data: {
          nivel_cargo: editando,
          arquivo: { path: up.path, mime_type: up.mime_type as (typeof MOLDURA_MIMES)[number] },
        },
      });
      toast.success(
        `${r.substituido ? "Modelo substituído" : "Modelo cadastrado"}: ${NIVEL_CARGO_CONFIG[editando].rotulo}.`,
      );
      setEditando(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar o modelo.");
    } finally {
      setSalvando(false);
      qc.invalidateQueries({ queryKey: ["arte-acervo"] });
    }
  };

  const cfgEditando = editando ? NIVEL_CARGO_CONFIG[editando] : null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Modelos de foto de perfil</h2>
        <p className="text-xs text-muted-foreground">
          O modelo é sempre o mesmo; muda só a moldura, uma por nível do cargo. Valem para a agência
          inteira (não pertencem a nenhuma empresa). {cadastrados} de {NIVEIS_CARGO.length}{" "}
          cadastrados.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {NIVEIS_CARGO.map((n) => {
          const cfg = NIVEL_CARGO_CONFIG[n];
          const m = porNivel.get(n);
          return (
            <div
              key={n}
              className="flex flex-col overflow-hidden rounded-lg border border-border bg-white text-black"
            >
              {/* Fundo cinza para a moldura branca também aparecer. */}
              <div className="flex h-40 items-center justify-center bg-gray-200">
                {m?.url ? (
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-full w-full"
                  >
                    <img
                      src={m.url}
                      alt={m.nome}
                      className="h-full w-full object-contain p-2"
                      loading="lazy"
                    />
                  </a>
                ) : (
                  <span
                    className="h-20 w-20 rounded-full border-8 opacity-40"
                    style={{ borderColor: cfg.corPadrao }}
                  />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-3 text-xs">
                <div className="text-sm font-semibold">{cfg.rotulo}</div>
                <div className="flex items-center gap-1.5 text-gray-600">
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-gray-300"
                    style={{ backgroundColor: cfg.corPadrao }}
                  />
                  Moldura {cfg.moldura} ({cfg.corPadrao})
                </div>
                <div className={m ? "text-emerald-600" : "text-amber-600"}>
                  {m ? "Cadastrado" : "Pendente"}
                </div>
                <Button
                  size="sm"
                  variant={m ? "outline" : "default"}
                  className="mt-auto"
                  onClick={() => abrir(n)}
                >
                  {m ? "Substituir" : "Cadastrar"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!editando} onOpenChange={(o) => !o && !salvando && setEditando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editando && porNivel.has(editando) ? "Substituir" : "Cadastrar"} modelo —{" "}
              {cfgEditando?.rotulo}
            </DialogTitle>
          </DialogHeader>
          {cfgEditando && (
            <div className="space-y-3 text-sm">
              <p className="flex items-center gap-2 text-muted-foreground">
                <span
                  className="h-4 w-4 rounded-full border border-gray-300"
                  style={{ backgroundColor: cfgEditando.corPadrao }}
                />
                Moldura {cfgEditando.moldura} ({cfgEditando.corPadrao}), válida para a agência toda.
              </p>
              <div className="space-y-1">
                <Label>Arquivo da moldura *</Label>
                <Input
                  type="file"
                  accept={MOLDURA_MIMES.join(",")}
                  disabled={salvando}
                  onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                />
                <p className="text-xs text-muted-foreground">
                  PNG, WebP ou SVG com fundo transparente, até {MARCA_TAMANHO_MAX_MB} MB.
                  {editando && porNivel.has(editando) ? " O arquivo atual será substituído." : ""}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={salvando} onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button disabled={salvando || !arquivo} onClick={salvar}>
              {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
