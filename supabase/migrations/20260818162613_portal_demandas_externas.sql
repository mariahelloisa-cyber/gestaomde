-- Portal externo de demandas: cadastro aberto para quem envia demandas,
-- sem virar perfil interno (perfis_usuarios), + acompanhamento de status.

-- 1) Perfil mínimo para quem se cadastra só para enviar/acompanhar demandas.
--    Não é perfis_usuarios de propósito: assim o guard de "_authenticated"
--    (que exige linha em perfis_usuarios) já barra essas contas do painel
--    interno, sem precisar mexer nele.
CREATE TABLE public.demandas_externas_usuarios (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL,
  email text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.demandas_externas_usuarios TO authenticated;
GRANT ALL ON public.demandas_externas_usuarios TO service_role;
ALTER TABLE public.demandas_externas_usuarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuario le proprio registro externo"
  ON public.demandas_externas_usuarios FOR SELECT TO authenticated
  USING (auth.uid() = id);
CREATE POLICY "Usuario atualiza proprio registro externo"
  ON public.demandas_externas_usuarios FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 2) Vincula cada demanda à conta que a enviou.
ALTER TABLE public.demandas_externas
  ADD COLUMN solicitante_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3) handle_new_user: cadastro tipo 'demandante' pula convite/bootstrap-admin
--    e cai direto em demandas_externas_usuarios.
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
  IF NEW.raw_user_meta_data->>'tipo' = 'demandante' THEN
    INSERT INTO public.demandas_externas_usuarios (id, nome, email)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
      NEW.email
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
  END IF;

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

-- 4) tem_perfil(uid): existe linha em perfis_usuarios para esse usuário?
--    Usado para fechar as policies "qualquer autenticado" agora que o
--    cadastro deixou de ser só por convite.
CREATE OR REPLACE FUNCTION public.tem_perfil(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis_usuarios WHERE id = _user_id
  )
$$;
REVOKE EXECUTE ON FUNCTION public.tem_perfil(uuid) FROM anon, public;

-- 5) Fecha as policies que hoje valem para "qualquer autenticado" — contas
--    'demandante' não têm perfis_usuarios, então tem_perfil() = false e elas
--    não enxergam nada por essas policies. Staff/cliente (que têm perfil)
--    continuam com o mesmo acesso de sempre.
DROP POLICY IF EXISTS "Autenticados gerenciam tarefas" ON public.tarefas;
CREATE POLICY "Autenticados gerenciam tarefas" ON public.tarefas
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

DROP POLICY IF EXISTS "Autenticados gerenciam responsaveis" ON public.tarefa_responsaveis;
CREATE POLICY "Autenticados gerenciam responsaveis" ON public.tarefa_responsaveis
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

DROP POLICY IF EXISTS "Autenticados gerenciam clientes" ON public.clientes;
CREATE POLICY "Autenticados gerenciam clientes" ON public.clientes
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

DROP POLICY IF EXISTS "Autenticados leem comentarios" ON public.comentarios_tarefa;
CREATE POLICY "Autenticados leem comentarios" ON public.comentarios_tarefa
  FOR SELECT TO authenticated
  USING (public.tem_perfil(auth.uid()));

DROP POLICY IF EXISTS "Autenticados podem ver perfis" ON public.perfis_usuarios;
CREATE POLICY "Autenticados podem ver perfis" ON public.perfis_usuarios
  FOR SELECT TO authenticated
  USING (public.tem_perfil(auth.uid()));

-- 6) Storage demandas-anexos: leitura só para admin ou dono do arquivo
--    (antes era qualquer autenticado, o que virou listagem/leitura livre de
--    anexos de terceiros assim que o cadastro abriu para qualquer pessoa).
DROP POLICY IF EXISTS "Demandas anexos: leitura autenticada" ON storage.objects;
CREATE POLICY "Demandas anexos: leitura autenticada"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'demandas-anexos'
    AND (public.is_admin(auth.uid()) OR owner = auth.uid())
  );
