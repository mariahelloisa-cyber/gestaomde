
-- Tabela de convites
CREATE TABLE public.convites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  cargo cargo_usuario NOT NULL DEFAULT 'Membro',
  convidado_por uuid,
  status text NOT NULL DEFAULT 'pendente',
  criado_em timestamptz NOT NULL DEFAULT now(),
  aceito_em timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.convites TO authenticated;
GRANT ALL ON public.convites TO service_role;

ALTER TABLE public.convites ENABLE ROW LEVEL SECURITY;

-- Função auxiliar is_admin (security definer para evitar recursão de RLS)
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis_usuarios
    WHERE id = _user_id AND cargo = 'Admin'
  )
$$;

-- Políticas: apenas admins gerenciam convites
CREATE POLICY "Admins veem convites"
ON public.convites FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins criam convites"
ON public.convites FOR INSERT TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins atualizam convites"
ON public.convites FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins excluem convites"
ON public.convites FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()));

-- Substitui handle_new_user para impor invite-only
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_convite public.convites%ROWTYPE;
  v_cargo public.cargo_usuario := 'Membro';
  v_total int;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.perfis_usuarios;

  IF v_total = 0 THEN
    -- Bootstrap: primeiro usuário do sistema vira Admin
    v_cargo := 'Admin';
  ELSE
    SELECT * INTO v_convite
    FROM public.convites
    WHERE lower(email) = lower(NEW.email)
      AND status = 'pendente'
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Acesso negado: Você precisa de um convite da agência para acessar este espaço.'
        USING ERRCODE = 'P0001';
    END IF;

    v_cargo := v_convite.cargo;

    UPDATE public.convites
    SET status = 'aceito', aceito_em = now()
    WHERE id = v_convite.id;
  END IF;

  INSERT INTO public.perfis_usuarios (id, nome, email, avatar_url, cargo)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'nome',
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url',
    v_cargo
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Garante que o trigger existe (idempotente)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
