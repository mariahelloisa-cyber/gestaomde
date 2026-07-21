-- A migração 20260529155105 semeou os planos com nome_plano='Diamante' (PT).
-- A migração 20260529160522 fez upsert com nome_plano='Diamond' (EN), que não
-- bateu com o registro existente (nomes diferentes = ON CONFLICT não pega),
-- então virou um INSERT novo em vez de update. Resultado: duas linhas pro
-- mesmo plano top. O app só reconhece "Diamond" (constante em PlansView.tsx),
-- então a linha "Diamante" quebrava a tela de planos.
DELETE FROM public.configuracoes_planos WHERE nome_plano = 'Diamante';
