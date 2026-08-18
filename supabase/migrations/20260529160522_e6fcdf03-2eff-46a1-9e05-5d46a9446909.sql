-- 1) Atualiza/insere os 4 planos com valores e serviços oficiais
INSERT INTO public.configuracoes_planos (nome_plano, valor_mensal, servicos_inclusos)
VALUES
  ('Bronze', 400, '["Cinco artes mensais","Uma campanha de tráfego pago","Consultoria de Instagram (Repaginada)"]'::jsonb),
  ('Prata',  500, '["Oito artes mensais","Duas campanhas de tráfego pago","Consultoria de Instagram (Repaginada)","Manuais de atendimento"]'::jsonb),
  ('Ouro',   600, '["Doze artes mensais","Cinco campanhas de tráfego pago","Consultoria de Instagram (Repaginada)","Manuais de atendimento","Branding e Rebranding"]'::jsonb),
  ('Diamond',1000,'["Doze artes mensais","Cinco campanhas de tráfego pago","Consultoria de Instagram (Repaginada)","Manuais de atendimento","Branding e Rebranding","Análise Competitiva","Auditoria de Mídia Paga","Auditoria de Setor Comercial"]'::jsonb)
ON CONFLICT (nome_plano) DO UPDATE
SET valor_mensal = EXCLUDED.valor_mensal,
    servicos_inclusos = EXCLUDED.servicos_inclusos,
    atualizado_em = now();
-- Garante unicidade de nome_plano caso ainda não exista
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'configuracoes_planos_nome_plano_key'
  ) THEN
    ALTER TABLE public.configuracoes_planos
      ADD CONSTRAINT configuracoes_planos_nome_plano_key UNIQUE (nome_plano);
  END IF;
END $$;
-- 2) Função de automação: ao criar cliente ativo, gera tarefas e mensalidade
CREATE OR REPLACE FUNCTION public.gerar_setup_cliente()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano public.configuracoes_planos%ROWTYPE;
  v_servico text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'ativo' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_plano
  FROM public.configuracoes_planos
  WHERE nome_plano = NEW.plano::text
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Cria uma tarefa de prioridade Alta para cada serviço do plano
  FOR v_servico IN
    SELECT jsonb_array_elements_text(v_plano.servicos_inclusos)
  LOOP
    INSERT INTO public.tarefas (titulo, cliente_id, status, prioridade, tipo, escopo, criado_por)
    VALUES (v_servico, NEW.id, 'Pendente', 'Alta', 'tarefa', 'geral', NEW.criado_por);
  END LOOP;

  -- Registra a primeira mensalidade no fluxo de caixa
  INSERT INTO public.financeiro_transacoes (cliente_id, tipo, descricao, valor, criado_por)
  VALUES (
    NEW.id,
    'mensalidade_plano',
    'Mensalidade ' || v_plano.nome_plano || ' - ' || NEW.nome_empresa,
    v_plano.valor_mensal,
    NEW.criado_por
  );

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gerar_setup_cliente ON public.clientes;
CREATE TRIGGER trg_gerar_setup_cliente
AFTER INSERT ON public.clientes
FOR EACH ROW
EXECUTE FUNCTION public.gerar_setup_cliente();
