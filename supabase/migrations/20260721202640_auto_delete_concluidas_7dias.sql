-- Tarefas concluídas há mais de 7 dias são excluídas automaticamente, para não
-- acumular na coluna/aba "Concluídas".

ALTER TABLE public.tarefas
  ADD COLUMN IF NOT EXISTS concluido_em timestamptz;

-- Tarefas já concluídas antes desta migration não têm como saber a data real
-- de conclusão; começam a contar os 7 dias a partir de agora.
UPDATE public.tarefas SET concluido_em = now() WHERE status = 'Concluído' AND concluido_em IS NULL;

CREATE OR REPLACE FUNCTION public.tg_tarefas_concluido_em()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'Concluído' THEN
      NEW.concluido_em := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'Concluído' AND OLD.status IS DISTINCT FROM 'Concluído' THEN
    NEW.concluido_em := now();
  ELSIF NEW.status <> 'Concluído' THEN
    NEW.concluido_em := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tarefas_concluido_em ON public.tarefas;
CREATE TRIGGER trg_tarefas_concluido_em
BEFORE INSERT OR UPDATE ON public.tarefas
FOR EACH ROW EXECUTE FUNCTION public.tg_tarefas_concluido_em();

-- Job diário: apaga tarefas concluídas há mais de 7 dias.
DO $$
BEGIN
  PERFORM cron.unschedule('excluir-tarefas-concluidas-antigas');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'excluir-tarefas-concluidas-antigas',
    '30 11 * * *',
    $job$
      DELETE FROM public.tarefas
      WHERE status = 'Concluído'
        AND concluido_em IS NOT NULL
        AND concluido_em < now() - interval '7 days';
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
