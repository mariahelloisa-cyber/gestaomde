
-- ENUMs
CREATE TYPE public.cargo_usuario AS ENUM ('Admin', 'Membro');
CREATE TYPE public.plano_cliente AS ENUM ('Bronze', 'Prata', 'Ouro', 'Diamond');
CREATE TYPE public.status_tarefa AS ENUM ('Pendente', 'Em Progresso', 'Concluído');
CREATE TYPE public.prioridade_tarefa AS ENUM ('Alta', 'Média', 'Baixa', 'Nenhuma');

-- perfis_usuarios
CREATE TABLE public.perfis_usuarios (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  cargo public.cargo_usuario NOT NULL DEFAULT 'Membro',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.perfis_usuarios TO authenticated;
GRANT ALL ON public.perfis_usuarios TO service_role;
ALTER TABLE public.perfis_usuarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados podem ver perfis" ON public.perfis_usuarios
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Usuário insere próprio perfil" ON public.perfis_usuarios
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Usuário atualiza próprio perfil" ON public.perfis_usuarios
  FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Usuário exclui próprio perfil" ON public.perfis_usuarios
  FOR DELETE TO authenticated USING (auth.uid() = id);

-- clientes
CREATE TABLE public.clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_empresa TEXT NOT NULL,
  logo_url TEXT,
  plano public.plano_cliente NOT NULL DEFAULT 'Bronze',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes TO authenticated;
GRANT ALL ON public.clientes TO service_role;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados gerenciam clientes" ON public.clientes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- tarefas
CREATE TABLE public.tarefas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descricao TEXT,
  status public.status_tarefa NOT NULL DEFAULT 'Pendente',
  prioridade public.prioridade_tarefa NOT NULL DEFAULT 'Nenhuma',
  data_vencimento TIMESTAMPTZ,
  data_criacao TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tarefas_cliente ON public.tarefas(cliente_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tarefas TO authenticated;
GRANT ALL ON public.tarefas TO service_role;
ALTER TABLE public.tarefas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados gerenciam tarefas" ON public.tarefas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- tarefa_responsaveis
CREATE TABLE public.tarefa_responsaveis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id UUID NOT NULL REFERENCES public.tarefas(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES public.perfis_usuarios(id) ON DELETE CASCADE,
  UNIQUE (tarefa_id, usuario_id)
);
CREATE INDEX idx_resp_tarefa ON public.tarefa_responsaveis(tarefa_id);
CREATE INDEX idx_resp_usuario ON public.tarefa_responsaveis(usuario_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tarefa_responsaveis TO authenticated;
GRANT ALL ON public.tarefa_responsaveis TO service_role;
ALTER TABLE public.tarefa_responsaveis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados gerenciam responsaveis" ON public.tarefa_responsaveis
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- comentarios_tarefa
CREATE TABLE public.comentarios_tarefa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id UUID NOT NULL REFERENCES public.tarefas(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES public.perfis_usuarios(id),
  conteudo TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_coment_tarefa ON public.comentarios_tarefa(tarefa_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comentarios_tarefa TO authenticated;
GRANT ALL ON public.comentarios_tarefa TO service_role;
ALTER TABLE public.comentarios_tarefa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados leem comentarios" ON public.comentarios_tarefa
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Autenticados criam comentarios" ON public.comentarios_tarefa
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = usuario_id);
CREATE POLICY "Autor edita comentario" ON public.comentarios_tarefa
  FOR UPDATE TO authenticated USING (auth.uid() = usuario_id);
CREATE POLICY "Autor exclui comentario" ON public.comentarios_tarefa
  FOR DELETE TO authenticated USING (auth.uid() = usuario_id);
