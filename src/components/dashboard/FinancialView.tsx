import { useMemo, useState } from "react";
import { Plus, Trash2, Wallet } from "lucide-react";
import { useTasks } from "@/lib/tasks-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function FinancialView() {
  const { clientes, planos, transacoes, addServicoAvulso, removerTransacao } = useTasks();

  const ativos = clientes.filter((c) => (c.status ?? "ativo") === "ativo");
  const planoByNome = new Map(planos.map((p) => [p.nome_plano, p]));
  const clienteById = new Map(clientes.map((c) => [c.id, c]));

  const mensalidadesAtivas = ativos.reduce((acc, c) => {
    const p = planoByNome.get(c.plano);
    return acc + (p?.valor_mensal ?? 0);
  }, 0);

  const totalAvulsos = transacoes
    .filter((t) => t.tipo === "servico_avulso")
    .reduce((acc, t) => acc + t.valor, 0);

  const saldoTotal = mensalidadesAtivas + totalAvulsos;

  return (
    <div className="px-6 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Financeiro</h1>
          <p className="text-sm text-muted-foreground">
            Caixa baseado nas mensalidades dos clientes ativos + serviços avulsos.
          </p>
        </div>
        <NovoAvulso clientesAtivos={ativos} onCreate={addServicoAvulso} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card title="Saldo total" value={brl(saldoTotal)} highlight icon />
        <Card title="Mensalidades vigentes" value={brl(mensalidadesAtivas)} subtitle={`${ativos.length} cliente(s) ativo(s)`} />
        <Card title="Serviços avulsos" value={brl(totalAvulsos)} subtitle={`${transacoes.filter((t) => t.tipo === "servico_avulso").length} lançamento(s)`} />
      </div>

      <section className="mb-8 overflow-hidden rounded-lg border border-border bg-white text-black shadow-sm">
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-black">Mensalidades por cliente ativo</h2>
        </header>
        <div className="divide-y divide-border">
          {ativos.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-600">Nenhum cliente ativo.</div>
          )}
          {ativos.map((c) => {
            const p = planoByNome.get(c.plano);
            return (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold text-white"
                  style={{ backgroundColor: c.cor }}
                >
                  {c.nome_empresa.charAt(0)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-black">{c.nome_empresa}</p>
                  <p className="text-xs text-gray-600">Plano {c.plano}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-black">{brl(p?.valor_mensal ?? 0)}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-white text-black shadow-sm">
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-black">Extrato de lançamentos</h2>
        </header>
        <div className="divide-y divide-border">
          {transacoes.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-600">Nenhum lançamento ainda.</div>
          )}
          {transacoes.map((t) => {
            const cli = t.cliente_id ? clienteById.get(t.cliente_id) : undefined;
            return (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${t.tipo === "servico_avulso" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                  {t.tipo === "servico_avulso" ? "Avulso" : "Mensalidade"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-black">{t.descricao}</p>
                  <p className="text-xs text-gray-600">
                    {cli?.nome_empresa ?? "—"} · {new Date(t.data_pagamento).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-black">{brl(t.valor)}</span>
                <button
                  onClick={() => removerTransacao(t.id)}
                  className="rounded-md p-1.5 text-gray-500 hover:bg-muted hover:text-destructive"
                  title="Excluir lançamento"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Card({ title, value, subtitle, highlight, icon }: { title: string; value: string; subtitle?: string; highlight?: boolean; icon?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 text-black shadow-sm ${highlight ? "border-primary/40 bg-white" : "border-border bg-white"}`}>
      <div className="flex items-center gap-2 text-xs text-gray-600">
        {icon && <Wallet className="h-3.5 w-3.5" />}
        {title}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-black">{value}</div>
      {subtitle && <div className="mt-0.5 text-xs text-gray-600">{subtitle}</div>}
    </div>
  );
}

function NovoAvulso({
  clientesAtivos,
  onCreate,
}: {
  clientesAtivos: { id: string; nome_empresa: string }[];
  onCreate: (vars: { cliente_id: string; descricao: string; valor: number; data_pagamento?: string }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [clienteId, setClienteId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState("");

  const reset = () => { setClienteId(""); setDescricao(""); setValor(""); setData(""); };

  const submit = async () => {
    const v = Number(valor.replace(",", "."));
    if (!clienteId || !descricao.trim() || !Number.isFinite(v) || v < 0) return;
    await onCreate({ cliente_id: clienteId, descricao: descricao.trim(), valor: v, data_pagamento: data || undefined });
    reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Serviço avulso</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Adicionar serviço avulso</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Cliente</Label>
            <Select value={clienteId} onValueChange={setClienteId}>
              <SelectTrigger><SelectValue placeholder="Selecione um cliente ativo" /></SelectTrigger>
              <SelectContent>
                {clientesAtivos.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome_empresa}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Descrição</Label>
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Edição extra de vídeo" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Valor (R$)</Label>
              <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" inputMode="decimal" />
            </div>
            <div>
              <Label className="text-xs">Data</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}