# Automação de avisos WhatsApp

## 1. Banco de dados (1 migração)

**`perfis_usuarios`**
- Adicionar coluna `telefone TEXT` (nullable a princípio — o app força preencher na UI).

**`tarefas`** — colunas de controle para não duplicar avisos:
- `aviso_lembrete_enviado_em TIMESTAMPTZ`
- `aviso_expirado_enviado_em TIMESTAMPTZ`

**Tabela nova `whatsapp_logs`** (rastreio de envios):
- `id`, `tarefa_id`, `usuario_id`, `telefone`, `tipo` (`designacao` | `lembrete` | `expirado`), `mensagem`, `status` (`enviado`|`erro`), `resposta`, `criado_em`.
- RLS: leitura para autenticados; insert/update apenas via `service_role` (server).

**Trigger no `tarefa_responsaveis`** (AFTER INSERT) usa `pg_net.http_post` para chamar `/api/public/hooks/whatsapp-assignment` com `{ tarefa_id, usuario_id }` — assim qualquer designação (UI, API, importação) dispara o aviso.

**pg_cron diário às 08:00** chamando `/api/public/hooks/whatsapp-daily` — processa lembretes (24h antes) e tarefas expiradas pendentes.

Extensões necessárias: `pg_cron`, `pg_net` (ativar se ainda não estiverem).

## 2. Secrets

Nomes: `WHATSAPP_API_URL` (ex: `https://free.uazapi.com/send/text`) e `WHATSAPP_API_TOKEN` (token/instance token do seu provedor).

## 3. Backend (TanStack server)

`src/lib/whatsapp.server.ts`
- `sendWhatsAppMessage(telefone, mensagem)` → POST autenticado com Bearer/token para `WHATSAPP_API_URL`, normaliza telefone (`55` + DDD + número), retorna `{ ok, response }`.
- `formatarMensagemDesignacao`, `formatarMensagemLembrete`, `formatarMensagemExpirado`.

`src/lib/whatsapp.functions.ts` (server fn opcional, para teste manual de envio a partir do app).

**Rotas públicas (chamadas por pg_cron / pg_net):**

`src/routes/api/public/hooks/whatsapp-assignment.ts` (POST)
- Body: `{ tarefa_id, usuario_id }`.
- Busca tarefa + telefone do membro via `supabaseAdmin`.
- Envia mensagem de designação, grava em `whatsapp_logs`.

`src/routes/api/public/hooks/whatsapp-daily.ts` (POST)
- Lembrete: tarefas com `data_vencimento` entre agora e +24h, status ≠ Concluída, `aviso_lembrete_enviado_em IS NULL`. Envia para todos os responsáveis com telefone e marca a coluna.
- Expirado: `data_vencimento < now()`, status ≠ Concluída, `aviso_expirado_enviado_em IS NULL`. Mesmo fluxo.

Segurança: ambas as rotas exigem header `apikey` com a publishable key do projeto (padrão pg_cron) e ignoram chamadas sem ela.

## 4. Frontend

**Cadastro/edição de membro**
- Campo "Telefone (com DDD)" com máscara `(99) 99999-9999`, validação Zod (10 ou 11 dígitos), obrigatório.
- Salvar no `perfis_usuarios.telefone` (apenas dígitos).

**Bloqueio para usuários existentes sem telefone**
- Guard no layout `_authenticated`: se `telefone` vazio, redireciona para `/perfil/completar` (tela simples com o campo + botão "Salvar"). Login continua funcionando, mas o app só libera após preencher.

**Convite de novo membro**
- Mostrar aviso de que o membro precisará cadastrar o telefone no primeiro login (o convite em si continua igual).

## 5. Cron job (executado depois da migração)

```sql
select cron.schedule(
  'whatsapp-daily-08h',
  '0 11 * * *',  -- 08:00 BRT (UTC-3)
  $$ select net.http_post(
       url := '<URL_DO_APP>/api/public/hooks/whatsapp-daily',
       headers := '{"Content-Type":"application/json","apikey":"<ANON_KEY>"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
```

> **Nota (pós-desvinculação da Lovable):** a URL usada aqui não pode mais ser `https://gestaomde.lovable.app/...` — deve apontar para o domínio real onde o app está hospedado. Ver `docs/lovable-decoupling.md` para o que ainda falta ajustar nas migrações existentes.

## Ordem de execução

1. Migração do banco (telefone, colunas em tarefas, `whatsapp_logs`, trigger, pg_cron/pg_net).
2. Configurar os 2 secrets (`WHATSAPP_API_URL`, `WHATSAPP_API_TOKEN`).
3. Implementar `whatsapp.server.ts` + as 2 rotas `/api/public/hooks/*`.
4. UI: campo telefone + tela de completar perfil + guard.
5. Agendar pg_cron e mostrar como testar (chamar a rota manualmente).

## Detalhes técnicos

- Provedor: UazAPI/Evolution/Z-API. Payload padrão `{ number, text }` com header `token` ou `Authorization: Bearer`. Configurável por env (`WHATSAPP_API_URL` aceita URL completa do endpoint de envio).
- Telefone armazenado só com dígitos; normalização para `55DDDNNNNNNNNN` na hora do envio.
- Idempotência garantida pelas colunas `aviso_*_enviado_em` (lembrete/expirado) e por checagem no `whatsapp_logs` (designação) para evitar duplicatas se a trigger refirar.
- Logs do envio ficam visíveis em `whatsapp_logs` (poderemos adicionar uma tela depois).
