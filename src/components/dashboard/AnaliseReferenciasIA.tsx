import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Sparkles, Square } from "lucide-react";
import type { listAcervoArte } from "@/lib/arte-acervo.functions";
import { analisarReferencia, resumoAnaliseReferencias } from "@/lib/arte-referencias-ia.functions";
import {
  ERRO_TETO_ANALISE,
  ESFORCOS_ANALISE,
  ESFORCO_PADRAO,
  ESFORCO_ROTULO,
  STATUS_ANALISE_ROTULO,
  type EsforcoAnalise,
  rotuloTag,
  statusAnalise,
  type MetadadosIA,
  type StatusAnalise,
} from "@/lib/arte/analise-referencias";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/* Análise das referências globais com IA: painel do lote (aviso de custo,
 * progresso, parar e continuar) e, em cada referência, status, reanálise e o
 * detalhe da análise. O lote roda no navegador, uma referência por chamada,
 * duas em paralelo; o servidor pula as já analisadas, então "continuar" é
 * só rodar de novo. */

type Referencia = Awaited<ReturnType<typeof listAcervoArte>>["referencias"][number];

const PARALELO = 2;
const CHAVE_RESUMO = ["arte-analise-resumo"];

export function statusDaReferencia(r: Referencia): StatusAnalise {
  return statusAnalise(r.analise ? { ia: r.analise } : null);
}

const usd = (v: number) => `US$ ${v.toFixed(2)}`;

export function useResumoAnalise() {
  const fn = useServerFn(resumoAnaliseReferencias);
  return useQuery({ queryKey: CHAVE_RESUMO, queryFn: () => fn() });
}

function useAtualizar() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["arte-acervo"] });
    qc.invalidateQueries({ queryKey: CHAVE_RESUMO });
  };
}

/** Análise de uma referência (botão do card e análise automática pós-upload). */
export function useAnalisarReferencia() {
  const fn = useServerFn(analisarReferencia);
  const atualizar = useAtualizar();
  return useMutation({
    mutationFn: (v: { id: string; forcar: boolean; esforco: EsforcoAnalise }) => fn({ data: v }),
    onSuccess: (r) => {
      if (r.resultado === "analisada") toast.success("Referência analisada.");
      if (r.resultado === "em_andamento") toast.info("Esta referência já está sendo analisada.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha na análise."),
    onSettled: atualizar,
  });
}

/* ---------------- Painel do lote ---------------- */

type Progresso = {
  total: number;
  feitas: number;
  erros: number;
  custo: number;
  parado: "usuario" | "teto" | null;
};

export function PainelAnaliseIA({ refs }: { refs: Referencia[] }) {
  const resumo = useResumoAnalise();
  const analisarFn = useServerFn(analisarReferencia);
  const atualizar = useAtualizar();
  const parar = useRef(false);
  const [confirmando, setConfirmando] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [prog, setProg] = useState<Progresso | null>(null);
  // Médio é o padrão; alto pode ser escolhido para um lote especial.
  const [esforcoLote, setEsforcoLote] = useState<EsforcoAnalise>(ESFORCO_PADRAO);

  const contagem: Record<StatusAnalise, number> = {
    pendente: 0,
    analisando: 0,
    analisada: 0,
    erro: 0,
  };
  for (const r of refs) contagem[statusDaReferencia(r)]++;
  const fila = refs.filter((r) => {
    const s = statusDaReferencia(r);
    return s === "pendente" || s === "erro";
  });

  const r = resumo.data;
  const restante = r ? Math.max(0, r.limiteDiarioUsd - r.gastoHojeUsd) : 0;
  const custoUnit = r ? r.custoUsd[esforcoLote] : 0;
  const estimativa = fila.length * custoUnit;
  const cabemHoje = r && custoUnit > 0 ? Math.floor(restante / custoUnit) : 0;

  const abrirConfirmacao = () => {
    setEsforcoLote(ESFORCO_PADRAO);
    setConfirmando(true);
  };

  const rodar = async () => {
    setConfirmando(false);
    const esforco = esforcoLote;
    const ids = fila.map((x) => x.id);
    parar.current = false;
    setRodando(true);
    const p: Progresso = { total: ids.length, feitas: 0, erros: 0, custo: 0, parado: null };
    setProg({ ...p });
    let proximo = 0;

    const trabalhador = async () => {
      while (!parar.current && proximo < ids.length) {
        const id = ids[proximo++];
        try {
          const res = await analisarFn({ data: { id, forcar: false, esforco } });
          if (res.resultado === "analisada") p.custo += res.custoUsd;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (msg.startsWith(ERRO_TETO_ANALISE)) {
            // Nada foi gasto nesta: o servidor recusou antes de chamar a IA.
            parar.current = true;
            p.parado = "teto";
            toast.error(msg);
            continue;
          }
          p.erros++;
        }
        p.feitas++;
        setProg({ ...p });
        if (p.feitas % 5 === 0) atualizar();
      }
    };

    await Promise.all(Array.from({ length: PARALELO }, trabalhador));
    if (parar.current && !p.parado) p.parado = "usuario";
    setProg({ ...p });
    setRodando(false);
    atualizar();
    if (!p.parado) {
      toast.success(
        `Lote concluído: ${p.feitas - p.erros} analisada(s), ${p.erros} com erro, ${usd(p.custo)}.`,
      );
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" /> Análise das referências com IA
          </h3>
          <p className="text-xs text-muted-foreground">
            Cada imagem é analisada uma vez: estrutura, composição, hierarquia de texto, CTA, fundo,
            uso de pessoa/foto e estilo. As cores ficam só como registro — a arte gerada usa a
            paleta da empresa.
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <span>{contagem.analisada} analisada(s)</span>
            <span>{contagem.pendente} pendente(s)</span>
            {contagem.analisando > 0 && <span>{contagem.analisando} analisando</span>}
            {contagem.erro > 0 && <span className="text-red-600">{contagem.erro} com erro</span>}
            {r && (
              <span className="text-muted-foreground">
                Hoje: {usd(r.gastoHojeUsd)} de {usd(r.limiteDiarioUsd)} • {r.modelo}
              </span>
            )}
          </div>
        </div>
        {rodando ? (
          <Button variant="outline" onClick={() => (parar.current = true)}>
            <Square className="mr-1 h-4 w-4" /> Parar
          </Button>
        ) : (
          <Button onClick={abrirConfirmacao} disabled={!r?.configurado || fila.length === 0}>
            <Sparkles className="mr-1 h-4 w-4" /> Analisar referências com IA
          </Button>
        )}
      </div>

      {r && !r.configurado && (
        <p className="text-xs text-red-600">A chave da IA não está configurada no servidor.</p>
      )}

      {prog && (
        <div className="space-y-1">
          <Progress value={prog.total ? (prog.feitas / prog.total) * 100 : 0} />
          <p className="text-xs text-muted-foreground">
            {rodando && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
            {prog.feitas} de {prog.total}
            {prog.erros > 0 ? ` • ${prog.erros} com erro` : ""} • {usd(prog.custo)} neste lote
            {prog.parado === "usuario" &&
              " • Parado. Clique em Analisar para continuar de onde parou."}
            {prog.parado === "teto" && " • Teto do dia atingido. Continue amanhã."}
          </p>
        </div>
      )}

      <Dialog open={confirmando} onOpenChange={setConfirmando}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Analisar {fila.length} referência(s) com IA?</DialogTitle>
          </DialogHeader>
          {r && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                {ESFORCOS_ANALISE.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEsforcoLote(e)}
                    className={cn(
                      "rounded-md py-1.5 text-xs font-medium transition-colors",
                      esforcoLote === e
                        ? "bg-background text-foreground shadow"
                        : "text-muted-foreground",
                    )}
                  >
                    Esforço {ESFORCO_ROTULO[e]} • {usd(fila.length * r.custoUsd[e])}
                    {e === ESFORCO_PADRAO ? " (padrão)" : ""}
                  </button>
                ))}
              </div>
              <p>
                Modelo: <strong>{r.modelo}</strong>, esforço{" "}
                <strong>{ESFORCO_ROTULO[esforcoLote]}</strong>. Custo estimado:{" "}
                <strong>{usd(estimativa)}</strong> (cerca de {usd(custoUnit)} por imagem
                {r.custoReal[esforcoLote] ? ", média real das análises feitas" : ", estimativa"}).
              </p>
              <p>
                Gasto de hoje com análise: {usd(r.gastoHojeUsd)} de {usd(r.limiteDiarioUsd)}. Cabem
                cerca de <strong>{cabemHoje}</strong> análise(s) hoje.
              </p>
              {cabemHoje < fila.length && (
                <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />O lote para sozinho ao
                  atingir o teto do dia. O que faltar continua pendente para outro dia.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Este gasto é separado do teto da geração de artes. Dá para parar a qualquer momento
                e continuar depois.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmando(false)}>
              Cancelar
            </Button>
            <Button onClick={rodar} disabled={!r || cabemHoje === 0}>
              Iniciar análise
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- Por referência ---------------- */

const COR_STATUS: Record<StatusAnalise, string> = {
  pendente: "bg-gray-100 text-gray-700",
  analisando: "bg-blue-100 text-blue-700",
  analisada: "bg-green-100 text-green-800",
  erro: "bg-red-100 text-red-700",
};

export function StatusAnaliseBadge({ status }: { status: StatusAnalise }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
        COR_STATUS[status],
      )}
    >
      {status === "analisando" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
      {STATUS_ANALISE_ROTULO[status]}
    </span>
  );
}

/** Rodapé de cada referência: status, analisar/reanalisar e o detalhe. */
export function CardAnalise({
  r,
  aberta,
  onAlternar,
  ocupado,
  podeAnalisar,
  custo,
  onAnalisar,
}: {
  r: Referencia;
  aberta: boolean;
  onAlternar: () => void;
  ocupado: boolean;
  podeAnalisar: boolean;
  custo?: Record<EsforcoAnalise, number>;
  onAnalisar: (forcar: boolean, esforco: EsforcoAnalise) => void;
}) {
  const status = ocupado ? "analisando" : statusDaReferencia(r);
  const ia = r.analise;
  const temDetalhe = !!ia?.descricao_visual;

  const analisar = (esforco: EsforcoAnalise) => {
    const forcar = status === "analisada";
    // Esforço alto é a exceção (referência importante): sempre confirma.
    if (forcar || esforco === "alto") {
      const aviso = custo ? ` Custo aproximado: ${usd(custo[esforco])}.` : "";
      const acao = forcar ? "Reanalisar" : "Analisar";
      if (!confirm(`${acao} esta referência com esforço ${ESFORCO_ROTULO[esforco]}?${aviso}`)) {
        return;
      }
    }
    onAnalisar(forcar, esforco);
  };

  return (
    <div className="space-y-1.5 border-t border-gray-100 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusAnaliseBadge status={status} />
        {temDetalhe && (
          <button type="button" onClick={onAlternar} className="text-[11px] text-primary underline">
            {aberta ? "Ocultar análise" : "Ver análise"}
          </button>
        )}
        {podeAnalisar && status !== "analisando" && (
          <span className="ml-auto flex gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => analisar(ESFORCO_PADRAO)}
              className="text-gray-600 underline hover:text-black"
            >
              {status === "analisada" ? "Reanalisar" : "Analisar"}
            </button>
            <button
              type="button"
              title="Mais detalhada e mais cara: para referências muito importantes"
              onClick={() => analisar("alto")}
              className="text-gray-600 underline hover:text-black"
            >
              em alto
            </button>
          </span>
        )}
      </div>
      {status === "erro" && ia?.erro && <p className="text-[11px] text-red-600">{ia.erro}</p>}
      {aberta && ia && <DetalheAnalise ia={ia} />}
    </div>
  );
}

function Chips({ titulo, tags }: { titulo: string; tags?: string[] }) {
  if (!tags?.length) return null;
  return (
    <div>
      <span className="font-medium text-gray-500">{titulo}: </span>
      {tags.map((t) => (
        <span key={t} className="mr-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">
          {rotuloTag(t)}
        </span>
      ))}
    </div>
  );
}

function Item({ titulo, texto }: { titulo: string; texto?: string }) {
  if (!texto?.trim()) return null;
  return (
    <p>
      <span className="font-medium text-gray-500">{titulo}: </span>
      {texto}
    </p>
  );
}

export function DetalheAnalise({ ia }: { ia: MetadadosIA }) {
  return (
    <div className="space-y-1.5 rounded-md bg-gray-50 p-2 text-[11px] leading-snug text-gray-800">
      <Item titulo="Descrição" texto={ia.descricao_visual} />
      <Item titulo="Estrutura reaproveitável" texto={ia.estrutura_reaproveitavel} />
      <Item titulo="Composição" texto={ia.composicao} />
      <Item titulo="Hierarquia de texto" texto={ia.hierarquia_texto} />
      <Item titulo="Posição dos elementos" texto={ia.posicionamento_elementos} />
      {ia.cta && (
        <Item
          titulo="CTA"
          texto={
            ia.cta.presente
              ? [ia.cta.posicao, ia.cta.estilo].filter(Boolean).join(" • ")
              : "sem CTA"
          }
        />
      )}
      {ia.tipo_fundo && (
        <Item
          titulo="Fundo"
          texto={`${rotuloTag(ia.tipo_fundo.categoria)}, ${ia.tipo_fundo.luminosidade}${
            ia.tipo_fundo.descricao ? ` — ${ia.tipo_fundo.descricao}` : ""
          }`}
        />
      )}
      {ia.uso_pessoa_foto && (
        <Item
          titulo="Pessoa/foto"
          texto={ia.uso_pessoa_foto.presente ? ia.uso_pessoa_foto.descricao : "sem pessoa/foto"}
        />
      )}
      <Chips titulo="Tema" tags={ia.tags_tema} />
      <Chips titulo="Objetivo" tags={ia.tags_objetivo} />
      <Chips titulo="Estilo" tags={ia.tags_estilo} />
      <Chips titulo="Composição" tags={ia.tags_composicao} />
      <Chips titulo="Elementos" tags={ia.tags_elementos} />
      {!!ia.cores_originais?.length && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-medium text-gray-500">Cores originais: </span>
          {ia.cores_originais.map((c) => (
            <span
              key={c}
              title={c}
              className="inline-block h-3.5 w-3.5 rounded-sm border border-gray-300"
              style={{ backgroundColor: c }}
            />
          ))}
          <span className="text-gray-500">— substituíveis pela paleta da marca</span>
        </div>
      )}
      <Item titulo="Para gerar" texto={ia.observacoes_geracao} />
      {ia.aviso_logo_terceiro && (
        <p className="flex items-start gap-1 rounded bg-amber-50 px-1.5 py-1 text-amber-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          Tem marca de terceiro
          {ia.aviso_logo_terceiro_detalhe ? `: ${ia.aviso_logo_terceiro_detalhe}` : ""}. Não copiar
          logo nem nome.
        </p>
      )}
      <p className="text-[10px] text-gray-500">
        {ia.modelo_usado}
        {ia.esforco ? ` • esforço ${ESFORCO_ROTULO[ia.esforco]}` : ""}
        {typeof ia.custo_estimado === "number" ? ` • ${usd(ia.custo_estimado)}` : ""}
        {ia.analisado_em ? ` • ${new Date(ia.analisado_em).toLocaleString("pt-BR")}` : ""}
      </p>
      {ia.ultimo_erro && (
        <p className="text-[10px] text-red-600">Última reanálise falhou: {ia.ultimo_erro}</p>
      )}
    </div>
  );
}
