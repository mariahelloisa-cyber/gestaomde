import { useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import { useTasks } from "@/lib/tasks-store";
import { PERIODO_PRESETS, resolverPeriodo, type PeriodoPreset } from "@/lib/productivity";
import { gerarRelatorioTarefasPDF } from "@/lib/reports";
import { PeriodFilter } from "./PeriodFilter";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TODOS = "todos";

export function ReportDialog({ apenasMinhas }: { apenasMinhas: boolean }) {
  const { tarefas, membros, clientes, projetos, myId, myNome } = useTasks();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<PeriodoPreset>("30d");
  const [customDe, setCustomDe] = useState("");
  const [customAte, setCustomAte] = useState("");
  const [membroId, setMembroId] = useState(TODOS);
  const [clienteId, setClienteId] = useState(TODOS);
  const [projetoId, setProjetoId] = useState(TODOS);

  const periodo = useMemo(
    () => resolverPeriodo(preset, { de: customDe, ate: customAte }),
    [preset, customDe, customAte],
  );

  const membrosOrdenados = useMemo(() => [...membros].sort((a, b) => a.nome.localeCompare(b.nome)), [membros]);
  const clientesOrdenados = useMemo(() => [...clientes].sort((a, b) => a.nome_empresa.localeCompare(b.nome_empresa)), [clientes]);
  const projetosOrdenados = useMemo(() => [...projetos].sort((a, b) => a.nome.localeCompare(b.nome)), [projetos]);

  const efetivoMembroId = apenasMinhas ? myId : membroId;

  const filtradas = useMemo(() => {
    const semPeriodo = preset === "todos";
    return tarefas.filter((t) => {
      if ((t.tipo ?? "tarefa") !== "tarefa") return false;
      if (efetivoMembroId !== TODOS && !t.responsaveis.some((r) => r.id === efetivoMembroId)) return false;
      if (clienteId !== TODOS && t.cliente_id !== clienteId) return false;
      if (projetoId !== TODOS && t.projeto_id !== projetoId) return false;
      if (!semPeriodo) {
        const ref = t.concluido_em ? t.concluido_em.slice(0, 10) : t.data_vencimento || null;
        if (!ref || ref < periodo.de || ref > periodo.ate) return false;
      }
      return true;
    });
  }, [tarefas, efetivoMembroId, clienteId, projetoId, preset, periodo]);

  const baixar = () => {
    const clientesById = new Map(clientes.map((c) => [c.id, c.nome_empresa]));
    const projetosById = new Map(projetos.map((p) => [p.id, p.nome]));
    const membroLabel = apenasMinhas
      ? myNome || "Você"
      : membroId === TODOS
        ? "Todos"
        : (membrosOrdenados.find((m) => m.id === membroId)?.nome ?? "Todos");
    const clienteLabel = clienteId === TODOS ? "Todos" : (clientesOrdenados.find((c) => c.id === clienteId)?.nome_empresa ?? "Todos");
    const projetoLabel = projetoId === TODOS ? "Todos" : (projetosOrdenados.find((p) => p.id === projetoId)?.nome ?? "Todos");
    const periodoLabel = PERIODO_PRESETS.find((p) => p.value === preset)?.label ?? "Período";

    gerarRelatorioTarefasPDF(
      filtradas,
      { periodo: periodoLabel, membro: membroLabel, cliente: clienteLabel, projeto: projetoLabel },
      clientesById,
      projetosById,
    );
    setOpen(false);
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileDown className="mr-1.5 h-4 w-4" />
        Gerar relatório
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar relatório de tarefas</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Período</label>
              <PeriodFilter
                preset={preset}
                onPresetChange={setPreset}
                customDe={customDe}
                customAte={customAte}
                onCustomChange={(de, ate) => {
                  setCustomDe(de);
                  setCustomAte(ate);
                }}
              />
            </div>

            {!apenasMinhas && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Membro</label>
                <Select value={membroId} onValueChange={setMembroId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS}>Todos os membros</SelectItem>
                    {membrosOrdenados.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Cliente</label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os clientes</SelectItem>
                  {clientesOrdenados.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome_empresa}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Projeto</label>
              <Select value={projetoId} onValueChange={setProjetoId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os projetos</SelectItem>
                  {projetosOrdenados.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs text-muted-foreground">
              {filtradas.length} tarefa{filtradas.length === 1 ? "" : "s"} encontrada{filtradas.length === 1 ? "" : "s"} com esses filtros.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={baixar} disabled={filtradas.length === 0}>
              <FileDown className="mr-1.5 h-4 w-4" />
              Baixar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
