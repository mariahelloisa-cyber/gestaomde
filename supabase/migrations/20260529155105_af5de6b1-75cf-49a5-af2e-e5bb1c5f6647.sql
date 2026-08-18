-- 1. Add status to clientes
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativo';
-- 2. Configurações de planos
CREATE TABLE IF NOT EXISTS public.configuracoes_planos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_plano text NOT NULL UNIQUE,
  valor_mensal numeric(12,2) NOT NULL DEFAULT 0,
  servicos_inclusos jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.configuracoes_planos TO authenticated;
GRANT ALL ON public.configuracoes_planos TO service_role;
ALTER TABLE public.configuracoes_planos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticados leem planos"
  ON public.configuracoes_planos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins inserem planos"
  ON public.configuracoes_planos FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins atualizam planos"
  ON public.configuracoes_planos FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins excluem planos"
  ON public.configuracoes_planos FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));
-- 3. Financeiro transações
CREATE TABLE IF NOT EXISTS public.financeiro_transacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('mensalidade_plano', 'servico_avulso')),
  descricao text NOT NULL,
  valor numeric(12,2) NOT NULL DEFAULT 0,
  data_pagamento timestamptz NOT NULL DEFAULT now(),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financeiro_transacoes TO authenticated;
GRANT ALL ON public.financeiro_transacoes TO service_role;
ALTER TABLE public.financeiro_transacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticados gerenciam transacoes"
  ON public.financeiro_transacoes FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_fin_cliente ON public.financeiro_transacoes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_fin_data ON public.financeiro_transacoes(data_pagamento DESC);
-- 4. Seed dos planos padrão
INSERT INTO public.configuracoes_planos (nome_plano, valor_mensal, servicos_inclusos) VALUES
  ('Bronze',   400,  '["Gestão de redes sociais básica","Relatório mensal"]'::jsonb),
  ('Prata',    500,  '["Gestão de redes sociais","Tráfego pago básico","Relatório quinzenal"]'::jsonb),
  ('Ouro',     600,  '["Gestão completa de redes sociais","Tráfego pago","Criação de conteúdo","Relatório semanal"]'::jsonb),
  ('Diamante', 1000, '["Gestão completa","Tráfego pago avançado","Produção audiovisual","Branding","Atendimento prioritário"]'::jsonb)
ON CONFLICT (nome_plano) DO NOTHING;
