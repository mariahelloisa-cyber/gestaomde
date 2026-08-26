-- Controle de envio dos avisos de auditoria (Telegram): guarda a última vez que
-- cada tipo de aviso foi mandado, só pra não duplicar se o cron rodar mais de
-- uma vez no mesmo dia. Como o ciclo se repete todo mês, isso NÃO é "enviado
-- para sempre" como em tarefas — o hook compara a data (dia/mês/ano) salva aqui
-- com a de hoje antes de decidir se manda de novo.
ALTER TABLE public.organograma_nos ADD COLUMN auditoria_aviso_lembrete_em timestamptz;
ALTER TABLE public.organograma_nos ADD COLUMN auditoria_aviso_expirado_em timestamptz;
