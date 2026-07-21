import { useEffect, useState, type ReactNode } from "react";
import { Building2, FileText, X, ChevronDown, Check } from "lucide-react";
import { toast } from "sonner";
import type { Cliente } from "@/lib/mock-data";
import { useTasks } from "@/lib/tasks-store";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Plano = "Bronze" | "Prata" | "Ouro" | "Diamond";
const PLANOS: Plano[] = ["Bronze", "Prata", "Ouro", "Diamond"];
const planoCor: Record<Plano, string> = {
  Bronze: "#C2410C",
  Prata: "#64748B",
  Ouro: "#D97706",
  Diamond: "#7C3AED",
};

function maskDoc(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function EditClientDialog({ cliente, trigger }: { cliente: Cliente; trigger: ReactNode }) {
  const { updateCliente } = useTasks();
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState(cliente.nome_empresa);
  const [endereco, setEndereco] = useState(cliente.endereco ?? "");
  const [documento, setDocumento] = useState(cliente.documento ?? "");
  const [email, setEmail] = useState(cliente.email ?? "");
  const [plano, setPlano] = useState<Plano>(cliente.plano as Plano);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNome(cliente.nome_empresa);
      setEndereco(cliente.endereco ?? "");
      setDocumento(cliente.documento ?? "");
      setEmail(cliente.email ?? "");
      setPlano(cliente.plano as Plano);
    }
  }, [open, cliente]);

  const submit = async () => {
    if (!nome.trim()) {
      toast.error("Informe o nome do cliente");
      return;
    }
    setSaving(true);
    try {
      await updateCliente({
        id: cliente.id,
        patch: {
          nome_empresa: nome.trim(),
          plano,
          endereco: endereco.trim() || null,
          documento: documento.trim() || null,
          email: email.trim() || null,
        },
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0 sm:rounded-xl [&>button]:hidden">
        <DialogTitle className="sr-only">Editar cliente</DialogTitle>

        <div className="flex items-center justify-between border-b border-border px-5 pt-4">
          <button className="relative pb-2.5">
            <span className="text-sm font-medium text-foreground">editar cliente</span>
            <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-foreground" />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="mb-2 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 pt-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-foreground/80 hover:bg-muted">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: planoCor[plano] }} />
                {plano}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {PLANOS.map((p) => (
                <DropdownMenuItem key={p} onClick={() => setPlano(p)} className="gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: planoCor[p] }} />
                  <span className="flex-1">{p}</span>
                  {p === plano && <Check className="h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="px-5 pt-5">
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do cliente"
            className="w-full border-0 bg-transparent text-xl font-semibold leading-tight outline-none placeholder:text-foreground/40"
          />

          <div className="mt-4 space-y-3">
            <Row icon={<Building2 className="h-4 w-4 text-muted-foreground" />}>
              <input
                value={endereco}
                onChange={(e) => setEndereco(e.target.value)}
                placeholder="Endereço"
                className="w-full border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </Row>
            <Row icon={<FileText className="h-4 w-4 text-muted-foreground" />}>
              <input
                value={documento}
                onChange={(e) => setDocumento(maskDoc(e.target.value))}
                placeholder="CPF ou CNPJ"
                className="w-full border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </Row>
            <Row icon={<span className="text-xs font-semibold text-muted-foreground">@</span>}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="E-mail"
                className="w-full border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </Row>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3 mt-5">
          <button
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <div className="inline-flex overflow-hidden rounded-md bg-foreground text-background">
            <button
              onClick={submit}
              disabled={!nome.trim() || saving}
              className="px-4 py-1.5 text-sm font-medium transition-colors hover:bg-foreground/90 disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar alterações"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/40 pb-2">
      <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
      {children}
    </div>
  );
}