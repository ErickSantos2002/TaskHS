# Card Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add card reminders — automatic due-date reminders (day-before / due-day / overdue) to card members, plus personal scheduled reminders — delivered as in-app Notifications.

**Architecture:** Two new tables (`reminders` for manual, `reminder_sent` for auto dedup). A background asyncio loop started in the FastAPI lifespan runs `run_reminder_cycle()` every 60s, creating `Notification` rows (reused by the existing bell UI). A small router exposes manual-reminder CRUD on a card.

**Tech Stack:** FastAPI + async SQLAlchemy 2.0 + asyncpg (backend), React 19 + Vite + TypeScript (frontend), PostgreSQL 17 (remote).

## Global Constraints

- Auto reminder kinds and conditions (server date, UTC): `day_before` = due_date == today+1; `due_day` = due_date == today; `overdue` = due_date < today.
- Auto reminders go to **card members only**; skip cards with no members, archived cards, and cards with `due_date_completed == True` or `due_date == NULL`.
- Auto dedup key: unique `(card_id, user_id, kind, due_date)` — fire each kind once per due_date value.
- Manual reminders are **personal** (only the creating user); `remind_at` in the past is accepted (fires next cycle).
- All reminder endpoints require `get_current_user`. Manual delete allowed only for `reminder.user_id == current_user.id`.
- Notifications reused as-is: `type` is `reminder_manual` or `reminder_due`; messages in pt-BR.
- New tables are created by `create_all` on startup — no manual migration needed.
- NO automated test harness by design; verification is via curl + `docker compose exec` + DB checks. Do not add pytest.
- Backend runs in Docker; rebuild with `docker compose up -d --build` (from repo root /home/ericks/github/TaskHS) before backend verification. Frontend uses `npm run dev` HMR.

**Test fixtures** (run at the start of any backend verification; re-run if the shell resets):
```bash
cd /home/ericks/github/TaskHS
TOKEN=$(curl -s -X POST localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
LID=$(curl -s localhost:8000/api/boards/20/lists -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')
CID=$(curl -s localhost:8000/api/lists/$LID/cards -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')
echo "TOKEN len=${#TOKEN} LID=$LID CID=$CID"   # expect long token + two ints
```
PSQL for DB checks: `PGPASSWORD=administrador psql -h 62.72.11.28 -p 9874 -U administrador -d taskhs-banco`

---

### Task 1: Reminder models + schema

**Files:**
- Create: `backend/app/models/reminder.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/app/schemas/reminder.py`

**Interfaces:**
- Produces: `Reminder` (cols `id, card_id, user_id, remind_at, fired, created_at`), `ReminderSent` (cols `id, card_id, user_id, kind, due_date, created_at`, unique `(card_id,user_id,kind,due_date)`); `ReminderCreate{remind_at: datetime}`, `ReminderOut{id, card_id, remind_at, fired, created_at}`.

- [ ] **Step 1: Create the models**

Create `backend/app/models/reminder.py`:
```python
from datetime import datetime, date, timezone
from sqlalchemy import String, ForeignKey, DateTime, Date, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Reminder(Base):
    __tablename__ = "reminders"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    remind_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    fired: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ReminderSent(Base):
    __tablename__ = "reminder_sent"
    __table_args__ = (UniqueConstraint("card_id", "user_id", "kind", "due_date", name="uq_reminder_sent"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(20))
    due_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 2: Register the models**

In `backend/app/models/__init__.py`, add the import and `__all__` entries. The file currently reads:
```python
from app.models.user import User
from app.models.board import Board, BoardMember, BoardLabel
from app.models.list import List
from app.models.card import Card, CardLabel, CardMember, CardComment, CardAttachment
from app.models.notification import Notification

__all__ = [
    "User", "Board", "BoardMember", "BoardLabel", "List",
    "Card", "CardLabel", "CardMember", "CardComment", "CardAttachment",
    "Notification",
]
```
Add `from app.models.reminder import Reminder, ReminderSent` after the notification import, and add `"Reminder", "ReminderSent",` to `__all__`.

- [ ] **Step 3: Create the schemas**

Create `backend/app/schemas/reminder.py`:
```python
from datetime import datetime
from pydantic import BaseModel


class ReminderCreate(BaseModel):
    remind_at: datetime


class ReminderOut(BaseModel):
    id: int
    card_id: int
    remind_at: datetime
    fired: bool
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Rebuild and verify the tables are created**

Run:
```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build 2>&1 | tail -2 && sleep 4
curl -s localhost:8000/api/health; echo
PGPASSWORD=administrador psql -h 62.72.11.28 -p 9874 -U administrador -d taskhs-banco \
  -tAc "SELECT table_name FROM information_schema.tables WHERE table_name IN ('reminders','reminder_sent') ORDER BY table_name;"
```
Expected: `{"status":"ok"}` then two lines: `reminder_sent` and `reminders`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/reminder.py backend/app/models/__init__.py backend/app/schemas/reminder.py
git commit -m "feat(reminders): add Reminder and ReminderSent models + schema"
```

---

### Task 2: Manual reminder CRUD router

**Files:**
- Create: `backend/app/routers/reminders.py`
- Modify: `backend/app/main.py` (register router)

**Interfaces:**
- Consumes: `Reminder`, `ReminderCreate`, `ReminderOut` (Task 1), `get_current_user`, `Card`.
- Produces: `POST/GET /api/lists/{list_id}/cards/{card_id}/reminders`, `DELETE /api/lists/{list_id}/cards/{card_id}/reminders/{reminder_id}`.

- [ ] **Step 1: Create the router**

Create `backend/app/routers/reminders.py`:
```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.card import Card
from app.models.reminder import Reminder
from app.models.user import User
from app.schemas.reminder import ReminderCreate, ReminderOut
from app.dependencies import get_current_user

router = APIRouter(prefix="/lists/{list_id}/cards/{card_id}/reminders", tags=["reminders"])


async def _get_card_or_404(card_id: int, list_id: int, db: AsyncSession) -> Card:
    result = await db.execute(select(Card).where(Card.id == card_id, Card.list_id == list_id))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card não encontrado")
    return card


@router.post("", response_model=ReminderOut, status_code=status.HTTP_201_CREATED)
async def create_reminder(list_id: int, card_id: int, body: ReminderCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_card_or_404(card_id, list_id, db)
    reminder = Reminder(card_id=card_id, user_id=current_user.id, remind_at=body.remind_at)
    db.add(reminder)
    await db.commit()
    await db.refresh(reminder)
    return reminder


@router.get("", response_model=list[ReminderOut])
async def list_reminders(list_id: int, card_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Reminder).where(Reminder.card_id == card_id, Reminder.user_id == current_user.id).order_by(Reminder.remind_at)
    )
    return result.scalars().all()


@router.delete("/{reminder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reminder(list_id: int, card_id: int, reminder_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Reminder).where(Reminder.id == reminder_id, Reminder.card_id == card_id))
    reminder = result.scalar_one_or_none()
    if not reminder:
        raise HTTPException(status_code=404, detail="Lembrete não encontrado")
    if reminder.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Apenas o autor do lembrete pode excluí-lo")
    await db.delete(reminder)
    await db.commit()
```

- [ ] **Step 2: Register the router**

In `backend/app/main.py`, add `reminders` to the routers import line:
```python
from app.routers import auth, boards, lists, cards, labels, notifications, attachments, reminders
```
and add after the attachments include:
```python
app.include_router(reminders.router, prefix="/api")
```

- [ ] **Step 3: Rebuild and verify CRUD (curl)**

Run the **Test fixtures** block, then:
```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build 2>&1 | tail -2 && sleep 4
echo "--- create ---"
RID=$(curl -s -X POST "localhost:8000/api/lists/$LID/cards/$CID/reminders" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"remind_at":"2026-06-19T23:59:00Z"}' | tee /dev/stderr | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "--- list ---"
curl -s "localhost:8000/api/lists/$LID/cards/$CID/reminders" -H "Authorization: Bearer $TOKEN"
echo; echo "--- delete ($RID) ---"
curl -s -o /dev/null -w "%%{http_code}\n" -X DELETE "localhost:8000/api/lists/$LID/cards/$CID/reminders/$RID" -H "Authorization: Bearer $TOKEN"
echo "--- delete again (expect 404) ---"
curl -s -o /dev/null -w "%%{http_code}\n" -X DELETE "localhost:8000/api/lists/$LID/cards/$CID/reminders/$RID" -H "Authorization: Bearer $TOKEN"
```
Expected: create returns JSON with `"fired":false` and a numeric id; list shows that one reminder; first delete prints `204`; second delete prints `404`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/reminders.py backend/app/main.py
git commit -m "feat(reminders): manual reminder CRUD endpoints"
```

---

### Task 3: Background reminder loop

**Files:**
- Create: `backend/app/reminders.py`
- Modify: `backend/app/main.py` (start/stop loop in lifespan)

**Interfaces:**
- Consumes: `AsyncSessionLocal`, `Reminder`, `ReminderSent`, `Card`, `CardMember`, `List`, `Notification`.
- Produces: `async def run_reminder_cycle() -> None` (one scan, own session); `async def reminder_loop(interval: int = 60) -> None`.

- [ ] **Step 1: Create the reminders module**

Create `backend/app/reminders.py`:
```python
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.database import AsyncSessionLocal
from app.models.reminder import Reminder, ReminderSent
from app.models.card import Card, CardMember
from app.models.list import List
from app.models.notification import Notification

logger = logging.getLogger("reminders")


def _fmt(d) -> str:
    return d.strftime("%d/%m")


async def _board_id_for_card(db, list_id: int) -> int | None:
    res = await db.execute(select(List.board_id).where(List.id == list_id))
    return res.scalar_one_or_none()


async def run_reminder_cycle() -> None:
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        today = now.date()

        # --- manual reminders due ---
        due = (await db.execute(
            select(Reminder).where(Reminder.remind_at <= now, Reminder.fired == False)
        )).scalars().all()
        for r in due:
            card = (await db.execute(select(Card).where(Card.id == r.card_id))).scalar_one_or_none()
            if card is not None:
                board_id = await _board_id_for_card(db, card.list_id)
                db.add(Notification(
                    user_id=r.user_id, type="reminder_manual",
                    message=f'Lembrete: "{card.title}"', card_id=card.id, board_id=board_id,
                ))
            r.fired = True
        await db.commit()

        # --- automatic due-date reminders ---
        cards = (await db.execute(
            select(Card).where(
                Card.archived == False,
                Card.due_date_completed == False,
                Card.due_date != None,
            )
        )).scalars().all()
        for card in cards:
            kinds: list[tuple[str, str]] = []
            if card.due_date == today + timedelta(days=1):
                kinds.append(("day_before", f'"{card.title}" vence amanhã ({_fmt(card.due_date)})'))
            if card.due_date == today:
                kinds.append(("due_day", f'"{card.title}" vence hoje'))
            if card.due_date < today:
                kinds.append(("overdue", f'"{card.title}" está atrasado (venceu em {_fmt(card.due_date)})'))
            if not kinds:
                continue
            members = (await db.execute(select(CardMember).where(CardMember.card_id == card.id))).scalars().all()
            if not members:
                continue
            board_id = await _board_id_for_card(db, card.list_id)
            for m in members:
                for kind, msg in kinds:
                    exists = (await db.execute(select(ReminderSent.id).where(
                        ReminderSent.card_id == card.id, ReminderSent.user_id == m.user_id,
                        ReminderSent.kind == kind, ReminderSent.due_date == card.due_date,
                    ))).scalar_one_or_none()
                    if exists:
                        continue
                    db.add(ReminderSent(card_id=card.id, user_id=m.user_id, kind=kind, due_date=card.due_date))
                    db.add(Notification(
                        user_id=m.user_id, type="reminder_due", message=msg,
                        card_id=card.id, board_id=board_id,
                    ))
            try:
                await db.commit()
            except IntegrityError:
                await db.rollback()


async def reminder_loop(interval: int = 60) -> None:
    while True:
        try:
            await run_reminder_cycle()
        except Exception:
            logger.exception("reminder cycle failed")
        await asyncio.sleep(interval)
```

- [ ] **Step 2: Start the loop in lifespan**

In `backend/app/main.py`, add `import asyncio` near the top (after `import os`) and `from app.reminders import reminder_loop` with the other app imports. Replace the `lifespan` body so it starts and cancels the loop task:
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    task = asyncio.create_task(reminder_loop())
    try:
        yield
    finally:
        task.cancel()
```

- [ ] **Step 3: Rebuild, then verify the MANUAL path via one cycle**

Run the **Test fixtures** block, then:
```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build 2>&1 | tail -2 && sleep 4
# create a reminder already in the past so it's due now
curl -s -X POST "localhost:8000/api/lists/$LID/cards/$CID/reminders" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"remind_at":"2020-01-01T00:00:00Z"}' >/dev/null
# run exactly one cycle (no waiting for the 60s loop)
docker compose exec -T backend python -c "import asyncio; from app.reminders import run_reminder_cycle; asyncio.run(run_reminder_cycle())"
# the requesting user should now have a reminder_manual notification
curl -s "localhost:8000/api/notifications" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json; ns=json.load(sys.stdin); print([n["message"] for n in ns if n["type"]=="reminder_manual"][:3])'
```
Expected: the printed list contains a `Lembrete: "<card title>"` entry. (Confirms manual reminder → notification, and the reminder was marked fired so a second cycle won't duplicate.)

- [ ] **Step 4: Verify the AUTOMATIC path (set up, run cycle, then clean up)**

Run the **Test fixtures** block, then (this temporarily sets a due date + adds the admin as member, then reverts):
```bash
cd /home/ericks/github/TaskHS
USERID=$(curl -s "localhost:8000/api/auth/me" -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
TODAY=$(date -u +%F)
curl -s -X PATCH "localhost:8000/api/lists/$LID/cards/$CID" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"due_date\":\"$TODAY\",\"due_date_completed\":false}" >/dev/null
curl -s -X POST "localhost:8000/api/lists/$LID/cards/$CID/members/$USERID" -H "Authorization: Bearer $TOKEN" >/dev/null
docker compose exec -T backend python -c "import asyncio; from app.reminders import run_reminder_cycle; asyncio.run(run_reminder_cycle())"
echo "--- due notifications for this user ---"
curl -s "localhost:8000/api/notifications" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json; ns=json.load(sys.stdin); print([n["message"] for n in ns if n["type"]=="reminder_due"][:3])'
echo "--- reminder_sent rows (expect >=1) ---"
PGPASSWORD=administrador psql -h 62.72.11.28 -p 9874 -U administrador -d taskhs-banco -tAc \
  "SELECT kind FROM reminder_sent WHERE card_id=$CID AND user_id=$USERID;"
echo "--- run cycle again: should NOT add duplicates ---"
docker compose exec -T backend python -c "import asyncio; from app.reminders import run_reminder_cycle; asyncio.run(run_reminder_cycle())"
PGPASSWORD=administrador psql -h 62.72.11.28 -p 9874 -U administrador -d taskhs-banco -tAc \
  "SELECT count(*) FROM reminder_sent WHERE card_id=$CID AND user_id=$USERID;"
echo "--- CLEANUP: revert due date, remove member, drop test rows ---"
curl -s -X PATCH "localhost:8000/api/lists/$LID/cards/$CID" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"due_date":null}' >/dev/null
curl -s -o /dev/null -X DELETE "localhost:8000/api/lists/$LID/cards/$CID/members/$USERID" -H "Authorization: Bearer $TOKEN"
PGPASSWORD=administrador psql -h 62.72.11.28 -p 9874 -U administrador -d taskhs-banco -c \
  "DELETE FROM reminder_sent WHERE card_id=$CID AND user_id=$USERID; DELETE FROM notifications WHERE card_id=$CID AND type IN ('reminder_due','reminder_manual'); DELETE FROM reminders WHERE card_id=$CID;"
```
Expected: the due-notifications list shows a `due_day` message (`"<card>" vence hoje`); `reminder_sent` has a `due_day` row; the count after the second cycle is unchanged (dedup works); cleanup runs without error.

- [ ] **Step 5: Commit**

```bash
git add backend/app/reminders.py backend/app/main.py
git commit -m "feat(reminders): background loop generating manual + due-date notifications"
```

---

### Task 4: Frontend — Reminders section in the card modal

**Files:**
- Modify: `frontend/src/types/index.ts` (add `Reminder`)
- Modify: `frontend/src/pages/BoardPage.tsx` (Reminders section in `CardDetailModal`)

**Interfaces:**
- Consumes: `api.get/post/del`, `card.list_id`, `card.id`.
- Produces: a "Lembretes" UI block; `Reminder` type `{ id, card_id, remind_at, fired, created_at }`.

- [ ] **Step 1: Add the `Reminder` type**

In `frontend/src/types/index.ts`, append:
```ts
export interface Reminder {
  id: number;
  card_id: number;
  remind_at: string;
  fired: boolean;
  created_at: string;
}
```

- [ ] **Step 2: Add reminder state + handlers in `CardDetailModal`**

In `frontend/src/pages/BoardPage.tsx`, add `Reminder` to the `import type { ... } from "../types";` line. Then, after the attachments state declarations inside `CardDetailModal`, add:
```tsx
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [remindAt, setRemindAt] = useState("");
  const [addingReminder, setAddingReminder] = useState(false);

  useEffect(() => {
    api.get<Reminder[]>(`/lists/${card.list_id}/cards/${card.id}/reminders`).then(setReminders).catch(() => {});
  }, [card.id, card.list_id]);

  async function handleAddReminder() {
    if (!remindAt || addingReminder) return;
    setAddingReminder(true);
    try {
      const iso = new Date(remindAt).toISOString();
      const r = await api.post<Reminder>(`/lists/${card.list_id}/cards/${card.id}/reminders`, { remind_at: iso });
      setReminders(prev => [...prev, r].sort((a, b) => a.remind_at.localeCompare(b.remind_at)));
      setRemindAt("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao criar lembrete");
    } finally {
      setAddingReminder(false);
    }
  }

  async function handleDeleteReminder(id: number) {
    try {
      await api.del(`/lists/${card.list_id}/cards/${card.id}/reminders/${id}`);
      setReminders(prev => prev.filter(r => r.id !== id));
    } catch {}
  }
```

- [ ] **Step 3: Render the Lembretes section**

In `CardDetailModal`'s left column JSX, add this block right after the Anexos section block (and before the Archive block):
```tsx
            {/* Lembretes */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-semibold text-slate-300">Meus lembretes {reminders.length > 0 && <span className="font-normal text-slate-500">({reminders.length})</span>}</p>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="datetime-local"
                  value={remindAt}
                  onChange={e => setRemindAt(e.target.value)}
                  className="text-sm rounded-lg border border-border px-3 py-1.5 bg-transparent text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  onClick={handleAddReminder}
                  disabled={!remindAt || addingReminder}
                  className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-600 disabled:opacity-40 transition-all"
                >
                  {addingReminder ? "…" : "Adicionar"}
                </button>
              </div>
              {reminders.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Nenhum lembrete pessoal.</p>
              ) : (
                <div className="space-y-1">
                  {reminders.map(r => (
                    <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg bg-background-elevated border border-border">
                      <span className="text-xs text-slate-200 flex-1">
                        {new Date(r.remind_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        {r.fired && <span className="ml-2 text-[10px] text-slate-500">(enviado)</span>}
                      </span>
                      <button onClick={() => handleDeleteReminder(r.id)} title="Excluir" className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
```

- [ ] **Step 4: Verify (type-check + HMR)**

The Vite dev server is running. Run:
```bash
cd /home/ericks/github/TaskHS/frontend && npx tsc -b 2>&1 | tail -5; echo "exit: ${PIPESTATUS[0]}"
tail -8 /tmp/claude-1000/-home-ericks-github-TaskHS/*/tasks/*.output 2>/dev/null | tail -8
```
Expected: tsc exit `0` (no errors); recent `hmr update` for BoardPage.tsx with no stack trace. (Browser interaction — create/list/delete a reminder in a card — is deferred to the human.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/BoardPage.tsx
git commit -m "feat(reminders): personal reminders section in card modal"
```

---

## Self-Review

**Spec coverage:**
- 2 tables (reminders, reminder_sent + unique key) → Task 1 ✓
- Manual CRUD (personal, owner-only delete, past remind_at accepted) → Task 2 ✓
- Background loop every 60s, own session, manual + auto with dedup, member-only/skip rules, pt-BR messages, reuse Notification → Task 3 ✓
- Frontend Lembretes section (datetime-local create, list, delete, fired marker) + Reminder type → Task 4 ✓
- Auto kinds/conditions & dedup-by-due_date (re-fires on due_date change) → Task 3 (UniqueConstraint + per-due_date key) ✓
- Out of scope (email, recurrence, others' reminders) → not implemented ✓

**Placeholder scan:** none — every code/command step is concrete.

**Type consistency:** `Reminder`/`ReminderSent` columns, `ReminderOut` fields, the TS `Reminder` interface, and the router/loop field names all match (`remind_at`, `fired`, `kind`, `due_date`). Endpoint paths identical across Task 2 and Task 4. `run_reminder_cycle()` name identical in Task 3 module, lifespan, and the verification `docker compose exec` calls.

**Note for the executor:** Backend tasks need `docker compose up -d --build` before their verification. Task 3 Step 4 mutates a real card (due_date + member) and then reverts and deletes the test rows — run the cleanup block even if an earlier assertion fails.
