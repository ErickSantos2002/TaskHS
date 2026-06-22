# Automações — Design

**Data:** 2026-06-22
**Status:** Aprovado
**Contexto:** TaskHS (clone de Trello da Health & Safety). Última feature de paridade com o Trello. As automações do Trello (Butler) que a empresa usa se resumem a **regras por evento**: "quando algo acontece com um card, faça uma ação". O sistema já tem tudo que a ação precisa manipular no `Card` (`due_date`, `due_date_completed`, `list_id`, labels, members) e já tem o sino de notificações. Não há scheduler além do loop de lembretes (`app/reminders.py`).

## Decisões (definidas com o Erick)

| Tema | Decisão |
|------|---------|
| Tipo de automação | **Regras por evento** (só). Sem botões manuais, sem agendadas. |
| Gatilho (v1) | **Card movido para uma lista** (só). |
| Ação (v1) | **Marcar a data de entrega como concluída** (`due_date_completed = True`) (só). |
| Quem gerencia | **Dono do quadro + admin global** (`is_admin`). Membros comuns só sofrem o efeito. |
| Escopo | **Por quadro.** |
| Arquitetura | **Motor de automação dedicado** (`app/automations.py`), dirigido por evento, chamado pelo handler de movimentação. |

O modelo é desenhado genérico (gatilho + ação + config) para que gatilhos/ações futuros sejam baratos de adicionar, **mas só a regra acima é implementada na v1** (YAGNI).

## 1. Banco — 1 tabela nova

`create_all` cria tabelas que faltam — tabela nova não precisa de migration manual.

**`automations`:**
- `id` PK
- `board_id` FK → `boards.id`
- `trigger_type` str — v1 sempre `"card_moved_to_list"`
- `trigger_list_id` FK → `lists.id` — a lista de destino que dispara a regra
- `action_type` str — v1 sempre `"mark_due_complete"`
- `action_config` Text (JSON), **nullable** — vazio/`NULL` na v1; existe para parâmetros de ações futuras (ex.: `label_id`, dias) sem exigir migration depois
- `enabled` bool, default `true`
- `created_by` FK → `users.id`, **nullable**
- `created_at` datetime tz, default agora

Model em `backend/app/models/automation.py`, registrado em `app/models/__init__.py`.

**Sem relationship/cascade** (como `Notification`/`Reminder`/`ReminderSent`). A limpeza de linhas é explícita (ver §5).

## 2. Motor de automação

Módulo novo `backend/app/automations.py`:

```python
async def run_card_moved_automations(db, card, from_list_id, to_list_id) -> None
```

Comportamento:
1. Se `from_list_id == to_list_id` → retorna (reordenar dentro da mesma lista não dispara).
2. Resolve o `board_id` do card via `list → board` (mesma técnica de `reminders._board_id_for_card`, usando `to_list_id`).
3. Seleciona `automations` com `enabled == True`, `trigger_type == "card_moved_to_list"`, `trigger_list_id == to_list_id` e `board_id ==` board do card.
4. Para cada automação, executa a ação dentro de `try/except` (loga e segue se uma falhar — uma regra defeituosa nunca trava o movimento do card):
   - `mark_due_complete`: se `card.due_date is not None`, faz `card.due_date_completed = True`. Sem `due_date` é **no-op** (não levanta erro).
5. **Não** re-dispara automações a partir das ações (sem cascata na v1).

O motor **não** dá `commit` — ele apenas muta o objeto `card` na sessão recebida; o handler que o chamou faz o commit (movimento do card + efeito da automação na mesma transação).

## 3. Ponto de gatilho

Dentro do `PATCH update_card` em `backend/app/routers/cards.py`:
- Antes de aplicar o body: `old_list_id = card.list_id`.
- Aplica o body (que pode setar `card.list_id` para a lista nova).
- `new_list_id = card.list_id`.
- Se `old_list_id != new_list_id`: `await run_card_moved_automations(db, card, old_list_id, new_list_id)`.
- `await db.commit()` (já existente) persiste tudo junto.

**Multi-worker:** por ser síncrono no request (não é loop de polling), rodar uvicorn com vários workers **não duplica** o efeito — diferente do gotcha dos lembretes.

## 4. Backend — endpoints

Router novo `backend/app/routers/automations.py`, prefixo `/boards/{board_id}/automations`, todos com `get_current_user`. Registrado em `main.py` com prefixo `/api` (→ `/api/boards/{board_id}/automations`).

| Método | Rota | Authz | Comportamento |
|--------|------|-------|---------------|
| `GET` | `""` | logado | Lista as automações do board, ordenadas por `id`. → `list[AutomationOut]`. 404 se board não existe. |
| `POST` | `""` | dono/admin | Cria. Valida que `trigger_list_id` existe e pertence a `board_id` (senão 400). `trigger_type` default `"card_moved_to_list"`, `action_type` default `"mark_due_complete"`, `enabled` default `true`. Seta `created_by = current_user.id`. → `AutomationOut` 201. |
| `PATCH` | `/{automation_id}` | dono/admin | Edita campos enviados (`enabled`, `trigger_list_id`, `action_type`). Se `trigger_list_id` mudar, revalida pertencimento ao board. 404 se não existe. → `AutomationOut`. |
| `DELETE` | `/{automation_id}` | dono/admin | Remove. 404 se não existe. → 204. |

**Autorização (dono/admin)** — espelha o `update_board` atual:
```python
if board.owner_id != current_user.id and not current_user.is_admin:
    raise HTTPException(status_code=403, detail="Apenas o dono ou administrador pode gerenciar automações")
```

`AutomationOut` (schema em `backend/app/schemas/automation.py`): `id`, `board_id`, `trigger_type`, `trigger_list_id`, `action_type`, `enabled`, `created_at`.
`AutomationCreate`: `trigger_list_id: int`, `trigger_type: str = "card_moved_to_list"`, `action_type: str = "mark_due_complete"`, `enabled: bool = True`.
`AutomationUpdate`: `enabled: bool | None`, `trigger_list_id: int | None`, `action_type: str | None`.

## 5. Limpeza explícita (sem cascade)

- **Apagar lista:** o handler de delete de lista (`backend/app/routers/lists.py`) passa a executar `delete(Automation).where(Automation.trigger_list_id == list_id)` antes de apagar a lista (senão FK 500 / regra órfã apontando para lista inexistente).
- **Apagar board:** adicionar `delete(Automation).where(Automation.board_id == board_id)` à limpeza já existente em `delete_board` (`backend/app/routers/boards.py`), junto de notifications/reminders.

## 6. Frontend — painel "Automações" no quadro

Em `frontend/src/pages/BoardPage.tsx`:
- Botão **"Automações"** (ícone de robô/engrenagem) no cabeçalho do board, **renderizado só** quando o usuário atual é dono do board **ou** `is_admin`.
- Abre um **modal** (`AutomationsModal`) que:
  - Lista as regras existentes (`GET`), cada uma como a frase **"Quando um card for movido para *‹lista›*, marcar a data de entrega como concluída"**, com **toggle ligar/desligar** (`PATCH enabled`) e botão **excluir** (`DELETE`).
  - Formulário de criação: um `select` com as listas do board + botão "Adicionar" (`POST { trigger_list_id }`). A ação é fixa (texto), já que só há uma na v1.
  - Carrega no `useEffect` por `board.id`; estado local na modal.
- Tipo `Automation` em `frontend/src/types/index.ts`: `{ id: number; board_id: number; trigger_type: string; trigger_list_id: number; action_type: string; enabled: boolean; created_at: string }`.

## 7. Fora de escopo (v1)

- Outros gatilhos: etiqueta adicionada, card criado, due_date marcada concluída, etc.
- Outras ações: adicionar/remover etiqueta, definir `due_date`, atribuir/remover membro, comentar, mover card, notificar.
- Botões manuais (card/board buttons) e automações agendadas (calendário).
- Cascata: ações que disparam novas automações.
- Histórico/log de execuções de automação.

O modelo (`trigger_type`/`action_type`/`action_config`) já comporta esses itens sem mudança de schema — cada um é só um novo ramo no motor + opção na UI.

## 8. Critérios de aceite

1. Dono/admin cria regra "movido para lista X → marcar concluída"; membro comum recebe **403** ao tentar criar/editar/excluir.
2. Mover um card (PATCH mudando `list_id`) para a lista X marca `due_date_completed = true` no mesmo request; mover para uma lista sem regra não tem efeito.
3. Reordenar um card **dentro** da mesma lista (PATCH só de `position`) não dispara nada.
4. Card sem `due_date` movido para a lista X: nenhum erro, `due_date_completed` segue `false` (no-op).
5. Regra com `enabled = false` não dispara.
6. Apagar a lista usada como gatilho remove as automações associadas (sem FK 500); apagar o board remove as automações do board.
7. A regra é por board: mover card num board sem aquela regra não dispara.
