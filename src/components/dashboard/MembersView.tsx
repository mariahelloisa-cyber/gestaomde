import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Shield, ShieldCheck, User, Mail, Clock, Building2 } from "lucide-react";
import { useTasks } from "@/lib/tasks-store";
import { getMyRole, createInvites, updateMemberRole } from "@/lib/data.functions";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface ConvitePendente {
  id: string;
  email: string;
  cargo: "Admin" | "Supervisor" | "Membro";
  criado_em: string;
}

function MemberCard({
  m,
  canEditRole,
  onChangeRole,
}: {
  m: {
    id: string;
    nome: string;
    iniciais: string;
    cor: string;
    email?: string;
    cargo?: "Admin" | "Supervisor" | "Membro";
  };
  canEditRole?: boolean;
  onChangeRole?: (userId: string, cargo: "Admin" | "Supervisor" | "Membro") => void;
}) {
  const RoleIcon = m.cargo === "Admin" ? Shield : m.cargo === "Supervisor" ? ShieldCheck : User;
  const badgeVariant = m.cargo === "Admin" || m.cargo === "Supervisor" ? "default" : "secondary";
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white"
        style={{ backgroundColor: m.cor }}
      >
        {m.iniciais}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-black">{m.nome}</div>
        <div className="flex items-center gap-1 truncate text-xs text-gray-600">
          <Mail className="h-3 w-3" />
          <span className="truncate">{m.email ?? "—"}</span>
        </div>
      </div>
      {canEditRole && onChangeRole ? (
        <Select
          value={m.cargo ?? "Membro"}
          onValueChange={(v) => onChangeRole(m.id, v as "Admin" | "Supervisor" | "Membro")}
        >
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Admin">Admin</SelectItem>
            <SelectItem value="Supervisor">Supervisor</SelectItem>
            <SelectItem value="Membro">Membro</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <Badge variant={badgeVariant} className="gap-1">
          <RoleIcon className="h-3 w-3" />
          {m.cargo ?? "Membro"}
        </Badge>
      )}
    </div>
  );
}

function ClientCard({ c }: { c: { id: string; nome_empresa: string; email?: string | null; status?: string } }) {
  const iniciais = c.nome_empresa
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
        <Building2 className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-black">{c.nome_empresa}</div>
        <div className="flex items-center gap-1 truncate text-xs text-gray-600">
          <Mail className="h-3 w-3" />
          <span className="truncate">{c.email ?? "—"}</span>
        </div>
      </div>
      <Badge variant="outline" className="gap-1 capitalize">
        {c.status ?? "ativo"}
      </Badge>
    </div>
  );
}

export function MembersView() {
  const { membros, clientes, myIniciais } = useTasks();
  const getMyRoleFn = useServerFn(getMyRole);
  const createInvitesFn = useServerFn(createInvites);
  const updateRoleFn = useServerFn(updateMemberRole);
  const queryClient = useQueryClient();
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendentes, setPendentes] = useState<ConvitePendente[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await getMyRoleFn();
        const admin = r.cargo === "Admin";
        setIsAdmin(admin);
        if (admin) {
          const { data } = await supabase
            .from("convites")
            .select("id, email, cargo, criado_em")
            .eq("status", "pendente")
            .order("criado_em", { ascending: false });
          setPendentes((data ?? []) as ConvitePendente[]);
        }
      } catch {
        // ignore
      }
    })();
  }, [getMyRoleFn]);

  const reenviar = async (c: ConvitePendente) => {
    try {
      await createInvitesFn({ data: { emails: [c.email], cargo: c.cargo } });
      toast.success("Convite reenviado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reenviar.");
    }
  };

  const alterarCargo = async (
    user_id: string,
    cargo: "Admin" | "Supervisor" | "Membro",
  ) => {
    try {
      await updateRoleFn({ data: { user_id, cargo } });
      toast.success("Cargo atualizado.");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar cargo.");
    }
  };

  const admins = membros
    .filter((m) => m.cargo === "Admin")
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const supervisores = membros
    .filter((m) => m.cargo === "Supervisor")
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const membrosComum = membros
    .filter((m) => m.cargo !== "Admin" && m.cargo !== "Supervisor")
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const clientesOrdenados = [...clientes].sort((a, b) =>
    a.nome_empresa.localeCompare(b.nome_empresa)
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Membros</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pessoas da equipe e clientes com acesso a este workspace.
        </p>
      </header>

      {/* Administradores */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Administradores · {admins.length}
          </h2>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-white text-black shadow-sm">
          {admins.length === 0 ? (
            <div className="p-6 text-sm text-gray-600">Nenhum administrador encontrado.</div>
          ) : (
            admins.map((m) => (
              <MemberCard
                key={m.id}
                m={m}
                canEditRole={isAdmin && m.iniciais !== myIniciais}
                onChangeRole={alterarCargo}
              />
            ))
          )}
        </div>
      </section>

      {/* Membros */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Supervisores · {supervisores.length}
          </h2>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-white text-black shadow-sm">
          {supervisores.length === 0 ? (
            <div className="p-6 text-sm text-gray-600">Nenhum supervisor encontrado.</div>
          ) : (
            supervisores.map((m) => (
              <MemberCard
                key={m.id}
                m={m}
                canEditRole={isAdmin && m.iniciais !== myIniciais}
                onChangeRole={alterarCargo}
              />
            ))
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Membros · {membrosComum.length}
          </h2>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-white text-black shadow-sm">
          {membrosComum.length === 0 ? (
            <div className="p-6 text-sm text-gray-600">Nenhum membro encontrado.</div>
          ) : (
            membrosComum.map((m) => (
              <MemberCard
                key={m.id}
                m={m}
                canEditRole={isAdmin && m.iniciais !== myIniciais}
                onChangeRole={alterarCargo}
              />
            ))
          )}
        </div>
      </section>

      {/* Clientes */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Clientes · {clientesOrdenados.length}
          </h2>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-white text-black shadow-sm">
          {clientesOrdenados.length === 0 ? (
            <div className="p-6 text-sm text-gray-600">Nenhum cliente encontrado.</div>
          ) : (
            clientesOrdenados.map((c) => <ClientCard key={c.id} c={c} />)
          )}
        </div>
      </section>

      {isAdmin && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Convites pendentes · {pendentes.length}
          </h2>
          <div className="overflow-hidden rounded-lg border border-border bg-white text-black shadow-sm">
            {pendentes.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">
                Nenhum convite pendente.
              </div>
            ) : (
              pendentes.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                    <Clock className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-black">{c.email}</div>
                    <div className="text-xs text-gray-600">
                      Convidado em {new Date(c.criado_em).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                  <Badge variant="outline" className="gap-1">
                    {c.cargo === "Admin" ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
                    {c.cargo}
                  </Badge>
                  <Button size="sm" variant="ghost" onClick={() => reenviar(c)}>
                    Reenviar
                  </Button>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}