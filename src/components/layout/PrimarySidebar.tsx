import { useState } from "react";
import { Home, Calendar, Users, UserCircle, UserPlus, LogOut, Search, ChevronDown, Menu, Wallet, Settings, UserMinus, ClipboardList, Mail, Inbox, Link2, CheckCheck, Lightbulb, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTasks } from "@/lib/tasks-store";
import { InviteDialog } from "./InviteDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useTheme } from "@/lib/theme";
import logoMde from "@/assets/logo-mde.png";

export function PrimarySidebar() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { workspace, setWorkspace, myCargo } = useTasks();
  const isAdminLike = myCargo === "Admin" || myCargo === "Supervisor";
  const { theme, toggle: toggleTheme } = useTheme();

  const active =
    workspace.tipo === "todos-clientes"
      ? "Todos os clientes"
      : workspace.tipo === "cliente"
        ? "cliente"
        : workspace.tipo === "calendario-geral"
          ? "Calendário"
          : workspace.tipo === "membros"
            ? "Membros"
            : workspace.tipo === "financeiro"
              ? "Financeiro"
              : workspace.tipo === "planos"
                ? "Planos"
                : workspace.tipo === "clientes-inativos"
                  ? "Clientes inativos"
                  : workspace.tipo === "configuracoes"
                    ? "Configurações"
                    : workspace.tipo === "dashboard"
                  ? "Início"
                  : workspace.tipo === "tarefas-gerais"
                    ? "Tarefas"
                    : workspace.tipo === "demandas"
                      ? "Demandas"
                      : workspace.tipo === "links"
                        ? "Links"
                        : workspace.tipo === "finalizados"
                          ? "Finalizados"
                          : workspace.tipo === "ideias"
                            ? "Ideias"
                    : "Minhas tarefas";

  const items: { icon: typeof Home; label: string; onClick: () => void }[] = [
    { icon: Home, label: "Início", onClick: () => { setWorkspace({ tipo: "dashboard" as const }); } },
    { icon: ClipboardList, label: "Tarefas", onClick: () => setWorkspace({ tipo: "tarefas-gerais" }) },
    ...(isAdminLike
      ? [{ icon: Inbox, label: "Demandas", onClick: () => setWorkspace({ tipo: "demandas" as const }) }]
      : []),
    { icon: Calendar, label: "Calendário", onClick: () => setWorkspace({ tipo: "calendario-geral" }) },
    { icon: UserCircle, label: "Membros", onClick: () => setWorkspace({ tipo: "membros" }) },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
          expanded ? "w-60" : "w-14",
        )}
      >
        {/* Header / toggle */}
        <div className={cn("flex items-center border-b border-sidebar-border py-2.5", expanded ? "gap-2 px-3" : "justify-center px-2")}>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label={expanded ? "Recolher menu" : "Expandir menu"}
          >
            <Menu className="h-4 w-4" />
          </button>
          {expanded && (
            <>
              <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-md bg-white">
                <img src={logoMde} alt="Logo" className="h-6 w-6 object-contain" />
              </div>
              <div className="flex-1 truncate text-sm font-medium">Painel</div>
              <ChevronDown className="h-4 w-4 text-sidebar-foreground/70" />
            </>
          )}
        </div>

        {/* Quick search */}
        {expanded && (
          <div className="px-3 pt-3">
            <div className="flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-sidebar-foreground/70" />
              <input
                placeholder="Pesquisar"
                className="flex-1 bg-transparent text-xs text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/60"
              />
              <kbd className="rounded bg-sidebar-accent/60 px-1.5 py-0.5 text-[10px] text-sidebar-foreground/80">⌘K</kbd>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className={cn("flex-1 pt-3", expanded ? "px-2" : "px-2")}>
          {items.map((item) => (
            <NavButton
              key={item.label}
              icon={item.icon}
              label={item.label}
              expanded={expanded}
              active={active === item.label}
              onClick={item.onClick}
            />
          ))}

          <NavButton
            icon={Users}
            label="Todos os clientes"
            expanded={expanded}
            active={active === "Todos os clientes"}
            onClick={() => setWorkspace({ tipo: "todos-clientes" })}
          />

          <NavButton
            icon={UserMinus}
            label="Clientes inativos"
            expanded={expanded}
            active={active === "Clientes inativos"}
            onClick={() => setWorkspace({ tipo: "clientes-inativos" })}
          />

          {isAdminLike && (
            <NavButton
              icon={Wallet}
              label="Financeiro"
              expanded={expanded}
              active={active === "Financeiro"}
              onClick={() => setWorkspace({ tipo: "financeiro" })}
            />
          )}

          <NavButton
            icon={Settings}
            label="Planos"
            expanded={expanded}
            active={active === "Planos"}
            onClick={() => setWorkspace({ tipo: "planos" })}
          />

          <NavButton
            icon={Link2}
            label="Links"
            expanded={expanded}
            active={active === "Links"}
            onClick={() => setWorkspace({ tipo: "links" })}
          />

          {isAdminLike && (
            <NavButton
              icon={CheckCheck}
              label="Finalizados"
              expanded={expanded}
              active={active === "Finalizados"}
              onClick={() => setWorkspace({ tipo: "finalizados" })}
            />
          )}

          <NavButton
            icon={Lightbulb}
            label="Ideias"
            expanded={expanded}
            active={active === "Ideias"}
            onClick={() => setWorkspace({ tipo: "ideias" })}
          />

          {isAdminLike && (
            <NavButton
              icon={Mail}
              label="Configurações"
              expanded={expanded}
              active={active === "Configurações"}
              onClick={() => setWorkspace({ tipo: "configuracoes" })}
            />
          )}

          {isAdminLike && (
            <NavButton
              icon={UserPlus}
              label="Convidar"
              expanded={expanded}
              active={false}
              onClick={() => setInviteOpen(true)}
            />
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-2">
          <NavButton
            icon={theme === "dark" ? Sun : Moon}
            label={theme === "dark" ? "Modo claro" : "Modo escuro"}
            expanded={expanded}
            active={false}
            onClick={toggleTheme}
          />
          <NavButton
            icon={LogOut}
            label="Sair"
            expanded={expanded}
            active={false}
            onClick={() => { supabase.auth.signOut(); }}
          />
        </div>
      </aside>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </TooltipProvider>
  );
}

function NavButton({
  icon: Icon,
  label,
  expanded,
  active,
  onClick,
}: {
  icon: typeof Home;
  label: string;
  expanded: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const base = cn(
    "mt-1 flex w-full items-center rounded-md text-sm transition-colors",
    expanded ? "gap-2.5 px-2.5 py-1.5" : "justify-center px-0 py-2",
    active
      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
      : "text-sidebar-foreground/90 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
  );
  const btn = (
    <button onClick={onClick} className={base} aria-label={label}>
      <Icon className="h-4 w-4 shrink-0" />
      {expanded && <span className="truncate">{label}</span>}
    </button>
  );
  if (expanded) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
