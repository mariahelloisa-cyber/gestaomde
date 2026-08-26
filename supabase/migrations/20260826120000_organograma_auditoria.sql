-- Auditoria periódica dos nós com link (ex: redes sociais): registra quando a
-- auditoria foi marcada como feita. O app calcula se o ciclo de 10 dias ainda
-- está em dia a partir dessa data — não há job de limpeza, o "desmarcar" é
-- apenas visual quando o prazo vence.
ALTER TABLE public.organograma_nos ADD COLUMN auditoria_marcada_em timestamptz;
