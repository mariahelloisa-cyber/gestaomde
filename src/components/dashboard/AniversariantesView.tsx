import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Cake,
  Check,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Share2,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useTasks } from "@/lib/tasks-store";
import {
  criarAniversariante,
  editarAniversariante,
  excluirAniversariante,
  listarAniversariantes,
  listarPeriodosAniversariantes,
  marcarPublicado,
  MAX_IMAGENS,
  type Aniversariante,
  type ImagemComUrl,
} from "@/lib/aniversariantes.functions";
import {
  BUCKET_ANIVERSARIANTES,
  IMAGEM_TAMANHO_MAX_MB,
  NOMES_MESES,
  TIPOS_IMAGEM_ACEITOS,
  dataPorExtenso,
  diaEMes,
  mesAtualSaoPaulo,
} from "@/lib/aniversariantes";
import { AniversarianteMaterialDialog, StatusPublicacao } from "./AniversarianteMaterial";
import {
  AniversariantesHojeModal,
  CHAVE_ANIVERSARIANTES_HOJE,
  useAniversariantesDeHoje,
} from "./AniversariantesPopup";

const CHAVE_LISTA = "aniversariantes";

export function AniversariantesView() {
  const { myCargo } = useTasks();
  const podeGerenciar = myCargo === "Admin" || myCargo === "Supervisor";

  const hojeSP = mesAtualSaoPaulo();
  const [ano, setAno] = useState(hojeSP.ano);
  const [mes, setMes] = useState<number | null>(hojeSP.mes);

  const qc = useQueryClient();
  const listarFn = useServerFn(listarAniversariantes);
  const { data: lista = [], isLoading } = useQuery({
    queryKey: [CHAVE_LISTA, ano, mes],
    queryFn: () => listarFn({ data: { ano, mes } }),
  });

  const periodosFn = useServerFn(listarPeriodosAniversariantes);
  const { data: periodos = [] } = useQuery({
    queryKey: [CHAVE_LISTA, "periodos"],
    queryFn: () => periodosFn(),
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: [CHAVE_LISTA] });
    qc.invalidateQueries({ queryKey: CHAVE_ANIVERSARIANTES_HOJE });
  };

  const hoje = useAniversariantesDeHoje();
  const [reabrirHoje, setReabrirHoje] = useState(false);

  const [formAberto, setFormAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Aniversariante | null>(null);
  const [material, setMaterial] = useState<Aniversariante | null>(null);
  const [paraExcluir, setParaExcluir] = useState<Aniversariante | null>(null);

  const publicarFn = useServerFn(marcarPublicado);
  const publicarMut = useMutation({
    mutationFn: (vars: { id: string; publicado: boolean }) => publicarFn({ data: vars }),
    onSuccess: (_r, vars) => {
      toast.success(
        vars.publicado
          ? "Marcado como publicado. A equipe inteira passa a ver esse status."
          : "Marcação desfeita: voltou para Pendente.",
      );
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar o status."),
  });

  const excluirFn = useServerFn(excluirAniversariante);
  const excluirMut = useMutation({
    mutationFn: (id: string) => excluirFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Aniversariante excluído.");
      setParaExcluir(null);
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao excluir."),
  });

  /** Quantos cadastros cada mês do ano selecionado já tem — dica no seletor. */
  const totalPorMes = useMemo(() => {
    const mapa = new Map<number, number>();
    for (const p of periodos) if (p.ano === ano) mapa.set(p.mes, p.total);
    return mapa;
  }, [periodos, ano]);

  // Anos oferecidos no filtro: o ano corrente e o próximo (para adiantar o
  // planejamento) mais todos os que já têm cadastro, para nada ficar inacessível.
  const anos = useMemo(() => {
    const conjunto = new Set<number>([hojeSP.ano, hojeSP.ano + 1, ano]);
    for (const p of periodos) conjunto.add(p.ano);
    return [...conjunto].sort((a, b) => b - a);
  }, [hojeSP.ano, ano, periodos]);

  const porData = useMemo(() => {
    const grupos = new Map<string, Aniversariante[]>();
    for (const a of lista) {
      const arr = grupos.get(a.data_comemoracao) ?? [];
      arr.push(a);
      grupos.set(a.data_comemoracao, arr);
    }
    return [...grupos.entries()];
  }, [lista]);

  const pendentes = lista.filter((a) => !a.publicado_em).length;
  const temAniversarioHoje = (hoje.data?.aniversariantes.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Cake className="h-5 w-5 text-primary" />
            Aniversariantes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Planejamento mensal das artes e mensagens que vão para o grupo do WhatsApp. No dia, o
            sistema avisa a equipe com um pop-up.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {temAniversarioHoje && (
            <Button variant="secondary" onClick={() => setReabrirHoje(true)}>
              <Cake className="h-4 w-4" />
              Aniversariantes de hoje
            </Button>
          )}
          {podeGerenciar && (
            <Button
              onClick={() => {
                setEmEdicao(null);
                setFormAberto(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Novo aniversariante
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
        <div className="min-w-[140px]">
          <Label className="text-xs text-muted-foreground">Mês</Label>
          <Select
            value={mes === null ? "todos" : String(mes)}
            onValueChange={(v) => setMes(v === "todos" ? null : Number(v))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Ano inteiro</SelectItem>
              {NOMES_MESES.map((nome, i) => {
                const cadastrados = totalPorMes.get(i + 1) ?? 0;
                return (
                  <SelectItem key={nome} value={String(i + 1)}>
                    {nome}
                    {cadastrados > 0 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">{cadastrados}</span>
                    )}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[110px]">
          <Label className="text-xs text-muted-foreground">Ano</Label>
          <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {anos.map((a) => (
                <SelectItem key={a} value={String(a)}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="ml-auto text-xs text-muted-foreground">
          {lista.length === 0
            ? "Nenhum cadastro no período."
            : `${lista.length} ${lista.length === 1 ? "cadastro" : "cadastros"} · ${pendentes} ${
                pendentes === 1 ? "pendente" : "pendentes"
              } de publicação`}
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : lista.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <Cake className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">
            Nenhum aniversariante neste período.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {podeGerenciar
              ? "Cadastre os aniversariantes do mês com a arte e a mensagem de cada pessoa."
              : "Quando a gestão cadastrar o mês, os aniversariantes aparecem aqui."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {porData.map(([data, pessoas]) => (
            <section key={data} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {dataPorExtenso(data)}
              </h2>
              {pessoas.map((a) => (
                <article
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"
                >
                  <button
                    type="button"
                    onClick={() => setMaterial(a)}
                    className="relative shrink-0"
                    aria-label={`Abrir material de ${a.nome}`}
                  >
                    {a.imagens[0]?.url ? (
                      <img
                        src={a.imagens[0].url}
                        alt=""
                        className="h-14 w-14 rounded-lg border border-border object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-border bg-muted">
                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    {/* Só a capa aparece na lista; o contador avisa que há mais. */}
                    {a.imagens.length > 1 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-semibold text-background">
                        {a.imagens.length}
                      </span>
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMaterial(a)}
                        className="truncate text-sm font-medium text-foreground hover:underline"
                      >
                        {a.nome}
                      </button>
                      <StatusPublicacao
                        publicado_em={a.publicado_em}
                        publicado_por_nome={a.publicado_por_nome}
                      />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {diaEMes(a.data_comemoracao)} ·{" "}
                      {a.publicado_em
                        ? `publicado por ${a.publicado_por_nome ?? "alguém da equipe"}`
                        : a.mensagem.replace(/\s+/g, " ").slice(0, 70) +
                          (a.mensagem.length > 70 ? "…" : "")}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant={a.publicado_em ? "ghost" : "secondary"}
                      onClick={() => publicarMut.mutate({ id: a.id, publicado: !a.publicado_em })}
                      disabled={publicarMut.isPending}
                    >
                      {a.publicado_em ? (
                        <>
                          <Undo2 className="h-3.5 w-3.5" />
                          Desfazer
                        </>
                      ) : (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Marcar como publicado
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setMaterial(a)}
                      title="Abrir o card para compartilhar"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </Button>
                    {podeGerenciar && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEmEdicao(a);
                            setFormAberto(true);
                          }}
                          title="Editar"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setParaExcluir(a)}
                          title="Excluir"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      )}

      {/* Pop-up de hoje reaberto à mão */}
      {hoje.data && (
        <AniversariantesHojeModal
          open={reabrirHoje}
          onOpenChange={setReabrirHoje}
          aniversariantes={hoje.data.aniversariantes}
          data={hoje.data.hoje}
        />
      )}

      <MaterialDoAniversariante
        aniversariante={material}
        onOpenChange={(v) => !v && setMaterial(null)}
        onAlterarPublicacao={(id, publicado) => publicarMut.mutate({ id, publicado })}
        publicando={publicarMut.isPending}
      />

      {podeGerenciar && (
        <AniversarianteFormDialog
          open={formAberto}
          onOpenChange={setFormAberto}
          emEdicao={emEdicao}
          anoPadrao={ano}
          mesPadrao={mes ?? hojeSP.mes}
          onSalvo={invalidar}
        />
      )}

      <AlertDialog open={!!paraExcluir} onOpenChange={(v) => !v && setParaExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {paraExcluir?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              A arte e a mensagem são apagadas, e os links já compartilhados param de funcionar. Não
              tem como desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => paraExcluir && excluirMut.mutate(paraExcluir.id)}
              disabled={excluirMut.isPending}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      
    </div>
  );
}

/** O material num modal, com o controle de publicação no rodapé. */
function MaterialDoAniversariante({
  aniversariante,
  onOpenChange,
  onAlterarPublicacao,
  publicando,
}: {
  aniversariante: Aniversariante | null;
  onOpenChange: (open: boolean) => void;
  onAlterarPublicacao: (id: string, publicado: boolean) => void;
  publicando: boolean;
}) {
  return (
    <AniversarianteMaterialDialog
      material={aniversariante}
      open={!!aniversariante}
      onOpenChange={onOpenChange}
      rodape={
        aniversariante && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <StatusPublicacao
              publicado_em={aniversariante.publicado_em}
              publicado_por_nome={aniversariante.publicado_por_nome}
            />
            <Button
              size="sm"
              variant={aniversariante.publicado_em ? "ghost" : "secondary"}
              onClick={() => onAlterarPublicacao(aniversariante.id, !aniversariante.publicado_em)}
              disabled={publicando}
            >
              {aniversariante.publicado_em ? (
                <>
                  <Undo2 className="h-3.5 w-3.5" />
                  Desfazer marcação
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Marcar como publicado
                </>
              )}
            </Button>
          </div>
        )
      }
    />
  );
}

/** Uma arte na galeria em edição adionar text file: já salva no bucket, ou recém-escolhida. */
interface ItemGaleria {
  /** Estável por item — o path quando já existe, um id aleatório quando é nova. */
  chave: string;
  existente?: ImagemComUrl;
  arquivo?: File;
  /** Signed URL (existente) ou object URL (nova). */
  previa: string | null;
}

/** Devolve ao navegador os object URLs das artes ainda não enviadas. */
function liberarPrevias(itens: ItemGaleria[]): void {
  for (const i of itens) {
    if (i.arquivo && i.previa) URL.revokeObjectURL(i.previa);
  }
}

/** Cadastro e edição, com prévia das artes e da mensagem antes de salvar. */
function AniversarianteFormDialog({
  open,
  onOpenChange,
  emEdicao,
  anoPadrao,
  mesPadrao,
  onSalvo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  emEdicao: Aniversariante | null;
  anoPadrao: number;
  mesPadrao: number;
  onSalvo: () => void;
}) {
  const criarFn = useServerFn(criarAniversariante);
  const editarFn = useServerFn(editarAniversariante);
  const inputArquivo = useRef<HTMLInputElement>(null);

  // A chave remonta o formulário quando troca o registro em edição — evita
  // carregar o estado do anterior.
  const chave = emEdicao?.id ?? "novo";
  const [nome, setNome] = useState("");
  const [data, setData] = useState("");
  const [mensagem, setMensagem] = useState("");
  /**
   * A galeria em edição, na ordem final. Cada item é uma arte que já está no
   * bucket (`existente`) ou uma escolhida agora e ainda não enviada (`arquivo`).
   * Guardar as duas no mesmo array mantém a ordem e simplifica o salvar: ele só
   * precisa subir as novas e mandar a lista inteira.
   */
  const [galeria, setGaleria] = useState<ItemGaleria[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [chaveAtual, setChaveAtual] = useState(chave);

  // Sincroniza com o registro em edição sem useEffect: compara a chave no render.
  if (chaveAtual !== chave) {
    setChaveAtual(chave);
    setNome(emEdicao?.nome ?? "");
    setData(emEdicao?.data_comemoracao ?? `${anoPadrao}-${String(mesPadrao).padStart(2, "0")}-01`);
    setMensagem(emEdicao?.mensagem ?? "");
    liberarPrevias(galeria);
    setGaleria(
      (emEdicao?.imagens ?? []).map((img) => ({
        chave: img.path,
        existente: img,
        previa: img.url,
      })),
    );
  }

  const escolherArquivos = (lista: FileList | null) => {
    if (!lista || lista.length === 0) return;
    const novos: ItemGaleria[] = [];
    for (const file of Array.from(lista)) {
      if (galeria.length + novos.length >= MAX_IMAGENS) {
        toast.error(`Máximo de ${MAX_IMAGENS} artes por aniversariante.`);
        break;
      }
      if (!TIPOS_IMAGEM_ACEITOS.includes(file.type)) {
        toast.error(`"${file.name}" não é JPG, PNG ou WebP.`);
        continue;
      }
      if (file.size > IMAGEM_TAMANHO_MAX_MB * 1024 * 1024) {
        toast.error(`"${file.name}" passa de ${IMAGEM_TAMANHO_MAX_MB} MB.`);
        continue;
      }
      novos.push({
        chave: `novo-${crypto.randomUUID()}`,
        arquivo: file,
        previa: URL.createObjectURL(file),
      });
    }
    if (novos.length > 0) setGaleria((atual) => [...atual, ...novos]);
  };

  const removerDaGaleria = (chaveItem: string) => {
    setGaleria((atual) => {
      const alvo = atual.find((i) => i.chave === chaveItem);
      if (alvo?.arquivo && alvo.previa) URL.revokeObjectURL(alvo.previa);
      return atual.filter((i) => i.chave !== chaveItem);
    });
  };

  /** Move uma arte na ordem — a primeira posição é a capa. */
  const moverNaGaleria = (indice: number, direcao: -1 | 1) => {
    setGaleria((atual) => {
      const destino = indice + direcao;
      if (destino < 0 || destino >= atual.length) return atual;
      const copia = [...atual];
      [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
      return copia;
    });
  };

  const salvar = async () => {
    if (!nome.trim()) return toast.error("Informe o nome da pessoa.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return toast.error("Informe a data da comemoração.");
    if (!mensagem.trim()) return toast.error("Escreva a mensagem.");
    if (galeria.length === 0) return toast.error("Envie pelo menos uma arte ou foto.");

    setSalvando(true);
    try {
      // Sobe só o que é novo e remonta a lista na ordem da tela.
      const imagens = await Promise.all(
        galeria.map(async (item) => {
          if (item.existente) {
            return {
              path: item.existente.path,
              nome: item.existente.nome,
              tipo: item.existente.tipo,
            };
          }
          const file = item.arquivo!;
          // Mesmo padrão dos outros uploads do projeto: pasta aleatória por arquivo.
          const seguro = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
          const path = `${crypto.randomUUID()}/${Date.now()}-${seguro}`;
          const { error: erroUpload } = await supabase.storage
            .from(BUCKET_ANIVERSARIANTES)
            .upload(path, file, { contentType: file.type, upsert: false });
          if (erroUpload)
            throw new Error(`Falha no upload de "${file.name}": ${erroUpload.message}`);
          return { path, nome: file.name, tipo: file.type };
        }),
      );

      if (emEdicao) {
        await editarFn({
          data: {
            id: emEdicao.id,
            nome: nome.trim(),
            data_comemoracao: data,
            mensagem,
            imagens,
          },
        });
        toast.success("Aniversariante atualizado.");
      } else {
        await criarFn({
          data: { nome: nome.trim(), data_comemoracao: data, mensagem, imagens },
        });
        toast.success("Aniversariante cadastrado.");
      }
      onSalvo();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{emEdicao ? `Editar ${emEdicao.nome}` : "Novo aniversariante"}</DialogTitle>
          <DialogDescription>
            A data inclui o ano: o planejamento é cadastrado mês a mês e nenhuma arte ou mensagem é
            reaproveitada automaticamente no ano seguinte.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-4">
            <div>
              <Label htmlFor="aniv-nome">Nome da pessoa</Label>
              <Input
                id="aniv-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Ana Carolina"
                maxLength={120}
              />
            </div>

            <div>
              <Label htmlFor="aniv-data">Data da comemoração</Label>
              <Input
                id="aniv-data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                O pop-up abre neste dia, pelo fuso de Brasília.
              </p>
            </div>

            <div>
              <Label htmlFor="aniv-arte">
                Artes ou fotos{galeria.length > 0 ? ` (${galeria.length}/${MAX_IMAGENS})` : ""}
              </Label>
              <input
                ref={inputArquivo}
                id="aniv-arte"
                type="file"
                multiple
                accept={TIPOS_IMAGEM_ACEITOS.join(",")}
                className="hidden"
                onChange={(e) => {
                  escolherArquivos(e.target.files);
                  // Zera para poder reescolher o mesmo arquivo depois de removê-lo.
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => inputArquivo.current?.click()}
                disabled={galeria.length >= MAX_IMAGENS}
              >
                <Upload className="h-4 w-4" />
                {galeria.length === 0 ? "Escolher imagens" : "Adicionar mais"}
              </Button>

              {galeria.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {galeria.map((item, i) => (
                    <li
                      key={item.chave}
                      className="flex items-center gap-2 rounded-lg border border-border bg-card p-1.5"
                    >
                      {item.previa ? (
                        <img
                          src={item.previa}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded border border-border object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-muted">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-foreground">
                          {item.existente?.nome ?? item.arquivo?.name}
                        </p>
                        {i === 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            Capa — miniatura e prévia do link
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => moverNaGaleria(i, -1)}
                          disabled={i === 0}
                          title="Subir"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => moverNaGaleria(i, 1)}
                          disabled={i === galeria.length - 1}
                          title="Descer"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => removerDaGaleria(item.chave)}
                          title="Remover"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-1 text-xs text-muted-foreground">
                JPG, PNG ou WebP, até {IMAGEM_TAMANHO_MAX_MB} MB cada. São estas imagens que vão ao
                WhatsApp — com mais de uma, elas são enviadas juntas, como álbum.
              </p>
            </div>

            <div>
              <Label htmlFor="aniv-mensagem">Mensagem</Label>
              <Textarea
                id="aniv-mensagem"
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                rows={7}
                maxLength={4000}
                placeholder={
                  "Parabéns, Ana! 🎉\n\nQue seu dia seja leve e cheio de alegria.\nToda a equipe te deseja o melhor! 🎂"
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Acentos, emojis e quebras de linha são preservados exatamente como aqui.
              </p>
            </div>
          </div>

          {/* Prévia: é o que a equipe vai ver e enviar. */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Prévia
            </p>
            <div className="space-y-3 rounded-xl border border-border bg-[var(--surface-1)] p-3">
              {galeria.length > 0 ? (
                <div className="space-y-2">
                  {galeria.map((item, i) =>
                    item.previa ? (
                      <div key={item.chave} className="relative">
                        <img
                          src={item.previa}
                          alt={`Prévia da arte ${i + 1}`}
                          className="w-full rounded-lg border border-border object-contain"
                        />
                        {galeria.length > 1 && (
                          <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">
                            {i + 1}/{galeria.length}
                          </span>
                        )}
                      </div>
                    ) : null,
                  )}
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                  As artes aparecem aqui
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-foreground">{nome || "Nome da pessoa"}</p>
                <p className="text-xs text-muted-foreground">
                  {/^\d{4}-\d{2}-\d{2}$/.test(data) ? dataPorExtenso(data) : "Data da comemoração"}
                </p>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                {mensagem || "A mensagem aparece aqui, com os emojis e as quebras de linha."}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            {emEdicao ? "Salvar alterações" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
