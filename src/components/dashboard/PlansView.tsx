import { useEffect, useState } from "react";
import { Crown, Diamond, Gem, Medal, Pencil, Plus, X, Save } from "lucide-react";
import { useTasks, type Plano } from "@/lib/tasks-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const META: Record<Plano["nome_plano"], { icon: typeof Crown; accent: string; classes: string }> = {
  Diamond: { icon: Diamond, accent: "#7C3AED", classes: "from-[#EDE9FE] to-[#DDD6FE] border-[#C4B5FD]" },
  Ouro: { icon: Crown, accent: "#D97706", classes: "from-[#FEF3C7] to-[#FDE68A] border-[#FCD34D]" },
  Prata: { icon: Medal, accent: "#64748B", classes: "from-[#F1F5F9] to-[#E2E8F0] border-[#CBD5E1]" },
  Bronze: { icon: Gem, accent: "#C2410C", classes: "from-[#FFEDD5] to-[#FED7AA] border-[#FDBA74]" },
};

const ORDEM: Plano["nome_plano"][] = ["Diamond", "Ouro", "Prata", "Bronze"];

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function PlansView() {
  const { planos, updatePlano, myCargo } = useTasks();
  const podeEditar = myCargo === "Admin" || myCargo === "Supervisor";
  // Planos com nome_plano fora do enum conhecido (ex: dado legado/inconsistente)
  // não têm ícone/cor definidos — não travar a tela inteira por causa disso.
  const ordenados = [...planos]
    .filter((p) => p.nome_plano in META)
    .sort((a, b) => ORDEM.indexOf(a.nome_plano) - ORDEM.indexOf(b.nome_plano));

  return (
    <div className="px-6 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Configurações de planos</h1>
        <p className="text-sm text-muted-foreground">
          {podeEditar
            ? "Defina valores e serviços inclusos em cada plano."
            : "Visualização apenas. Apenas Admins e Supervisores podem editar os planos."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ordenados.map((p) => (
          <PlanoCard key={p.id} plano={p} onSave={updatePlano} readOnly={!podeEditar} />
        ))}
      </div>
    </div>
  );
}

function PlanoCard({
  plano,
  onSave,
  readOnly,
}: {
  plano: Plano;
  onSave: (v: { id: string; valor_mensal?: number; servicos_inclusos?: string[] }) => Promise<void>;
  readOnly: boolean;
}) {
  const meta = META[plano.nome_plano];
  const Icon = meta.icon;

  const [editing, setEditing] = useState(false);
  const [valor, setValor] = useState(String(plano.valor_mensal).replace(".", ","));
  const [servicos, setServicos] = useState<string[]>(plano.servicos_inclusos);
  const [novo, setNovo] = useState("");

  // Re-sync local state when the plano prop updates (after refetch) and we're not editing.
  useEffect(() => {
    if (!editing) {
      setValor(String(plano.valor_mensal).replace(".", ","));
      setServicos(plano.servicos_inclusos);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plano.valor_mensal, plano.servicos_inclusos]);

  const reset = () => {
    setValor(String(plano.valor_mensal).replace(".", ","));
    setServicos(plano.servicos_inclusos);
    setNovo("");
    setEditing(false);
  };

  const salvar = async () => {
    const v = Number(valor.replace(",", "."));
    const pendente = novo.trim();
    const lista = pendente ? [...servicos, pendente] : servicos;
    await onSave({
      id: plano.id,
      valor_mensal: Number.isFinite(v) ? v : plano.valor_mensal,
      servicos_inclusos: lista,
    });
    setServicos(lista);
    setNovo("");
    setEditing(false);
  };

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className={`flex items-center gap-3 rounded-t-lg border-b bg-gradient-to-r px-4 py-3 ${meta.classes}`}>
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white/70 shadow-sm" style={{ color: meta.accent }}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <h2 className="text-sm font-semibold" style={{ color: meta.accent }}>{plano.nome_plano}</h2>
          <p className="text-[11px] font-medium text-black">
            {editing ? "Editando..." : `${brl(plano.valor_mensal)} / mês`}
          </p>
        </div>
        {!readOnly && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
        )}
      </div>

      <div className="space-y-4 p-4">
        <div>
          <Label className="text-xs">Valor mensal (R$)</Label>
          <Input
            value={editing ? valor : String(plano.valor_mensal).replace(".", ",")}
            disabled={!editing}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
          />
        </div>

        <div>
          <Label className="text-xs">Serviços inclusos</Label>
          <ul className="mt-1 space-y-1.5">
            {(editing ? servicos : plano.servicos_inclusos).map((s, idx) => (
              <li key={idx} className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-sm">
                <span className="flex-1 truncate">{s}</span>
                {editing && (
                  <button
                    onClick={() => setServicos((arr) => arr.filter((_, i) => i !== idx))}
                    className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
            {(editing ? servicos : plano.servicos_inclusos).length === 0 && (
              <li className="text-xs text-muted-foreground">Nenhum serviço cadastrado.</li>
            )}
          </ul>

          {editing && (
            <div className="mt-2 flex gap-2">
              <Input
                value={novo}
                onChange={(e) => setNovo(e.target.value)}
                placeholder="Adicionar serviço"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && novo.trim()) {
                    setServicos((arr) => [...arr, novo.trim()]);
                    setNovo("");
                  }
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (novo.trim()) {
                    setServicos((arr) => [...arr, novo.trim()]);
                    setNovo("");
                  }
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {editing && (
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button size="sm" variant="ghost" onClick={reset}>Cancelar</Button>
            <Button size="sm" onClick={salvar} className="gap-1.5"><Save className="h-3.5 w-3.5" /> Salvar</Button>
          </div>
        )}
      </div>
    </div>
  );
}