import { useEffect, useState } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/login", replace: true });
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("perfis_usuarios")
        .select("id, status")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        // Falha inesperada na consulta (ex.: coluna "status" ainda não migrada
        // no banco) — não bloqueia o acesso, só ignora a checagem de status.
        console.error(error);
        setChecking(false);
        return;
      }
      if (!data) {
        await supabase.auth.signOut();
        toast.error("Acesso negado: Você precisa de um convite da agência para acessar este espaço.");
        navigate({ to: "/login", replace: true });
      } else if (data.status === "inativo") {
        await supabase.auth.signOut();
        toast.error("Sua conta foi desativada. Fale com um administrador da agência.");
        navigate({ to: "/login", replace: true });
      } else {
        setChecking(false);
      }
    })();
  }, [user, loading, navigate]);

  if (loading || !user || checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  return <Outlet />;
}