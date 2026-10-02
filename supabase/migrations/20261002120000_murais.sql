
DROP FUNCTION IF EXISTS public.excluir_mural_quadro(uuid);
DROP TABLE IF EXISTS public.mural_itens;
DROP TABLE IF EXISTS public.mural_quadros;

CREATE TABLE public.murais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL DEFAULT auth.uid()
    REFERENCES public.perfis_usuarios(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 80),
  descricao text CHECK (descricao IS NULL OR char_length(descricao) <= 280),
  cor text NOT NULL CHECK (cor ~ '^#[0-9A-Fa-f]{6}$'),
  -- Ver comentário de posicao em mural_quadros.
  posicao double precision NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX murais_usuario_idx ON public.murais (usuario_id);

CREATE TABLE public.mural_quadros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mural_id uuid NOT NULL REFERENCES public.murais(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL DEFAULT auth.uid()
    REFERENCES public.perfis_usuarios(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 80),
  cor text NOT NULL CHECK (cor ~ '^#[0-9A-Fa-f]{6}$'),
    posicao double precision NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  -- Alvo da FK composta de mural_itens (garante item e quadro no mesmo mural).
  CONSTRAINT mural_quadros_id_mural_key UNIQUE (id, mural_id)
);

CREATE INDEX mural_quadros_mural_idx ON public.mural_quadros (mural_id);
CREATE INDEX mural_quadros_usuario_idx ON public.mural_quadros (usuario_id);

CREATE TABLE public.mural_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quadro_id uuid NOT NULL,
  -- Denormalizado: é o mural do quadro (preenchido pelo trigger abaixo).
  -- Existe para a regra "uma tarefa por mural" ser garantida pelo banco.
  mural_id uuid NOT NULL,
  usuario_id uuid NOT NULL DEFAULT auth.uid()
    REFERENCES public.perfis_usuarios(id) ON DELETE CASCADE,
  -- Tarefa ou lembrete (ambos vivem em public.tarefas). Apagar a tarefa tira
  -- ela do Mural automaticamente.
  tarefa_id uuid NOT NULL REFERENCES public.tarefas(id) ON DELETE CASCADE,
  posicao double precision NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mural_itens_quadro_fkey FOREIGN KEY (quadro_id, mural_id)
    REFERENCES public.mural_quadros (id, mural_id) ON DELETE CASCADE,
  -- A mesma tarefa pode estar em murais diferentes, mas em um quadro só
  -- dentro de cada mural: arrastar = mover.
  CONSTRAINT mural_itens_um_quadro_por_tarefa UNIQUE (usuario_id, mural_id, tarefa_id)
);

CREATE INDEX mural_itens_quadro_idx ON public.mural_itens (quadro_id);
CREATE INDEX mural_itens_tarefa_idx ON public.mural_itens (tarefa_id);

-- mural_id sempre acompanha o quadro — o app nunca precisa mandar essa coluna.
-- BEFORE trigger roda antes do WITH CHECK do RLS, então a policy enxerga o
-- valor já corrigido.
CREATE OR REPLACE FUNCTION public.mural_itens_preenche_mural()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT q.mural_id INTO NEW.mural_id
  FROM public.mural_quadros q
  WHERE q.id = NEW.quadro_id;
  IF NEW.mural_id IS NULL THEN
    RAISE EXCEPTION 'Quadro não encontrado.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mural_itens_preenche_mural_trg
  BEFORE INSERT OR UPDATE OF quadro_id ON public.mural_itens
  FOR EACH ROW EXECUTE FUNCTION public.mural_itens_preenche_mural();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.murais TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mural_quadros TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mural_itens TO authenticated;
GRANT ALL ON public.murais TO service_role;
GRANT ALL ON public.mural_quadros TO service_role;
GRANT ALL ON public.mural_itens TO service_role;

-- "Esta pessoa pode colocar esta tarefa no próprio Mural?" — só tarefas em que
-- ela é responsável, ou lembretes que ela mesma criou. SECURITY DEFINER para
-- não depender das policies de tarefas/tarefa_responsaveis (que em produção
-- já divergiram das migrations locais).
CREATE OR REPLACE FUNCTION public.mural_tarefa_permitida(_tarefa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tarefas t
    WHERE t.id = _tarefa_id
      AND (
        (t.tipo = 'lembrete' AND t.criado_por = auth.uid())
        OR (
          t.tipo = 'tarefa'
          AND EXISTS (
            SELECT 1 FROM public.tarefa_responsaveis r
            WHERE r.tarefa_id = t.id AND r.usuario_id = auth.uid()
          )
        )
      )
  )
$$;

REVOKE EXECUTE ON FUNCTION public.mural_tarefa_permitida(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mural_tarefa_permitida(uuid) TO authenticated;

ALTER TABLE public.murais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mural_quadros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mural_itens ENABLE ROW LEVEL SECURITY;

-- Murais e quadros: só o dono. Sem exceção para Admin/Supervisor (de propósito).
CREATE POLICY "Dono gerencia seus murais" ON public.murais
  FOR ALL TO authenticated
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "Dono ve seus quadros" ON public.mural_quadros
  FOR SELECT TO authenticated
  USING (usuario_id = auth.uid());

CREATE POLICY "Dono cria quadros" ON public.mural_quadros
  FOR INSERT TO authenticated
  WITH CHECK (
    usuario_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.murais m
      WHERE m.id = mural_id AND m.usuario_id = auth.uid()
    )
  );

CREATE POLICY "Dono edita quadros" ON public.mural_quadros
  FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid())
  WITH CHECK (
    usuario_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.murais m
      WHERE m.id = mural_id AND m.usuario_id = auth.uid()
    )
  );

CREATE POLICY "Dono exclui quadros" ON public.mural_quadros
  FOR DELETE TO authenticated
  USING (usuario_id = auth.uid());

CREATE POLICY "Dono ve seus itens" ON public.mural_itens
  FOR SELECT TO authenticated
  USING (usuario_id = auth.uid());

CREATE POLICY "Dono adiciona itens" ON public.mural_itens
  FOR INSERT TO authenticated
  WITH CHECK (
    usuario_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.mural_quadros q
      WHERE q.id = quadro_id AND q.usuario_id = auth.uid()
    )
    AND public.mural_tarefa_permitida(tarefa_id)
  );

-- Mover item (troca de quadro/posição): o quadro de destino também tem que ser dele.
CREATE POLICY "Dono move itens" ON public.mural_itens
  FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid())
  WITH CHECK (
    usuario_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.mural_quadros q
      WHERE q.id = quadro_id AND q.usuario_id = auth.uid()
    )
  );

CREATE POLICY "Dono remove itens" ON public.mural_itens
  FOR DELETE TO authenticated
  USING (usuario_id = auth.uid());

-- Mesmo cinto e suspensório das outras tabelas (ver 20260818165500).
CREATE POLICY "Exige perfil interno" ON public.murais
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

CREATE POLICY "Exige perfil interno" ON public.mural_quadros
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

CREATE POLICY "Exige perfil interno" ON public.mural_itens
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.tem_perfil(auth.uid()))
  WITH CHECK (public.tem_perfil(auth.uid()));

-- Excluir um quadro apaga junto os lembretes que estão nele (tarefas só saem
-- do quadro, continuam existindo). Numa função para ser atômico: ou apaga
-- tudo, ou nada. SECURITY INVOKER — roda com as policies de quem chamou.
CREATE OR REPLACE FUNCTION public.excluir_mural_quadro(_quadro_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mural_quadros
    WHERE id = _quadro_id AND usuario_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Quadro não encontrado.';
  END IF;

  DELETE FROM public.tarefas t
  USING public.mural_itens i
  WHERE i.quadro_id = _quadro_id
    AND i.usuario_id = auth.uid()
    AND t.id = i.tarefa_id
    AND t.tipo = 'lembrete'
    AND t.criado_por = auth.uid()
    -- Nunca apagar um lembrete que a pessoa também guardou em outro mural.
    AND NOT EXISTS (
      SELECT 1 FROM public.mural_itens o
      WHERE o.tarefa_id = i.tarefa_id
        AND o.usuario_id = i.usuario_id
        AND o.quadro_id <> _quadro_id
    );

  DELETE FROM public.mural_quadros
  WHERE id = _quadro_id AND usuario_id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.excluir_mural_quadro(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.excluir_mural_quadro(uuid) TO authenticated;

-- Excluir um mural: mesma regra, para todos os quadros dele de uma vez.
-- Os quadros e itens somem por cascata da FK.
CREATE OR REPLACE FUNCTION public.excluir_mural(_mural_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.murais
    WHERE id = _mural_id AND usuario_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Mural não encontrado.';
  END IF;

  DELETE FROM public.tarefas t
  USING public.mural_itens i
  WHERE i.mural_id = _mural_id
    AND i.usuario_id = auth.uid()
    AND t.id = i.tarefa_id
    AND t.tipo = 'lembrete'
    AND t.criado_por = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.mural_itens o
      WHERE o.tarefa_id = i.tarefa_id
        AND o.usuario_id = i.usuario_id
        AND o.mural_id <> _mural_id
    );

  DELETE FROM public.murais WHERE id = _mural_id AND usuario_id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.excluir_mural(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.excluir_mural(uuid) TO authenticated;
