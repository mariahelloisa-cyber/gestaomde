import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/login", replace: true });
      return;
    }
    // Verifica se o perfil foi criado (invite-only). Se não houver, faz logout.
    (async () => {
      const { data, error } = await supabase
        .from("perfis_usuarios")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();
      if (error || !data) {
        await supabase.auth.signOut();
        toast.error("Acesso negado: Você precisa de um convite da agência para acessar este espaço.");
        navigate({ to: "/login", replace: true });
      } else {
        navigate({ to: "/", replace: true });
      }
    })();
  }, [user, loading, navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Concluindo login...
    </div>
  );
}