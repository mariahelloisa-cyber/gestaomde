-- Permite inativar membros (mesmo padrão já usado em clientes.status) e
-- torna possível excluir um membro sem esbarrar em comentários antigos dele.

ALTER TABLE public.perfis_usuarios
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativo';

ALTER TABLE public.comentarios_tarefa
  DROP CONSTRAINT IF EXISTS comentarios_tarefa_usuario_id_fkey,
  ADD CONSTRAINT comentarios_tarefa_usuario_id_fkey
    FOREIGN KEY (usuario_id) REFERENCES public.perfis_usuarios(id) ON DELETE CASCADE;
