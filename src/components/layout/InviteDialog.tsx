import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, ShieldCheck, User, Building2 } from "lucide-react";
import { toast } from "sonner";
import { createInvites } from "@/lib/data.functions";
import { useTasks } from "@/lib/tasks-store";

type Cargo = "Membro" | "Admin" | "Supervisor" | "Cliente";

const DESCRICAO: Record<Cargo, string> = {
  Membro: "Pode acessar todos os itens públicos em seu Espaço de trabalho.",
  Admin: "Pode gerenciar membros, faturamento e configurações do Espaço.",
  Supervisor: "Acesso completo, igual ao Admin — gerencia tudo do Espaço.",
  Cliente: "Acessa apenas o portal do cliente (boas-vindas e treinamentos do seu plano).",
};

export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [emails, setEmails] = useState("");
  const [cargo, setCargo] = useState<Cargo>("Membro");
  const [clienteId, setClienteId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const createInvitesFn = useServerFn(createInvites);
  const { clientes } = useTasks();

  const enviar = async () => {
    const lista = emails.split(/[\s,]+/).filter(Boolean);
    if (lista.length === 0) {
      toast.error("Adicione pelo menos um e-mail.");
      return;
    }
    if (cargo === "Cliente" && !clienteId) {
      toast.error("Selecione a empresa cliente.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await createInvitesFn({ data: { emails: lista, cargo, cliente_id: cargo === "Cliente" ? clienteId : null } });
      toast.success(`Convite registrado para ${res.count} ${res.count === 1 ? "pessoa" : "pessoas"} como ${cargo}.`);
      setEmails("");
      setCargo("Membro");
      setClienteId("");
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao enviar convites.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const Icon =
    cargo === "Admin"
      ? Shield
      : cargo === "Supervisor"
        ? ShieldCheck
        : cargo === "Cliente"
          ? Building2
          : User;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Convide pessoas gratuitamente</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="emails" className="text-xs text-muted-foreground">
              Convidar por e-mail
            </Label>
            <Input
              id="emails"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="E-mail, separado por vírgulas ou espaços"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Adicionar como</Label>
            <Select value={cargo} onValueChange={(v) => setCargo(v as Cargo)}>
              <SelectTrigger className="h-auto py-2.5">
                <SelectValue>
                  <div className="flex items-center gap-3 text-left">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{cargo}</div>
                      <div className="text-xs text-muted-foreground">{DESCRICAO[cargo]}</div>
                    </div>
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Membro">
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5" />
                    <span>Membro</span>
                  </div>
                </SelectItem>
                <SelectItem value="Admin">
                  <div className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5" />
                    <span>Admin</span>
                  </div>
                </SelectItem>
                <SelectItem value="Supervisor">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Supervisor</span>
                  </div>
                </SelectItem>
                <SelectItem value="Cliente">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>Cliente</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {cargo === "Cliente" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Empresa cliente</Label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
                <SelectContent>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome_empresa} — {c.plano}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
          <Button onClick={enviar} disabled={submitting}>{submitting ? "Enviando..." : "Enviar convite"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}