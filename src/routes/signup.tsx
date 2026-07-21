import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Cadastro — Agência" }] }),
  component: SignupPage,
});

function SignupPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/", replace: true });
  }, [user, loading, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { nome },
      },
    });
    setSubmitting(false);
    if (error) {
      const msg = /acesso negado|invite|convite|database error saving new user/i.test(error.message)
        ? "Acesso negado: Você precisa de um convite da agência para acessar este espaço."
        : error.message;
      toast.error(msg);
    } else {
      toast.success("Cadastro concluído!");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-1)] px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Criar conta</h1>
        <p className="mt-1 text-sm text-muted-foreground">Comece a organizar sua agência.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="nome">Nome</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Criando..." : "Criar conta"}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          Já tem conta? <Link to="/login" className="font-medium text-foreground hover:underline">Entrar</Link>
        </p>
      </div>
    </div>
  );
}