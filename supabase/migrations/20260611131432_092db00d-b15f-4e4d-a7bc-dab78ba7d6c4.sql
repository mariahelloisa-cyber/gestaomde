-- 1) Add 'Cliente' role to enum (cannot be referenced as literal in same tx)
ALTER TYPE public.cargo_usuario ADD VALUE IF NOT EXISTS 'Cliente';
-- 2) Link profile -> cliente
ALTER TABLE public.perfis_usuarios
  ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL;
-- 3) Allow invite to carry cliente_id
ALTER TABLE public.convites
  ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL;
-- 4) Update handle_new_user trigger to copy cliente_id from convite
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_convite public.convites%ROWTYPE;
  v_cargo public.cargo_usuario := 'Membro';
  v_cliente_id uuid := NULL;
  v_total int;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.perfis_usuarios;

  IF v_total = 0 THEN
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
    v_cliente_id := v_convite.cliente_id;

    UPDATE public.convites
    SET status = 'aceito', aceito_em = now()
    WHERE id = v_convite.id;
  END IF;

  INSERT INTO public.perfis_usuarios (id, nome, email, avatar_url, cargo, cliente_id)
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
    v_cargo,
    v_cliente_id
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;
-- 5) Helper functions
CREATE OR REPLACE FUNCTION public.is_cliente(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis_usuarios
    WHERE id = _user_id AND cargo::text = 'Cliente'
  )
$$;
CREATE OR REPLACE FUNCTION public.get_meu_plano()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.plano::text
  FROM public.perfis_usuarios p
  JOIN public.clientes c ON c.id = p.cliente_id
  WHERE p.id = auth.uid()
  LIMIT 1
$$;
-- 6) Treinamentos table
CREATE TABLE IF NOT EXISTS public.treinamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descricao text,
  url_video text NOT NULL,
  plano_destino text NOT NULL CHECK (plano_destino IN ('Bronze','Prata','Ouro','Diamond','Todos')),
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treinamentos TO authenticated;
GRANT ALL ON public.treinamentos TO service_role;
ALTER TABLE public.treinamentos ENABLE ROW LEVEL SECURITY;
-- Admin: full management
CREATE POLICY "Admins gerenciam treinamentos"
ON public.treinamentos
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));
-- Cliente: SELECT apenas treinamentos do seu plano ou 'Todos'
CREATE POLICY "Clientes veem treinamentos do seu plano"
ON public.treinamentos
FOR SELECT
TO authenticated
USING (
  plano_destino = 'Todos'
  OR plano_destino = public.get_meu_plano()
  OR (
    NOT public.is_cliente(auth.uid())
    AND auth.uid() IS NOT NULL
  )
);
-- update trigger
CREATE OR REPLACE FUNCTION public.tg_treinamentos_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_treinamentos_updated ON public.treinamentos;
CREATE TRIGGER trg_treinamentos_updated
BEFORE UPDATE ON public.treinamentos
FOR EACH ROW EXECUTE FUNCTION public.tg_treinamentos_updated();
