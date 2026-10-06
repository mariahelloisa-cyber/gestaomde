import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  iniciarUploadAcervo,
  listAcervoArte,
  removerBrandAsset,
  removerReferencia,
  salvarBrandAsset,
  salvarModeloFotoPerfil,
  salvarReferencia,
} from "@/lib/arte-acervo.functions";
import {
  ARQUIVO_MIMES,
  ASSET_DE_TEXTO,
  ASSET_EXIGE_EMPRESA,
  ASSET_TEXTO_MAX,
  MARCA_MIMES,
  MARCA_TAMANHO_MAX_MB,
  MOLDURA_MIMES,
  NIVEIS_CARGO,
  NIVEL_CARGO_CONFIG,
  REFERENCIA_TAMANHO_MAX_MB,
  TIPOS_ARTE_REFERENCIA,
  TIPOS_ASSET,
  TIPOS_ASSET_MARCA,
  TIPOS_CONFIG,
  mimeDoArquivo,
  rotuloTipo,
  type MarcaMime,
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
 * Marcas das empresas (por empresa)
 * ========================================================================= */

const ACCEPT_ASSET: Partial<Record<TipoAsset, string>> = {
  logo: "image/png,image/jpeg,image/webp,image/svg+xml,application/pdf",
  paleta: "image/png,image/jpeg,image/webp,application/pdf",
  fonte: ".ttf,.otf,.woff,.woff2",
  elemento_visual: "image/png,image/jpeg,image/webp,image/svg+xml",
  modelo_base: "image/png,image/jpeg,image/webp,image/svg+xml,application/pdf",
};

function Cores({ cores }: { cores: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {cores.map((c) => (
        <span key={c} className="flex items-center gap-1 text-[10px] text-gray-600">
          <span className="h-4 w-4 rounded border border-gray-300" style={{ backgroundColor: c }} />
          {c}
        </span>
      ))}
    </div>
  );
}

/* =========================================================================
 * Marcas das empresas (identidade visual por empresa)
 * ========================================================================= */

export function AssetsMarca() {
  const query = useAcervo();
  const qc = useQueryClient();
  const subir = useUploadAcervo();
  const salvarFn = useServerFn(salvarBrandAsset);
  const removerFn = useServerFn(removerBrandAsset);

  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<TipoAsset>("logo");
  const [projeto, setProjeto] = useState("");
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tags, setTags] = useState("");
  const [texto, setTexto] = useState("");
  const [cores, setCores] = useState("");
  const [valorJson, setValorJson] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [filtroProjeto, setFiltroProjeto] = useState(TODOS);

  const removerMut = useMutation({
    mutationFn: (id: string) => removerFn({ data: { id } }),
    onSuccess: () => toast.success("Asset removido."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao remover."),
    onSettled: () => qc.invalidateQueries({ queryKey: ["arte-acervo"] }),
  });

  // Molduras de cargo ficam fora daqui: têm seção própria.
  const lista = useMemo(() => {
    const assets = (query.data?.assets ?? []).filter((a) => a.tipo !== "moldura_cargo");
    return assets.filter(
      (a) =>
        filtroProjeto === TODOS ||
        (filtroProjeto === AGENCIA ? a.projeto_id === null : a.projeto_id === filtroProjeto),
    );
  }, [query.data, filtroProjeto]);

  if (!query.data) return <Estado query={query} />;
  const { projetos } = query.data;
  const nomeProjeto = (id: string | null) =>
    id ? (projetos.find((p) => p.id === id)?.nome ?? "—") : "Agência";

  const ehPaleta = tipo === "paleta";
  const ehTexto = ASSET_DE_TEXTO.has(tipo);
  const exigeEmpresa = ASSET_EXIGE_EMPRESA.has(tipo);
  const arquivoObrigatorio = !ehPaleta && !ehTexto;

  const trocarTipo = (t: TipoAsset) => {
    setTipo(t);
    setArquivo(null);
    // Agência só vale para modelo; nos tipos de marca a empresa é obrigatória.
    if (ASSET_EXIGE_EMPRESA.has(t) && projeto === AGENCIA) setProjeto("");
  };

  const limpar = () => {
    setNome("");
    setDescricao("");
    setTags("");
    setTexto("");
    setCores("");
    setValorJson("");
    setArquivo(null);
  };

  const salvar = async () => {
    let valor: Record<string, unknown> = {};
    if (ehPaleta) {
      const lista = cores
        .split(/[\s,;]+/)
        .map((c) => c.trim())
        .filter(Boolean);
      if (lista.length === 0 || !lista.every((c) => HEX.test(c)))
        return toast.error("Informe as cores no formato #RRGGBB, separadas por vírgula.");
      valor = { cores: lista.map((c) => c.toUpperCase()) };
    } else if (ehTexto) {
      if (!texto.trim())
        return toast.error(tipo === "slogan" ? "Escreva o slogan." : "Escreva o briefing.");
      valor = { texto: texto.trim() };
    } else if (valorJson.trim()) {
      try {
        const parsed: unknown = JSON.parse(valorJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          return toast.error("O valor JSON precisa ser um objeto { … }.");
        valor = parsed as Record<string, unknown>;
      } catch {
        return toast.error("Valor JSON inválido.");
      }
    }
    if (exigeEmpresa && (!projeto || projeto === AGENCIA)) return toast.error("Escolha a empresa.");
    if (!nome.trim()) return toast.error("Dê um nome ao asset.");
    if (arquivoObrigatorio && !arquivo) return toast.error("Envie o arquivo deste asset.");
    if (arquivo) {
      const mime = mimeDoArquivo(arquivo);
      if (!(MARCA_MIMES as readonly string[]).includes(mime))
        return toast.error("Formato de arquivo não aceito.");
      if (arquivo.size > MARCA_TAMANHO_MAX_MB * MB)
        return toast.error(`O arquivo passa de ${MARCA_TAMANHO_MAX_MB} MB.`);
    }

    setSalvando(true);
    try {
      const projeto_id = !projeto || projeto === AGENCIA ? null : projeto;
      const up =
        arquivo && !ehTexto
          ? await subir(arquivo, { destino: "marca", projeto_id, tipo }, "brand-assets")
          : null;
      await salvarFn({
        data: {
          projeto_id,
          tipo,
          nome: nome.trim(),
          descricao: descricao.trim() || undefined,
          tags: separarTags(tags),
          valor,
          arquivo: up ? { path: up.path, mime_type: up.mime_type as MarcaMime } : null,
        },
      });
      toast.success("Asset cadastrado.");
      limpar();
      setAberto(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar o asset.");
    } finally {
      setSalvando(false);
      qc.invalidateQueries({ queryKey: ["arte-acervo"] });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Marcas das empresas</h2>
          <p className="text-xs text-muted-foreground">
            Logo, cores, slogan, briefing, fontes e elementos visuais de cada empresa.
          </p>
        </div>
        <Button
          onClick={() => {
            if (filtroProjeto !== TODOS && filtroProjeto !== AGENCIA) setProjeto(filtroProjeto);
            setAberto((v) => !v);
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> Novo asset
        </Button>
      </div>

      <div className="w-64 space-y-1">
        <Label className="text-xs">Empresa</Label>
        <Select value={filtroProjeto} onValueChange={setFiltroProjeto}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas</SelectItem>
            <SelectItem value={AGENCIA}>Agência (modelos gerais)</SelectItem>
            {projetos.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {aberto && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Tipo *</Label>
              <Select
                value={tipo}
                onValueChange={(v) => trocarTipo(v as TipoAsset)}
                disabled={salvando}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_ASSET_MARCA.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIPOS_ASSET[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Empresa {exigeEmpresa ? "*" : ""}</Label>
              <Select value={projeto} onValueChange={setProjeto} disabled={salvando}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {!exigeEmpresa && (
                    <SelectItem value={AGENCIA}>Agência (vale para todas)</SelectItem>
                  )}
                  {projetos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={200}
                placeholder={ehTexto ? `Ex: ${TIPOS_ASSET[tipo]} principal` : "Ex: Logo principal"}
              />
            </div>
            <div className="space-y-1">
              <Label>Tags (separadas por vírgula)</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
          </div>

          {tipo === "slogan" && (
            <div className="space-y-1">
              <Label>Slogan *</Label>
              <Input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                maxLength={ASSET_TEXTO_MAX.slogan}
                placeholder="Ex: Educação que transforma"
              />
            </div>
          )}

          {tipo === "briefing" && (
            <div className="space-y-1">
              <Label>Briefing da marca *</Label>
              <Textarea
                rows={6}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                maxLength={ASSET_TEXTO_MAX.briefing}
                placeholder="Público, tom de voz, o que a marca comunica, o que evitar…"
              />
              <div className="text-right text-xs text-muted-foreground">
                {texto.length}/{ASSET_TEXTO_MAX.briefing}
              </div>
            </div>
          )}

          {ehPaleta && (
            <div className="space-y-1">
              <Label>Cores * (#RRGGBB, separadas por vírgula)</Label>
              <Input
                value={cores}
                onChange={(e) => setCores(e.target.value)}
                placeholder="#0A2540, #FFCC00, #FFFFFF"
              />
              <Cores cores={cores.split(/[\s,;]+/).filter((c) => HEX.test(c))} />
            </div>
          )}

          <div className="space-y-1">
            <Label>Descrição</Label>
            <Textarea
              rows={2}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={2000}
              placeholder="Quando usar, restrições, observações…"
            />
          </div>

          {!ehTexto && (
            <div className="space-y-1">
              <Label>Arquivo {arquivoObrigatorio ? "*" : "(opcional)"}</Label>
              <Input
                type="file"
                accept={ACCEPT_ASSET[tipo]}
                disabled={salvando}
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">Até {MARCA_TAMANHO_MAX_MB} MB.</p>
            </div>
          )}

          {!ehPaleta && !ehTexto && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Valor em JSON (opcional)
              </summary>
              <Textarea
                rows={3}
                className="mt-2 font-mono text-xs"
                value={valorJson}
                onChange={(e) => setValorJson(e.target.value)}
                placeholder='{ "uso": "fundo escuro" }'
              />
            </details>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={salvando} onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button disabled={salvando} onClick={salvar}>
              {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar asset
            </Button>
          </div>
        </div>
      )}

      {lista.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Nenhum asset cadastrado{filtroProjeto !== TODOS ? " aqui" : ""}.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lista.map((a) => {
            const valor = (a.valor ?? {}) as Record<string, unknown>;
            const coresAsset = Array.isArray(valor.cores) ? (valor.cores as string[]) : [];
            const textoAsset = typeof valor.texto === "string" ? valor.texto : null;
            return (
              <div
                key={a.id}
                className="overflow-hidden rounded-lg border border-border bg-white text-black"
              >
                {a.url && a.imagem ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={a.url}
                      alt={a.nome}
                      className="h-32 w-full bg-gray-50 object-contain p-2"
                      loading="lazy"
                    />
                  </a>
                ) : a.url ? (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-32 items-center justify-center gap-2 bg-gray-50 text-xs text-gray-600 hover:bg-gray-100"
                  >
                    <FileText className="h-5 w-5" /> Abrir arquivo
                  </a>
                ) : null}
                <div className="space-y-1 p-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold">{a.nome}</span>
                    <BotaoRemover
                      disabled={removerMut.isPending}
                      onClick={() => {
                        if (confirm("Remover este asset?")) removerMut.mutate(a.id);
                      }}
                    />
                  </div>
                  <div className="text-gray-600">
                    {TIPOS_ASSET[a.tipo as TipoAsset] ?? a.tipo} • {nomeProjeto(a.projeto_id)}
                  </div>
                  {coresAsset.length > 0 && <Cores cores={coresAsset} />}
                  {textoAsset && (
                    <p
                      className={cn(
                        "whitespace-pre-wrap text-gray-800",
                        a.tipo === "slogan" && "text-sm italic",
                        a.tipo === "briefing" && "line-clamp-6",
                      )}
                    >
                      {textoAsset}
                    </p>
                  )}
                  <Tags tags={a.tags} />
                  {a.descricao && (
                    <p className="whitespace-pre-wrap text-gray-700">{a.descricao}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
