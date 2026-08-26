import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Facebook,
  Globe,
  Instagram,
  Linkedin,
  Network,
  Pencil,
  Plus,
  Trash2,
  Twitter,
  X,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTasks } from "@/lib/tasks-store";
import tiktokLogo from "@/assets/tiktok.png";
import reclameAquiLogo from "@/assets/reclameaqui.png";
import googleLogo from "@/assets/google.webp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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
  listOrganogramaNos,
  criarNoOrganograma,
  renomearNoOrganograma,
  excluirNoOrganograma,
  marcarAuditoriaOrganograma,
} from "@/lib/organograma.functions";
import { auditoriaEmDia } from "@/lib/organograma-auditoria";

type No = Awaited<ReturnType<typeof listOrganogramaNos>>[number];

type ConfigRede = {
  match: RegExp;
  /** Cor sólida usada na borda do card e (quando não há ícone com selo) no próprio ícone. */
  cor: string;
  /** Ícone da lucide-react, quando existe um equivalente de marca disponível. */
  Icon?: LucideIcon;
  /** Fundo do selo atrás do ícone (sólido ou gradiente). Sem selo = ícone "solto" na cor sólida (ex: Site). */
  selo?: string;
  /** Logo da marca em imagem, quando não há ícone equivalente na lucide-react. */
  logo?: string;
};

const REDES_SOCIAIS: ConfigRede[] = [
  { match: /site|website|blog/i, cor: "#3B82F6", Icon: Globe },
  {
    match: /instagram/i,
    cor: "#E1306C",
    Icon: Instagram,
    selo: "linear-gradient(135deg,#f58529,#dd2a7b,#8134af,#515bd4)",
  },
  { match: /facebook/i, cor: "#1877F2", Icon: Facebook, selo: "#1877F2" },
  { match: /youtube/i, cor: "#FF0000", Icon: Youtube, selo: "#FF0000" },
  { match: /linkedin/i, cor: "#0A66C2", Icon: Linkedin, selo: "#0A66C2" },
  { match: /twitter|^x$/i, cor: "#000000", Icon: Twitter, selo: "#000000" },
  { match: /tiktok/i, cor: "#000000", logo: tiktokLogo },
  { match: /whats ?app/i, cor: "#25D366", selo: "#25D366" },
  { match: /reclame\s*aqui/i, cor: "#4CAF50", logo: reclameAquiLogo },
  { match: /google/i, cor: "#4285F4", logo: googleLogo },
  { match: /pinterest/i, cor: "#E60023", selo: "#E60023" },
  { match: /telegram/i, cor: "#229ED9", selo: "#229ED9" },
  { match: /snapchat/i, cor: "#FFFC00", selo: "#FFFC00" },
  { match: /spotify/i, cor: "#1DB954", selo: "#1DB954" },
  { match: /kwai/i, cor: "#FF7900", selo: "#FF7900" },
  { match: /threads/i, cor: "#000000", selo: "#000000" },
];

const REDE_PADRAO: ConfigRede = { match: /$^/, cor: "#0EA5E9", selo: "#0EA5E9" };

function configRedeSocial(nome: string): ConfigRede {
  return REDES_SOCIAIS.find((r) => r.match.test(nome.trim())) ?? REDE_PADRAO;
}

function IconeRede({
  nome,
  config,
  className,
}: {
  nome: string;
  config: ConfigRede;
  className?: string;
}) {
  if (config.logo) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white",
          className,
        )}
      >
        <img src={config.logo} alt={nome} className="h-full w-full object-cover" />
      </span>
    );
  }
  if (config.Icon && !config.selo) {
    const { Icon } = config;
    return <Icon className={className} style={{ color: config.cor }} />;
  }
  if (config.Icon) {
    const { Icon } = config;
    return (
      <span
        className={cn("flex shrink-0 items-center justify-center rounded-md", className)}
        style={{ background: config.selo }}
      >
        <Icon className="h-[60%] w-[60%] text-white" strokeWidth={2.25} />
      </span>
    );
  }
  const iniciais = nome
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white",
        className,
      )}
      style={{ background: config.selo ?? config.cor }}
    >
      {iniciais}
    </span>
  );
}

// Ordem fixa dos cards de rede social — quem não estiver nessa lista mantém a
// ordem relativa de criação, no fim.
const ORDEM_REDES_SOCIAIS = [
  "Site",
  "Instagram",
  "Facebook",
  "TikTok",
  "YouTube",
  "Reclame Aqui",
  "Google Meu Negócio",
];

function ordenarFilhos(filhos: No[]): No[] {
  return [...filhos].sort((a, b) => {
    const ia = ORDEM_REDES_SOCIAIS.indexOf(a.nome);
    const ib = ORDEM_REDES_SOCIAIS.indexOf(b.nome);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export function OrganogramaView() {
  const qc = useQueryClient();
  const { myCargo } = useTasks();
  const podeEditar = myCargo === "Admin" || myCargo === "Supervisor";

  const listFn = useServerFn(listOrganogramaNos);
  const criarFn = useServerFn(criarNoOrganograma);
  const renomearFn = useServerFn(renomearNoOrganograma);
  const excluirFn = useServerFn(excluirNoOrganograma);
  const marcarAuditoriaFn = useServerFn(marcarAuditoriaOrganograma);

  const { data: nos = [], isLoading } = useQuery({
    queryKey: ["organograma"],
    queryFn: () => listFn(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["organograma"] });

  const filhosPorPai = useMemo(() => {
    const m = new Map<string | null, No[]>();
    for (const n of nos) {
      const chave = n.parent_id;
      const arr = m.get(chave) ?? [];
      arr.push(n);
      m.set(chave, arr);
    }
    for (const [chave, arr] of m) {
      m.set(chave, ordenarFilhos(arr));
    }
    return m;
  }, [nos]);

  const raiz = filhosPorPai.get(null)?.[0] ?? null;

  const contarDescendentes = (id: string): number => {
    const filhos = filhosPorPai.get(id) ?? [];
    return filhos.reduce((acc, f) => acc + 1 + contarDescendentes(f.id), 0);
  };

  const renomear = async (id: string, nome: string, link: string | null) => {
    try {
      await renomearFn({ data: { id, nome, link } });
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao renomear.");
    }
  };

  const alternarAuditoria = async (id: string, marcada: boolean) => {
    try {
      await marcarAuditoriaFn({ data: { id, marcada } });
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao marcar auditoria.");
    }
  };

  // Seleção + ações: clicar num card apenas o seleciona; as ações (editar,
  // adicionar, excluir) ficam num painel fixo no cabeçalho, não mais dentro
  // de cada card.
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const noSelecionado = selecionadoId ? (nos.find((n) => n.id === selecionadoId) ?? null) : null;

  const alternarSelecao = (id: string) => {
    setSelecionadoId((atual) => (atual === id ? null : id));
    setEditandoId(null);
  };

  const [addParaId, setAddParaId] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [novoLink, setNovoLink] = useState("");
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const noParaAdicionar = addParaId ? (nos.find((n) => n.id === addParaId) ?? null) : null;

  const abrirAdicionar = (parentId: string) => {
    setNovoNome("");
    setNovoLink("");
    setAddParaId(parentId);
  };

  const criarFilho = async () => {
    if (!addParaId || !novoNome.trim()) return;
    setSalvandoNovo(true);
    try {
      await criarFn({
        data: { nome: novoNome.trim(), parent_id: addParaId, link: novoLink.trim() || null },
      });
      invalidate();
      setAddParaId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao adicionar ramificação.");
    } finally {
      setSalvandoNovo(false);
    }
  };

  const [excluirParaId, setExcluirParaId] = useState<string | null>(null);
  const noParaExcluir = excluirParaId ? (nos.find((n) => n.id === excluirParaId) ?? null) : null;
  const descendentesParaExcluir = excluirParaId ? contarDescendentes(excluirParaId) : 0;

  const confirmarExcluir = async () => {
    if (!excluirParaId) return;
    const id = excluirParaId;
    try {
      await excluirFn({ data: { id } });
      invalidate();
      toast.success("Excluído.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir.");
    } finally {
      setExcluirParaId(null);
      setSelecionadoId((atual) => (atual === id ? null : atual));
      setEditandoId((atual) => (atual === id ? null : atual));
    }
  };

  const [rootDialogOpen, setRootDialogOpen] = useState(false);
  const [rootNome, setRootNome] = useState("");
  const [salvandoRoot, setSalvandoRoot] = useState(false);

  const criarRaiz = async () => {
    if (!rootNome.trim()) return;
    setSalvandoRoot(true);
    try {
      await criarFn({ data: { nome: rootNome.trim(), parent_id: null } });
      invalidate();
      setRootDialogOpen(false);
      setRootNome("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar organização.");
    } finally {
      setSalvandoRoot(false);
    }
  };

  // Arrastar para navegar pelo organograma (clicar e arrastar em qualquer
  // ponto do quadro), em vez de depender só da barra de rolagem.
  const scrollRef = useRef<HTMLDivElement>(null);
  const arrastoRef = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
    moveu: boolean;
  } | null>(null);
  const bloquearCliqueRef = useRef(false);

  const iniciarArrasto = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el || e.button !== 0) return;
    // Não inicia o arrasto (nem tira o foco) quando o clique começa num
    // campo de formulário, botão ou link — precisam do mousedown normal.
    const alvo = e.target as HTMLElement;
    if (alvo.closest("input, textarea, button, a, [contenteditable]")) return;
    e.preventDefault();
    arrastoRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      moveu: false,
    };
  };

  const moverArrasto = (e: React.MouseEvent) => {
    const a = arrastoRef.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    if (e.buttons !== 1) {
      arrastoRef.current = null;
      return;
    }
    e.preventDefault();
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    if (!a.moveu && Math.hypot(dx, dy) > 4) {
      a.moveu = true;
      bloquearCliqueRef.current = true;
    }
    if (a.moveu) {
      el.scrollLeft = a.scrollLeft - dx;
      el.scrollTop = a.scrollTop - dy;
    }
  };

  const finalizarArrasto = () => {
    arrastoRef.current = null;
  };

  return (
    <div className="mx-auto max-w-[1800px] space-y-6 p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Organograma</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {podeEditar
              ? "Clique numa caixa para selecioná-la; as ações aparecem aqui ao lado."
              : "Estrutura da equipe — somente visualização."}
          </p>
        </div>

        {podeEditar && noSelecionado && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
            <span className="max-w-[160px] truncate text-sm font-medium">{noSelecionado.nome}</span>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setEditandoId(noSelecionado.id)}
                title="Editar"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => abrirAdicionar(noSelecionado.id)}
                title="Adicionar ramificação"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => setExcluirParaId(noSelecionado.id)}
                title="Excluir"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setSelecionadoId(null)}
              title="Fechar"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </header>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : !raiz ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Network className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Nenhum organograma criado ainda.</p>
          {podeEditar && (
            <Button className="mt-4" onClick={() => setRootDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Criar organização
            </Button>
          )}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="h-[calc(100vh_-_140px)] min-h-[500px] w-full cursor-grab select-none overflow-auto rounded-lg border border-border bg-[var(--surface-2)] py-10 active:cursor-grabbing"
          onMouseDown={iniciarArrasto}
          onMouseMove={moverArrasto}
          onMouseUp={finalizarArrasto}
          onMouseLeave={finalizarArrasto}
          onDragStart={(e) => e.preventDefault()}
          onClickCapture={(e) => {
            if (bloquearCliqueRef.current) {
              bloquearCliqueRef.current = false;
              e.stopPropagation();
            }
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelecionadoId(null);
          }}
        >
          <ul className="org-chart min-w-max px-8">
            <OrgNode
              node={raiz}
              nivel={0}
              filhosPorPai={filhosPorPai}
              podeEditar={podeEditar}
              onRenomear={renomear}
              onAuditoria={alternarAuditoria}
              selecionadoId={selecionadoId}
              onSelecionar={alternarSelecao}
              editandoId={editandoId}
              onFecharEdicao={() => setEditandoId(null)}
            />
          </ul>
        </div>
      )}

      <Dialog open={rootDialogOpen} onOpenChange={setRootDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar organização</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="raiz-nome">Nome do topo do organograma</Label>
            <Input
              id="raiz-nome"
              value={rootNome}
              onChange={(e) => setRootNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criarRaiz()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRootDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={criarRaiz} disabled={!rootNome.trim() || salvandoRoot}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!addParaId} onOpenChange={(o) => !o && setAddParaId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova ramificação em "{noParaAdicionar?.nome}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="novo-no-nome">Nome</Label>
            <Input
              id="novo-no-nome"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criarFilho()}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="novo-no-link">Link (opcional)</Label>
            <Input
              id="novo-no-link"
              value={novoLink}
              onChange={(e) => setNovoLink(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criarFilho()}
              placeholder="https://..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddParaId(null)}>
              Cancelar
            </Button>
            <Button onClick={criarFilho} disabled={!novoNome.trim() || salvandoNovo}>
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!excluirParaId} onOpenChange={(o) => !o && setExcluirParaId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{noParaExcluir?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {descendentesParaExcluir > 0
                ? `Isso também vai excluir ${descendentesParaExcluir} ramificação(ões) abaixo dele. Ação permanente.`
                : "Ação permanente."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmarExcluir}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OrgNode({
  node,
  nivel,
  filhosPorPai,
  podeEditar,
  onRenomear,
  onAuditoria,
  selecionadoId,
  onSelecionar,
  editandoId,
  onFecharEdicao,
}: {
  node: No;
  nivel: number;
  filhosPorPai: Map<string | null, No[]>;
  podeEditar: boolean;
  onRenomear: (id: string, nome: string, link: string | null) => Promise<void>;
  onAuditoria: (id: string, marcada: boolean) => Promise<void>;
  selecionadoId: string | null;
  onSelecionar: (id: string) => void;
  editandoId: string | null;
  onFecharEdicao: () => void;
}) {
  const filhos = filhosPorPai.get(node.id) ?? [];
  const temLink = !!node.link;
  const filhosSaoFolhas =
    filhos.length > 0 && filhos.every((f) => (filhosPorPai.get(f.id) ?? []).length === 0);

  const selecionado = selecionadoId === node.id;
  const editando = editandoId === node.id;

  const [nomeEdit, setNomeEdit] = useState(node.nome);
  const [linkEdit, setLinkEdit] = useState(node.link ?? "");
  const [salvandoNome, setSalvandoNome] = useState(false);

  useEffect(() => {
    if (editando) {
      setNomeEdit(node.nome);
      setLinkEdit(node.link ?? "");
    }
  }, [editando, node.nome, node.link]);

  const salvarNome = async () => {
    const nome = nomeEdit.trim();
    const link = linkEdit.trim() || null;
    if (!nome || (nome === node.nome && link === (node.link ?? null))) {
      onFecharEdicao();
      return;
    }
    setSalvandoNome(true);
    try {
      await onRenomear(node.id, nome, link);
      onFecharEdicao();
    } finally {
      setSalvandoNome(false);
    }
  };

  const redeConfig = temLink ? configRedeSocial(node.nome) : null;
  const auditada = auditoriaEmDia(node.auditoria_marcada_em);

  // Raiz e o primeiro nível (as ramificações logo abaixo dela) usam cor de
  // fundo sólida da marca em vez da caixa branca padrão.
  const selecionavel = podeEditar && !editando;
  const clicarCard = () => {
    if (selecionavel) onSelecionar(node.id);
  };
  // Usa outline (não ring/box-shadow) para não conflitar com o box-shadow
  // inline que desenha a borda colorida dos cards de rede social.
  const anelSelecao = selecionado
    ? "outline outline-2 outline-offset-2 outline-[var(--color-primary)]"
    : "";

  const formEdicao = (
    <div className="w-[160px] space-y-1.5 p-2">
      <Input
        autoFocus
        value={nomeEdit}
        onChange={(e) => setNomeEdit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") salvarNome();
          if (e.key === "Escape") onFecharEdicao();
        }}
        placeholder="Nome"
        disabled={salvandoNome}
        className="h-7 bg-white text-sm text-black placeholder:text-gray-400"
      />
      <Input
        value={linkEdit}
        onChange={(e) => setLinkEdit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") salvarNome();
          if (e.key === "Escape") onFecharEdicao();
        }}
        placeholder="Link (opcional)"
        disabled={salvandoNome}
        className="h-7 bg-white text-xs text-black placeholder:text-gray-400"
      />
      <div className="flex justify-end gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onFecharEdicao}
        >
          Cancelar
        </Button>
        <Button
          size="sm"
          className="h-6 px-2 text-xs"
          onMouseDown={(e) => e.preventDefault()}
          onClick={salvarNome}
          disabled={salvandoNome}
        >
          Salvar
        </Button>
      </div>
    </div>
  );

  return (
    <li>
      {editando ? (
        <div className="inline-flex flex-col items-center rounded-lg border border-border bg-white text-black shadow-sm">
          {formEdicao}
        </div>
      ) : temLink ? (
        <div
          onClick={clicarCard}
          className={cn(
            "inline-flex w-[220px] items-center gap-2.5 rounded-xl bg-white px-3.5 py-2.5 text-black",
            selecionavel && "cursor-pointer",
            anelSelecao,
          )}
          style={{
            boxShadow: `0 1px 2px 0 rgb(0 0 0 / 0.06), inset 0 0 0 2px ${redeConfig!.cor}`,
          }}
        >
          <IconeRede nome={node.nome} config={redeConfig!} className="h-8 w-8" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{node.nome}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (podeEditar) onAuditoria(node.id, !auditada);
            }}
            disabled={!podeEditar}
            className="shrink-0 disabled:cursor-default"
            title={
              !podeEditar
                ? auditada
                  ? "Auditoria em dia"
                  : "Auditoria atrasada"
                : auditada
                  ? "Auditoria em dia — clique para desmarcar"
                  : "Auditoria atrasada — clique para marcar como feita (dias 1, 10, 20 e 30 de cada mês)"
            }
          >
            {auditada ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <Circle className="h-4 w-4 text-red-400 hover:text-red-500" />
            )}
          </button>
          <a
            href={node.link!}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 text-gray-400 hover:text-gray-700"
            title="Abrir link"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      ) : (
        <div
          onClick={clicarCard}
          className={cn(
            "inline-flex flex-col items-center gap-1.5 border border-border shadow-sm",
            selecionavel && "cursor-pointer",
            anelSelecao,
            nivel === 0
              ? "rounded-lg min-w-[150px] bg-[#E6197E] px-5 py-3 text-white"
              : nivel === 1
                ? "rounded-md min-w-[160px] bg-[#1C7EDB] px-7 py-5 text-white"
                : "rounded-lg min-w-[140px] bg-white px-4 py-2.5 text-black",
          )}
        >
          <span
            className={cn(
              "text-center font-medium",
              nivel === 1 ? "text-lg font-semibold" : "text-sm",
            )}
          >
            {node.nome}
          </span>
        </div>
      )}

      {filhos.length > 0 && (
        <ul className={filhosSaoFolhas ? "org-chart-vertical" : undefined}>
          {filhos.map((filho) => (
            <OrgNode
              key={filho.id}
              node={filho}
              nivel={nivel + 1}
              filhosPorPai={filhosPorPai}
              podeEditar={podeEditar}
              onRenomear={onRenomear}
              onAuditoria={onAuditoria}
              selecionadoId={selecionadoId}
              onSelecionar={onSelecionar}
              editandoId={editandoId}
              onFecharEdicao={onFecharEdicao}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
