import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
}

const Ctx = createContext<AuthState>({ user: null, session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, session: null, loading: true });
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      setState({ user: session?.user ?? null, session, loading: false });
      if (event === "SIGNED_OUT") {
        queryClient.cancelQueries();
        queryClient.clear();
      } else {
        queryClient.invalidateQueries();
      }
      router.invalidate();
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setState({ user: data.session?.user ?? null, session: data.session, loading: false });
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router, queryClient]);

  const value = useMemo(() => state, [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  return useContext(Ctx);
}