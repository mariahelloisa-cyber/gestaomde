import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Building2,
  CalendarHeart,
  FileText,
  ImagePlus,
  Info,
  Layers,
  Loader2,
  Lock,
  Ruler,
  Send,
  User,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  enviarSolicitacaoArte,
  iniciarSolicitacaoArte,
  listOpcoesFormularioArte,
} from "@/lib/arte.functions";
import {
  ARQUIVO_MIMES,
  ARQUIVO_TAMANHO_MAX,
  ARQUIVO_TAMANHO_MAX_MB,
  CARROSSEL_SLIDES_MAX,
  CARROSSEL_SLIDES_MIN,
  NIVEIS_CARGO,
  NIVEL_CARGO_CONFIG,
  PANFLETO_MM_MAX,
  PANFLETO_MM_MIN,
  TIPOS_ARTE,
  TIPOS_CONFIG,
  solicitacaoArteSchema,
  validarArquivos,
  type CategoriaArquivo,
  type NivelCargo,
  type TipoArte,
} from "@/lib/arte/tipos";
import { Button } from "@/components/ui/button";
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

const BUCKET = "art-request-files";

type Arquivos = Record<CategoriaArquivo, File[]>;
const SEM_ARQUIVOS: Arquivos = { foto_pessoa: [], referencia: [], elemento_obrigatorio: [] };

function Campo({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </div>
  );
}

export function NovaArteForm({ onEnviado }: { onEnviado: () => void }) {
  const opcoesFn = useServerFn(listOpcoesFormularioArte);
  const iniciarFn = useServerFn(iniciarSolicitacaoArte);
  const enviarFn = useServerFn(enviarSolicitacaoArte);

  const {
    data: opcoes,
    isLoading: carregandoOpcoes,
    isError: erroOpcoes,
    refetch,
  } = useQuery({
    queryKey: ["arte-opcoes-formulario"],
    queryFn: () => opcoesFn(),
  });

  const [tipo, setTipo] = useState<TipoArte | null>(null);
  const [projetoId, setProjetoId] = useState("");
  const [briefing, setBriefing] = useState("");
  const [nome, setNome] = useState("");
  const [cargo, setCargo] = useState("");
  const [nivelCargo, setNivelCargo] = useState<NivelCargo | "">("");
  const [tamanho, setTamanho] = useState<"padrao" | "personalizado">("padrao");
  const [larguraMm, setLarguraMm] = useState("");
  const [alturaMm, setAlturaMm] = useState("");
  const [data, setData] = useState("");
  const [descricaoData, setDescricaoData] = useState("");
  const [qtdSlides, setQtdSlides] = useState(String(CARROSSEL_SLIDES_MIN));
  const [funcao, setFuncao] = useState("");
  const [beneficios, setBeneficios] = useState("");
  const [aviso, setAviso] = useState("");
  const [arquivos, setArquivos] = useState<Arquivos>(SEM_ARQUIVOS);
  const [etapa, setEtapa] = useState<string | null>(null);

  const config = tipo ? TIPOS_CONFIG[tipo] : null;
  const enviando = etapa !== null;

  const escolherTipo = (t: TipoArte) => {
    setTipo(t);
    // Arquivos de categorias que o novo tipo não aceita não podem ir junto.
    const permitidas = new Set(TIPOS_CONFIG[t].uploads.map((u) => u.categoria));
    setArquivos((prev) => ({
      foto_pessoa: permitidas.has("foto_pessoa") ? prev.foto_pessoa : [],
      referencia: permitidas.has("referencia") ? prev.referencia : [],
      elemento_obrigatorio: permitidas.has("elemento_obrigatorio") ? prev.elemento_obrigatorio : [],
    }));
  };

  const adicionarArquivos = (categoria: CategoriaArquivo, max: number, files: FileList | null) => {
    if (!files) return;
    const aceitos: File[] = [];
    for (const f of Array.from(files)) {
      if (!(ARQUIVO_MIMES as readonly string[]).includes(f.type)) {
        toast.error(`"${f.name}": use JPG, PNG ou WebP.`);
        continue;
      }
      if (f.size > ARQUIVO_TAMANHO_MAX) {
        toast.error(`"${f.name}" passa de ${ARQUIVO_TAMANHO_MAX_MB} MB.`);
        continue;
      }
      aceitos.push(f);
    }
    setArquivos((prev) => {
      const juntos = max === 1 ? aceitos.slice(-1) : [...prev[categoria], ...aceitos];
      if (juntos.length > max) toast.error(`No máximo ${max} arquivo(s) aqui.`);
      return { ...prev, [categoria]: juntos.slice(0, max) };
    });
  };

  const removerArquivo = (categoria: CategoriaArquivo, idx: number) =>
    setArquivos((prev) => ({ ...prev, [categoria]: prev[categoria].filter((_, i) => i !== idx) }));

  const dados = useMemo(() => {
    if (!tipo) return null;
    const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
    switch (tipo) {
      case "foto_perfil":
        return { tipo, nome, nivel_cargo: nivelCargo, cargo };
      case "panfleto":
        return {
          tipo,
          projeto_id: projetoId,
          briefing,
          tamanho,
          largura_mm: tamanho === "personalizado" ? num(larguraMm) : undefined,
          altura_mm: tamanho === "personalizado" ? num(alturaMm) : undefined,
        };
      case "feed_data_comemorativa":
        return { tipo, projeto_id: projetoId, data, descricao_data: descricaoData, briefing };
      case "carrossel":
        return { tipo, projeto_id: projetoId, qtd_slides: Number(qtdSlides), briefing };
      case "vaga_emprego":
        return { tipo, projeto_id: projetoId, funcao, beneficios, briefing };
      case "aviso":
        return { tipo, projeto_id: projetoId, aviso, briefing };
      default:
        return { tipo, projeto_id: projetoId, briefing };
    }
  }, [
    tipo,
    nome,
    cargo,
    nivelCargo,
    projetoId,
    briefing,
    tamanho,
    larguraMm,
    alturaMm,
    data,
    descricaoData,
    qtdSlides,
    funcao,
    beneficios,
    aviso,
  ]);

  const limpar = () => {
    setTipo(null);
    setProjetoId("");
    setBriefing("");
    setNome("");
    setCargo("");
    setNivelCargo("");
    setTamanho("padrao");
    setLarguraMm("");
    setAlturaMm("");
    setData("");
    setDescricaoData("");
    setQtdSlides(String(CARROSSEL_SLIDES_MIN));
    setFuncao("");
    setBeneficios("");
    setAviso("");
    setArquivos(SEM_ARQUIVOS);
  };

  const enviar = async () => {
    if (!tipo || !dados) {
      toast.error("Escolha o tipo de arte.");
      return;
    }
    const parsed = solicitacaoArteSchema.safeParse(dados);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Confira os campos.");
      return;
    }
    const lista = (Object.keys(arquivos) as CategoriaArquivo[]).flatMap((categoria) =>
      arquivos[categoria].map((file) => ({ categoria, file })),
    );
    const erroArquivos = validarArquivos(tipo, lista);
    if (erroArquivos) {
      toast.error(erroArquivos);
      return;
    }

    try {
      setEtapa("Preparando…");
      const { art_request_id, uploads } = await iniciarFn({
        data: {
          dados: parsed.data,
          arquivos: lista.map(({ categoria, file }) => ({
            categoria,
            nome_arquivo: file.name.slice(0, 255),
            mime_type: file.type as (typeof ARQUIVO_MIMES)[number],
            tamanho_bytes: file.size,
          })),
        },
      });

      for (const [n, u] of uploads.entries()) {
        setEtapa(`Enviando arquivos (${n + 1}/${uploads.length})…`);
        const { file } = lista[u.indice];
        const { error } = await supabase.storage
          .from(BUCKET)
          .uploadToSignedUrl(u.path, u.token, file, { contentType: file.type });
        if (error) throw new Error(`Falha no upload de "${file.name}": ${error.message}`);
      }

      setEtapa("Finalizando…");
      await enviarFn({ data: { art_request_id } });

      toast.success("Solicitação de arte enviada!");
      limpar();
      onEnviado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar a solicitação.");
    } finally {
      setEtapa(null);
    }
  };

  if (carregandoOpcoes) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-border bg-white p-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (erroOpcoes || !opcoes) {
    return (
      <div className="space-y-3 rounded-2xl border border-border bg-white p-8 text-center text-sm">
        <p className="text-muted-foreground">Não foi possível carregar o formulário de arte.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-2xl border border-border bg-white p-6 shadow-sm sm:p-8">
      <div className="space-y-2">
        <Label className="font-semibold">Tipo de arte *</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {TIPOS_ARTE.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => escolherTipo(t)}
              disabled={enviando}
              className={cn(
                "rounded-xl border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-muted",
                tipo === t && "border-primary bg-primary/5 ring-1 ring-primary",
              )}
            >
              <div className="text-sm font-semibold text-foreground">{TIPOS_CONFIG[t].rotulo}</div>
              <div className="text-xs text-muted-foreground">{TIPOS_CONFIG[t].formato}</div>
            </button>
          ))}
        </div>
      </div>

      {tipo && config && (
        <>
          <hr className="border-border" />

          {config.usaProjeto && (
            <Campo icon={Building2}>
              <Label className="font-semibold">Empresa *</Label>
              {opcoes.projetos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma empresa cadastrada ainda. Fale com a equipe.
                </p>
              ) : (
                <Select value={projetoId} onValueChange={setProjetoId} disabled={enviando}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha a empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {opcoes.projetos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Campo>
          )}

          {tipo === "foto_perfil" && (
            <Campo icon={User}>
              <div className="space-y-1.5">
                <Label htmlFor="arte-nome" className="font-semibold">
                  Nome *
                </Label>
                <Input
                  id="arte-nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  maxLength={120}
                  placeholder="Como deve aparecer na foto"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="font-semibold">Nível do cargo *</Label>
                  <Select
                    value={nivelCargo}
                    onValueChange={(v) => setNivelCargo(v as NivelCargo)}
                    disabled={enviando}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha o nível" />
                    </SelectTrigger>
                    <SelectContent>
                      {NIVEIS_CARGO.map((n) => (
                        <SelectItem key={n} value={n}>
                          {NIVEL_CARGO_CONFIG[n].rotulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="arte-cargo" className="font-semibold">
                    Cargo *
                  </Label>
                  <Input
                    id="arte-cargo"
                    value={cargo}
                    onChange={(e) => setCargo(e.target.value)}
                    maxLength={120}
                    placeholder="Ex: Gerente Comercial"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                O modelo é sempre o mesmo: a moldura segue o nível escolhido e o cargo aparece
                abaixo do nome.
              </p>
            </Campo>
          )}

          {tipo === "panfleto" && (
            <Campo icon={Ruler}>
              <Label className="font-semibold">Tamanho *</Label>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                {(["padrao", "personalizado"] as const).map((op) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => setTamanho(op)}
                    disabled={enviando}
                    className={cn(
                      "rounded-md py-1.5 text-sm font-medium transition-colors",
                      tamanho === op
                        ? "bg-background text-foreground shadow"
                        : "text-muted-foreground",
                    )}
                  >
                    {op === "padrao" ? "Padrão 15 × 21 cm" : "Personalizado"}
                  </button>
                ))}
              </div>
              {tamanho === "personalizado" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="arte-largura">Largura (mm)</Label>
                    <Input
                      id="arte-largura"
                      type="number"
                      inputMode="numeric"
                      min={PANFLETO_MM_MIN}
                      max={PANFLETO_MM_MAX}
                      value={larguraMm}
                      onChange={(e) => setLarguraMm(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="arte-altura">Altura (mm)</Label>
                    <Input
                      id="arte-altura"
                      type="number"
                      inputMode="numeric"
                      min={PANFLETO_MM_MIN}
                      max={PANFLETO_MM_MAX}
                      value={alturaMm}
                      onChange={(e) => setAlturaMm(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </Campo>
          )}

          {tipo === "feed_data_comemorativa" && (
            <Campo icon={CalendarHeart}>
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <div className="space-y-1.5">
                  <Label htmlFor="arte-data" className="font-semibold">
                    Data *
                  </Label>
                  <Input
                    id="arte-data"
                    type="date"
                    value={data}
                    onChange={(e) => setData(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="arte-desc-data" className="font-semibold">
                    Que data é essa? *
                  </Label>
                  <Input
                    id="arte-desc-data"
                    value={descricaoData}
                    onChange={(e) => setDescricaoData(e.target.value)}
                    maxLength={200}
                    placeholder="Ex: Dia do Professor"
                  />
                </div>
              </div>
            </Campo>
          )}

          {tipo === "carrossel" && (
            <Campo icon={Layers}>
              <Label htmlFor="arte-slides" className="font-semibold">
                Quantidade de slides *
              </Label>
              <Input
                id="arte-slides"
                type="number"
                inputMode="numeric"
                className="w-32"
                min={CARROSSEL_SLIDES_MIN}
                max={CARROSSEL_SLIDES_MAX}
                value={qtdSlides}
                onChange={(e) => setQtdSlides(e.target.value)}
              />
            </Campo>
          )}

          {tipo === "vaga_emprego" && (
            <Campo icon={FileText}>
              <div className="space-y-1.5">
                <Label htmlFor="arte-funcao" className="font-semibold">
                  Função *
                </Label>
                <Input
                  id="arte-funcao"
                  value={funcao}
                  onChange={(e) => setFuncao(e.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="arte-beneficios" className="font-semibold">
                  Benefícios *
                </Label>
                <Textarea
                  id="arte-beneficios"
                  rows={3}
                  value={beneficios}
                  onChange={(e) => setBeneficios(e.target.value)}
                  maxLength={2000}
                />
              </div>
            </Campo>
          )}

          {tipo === "aviso" && (
            <Campo icon={FileText}>
              <Label htmlFor="arte-aviso" className="font-semibold">
                Aviso *
              </Label>
              <Textarea
                id="arte-aviso"
                rows={3}
                value={aviso}
                onChange={(e) => setAviso(e.target.value)}
                maxLength={2000}
                placeholder="O texto do aviso que deve aparecer na arte"
              />
            </Campo>
          )}

          {tipo !== "foto_perfil" && (
            <Campo icon={FileText}>
              <Label htmlFor="arte-briefing" className="font-semibold">
                Briefing *
              </Label>
              <Textarea
                id="arte-briefing"
                rows={5}
                value={briefing}
                onChange={(e) => setBriefing(e.target.value)}
                maxLength={5000}
                placeholder="Descreva o que a arte precisa comunicar, tom, cores, público…"
              />
              <div className="text-right text-xs text-muted-foreground">{briefing.length}/5000</div>
            </Campo>
          )}

          {config.uploads.map((u) => (
            <Campo key={u.categoria} icon={ImagePlus}>
              <Label className="font-semibold">{u.rotulo}</Label>
              <label
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-background px-4 py-6 text-center transition-colors hover:bg-muted",
                  enviando && "pointer-events-none opacity-60",
                )}
              >
                <span className="text-sm font-semibold text-foreground">
                  {u.max === 1 ? "Selecionar imagem" : `Selecionar imagens (até ${u.max})`}
                </span>
                <span className="text-xs text-muted-foreground">
                  JPG, PNG ou WebP • até {ARQUIVO_TAMANHO_MAX_MB} MB cada
                </span>
                <input
                  type="file"
                  accept={ARQUIVO_MIMES.join(",")}
                  multiple={u.max > 1}
                  className="hidden"
                  onChange={(e) => {
                    adicionarArquivos(u.categoria, u.max, e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              {arquivos[u.categoria].length > 0 && (
                <ul className="space-y-1">
                  {arquivos[u.categoria].map((f, i) => (
                    <li
                      key={`${f.name}-${i}`}
                      className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm"
                    >
                      <span className="truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => removerArquivo(u.categoria, i)}
                        disabled={enviando}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={`Remover ${f.name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Campo>
          ))}

          <p className="flex items-start gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />A equipe analisa o pedido e produz a
            arte. Ela fica disponível para download aqui depois de aprovada internamente.
          </p>

          <Button onClick={enviar} disabled={enviando} className="h-12 w-full rounded-xl text-base">
            {enviando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {etapa ?? "Enviar solicitação de arte"}
          </Button>
        </>
      )}

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5 shrink-0" />
        Os arquivos ficam em área privada e só a equipe tem acesso.
      </p>
    </div>
  );
}
