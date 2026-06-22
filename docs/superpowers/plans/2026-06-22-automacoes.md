# Automações Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar automações por evento ao TaskHS — regra "quando um card for movido para a lista X, marcar a data de entrega como concluída" — gerenciável por dono/admin via um painel no quadro.

**Architecture:** Tabela `automations` genérica (trigger/action/config). Um motor dirigido por evento (`app/automations.py`) é chamado dentro do `PATCH update_card` quando o `list_id` muda, na mesma transação do movimento. CRUD via router novo `/api/boards/{board_id}/automations` (criar/editar/excluir só dono/admin). Frontend: modal "Automações" no cabeçalho do board.

**Tech Stack:** FastAPI async, SQLAlchemy 2.0 (`Mapped`/`mapped_column`), asyncpg, pydantic-settings; React 19 + Vite + Tailwind v4 + TypeScript.

## Global Constraints

- **Spec de referência:** `docs/superpowers/specs/2026-06-22-automacoes-design.md` — segui-lo à risca.
- **Sem suíte de testes no projeto** (CLAUDE.md: "Não há suíte de testes" / "Não invente comandos de teste"). A verificação de cada task é **manual via curl + consulta ao banco + navegador**, exatamente como foi feito em anexos/lembretes. NÃO criar pytest/vitest.
- **Backend roda em Docker:** após mudança no backend, rebuildar com `docker compose up -d --build` e esperar o health (`until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done`).
- **`create_all` cria só tabelas que faltam** — a tabela nova `automations` nasce sozinha no startup; **não** há migration manual.
- **Banco é o de produção remoto** (Easypanel). Limpar quaisquer linhas de teste criadas durante a verificação.
- **Driver async obrigatório:** nada de query síncrona; usar `AsyncSession`/`await db.execute(...)`.
- **Padrão de autorização dono/admin** (verbatim do `update_board`): `if board.owner_id != current_user.id and not current_user.is_admin: raise HTTPException(status_code=403, detail="...")`.
- **v1 só implementa:** `trigger_type="card_moved_to_list"` + `action_type="mark_due_complete"`. O modelo é genérico, mas **não** implementar outros gatilhos/ações (YAGNI).
- **Mensagens/labels em português.**
- **Commits** terminam com `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### Helper de verificação (token admin)

Várias tasks usam um token JWT. Para obtê-lo:
```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
echo "$TOKEN" | cut -c1-20
```
(O campo exato do token é `access_token`; confirmar na resposta do login se necessário.)

---

### Task 1: Modelo `Automation` + schemas

**Files:**
- Create: `backend/app/models/automation.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/app/schemas/automation.py`

**Interfaces:**
- Produces: model `Automation` (tabela `automations`) com campos `id, board_id, trigger_type, trigger_list_id, action_type, action_config, enabled, created_by, created_at`. Schemas `AutomationCreate`, `AutomationUpdate`, `AutomationOut`.

- [ ] **Step 1: Criar o model**

`backend/app/models/automation.py`:
```python
from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, Boolean, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Automation(Base):
    __tablename__ = "automations"

    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id"))
    trigger_type: Mapped[str] = mapped_column(String(50), default="card_moved_to_list")
    trigger_list_id: Mapped[int] = mapped_column(ForeignKey("lists.id"))
    action_type: Mapped[str] = mapped_column(String(50), default="mark_due_complete")
    action_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 2: Registrar no `__init__.py`**

Em `backend/app/models/__init__.py`, adicionar o import e o `__all__`. Resultado final do arquivo:
```python
from app.models.user import User
from app.models.board import Board, BoardMember, BoardLabel
from app.models.list import List
from app.models.card import Card, CardLabel, CardMember, CardComment, CardAttachment
from app.models.notification import Notification
from app.models.reminder import Reminder, ReminderSent
from app.models.automation import Automation

__all__ = [
    "User", "Board", "BoardMember", "BoardLabel", "List",
    "Card", "CardLabel", "CardMember", "CardComment", "CardAttachment",
    "Notification",
    "Reminder", "ReminderSent",
    "Automation",
]
```

- [ ] **Step 3: Criar os schemas**

`backend/app/schemas/automation.py`:
```python
from datetime import datetime
from pydantic import BaseModel


class AutomationCreate(BaseModel):
    trigger_list_id: int
    trigger_type: str = "card_moved_to_list"
    action_type: str = "mark_due_complete"
    enabled: bool = True


class AutomationUpdate(BaseModel):
    enabled: bool | None = None
    trigger_list_id: int | None = None
    action_type: str | None = None


class AutomationOut(BaseModel):
    id: int
    board_id: int
    trigger_type: str
    trigger_list_id: int
    action_type: str
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Rebuildar o backend e verificar que a tabela foi criada**

```bash
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
```
Verificar a existência da tabela e colunas (ajustar o comando ao ambiente):
```bash
docker compose exec -T backend python -c "
import asyncio
from sqlalchemy import text
from app.database import AsyncSessionLocal
async def main():
    async with AsyncSessionLocal() as db:
        r = await db.execute(text(\"select column_name from information_schema.columns where table_name='automations' order by ordinal_position\"))
        print([row[0] for row in r.fetchall()])
asyncio.run(main())
"
```
Expected: imprime `['id', 'board_id', 'trigger_type', 'trigger_list_id', 'action_type', 'action_config', 'enabled', 'created_by', 'created_at']`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/automation.py backend/app/models/__init__.py backend/app/schemas/automation.py
git commit -m "feat(automacoes): modelo Automation + schemas

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Router CRUD `/api/boards/{board_id}/automations` + authz

**Files:**
- Create: `backend/app/routers/automations.py`
- Modify: `backend/app/main.py` (import + include_router)

**Interfaces:**
- Consumes: `Automation` (Task 1), `AutomationCreate`/`AutomationUpdate`/`AutomationOut` (Task 1), `Board`, `List`, `User`, `get_current_user`, `get_db`.
- Produces: rotas `GET/POST/PATCH/DELETE` sob `/boards/{board_id}/automations` (registradas com prefixo `/api`).

- [ ] **Step 1: Criar o router**

`backend/app/routers/automations.py`:
```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.automation import Automation
from app.models.board import Board
from app.models.list import List
from app.models.user import User
from app.schemas.automation import AutomationCreate, AutomationUpdate, AutomationOut
from app.dependencies import get_current_user

router = APIRouter(prefix="/boards/{board_id}/automations", tags=["automations"])


async def _get_board_or_404(board_id: int, db: AsyncSession) -> Board:
    board = (await db.execute(select(Board).where(Board.id == board_id))).scalar_one_or_none()
    if not board:
        raise HTTPException(status_code=404, detail="Board não encontrado")
    return board


def _require_owner_or_admin(board: Board, user: User) -> None:
    if board.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas o dono ou administrador pode gerenciar automações")


async def _validate_list_in_board(list_id: int, board_id: int, db: AsyncSession) -> None:
    lst = (await db.execute(
        select(List).where(List.id == list_id, List.board_id == board_id)
    )).scalar_one_or_none()
    if not lst:
        raise HTTPException(status_code=400, detail="Lista não pertence a este board")


@router.get("", response_model=list[AutomationOut])
async def list_automations(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_board_or_404(board_id, db)
    rows = (await db.execute(
        select(Automation).where(Automation.board_id == board_id).order_by(Automation.id)
    )).scalars().all()
    return rows


@router.post("", response_model=AutomationOut, status_code=status.HTTP_201_CREATED)
async def create_automation(board_id: int, body: AutomationCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    _require_owner_or_admin(board, current_user)
    await _validate_list_in_board(body.trigger_list_id, board_id, db)
    auto = Automation(
        board_id=board_id,
        trigger_type=body.trigger_type,
        trigger_list_id=body.trigger_list_id,
        action_type=body.action_type,
        enabled=body.enabled,
        created_by=current_user.id,
    )
    db.add(auto)
    await db.commit()
    await db.refresh(auto)
    return auto


@router.patch("/{automation_id}", response_model=AutomationOut)
async def update_automation(board_id: int, automation_id: int, body: AutomationUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    _require_owner_or_admin(board, current_user)
    auto = (await db.execute(
        select(Automation).where(Automation.id == automation_id, Automation.board_id == board_id)
    )).scalar_one_or_none()
    if not auto:
        raise HTTPException(status_code=404, detail="Automação não encontrada")
    data = body.model_dump(exclude_none=True)
    if "trigger_list_id" in data:
        await _validate_list_in_board(data["trigger_list_id"], board_id, db)
    for k, v in data.items():
        setattr(auto, k, v)
    await db.commit()
    await db.refresh(auto)
    return auto


@router.delete("/{automation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_automation(board_id: int, automation_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    _require_owner_or_admin(board, current_user)
    auto = (await db.execute(
        select(Automation).where(Automation.id == automation_id, Automation.board_id == board_id)
    )).scalar_one_or_none()
    if not auto:
        raise HTTPException(status_code=404, detail="Automação não encontrada")
    await db.delete(auto)
    await db.commit()
```

- [ ] **Step 2: Registrar o router no `main.py`**

Em `backend/app/main.py`, na linha de import dos routers, adicionar `automations`:
```python
from app.routers import auth, boards, lists, cards, labels, notifications, attachments, reminders, automations
```
E adicionar o include (junto dos outros `app.include_router(...)`):
```python
app.include_router(automations.router, prefix="/api")
```

- [ ] **Step 3: Rebuildar e verificar o CRUD + authz**

```bash
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
# Descobrir um board do admin e uma lista dele:
curl -s http://localhost:8000/api/boards -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -40
```
Escolher um `board_id` (BID) e, via `/api/boards/{BID}/lists`, uma `list_id` (LID). Então:
```bash
# CREATE
curl -s -X POST http://localhost:8000/api/boards/$BID/automations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"trigger_list_id\": $LID}" | python3 -m json.tool
# LIST
curl -s http://localhost:8000/api/boards/$BID/automations -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
# PATCH (desligar) — usar o id retornado (AID)
curl -s -X PATCH http://localhost:8000/api/boards/$BID/automations/$AID -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"enabled": false}' | python3 -m json.tool
# Lista inválida → 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/api/boards/$BID/automations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"trigger_list_id": 999999}'
# DELETE → 204
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:8000/api/boards/$BID/automations/$AID -H "Authorization: Bearer $TOKEN"
```
Expected: CREATE retorna o objeto com `id`, `enabled: true`, `action_type: "mark_due_complete"`, `trigger_type: "card_moved_to_list"`; LIST mostra-o; PATCH retorna `enabled: false`; lista inválida → `400`; DELETE → `204`.

- [ ] **Step 4: Verificar o 403 (não-dono/não-admin)**

Se houver um usuário comum conhecido, logar com ele e tentar `POST` numa board de outro dono → deve dar `403`. Se não houver, registrar um usuário de teste:
```bash
curl -s -X POST http://localhost:8000/api/auth/register -H 'Content-Type: application/json' -d '{"name":"Teste Automacao","email":"auto-test@example.com","password":"teste123"}' >/dev/null
TOKEN2=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"auto-test@example.com","password":"teste123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/api/boards/$BID/automations -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' -d "{\"trigger_list_id\": $LID}"
```
Expected: `403` (board pertence ao admin, e o usuário de teste não é dono nem `is_admin`).
Limpar depois: remover o usuário de teste se desejar (admin pode via `/api/auth/users`), ou deixar — não interfere.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/automations.py backend/app/main.py
git commit -m "feat(automacoes): router CRUD com authz dono/admin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Motor de automação + gatilho no `update_card`

**Files:**
- Create: `backend/app/automations.py`
- Modify: `backend/app/routers/cards.py` (import + `update_card`)

**Interfaces:**
- Consumes: `Automation` (Task 1), `List`.
- Produces: `async def run_card_moved_automations(db, card, from_list_id: int, to_list_id: int) -> None` — muta `card.due_date_completed` quando aplicável; **não** dá commit.

- [ ] **Step 1: Criar o motor**

`backend/app/automations.py`:
```python
import logging
from sqlalchemy import select
from app.models.automation import Automation
from app.models.list import List

logger = logging.getLogger("automations")


async def run_card_moved_automations(db, card, from_list_id: int, to_list_id: int) -> None:
    """Executa automações de 'card movido para lista'. Muta o card na sessão; NÃO faz commit."""
    if from_list_id == to_list_id:
        return
    board_id = (await db.execute(
        select(List.board_id).where(List.id == to_list_id)
    )).scalar_one_or_none()
    if board_id is None:
        return
    automations = (await db.execute(
        select(Automation).where(
            Automation.enabled == True,
            Automation.trigger_type == "card_moved_to_list",
            Automation.trigger_list_id == to_list_id,
            Automation.board_id == board_id,
        )
    )).scalars().all()
    for auto in automations:
        try:
            if auto.action_type == "mark_due_complete":
                if card.due_date is not None:
                    card.due_date_completed = True
        except Exception:
            logger.exception("automation %s failed for card %s", auto.id, card.id)
```

- [ ] **Step 2: Ligar o gatilho no `update_card`**

Em `backend/app/routers/cards.py`, adicionar o import (junto dos outros imports `from app...`):
```python
from app.automations import run_card_moved_automations
```
E alterar o corpo de `update_card` (a parte após obter o `card`). Substituir:
```python
    data = body.model_dump(exclude_none=True)
    for k, v in data.items():
        setattr(card, k, v)
    await db.commit()
    return _card_to_dict(card)
```
por:
```python
    data = body.model_dump(exclude_none=True)
    old_list_id = card.list_id
    for k, v in data.items():
        setattr(card, k, v)
    new_list_id = card.list_id
    if old_list_id != new_list_id:
        await run_card_moved_automations(db, card, old_list_id, new_list_id)
    await db.commit()
    return _card_to_dict(card)
```

- [ ] **Step 3: Rebuildar e verificar o disparo**

```bash
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
```
Preparar: um board (BID) com duas listas — origem (LID_SRC) e destino-gatilho (LID_DST). Criar a regra na LID_DST:
```bash
curl -s -X POST http://localhost:8000/api/boards/$BID/automations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"trigger_list_id\": $LID_DST}" | python3 -m json.tool
```
Criar um card na LID_SRC **com due_date** e mover para LID_DST:
```bash
# criar card com due_date
curl -s -X POST http://localhost:8000/api/lists/$LID_SRC/cards -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"Card teste automacao","due_date":"2030-01-01"}' | python3 -m json.tool
# mover (PATCH mudando list_id) — usar o id do card (CID)
curl -s -X PATCH http://localhost:8000/api/lists/$LID_SRC/cards/$CID -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"list_id\": $LID_DST}" | python3 -c 'import sys,json;c=json.load(sys.stdin);print("due_date_completed=",c["due_date_completed"])'
```
Expected: `due_date_completed= True`.

Casos negativos:
```bash
# (a) reordenar dentro da mesma lista NÃO dispara: criar outro card com due_date na LID_DST e PATCH só de position
# (b) mover um card SEM due_date para LID_DST: due_date_completed continua false (no-op)
# (c) regra enabled=false não dispara
```
Para (b): criar card sem `due_date` na LID_SRC, mover para LID_DST, conferir `due_date_completed=False`.
Para (a): PATCH `{"position": 100.0}` num card já na LID_DST — `due_date_completed` não deve mudar para true por causa disso.
Expected: (a) sem efeito; (b) `due_date_completed= False`; (c) com a regra desligada (`PATCH enabled:false`), mover novo card com due_date → `due_date_completed= False`.
Limpar os cards/regra de teste ao final (DELETE nos cards e na automação).

- [ ] **Step 4: Commit**

```bash
git add backend/app/automations.py backend/app/routers/cards.py
git commit -m "feat(automacoes): motor de evento + gatilho no update_card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Limpeza explícita ao apagar lista/board

**Files:**
- Modify: `backend/app/routers/lists.py` (imports + `delete_list`)
- Modify: `backend/app/routers/boards.py` (import + `delete_board`)

**Interfaces:**
- Consumes: `Automation` (Task 1).

- [ ] **Step 1: Limpeza no delete de lista**

Em `backend/app/routers/lists.py`, alterar o import da linha 3 e adicionar o import do model:
```python
from sqlalchemy import select, func, delete as sql_delete
```
```python
from app.models.automation import Automation
```
Alterar o corpo de `delete_list`. Substituir:
```python
    lst = await _get_list_or_404(list_id, board_id, db)
    await db.delete(lst)
    await db.commit()
```
por:
```python
    lst = await _get_list_or_404(list_id, board_id, db)
    await db.execute(sql_delete(Automation).where(Automation.trigger_list_id == list_id))
    await db.delete(lst)
    await db.commit()
```

- [ ] **Step 2: Limpeza no delete de board**

Em `backend/app/routers/boards.py`, adicionar o import do model (junto dos outros `from app.models...`):
```python
from app.models.automation import Automation
```
Em `delete_board`, adicionar a remoção das automações do board logo antes de `await db.delete(board)`:
```python
    await db.execute(sql_delete(Automation).where(Automation.board_id == board_id))
    await db.delete(board)
```
(`sql_delete` já está importado em `boards.py`.)

- [ ] **Step 3: Rebuildar e verificar**

```bash
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
```
Teste de delete de lista: criar uma lista descartável (LID_TMP) num board (BID), criar uma automação apontando para ela, apagar a lista, e confirmar que a automação sumiu:
```bash
# criar lista
curl -s -X POST http://localhost:8000/api/boards/$BID/lists -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"Lista descartavel"}' | python3 -m json.tool
# criar automacao para LID_TMP
curl -s -X POST http://localhost:8000/api/boards/$BID/automations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"trigger_list_id\": $LID_TMP}" | python3 -m json.tool
# apagar a lista -> deve dar 204 e nao quebrar com FK
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:8000/api/boards/$BID/lists/$LID_TMP -H "Authorization: Bearer $TOKEN"
# listar automacoes -> a do LID_TMP nao deve aparecer
curl -s http://localhost:8000/api/boards/$BID/automations -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
Expected: DELETE da lista → `204` (sem erro de FK); a automação do `LID_TMP` não aparece mais na listagem.
(Delete de board é destrutivo demais para testar no banco de produção — basta a inspeção de código garantir que a linha foi adicionada antes de `db.delete(board)`.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/lists.py backend/app/routers/boards.py
git commit -m "fix(automacoes): limpar automacoes ao apagar lista/board (sem cascade)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — painel "Automações" no quadro

**Files:**
- Modify: `frontend/src/types/index.ts` (interface `Automation`)
- Modify: `frontend/src/pages/BoardPage.tsx` (componente `AutomationsModal`, estado, botão no cabeçalho)

**Interfaces:**
- Consumes: API `/boards/{board_id}/automations` (Task 2); `api.get/post/patch/del` de `lib/api.ts`.
- Produces: modal de automações acessível por dono/admin.

- [ ] **Step 1: Adicionar o tipo `Automation`**

Em `frontend/src/types/index.ts`, adicionar:
```ts
export interface Automation {
  id: number;
  board_id: number;
  trigger_type: string;
  trigger_list_id: number;
  action_type: string;
  enabled: boolean;
  created_at: string;
}
```

- [ ] **Step 2: Criar o componente `AutomationsModal`**

Em `frontend/src/pages/BoardPage.tsx`, adicionar o componente (perto dos outros modais do arquivo; importar `Automation` do types junto dos imports existentes). O componente recebe `boardId`, a lista de `lists` (com `id`/`title`) e `onClose`:
```tsx
function AutomationsModal({ boardId, lists, onClose }: {
  boardId: number;
  lists: { id: number; title: string }[];
  onClose: () => void;
}) {
  const [rules, setRules] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [newListId, setNewListId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRules(await api.get<Automation[]>(`/boards/${boardId}/automations`));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [boardId]);

  const listTitle = (id: number) => lists.find(l => l.id === id)?.title ?? `Lista #${id}`;

  const addRule = async () => {
    if (newListId === "") return;
    setSaving(true);
    try {
      await api.post(`/boards/${boardId}/automations`, { trigger_list_id: newListId });
      setNewListId("");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (r: Automation) => {
    await api.patch(`/boards/${boardId}/automations/${r.id}`, { enabled: !r.enabled });
    await load();
  };

  const remove = async (r: Automation) => {
    await api.del(`/boards/${boardId}/automations/${r.id}`);
    await load();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-background-elevated rounded-xl border border-border w-full max-w-lg max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-100">Automações</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl leading-none">×</button>
        </div>

        <div className="rounded-lg border border-border p-3 mb-4">
          <p className="text-xs text-slate-400 mb-2">Nova regra</p>
          <p className="text-sm text-slate-300 mb-2">
            Quando um card for movido para{" "}
            <select
              value={newListId}
              onChange={e => setNewListId(e.target.value === "" ? "" : Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-slate-200 text-sm"
            >
              <option value="">selecione a lista…</option>
              {lists.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
            , marcar a data de entrega como concluída.
          </p>
          <button
            onClick={addRule}
            disabled={newListId === "" || saving}
            className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
          >
            Adicionar
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Carregando…</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-slate-500 italic">Nenhuma automação ainda.</p>
        ) : (
          <ul className="space-y-2">
            {rules.map(r => (
              <li key={r.id} className="flex items-center gap-2 rounded-lg border border-border p-3">
                <span className={cn("flex-1 text-sm", r.enabled ? "text-slate-200" : "text-slate-500 line-through")}>
                  Quando movido para <strong>{listTitle(r.trigger_list_id)}</strong>, marcar a data como concluída.
                </span>
                <button onClick={() => toggle(r)} className="text-xs px-2 py-1 rounded border border-border text-slate-300 hover:bg-background transition-colors">
                  {r.enabled ? "Desligar" : "Ligar"}
                </button>
                <button onClick={() => remove(r)} className="text-xs px-2 py-1 rounded border border-border text-red-400 hover:bg-red-500/10 transition-colors">
                  Excluir
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Adicionar estado + botão + render do modal**

Em `BoardPage` (o componente de página), adicionar o estado perto dos outros `showX`:
```tsx
const [showAutomations, setShowAutomations] = useState(false);
```
Adicionar o botão **logo após** o bloco do botão "Configurações" (mesma condição de dono/admin), por volta de [BoardPage.tsx:1814](frontend/src/pages/BoardPage.tsx#L1814):
```tsx
{(currentUser?.id === board.owner_id || currentUser?.is_admin) && (
  <button
    onClick={() => setShowAutomations(true)}
    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border border-border text-slate-300 hover:bg-background-elevated active:scale-95 transition-all duration-150"
    title="Automações do board"
  >
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
    Automações
  </button>
)}
```
E renderizar o modal junto dos outros modais condicionais da página (onde ficam `showEditBoard`, `showLabelManager` etc.):
```tsx
{showAutomations && (
  <AutomationsModal
    boardId={board.id}
    lists={lists.map(l => ({ id: l.id, title: l.title }))}
    onClose={() => setShowAutomations(false)}
  />
)}
```
(Conferir o nome real da variável das listas no escopo do `BoardPage` — usar a mesma fonte que alimenta o board; se for outro nome que não `lists`, ajustar o `.map`.)

- [ ] **Step 4: Build do frontend + verificação no navegador**

```bash
cd frontend && npm run build
```
Expected: build **passa** (sem erros TS). Depois, com `npm run dev` rodando, abrir um board onde o usuário é dono/admin:
- o botão "Automações" aparece no cabeçalho; clicar abre o modal.
- adicionar uma regra para uma lista; ela aparece na lista de regras.
- arrastar um card com data de entrega para essa lista → reabrir o card e confirmar que a data ficou marcada como concluída.
- desligar/excluir a regra funciona.
- logar com um usuário comum (não dono/admin): o botão "Automações" **não** aparece.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/BoardPage.tsx
git commit -m "feat(automacoes): painel de automações no quadro (dono/admin)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notas finais

- Após todas as tasks: rodar a revisão final de branch (subagent-driven-development → final code review) e então **finishing-a-development-branch** (merge na `main` + push), seguindo o fluxo das features anteriores.
- Atualizar o `CLAUDE.md` (lista de routers + seção de arquitetura) e o memory `taskhs-purpose.md` (marcar automações ✅) como passo de fechamento — não é uma task de código, mas faz parte do encerramento.
