# Lembretes — Design

**Data:** 2026-06-19
**Status:** Aprovado
**Contexto:** TaskHS (clone de Trello da Health & Safety). Falta paridade com o Trello em **lembretes** de cards. O sistema de **notificações já existe e está completo**: model `Notification` (`user_id`, `type`, `message`, `card_id`, `board_id`, `read`, `created_at`), router `/notifications` (listar 50, marcar lida, marcar todas), e o **sino no `MainLayout`** com polling a cada 30s. Lembretes vão **gerar `Notification`** desse sistema — sem mudar o frontend de notificação. Não há scheduler/cron no backend hoje.

## Decisões (definidas com o Erick)

| Tema | Decisão |
|------|---------|
| Tipos | **Dois**: automático por data de entrega + manual por card |
| Canal | **Só no app**, reaproveitando o sino atual (sem e-mail) |
| Momentos do automático | **véspera** (1 dia antes), **dia** da entrega, **atrasado** (vencido e não concluído) |
| Destinatários do automático | **Membros do card** (se não há membros, ninguém) |
| Lembrete manual | **Pessoal** (só o criador), com **data e hora** específicas |
| Geração/entrega | **Loop em segundo plano** no backend (a cada 60s), dispara mesmo offline |

## 1. Banco — 2 tabelas novas

`create_all` cria tabelas que faltam (sem migration manual necessária para tabelas novas).

**`reminders`** (lembretes manuais):
- `id` PK
- `card_id` FK → `cards.id`
- `user_id` FK → `users.id`
- `remind_at` datetime (timezone-aware)
- `fired` bool, default `false`
- `created_at` datetime tz, default agora

**`reminder_sent`** (dedup dos automáticos):
- `id` PK
- `card_id` FK → `cards.id`
- `user_id` FK → `users.id`
- `kind` str (`day_before` | `due_day` | `overdue`)
- `due_date` Date (a data de entrega vigente quando o aviso foi enviado)
- `created_at` datetime tz
- **Único** em `(card_id, user_id, kind, due_date)` → evita reenviar o mesmo aviso; se o `due_date` mudar, a chave muda e re-avisa.

Models em `backend/app/models/reminder.py`, registrados em `app/models/__init__.py`.

## 2. Loop em segundo plano

Iniciado no `lifespan` de `main.py` via `asyncio.create_task`, cancelado no shutdown. Intervalo: **60s**. Abre sua própria sessão (`AsyncSessionLocal`) a cada ciclo. Toda exceção do ciclo é capturada e logada (o loop nunca morre por erro de um ciclo).

**Manuais:** seleciona `reminders` com `remind_at <= now(utc)` e `fired == False`. Para cada um: cria `Notification(user_id, type="reminder_manual", message=…, card_id, board_id)` e marca `fired=True`. (Resolve `board_id` via `list → board`.)

**Automáticos:** para cada `Card` ativo (`archived == False`, `due_date_completed == False`) com `due_date != NULL`, calcula quais `kind` se aplicam **hoje** (data do servidor, UTC):
- `day_before`: `due_date == hoje + 1 dia`
- `due_day`: `due_date == hoje`
- `overdue`: `due_date < hoje`

Para cada membro do card (`CardMember`) e cada `kind` aplicável: se **não** existe `reminder_sent(card_id, user_id, kind, due_date)`, cria `Notification(type="reminder_due", message=…)` e insere a linha de dedup. `overdue` dispara **uma vez** por `due_date` (a chave de dedup garante isso, mesmo que o card siga vencido por dias).

Mensagens (pt-BR), ex.:
- manual: `"Lembrete: \"{título do card}\""`
- day_before: `"\"{card}\" vence amanhã ({dd/mm})"`
- due_day: `"\"{card}\" vence hoje"`
- overdue: `"\"{card}\" está atrasado (venceu em {dd/mm})"`

## 3. Backend — endpoints

Novo router `app/routers/reminders.py`, prefixo `/lists/{list_id}/cards/{card_id}/reminders`, todos com `get_current_user`.

- `POST ""` — body `{ remind_at: datetime }`. Valida que o card existe (`card_id`+`list_id`). Cria `Reminder(card_id, user_id=current_user.id, remind_at)`. Retorna `ReminderOut`. `remind_at` no passado é **aceito** (dispara no próximo ciclo do loop) — sem validação de data futura.
- `GET ""` — lista os `reminders` **do usuário atual** naquele card, ordenados por `remind_at`. Retorna `list[ReminderOut]`.
- `DELETE "/{reminder_id}"` — remove; só se `reminder.user_id == current_user.id` (senão 403); 404 se não existe. Retorna 204.

`ReminderOut`: `id`, `card_id`, `remind_at`, `fired`, `created_at`. Schema em `app/schemas/reminder.py`.

Registrar o router em `main.py` com prefixo `/api`.

## 4. Frontend — seção "Lembretes" no `CardDetailModal`

Adicionar uma seção (perto de Datas/Checklists) em `frontend/src/pages/BoardPage.tsx`:
- **Criar:** input `datetime-local` + botão "Adicionar lembrete" → `api.post('/lists/{lid}/cards/{cid}/reminders', { remind_at })`. Converter o valor local para ISO antes de enviar.
- **Listar:** os lembretes do usuário no card (`api.get`), cada um com data/hora formatada (pt-BR) e um marcador de "já disparado" quando `fired`. Botão excluir (`api.del`).
- Ícone de relógio/sino. Estado local na modal; carregar no `useEffect` por `card.id`.
- Tipo `Reminder` em `frontend/src/types/index.ts`: `{ id, card_id, remind_at, fired, created_at }`.

Os **automáticos não têm UI** de configuração (são política do sistema) — chegam direto no sino.

## 5. Fora de escopo (v1)

- E-mail / push.
- Lembrete manual para outros usuários; lembrete coletivo.
- Recorrência (diário/semanal).
- Hora-do-dia no `due_date` (os automáticos seguem granularidade de dia).
- Limpeza de `reminder_sent`/`reminders` antigos (volume é baixo; pode vir depois).

## 6. Critérios de aceite

1. Criar lembrete manual para daqui a 1–2 min → dentro de ~60s aparece uma notificação no sino para o criador, e o lembrete fica `fired`.
2. Excluir lembrete manual só funciona para o dono (403 caso contrário).
3. Um card com `due_date` = amanhã e um membro → o membro recebe a notificação `day_before` (uma vez); rodar o loop de novo não duplica.
4. `due_day` e `overdue` disparam nos momentos corretos, uma vez cada por `due_date`.
5. Card sem membros não gera lembrete automático; card concluído/arquivado não gera.
6. O sino existente exibe os lembretes sem alteração no fluxo de notificações.
7. Mudar o `due_date` de um card já avisado faz re-disparar os automáticos aplicáveis (nova chave de dedup).
