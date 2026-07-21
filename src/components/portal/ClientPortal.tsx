import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Home, LogOut, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { getMyPortalContext } from "@/lib/data.functions";
import { useState } from "react";
import logoMde from "@/assets/logo-mde.png";

export function ClientPortal() {
  const [expanded, setExpanded] = useState(true);

  const ctxFn = useServerFn(getMyPortalContext);
  const { data: ctx } = useQuery({ queryKey: ["portal-ctx"], queryFn: () => ctxFn() });

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <aside
        className={cn(
          "flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
          expanded ? "w-60" : "w-14",
        )}
      >
        <div className={cn("flex items-center border-b border-sidebar-border py-2.5", expanded ? "gap-2 px-3" : "justify-center px-2")}>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent"
            aria-label="Menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          {expanded && (
            <>
              <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-md bg-white">
                <img src={logoMde} alt="Logo" className="h-6 w-6 object-contain" />
              </div>
              <div className="flex-1 truncate text-sm font-medium">Portal Cliente</div>
            </>
          )}
        </div>

        <nav className="flex-1 px-2 pt-3">
          <PortalNav icon={Home} label="Início" expanded={expanded} active onClick={() => {}} />
        </nav>

        <div className="border-t border-sidebar-border p-2">
          <PortalNav icon={LogOut} label="Sair" expanded={expanded} active={false} onClick={() => { supabase.auth.signOut(); }} />
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-[var(--surface-1)]">
        <PortalHome nome={ctx?.nome ?? ""} cliente={ctx?.cliente_nome ?? null} plano={ctx?.plano ?? null} />
      </main>
    </div>
  );
}

function PortalNav({ icon: Icon, label, expanded, active, onClick }: { icon: typeof Home; label: string; expanded: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "mt-1 flex w-full items-center rounded-md text-sm transition-colors",
        expanded ? "gap-2.5 px-2.5 py-1.5" : "justify-center px-0 py-2",
        active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/90 hover:bg-sidebar-accent/60",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {expanded && <span className="truncate">{label}</span>}
    </button>
  );
}

function PortalHome({ nome, cliente, plano }: { nome: string; cliente: string | null; plano: string | null }) {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-semibold text-foreground">Olá, {nome || "Cliente"}!</h1>
      <p className="mt-2 text-muted-foreground">Bem-vindo ao seu espaço MDE</p>
      {cliente && (
        <div className="mt-6 rounded-lg border border-border bg-card p-5">
          <div className="text-sm text-muted-foreground">Sua empresa</div>
          <div className="mt-1 text-lg font-medium text-foreground">{cliente}</div>
          {plano && <div className="mt-1 text-xs text-muted-foreground">Plano: {plano}</div>}
        </div>
      )}
    </div>
  );
}
