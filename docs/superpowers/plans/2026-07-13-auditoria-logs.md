# Auditoria / Página de Logs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auditar automaticamente **toda** mudança no TaskHS (quem, o quê, quando, de→para), mais login e tentativas bloqueadas, e expor uma página `/logs` **só para Administrador** com filtros, busca e paginação.

**Architecture:** Captura automática no nível do ORM — listeners `before_flush`/`after_flush` da `Session` do SQLAlchemy gravam uma linha em `audit_log` **na mesma transação** da mudança. O ator vem de um `ContextVar` setado por middleware + dependencies. Eventos que não são escrita no banco (login, 403) são gravados explicitamente. Sem FKs no log (para o histórico sobreviver à exclusão das entidades).

**Tech Stack:** FastAPI async, SQLAlchemy 2.0 (eventos de sessão), asyncpg, Pydantic v2; React 19 + Vite + Tailwind.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-13-auditoria-logs-design.md` — seguir à risca.
- **Sem suíte de testes** (CLAUDE.md). Verificação = curl + inspeção do banco + `npm run build`. NÃO criar pytest/vitest.
- **Backend em Docker.** A **porta 8000 está livre** e o `taskhs-backend-1` está rodando. Rebuild: `docker compose up -d --build`; esperar health: `until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done`.
- **`create_all` cria tabelas que faltam** → a tabela nova `audit_log` nasce sozinha. **Sem migração manual.**
- **Banco remoto de produção** (27 usuários reais). Limpar dados de teste (quadros/cards/usuários criados na verificação). **Nunca apagar linhas de `audit_log`** (é append-only) — as linhas geradas pelos testes podem ficar.
- **SEM foreign keys** nas colunas `actor_user_id`/`entity_id`/`board_id`/`card_id` do log (proposital: o log não pode ser apagado em cascata).
- **Atomicidade:** o log é gravado na mesma transação da mudança (se o log falhar, a mudança falha).
- **Exclusões (ruído):** `Notification`, `ReminderSent` e o próprio `AuditLog` nunca são auditados.
- **Regra do arrasto:** `Card` cuja única mudança é `position` → **não loga**. `list_id` mudou → ação **`mover`**.
- **`password_hash` NUNCA aparece** no `changes` (mascarar como `"***"`).
- **Ponto técnico:** dentro dos handlers de flush a execução está **dentro do greenlet** do SQLAlchemy async → consultas síncronas (`session.get`, `session.execute`) **são permitidas**; usar `with session.no_autoflush:` para evitar flush reentrante.
- **Página `/logs` = Administrador estrito** (`get_admin_user`); Coordenador recebe **403**.
- **Login admin p/ testes:** `healthsafetyti@gmail.com` / `admin123` (token em `access_token`).
- **Changelog (CLAUDE.md):** fecha com **v1.3.0**. Tudo em pt-BR.
- **Commits** terminam com `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Modelo `AuditLog` + schemas + contexto do ator

**Files:**
- Create: `backend/app/models/audit.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/app/schemas/audit.py`
- Create: `backend/app/audit_context.py`
- Modify: `backend/app/main.py` (middleware de contexto)

**Interfaces:**
- Produces: model `AuditLog` (tabela `audit_log`); schemas `AuditLogOut`/`AuditLogPage`; `Actor`, `current_actor`, `get_actor()`, `set_actor_identity(...)`; middleware que preenche `ip`/`path`.

- [ ] **Step 1: Model**

`backend/app/models/audit.py`:
```python
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class AuditLog(Base):
    """Log de auditoria — append-only. SEM foreign keys de propósito: o histórico
    precisa sobreviver à exclusão do usuário/quadro/card (snapshots nos campos *_name/label/summary)."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    actor_type: Mapped[str] = mapped_column(String(20), default="sistema")
    actor_user_id: Mapped[int | None] = mapped_column(Integer, index=True)
    actor_name: Mapped[str] = mapped_column(String(120), default="sistema")
    actor_email: Mapped[str | None] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(20), index=True)
    entity_type: Mapped[str] = mapped_column(String(40), index=True)
    entity_id: Mapped[int | None] = mapped_column(Integer)
    entity_label: Mapped[str | None] = mapped_column(String(255))
    board_id: Mapped[int | None] = mapped_column(Integer, index=True)
    card_id: Mapped[int | None] = mapped_column(Integer, index=True)
    summary: Mapped[str] = mapped_column(Text)
    changes: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(String(45))
    path: Mapped[str | None] = mapped_column(String(255))
```

- [ ] **Step 2: Registrar o model**

Em `backend/app/models/__init__.py`, adicionar o import e o `__all__`:
```python
from app.models.audit import AuditLog
```
e `"AuditLog",` na lista `__all__`.

- [ ] **Step 3: Schemas**

`backend/app/schemas/audit.py`:
```python
from datetime import datetime
from typing import Any
from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: int
    created_at: datetime
    actor_type: str
    actor_user_id: int | None
    actor_name: str
    actor_email: str | None
    action: str
    entity_type: str
    entity_id: int | None
    entity_label: str | None
    board_id: int | None
    card_id: int | None
    summary: str
    changes: dict[str, Any] | None
    ip: str | None
    path: str | None


class AuditLogPage(BaseModel):
    total: int
    items: list[AuditLogOut]
```

- [ ] **Step 4: Contexto do ator**

`backend/app/audit_context.py`:
```python
from contextvars import ContextVar
from dataclasses import dataclass


@dataclass
class Actor:
    actor_type: str = "sistema"
    user_id: int | None = None
    name: str = "sistema"
    email: str | None = None
    ip: str | None = None
    path: str | None = None


current_actor: ContextVar[Actor | None] = ContextVar("current_actor", default=None)


def get_actor() -> Actor:
    """Ator da operação atual. Fora de request (loop de lembretes) → 'sistema'."""
    return current_actor.get() or Actor()


def set_request_actor(ip: str | None, path: str | None) -> Actor:
    """Chamado pelo middleware no começo do request."""
    actor = Actor(ip=ip, path=path)
    current_actor.set(actor)
    return actor


def set_actor_identity(actor_type: str, user_id: int | None, name: str, email: str | None = None) -> None:
    """Enriquece o ator do request (mantém ip/path). Muta o objeto — as referências já
    existentes enxergam a mudança, o que evita depender de propagação de ContextVar."""
    actor = current_actor.get()
    if actor is None:
        actor = Actor()
        current_actor.set(actor)
    actor.actor_type = actor_type
    actor.user_id = user_id
    actor.name = name
    actor.email = email
```

- [ ] **Step 5: Middleware de contexto no `main.py`**

Em `backend/app/main.py`, adicionar o import e o middleware **depois** de `app = FastAPI(...)` e do `add_middleware(CORSMiddleware...)`:
```python
from fastapi import Request
from app.audit_context import set_request_actor
```
```python
@app.middleware("http")
async def audit_context_middleware(request: Request, call_next):
    ip = request.client.host if request.client else None
    set_request_actor(ip, f"{request.method} {request.url.path}")
    return await call_next(request)
```

- [ ] **Step 6: Rebuildar e verificar que a tabela nasceu**

```bash
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
docker compose exec -T backend python -c "
import asyncio
from sqlalchemy import text
from app.database import AsyncSessionLocal
async def main():
    async with AsyncSessionLocal() as db:
        r = await db.execute(text(\"select column_name from information_schema.columns where table_name='audit_log' order by ordinal_position\"))
        print([x[0] for x in r.fetchall()])
asyncio.run(main())
"
```
Expected: imprime as 16 colunas (`id, created_at, actor_type, actor_user_id, actor_name, actor_email, action, entity_type, entity_id, entity_label, board_id, card_id, summary, changes, ip, path`).
Regressão: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/api/health` → `200`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/audit.py backend/app/models/__init__.py backend/app/schemas/audit.py backend/app/audit_context.py backend/app/main.py
git commit -m "feat(auditoria): modelo AuditLog + schemas + contexto do ator

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Motor de captura (listeners de flush + descrição em pt-BR)

**Files:**
- Create: `backend/app/audit.py`
- Modify: `backend/app/main.py` (importar `app.audit` para registrar os listeners)

**Interfaces:**
- Consumes: `AuditLog` (Task 1), `get_actor()` (Task 1).
- Produces: listeners registrados; nada é chamado manualmente.

- [ ] **Step 1: Criar o motor**

`backend/app/audit.py`:
```python
"""Auditoria automática: grava uma linha em audit_log para cada INSERT/UPDATE/DELETE
que passa pela sessão do SQLAlchemy — na MESMA transação da mudança.

Nota técnica: os handlers de flush rodam DENTRO do greenlet do SQLAlchemy async,
então consultas síncronas (session.get / session.execute) são permitidas aqui.
"""
import json
from datetime import datetime, date, timezone
from enum import Enum

from sqlalchemy import event, insert, inspect
from sqlalchemy.orm import Session

from app.audit_context import get_actor
from app.models.audit import AuditLog
from app.models.automation import Automation
from app.models.board import Board, BoardLabel, BoardMember
from app.models.card import (
    Card, CardAttachment, CardComment, CardLabel, CardMember, Checklist, ChecklistItem,
)
from app.models.list import List
from app.models.reminder import Reminder
from app.models.user import User

# Tipos auditados. Notification, ReminderSent e AuditLog ficam de fora (ruído / recursão).
ENTITY_TYPES: dict[type, str] = {
    Board: "quadro",
    List: "lista",
    Card: "card",
    BoardLabel: "etiqueta_quadro",
    CardLabel: "etiqueta_card",
    BoardMember: "membro_quadro",
    CardMember: "membro_card",
    CardComment: "comentario",
    Checklist: "checklist",
    ChecklistItem: "item_checklist",
    CardAttachment: "anexo",
    Reminder: "lembrete",
    Automation: "automacao",
    User: "usuario",
}

SENSITIVE = {"password_hash"}
IGNORED_FIELDS = {"created_at", "updated_at"}
VERB = {"criar": "criou", "editar": "editou", "excluir": "excluiu", "mover": "moveu"}


def _json_safe(v):
    if isinstance(v, Enum):
        return v.value
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    return str(v)


def _diff(obj) -> dict:
    """Campos alterados: {campo: {"de": x, "para": y}}."""
    st = inspect(obj)
    out: dict = {}
    for attr in st.mapper.column_attrs:
        key = attr.key
        if key in IGNORED_FIELDS:
            continue
        hist = st.attrs[key].history
        if not hist.has_changes():
            continue
        before = hist.deleted[0] if hist.deleted else None
        after = hist.added[0] if hist.added else None
        if key in SENSITIVE:
            out[key] = {"de": "***", "para": "***"}
            continue
        out[key] = {"de": _json_safe(before), "para": _json_safe(after)}
    return out


def _snapshot(obj) -> dict:
    """Valores atuais (usado no DELETE, onde não há histórico)."""
    st = inspect(obj)
    out: dict = {}
    for attr in st.mapper.column_attrs:
        key = attr.key
        if key in IGNORED_FIELDS:
            continue
        out[key] = "***" if key in SENSITIVE else _json_safe(getattr(obj, key, None))
    return out


def _card_ctx(session, card_id):
    """(titulo_do_card, board_id) — tolerante a entidade já removida."""
    card = session.get(Card, card_id) if card_id else None
    if card is None:
        return None, None
    lst = session.get(List, card.list_id)
    return card.title, (lst.board_id if lst else None)


def _describe(session, obj, action, changes):
    """→ (entity_type, entity_id, entity_label, board_id, card_id, summary)"""
    t = type(obj)
    etype = ENTITY_TYPES[t]
    eid = getattr(obj, "id", None)
    verb = VERB.get(action, action)
    board_id = card_id = None
    label = None

    if t is Board:
        board_id, label = obj.id, obj.title
        summary = f'{verb} o quadro "{obj.title}"'

    elif t is List:
        board_id, label = obj.board_id, obj.title
        summary = f'{verb} a lista "{obj.title}"'

    elif t is Card:
        card_id, label = obj.id, obj.title
        lst = session.get(List, obj.list_id)
        board_id = lst.board_id if lst else None
        if action == "mover":
            de = (changes.get("list_id") or {}).get("de")
            para = (changes.get("list_id") or {}).get("para")
            l_de = session.get(List, de) if de else None
            l_para = session.get(List, para) if para else None
            n_de = l_de.title if l_de else de
            n_para = l_para.title if l_para else para
            summary = f'moveu o card "{obj.title}" de "{n_de}" para "{n_para}"'
        else:
            summary = f'{verb} o card "{obj.title}"'

    elif t is BoardLabel:
        board_id, label = obj.board_id, obj.name
        summary = f'{verb} a etiqueta "{obj.name}" do quadro'

    elif t is CardLabel:
        card_id = obj.card_id
        titulo, board_id = _card_ctx(session, obj.card_id)
        bl = session.get(BoardLabel, obj.label_id)
        label = bl.name if bl else str(obj.label_id)
        if action == "criar":
            summary = f'adicionou a etiqueta "{label}" ao card "{titulo or obj.card_id}"'
        else:
            summary = f'removeu a etiqueta "{label}" do card "{titulo or obj.card_id}"'

    elif t is BoardMember:
        board_id = obj.board_id
        u = session.get(User, obj.user_id)
        label = u.name if u else str(obj.user_id)
        if action == "criar":
            summary = f'adicionou "{label}" como membro do quadro'
        elif action == "excluir":
            summary = f'removeu "{label}" dos membros do quadro'
        else:
            summary = f'alterou o membro "{label}" do quadro'

    elif t is CardMember:
        card_id = obj.card_id
        titulo, board_id = _card_ctx(session, obj.card_id)
        u = session.get(User, obj.user_id)
        label = u.name if u else str(obj.user_id)
        if action == "criar":
            summary = f'atribuiu "{label}" ao card "{titulo or obj.card_id}"'
        else:
            summary = f'removeu "{label}" do card "{titulo or obj.card_id}"'

    elif t is CardComment:
        card_id = obj.card_id
        titulo, board_id = _card_ctx(session, obj.card_id)
        label = (obj.body or "")[:80]
        if action == "criar":
            summary = f'comentou no card "{titulo or obj.card_id}"'
        else:
            summary = f'{verb} um comentário do card "{titulo or obj.card_id}"'

    elif t is Checklist:
        card_id = obj.card_id
        titulo, board_id = _card_ctx(session, obj.card_id)
        label = obj.title
        summary = f'{verb} o checklist "{obj.title}" no card "{titulo or obj.card_id}"'

    elif t is ChecklistItem:
        cl = session.get(Checklist, obj.checklist_id)
        card_id = cl.card_id if cl else None
        titulo, board_id = _card_ctx(session, card_id)
        label = obj.text
        if action == "editar" and "checked" in changes:
            marcou = changes["checked"].get("para")
            acao = "marcou" if marcou else "desmarcou"
            summary = f'{acao} o item "{obj.text}" no card "{titulo or card_id}"'
        elif action == "criar":
            summary = f'adicionou o item "{obj.text}" ao checklist do card "{titulo or card_id}"'
        else:
            summary = f'{verb} o item "{obj.text}" do card "{titulo or card_id}"'

    elif t is CardAttachment:
        card_id = obj.card_id
        titulo, board_id = _card_ctx(session, obj.card_id)
        label = obj.filename
        if action == "criar":
            summary = f'anexou "{obj.filename}" ao card "{titulo or obj.card_id}"'
        else:
            summary = f'{verb} o anexo "{obj.filename}" do card "{titulo or obj.card_id}"'

    elif t is Reminder:
        card_id = obj.card_id
        titulo, board_id = _card_ctx(session, obj.card_id)
        label = titulo
        summary = f'{verb} um lembrete no card "{titulo or obj.card_id}"'

    elif t is Automation:
        board_id = obj.board_id
        label = obj.action_type
        summary = f"{verb} uma automação no quadro"

    elif t is User:
        eid, label = obj.id, obj.name
        if action == "editar" and "role" in changes:
            de = changes["role"].get("de")
            para = changes["role"].get("para")
            summary = f'alterou o perfil de "{obj.name}" de {de} para {para}'
        else:
            summary = f'{verb} o usuário "{obj.name}"'

    else:  # pragma: no cover — ENTITY_TYPES cobre todos os tipos acima
        summary = f"{verb} {etype}"

    return etype, eid, label, board_id, card_id, summary


@event.listens_for(Session, "before_flush")
def _audit_before_flush(session, flush_context, instances):
    if session.info.get("audit_silent"):
        return
    pending = session.info.setdefault("_audit_pending", [])

    for obj in session.new:
        if type(obj) not in ENTITY_TYPES:
            continue
        pending.append((obj, "criar", _diff(obj)))

    for obj in session.dirty:
        if type(obj) not in ENTITY_TYPES:
            continue
        if not session.is_modified(obj, include_collections=False):
            continue
        changes = _diff(obj)
        if not changes:
            continue
        if type(obj) is Card:
            if set(changes) <= {"position"}:
                continue  # só reordenou dentro da lista → não audita
            action = "mover" if "list_id" in changes else "editar"
        else:
            action = "editar"
        pending.append((obj, action, changes))

    for obj in session.deleted:
        if type(obj) not in ENTITY_TYPES:
            continue
        pending.append((obj, "excluir", _snapshot(obj)))


@event.listens_for(Session, "after_flush")
def _audit_after_flush(session, flush_context):
    pending = session.info.pop("_audit_pending", None)
    if not pending:
        return
    actor = get_actor()
    rows = []
    with session.no_autoflush:
        for obj, action, changes in pending:
            etype, eid, label, board_id, card_id, summary = _describe(session, obj, action, changes)
            rows.append({
                "created_at": datetime.now(timezone.utc),
                "actor_type": actor.actor_type,
                "actor_user_id": actor.user_id,
                "actor_name": actor.name,
                "actor_email": actor.email,
                "action": action,
                "entity_type": etype,
                "entity_id": eid,
                "entity_label": (str(label)[:255] if label is not None else None),
                "board_id": board_id,
                "card_id": card_id,
                "summary": summary,
                "changes": json.dumps(changes, ensure_ascii=False) if changes else None,
                "ip": actor.ip,
                "path": actor.path,
            })
        if rows:
            session.execute(insert(AuditLog), rows)
```

- [ ] **Step 2: Registrar os listeners no `main.py`**

Em `backend/app/main.py`, junto do `import app.models`, adicionar (o import é o que registra os listeners):
```python
import app.audit  # noqa: F401 — registra os listeners de auditoria
```

- [ ] **Step 3: Rebuildar e verificar a captura básica**

```bash
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
# cria um quadro descartável -> deve gerar 1 log "criou o quadro"
curl -s -X POST http://localhost:8000/api/boards -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"ZZ Auditoria Teste"}' | python3 -c 'import sys,json;print("board id",json.load(sys.stdin)["id"])'
docker compose exec -T backend python -c "
import asyncio
from sqlalchemy import text
from app.database import AsyncSessionLocal
async def main():
    async with AsyncSessionLocal() as db:
        r = await db.execute(text('select actor_name, action, entity_type, summary from audit_log order by id desc limit 3'))
        for row in r.fetchall(): print(row)
asyncio.run(main())
"
```
Expected: a última linha mostra algo como `('Erick H.', 'criar', 'quadro', 'criou o quadro \"ZZ Auditoria Teste\"')`.
(Deixe o quadro por enquanto — a Task 6 faz a bateria completa e a limpeza.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/audit.py backend/app/main.py
git commit -m "feat(auditoria): motor de captura automatica (listeners de flush)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Atores + eventos não-ORM (login, 403, integração, import)

**Files:**
- Modify: `backend/app/dependencies.py` (ator do usuário; ator da integração)
- Modify: `backend/app/routers/integration.py` (nome do ator = `source`)
- Modify: `backend/app/routers/auth.py` (login/login_falhou; delete de usuário via ORM)
- Modify: `backend/app/main.py` (exception handler global de 403)
- Modify: `backend/app/routers/boards.py` (import em modo silencioso + 1 evento-resumo)

**Interfaces:**
- Consumes: `set_actor_identity`, `get_actor` (Task 1); `AuditLog` (Task 1); listeners (Task 2).

- [ ] **Step 1: Ator do usuário e da integração**

Em `backend/app/dependencies.py`, adicionar o import:
```python
from app.audit_context import set_actor_identity
```
No fim de `get_current_user`, **antes do `return user`**:
```python
    set_actor_identity("usuario", user.id, user.name, user.email)
    return user
```
E no fim de `require_integration_key` (que hoje só valida e retorna `None`), antes do fim da função:
```python
    set_actor_identity("integracao", None, "integração", None)
```

- [ ] **Step 2: Nome do ator da integração = `source`**

Em `backend/app/routers/integration.py`, adicionar o import:
```python
from app.audit_context import set_actor_identity
```
E como **primeira linha** do corpo de `upsert_card` e de `delete_external_card`:
```python
    set_actor_identity("integracao", None, body.source, None)
```

- [ ] **Step 3: Eventos de login**

Em `backend/app/routers/auth.py`, adicionar os imports:
```python
from app.models.audit import AuditLog
from app.audit_context import get_actor
```
Substituir o corpo de `login` por:
```python
@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    actor = get_actor()
    if not user or not verify_password(body.password, user.password_hash):
        db.add(AuditLog(
            actor_type="usuario", actor_user_id=(user.id if user else None),
            actor_name=(user.name if user else body.email), actor_email=body.email,
            action="login_falhou", entity_type="sessao", entity_id=(user.id if user else None),
            entity_label=body.email, summary=f"tentativa de login falhou ({body.email})",
            ip=actor.ip, path=actor.path,
        ))
        await db.commit()
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    db.add(AuditLog(
        actor_type="usuario", actor_user_id=user.id, actor_name=user.name, actor_email=user.email,
        action="login", entity_type="sessao", entity_id=user.id, entity_label=user.email,
        summary=f'"{user.name}" entrou no sistema', ip=actor.ip, path=actor.path,
    ))
    await db.commit()
    token = create_access_token(user.email)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))
```

- [ ] **Step 4: Delete de usuário via ORM (para ser auditado)**

Em `backend/app/routers/auth.py`, em `admin_delete_user`, trocar a linha do delete em massa:
```python
    await db.execute(sql_delete(User).where(User.id == user_id))
```
por:
```python
    await db.delete(user)
```
(Se o `delete as sql_delete` do import ficar sem uso, removê-lo do `from sqlalchemy import ...`.)

- [ ] **Step 5: Exception handler global de 403**

Em `backend/app/main.py`, adicionar os imports:
```python
from fastapi import HTTPException
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.database import AsyncSessionLocal
from app.models.audit import AuditLog
from app.audit_context import get_actor
```
E o handler (depois dos middlewares):
```python
@app.exception_handler(StarletteHTTPException)
async def audit_http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 403:
        actor = get_actor()
        try:
            async with AsyncSessionLocal() as db:
                db.add(AuditLog(
                    actor_type=actor.actor_type, actor_user_id=actor.user_id,
                    actor_name=actor.name, actor_email=actor.email,
                    action="acesso_negado", entity_type="sessao",
                    summary=f"tentativa bloqueada: {exc.detail}",
                    ip=actor.ip, path=actor.path,
                ))
                await db.commit()
        except Exception:
            pass
    return await http_exception_handler(request, exc)
```

- [ ] **Step 6: Import de Trello — modo silencioso + evento-resumo**

Em `backend/app/routers/boards.py`, no import SSE (`POST /import`), na função que abre a própria sessão com `AsyncSessionLocal()`, marcar a sessão como silenciosa **logo após abri-la**:
```python
        db.sync_session.info["audit_silent"] = True
```
E, ao final do import (depois do último commit, quando `board`, e as contagens de listas/cards já existem), gravar **um** evento-resumo. Adicionar o import no topo do arquivo:
```python
from app.models.audit import AuditLog
from app.audit_context import get_actor
```
e, antes de encerrar o stream:
```python
            actor = get_actor()
            db.sync_session.info["audit_silent"] = False
            db.add(AuditLog(
                actor_type=actor.actor_type, actor_user_id=actor.user_id,
                actor_name=actor.name, actor_email=actor.email,
                action="criar", entity_type="quadro", entity_id=board.id,
                entity_label=board.title, board_id=board.id,
                summary=f'importou o quadro "{board.title}" do Trello ({total_listas} listas, {total_cards} cards)',
                ip=actor.ip, path=actor.path,
            ))
            await db.commit()
```
Usar os contadores de listas/cards que o import já mantém para o SSE (se os nomes das variáveis forem outros, usar os existentes; **não** criar contadores novos se já houver).

- [ ] **Step 7: Rebuildar e verificar login + 403 + integração**

```bash
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
# login OK
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
# login falho
curl -s -o /dev/null -w 'login errado: %{http_code}\n' -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"healthsafetyti@gmail.com","password":"errada"}'
docker compose exec -T backend python -c "
import asyncio
from sqlalchemy import text
from app.database import AsyncSessionLocal
async def main():
    async with AsyncSessionLocal() as db:
        r = await db.execute(text(\"select action, actor_name, summary from audit_log where action in ('login','login_falhou') order by id desc limit 2\"))
        for row in r.fetchall(): print(row)
asyncio.run(main())
"
```
Expected: `login errado: 401`; e o banco mostra uma linha `login_falhou` e uma `login`.

- [ ] **Step 8: Commit**

```bash
git add backend/app/dependencies.py backend/app/routers/integration.py backend/app/routers/auth.py backend/app/main.py backend/app/routers/boards.py
git commit -m "feat(auditoria): atores + login, 403, integracao e import silencioso

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: API `GET /api/logs` (filtros, busca, paginação)

**Files:**
- Create: `backend/app/routers/logs.py`
- Modify: `backend/app/main.py` (import + include_router)

**Interfaces:**
- Consumes: `AuditLog` (Task 1), `AuditLogOut`/`AuditLogPage` (Task 1), `get_admin_user` (já existe em `app/routers/auth.py`).
- Produces: `GET /api/logs`.

- [ ] **Step 1: Router**

`backend/app/routers/logs.py`:
```python
import json
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.audit import AuditLog
from app.models.user import User
from app.routers.auth import get_admin_user
from app.schemas.audit import AuditLogOut, AuditLogPage

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get("", response_model=AuditLogPage)
async def list_logs(
    actor_user_id: int | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    board_id: int | None = None,
    card_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),   # administrador estrito
):
    conds = []
    if actor_user_id is not None:
        conds.append(AuditLog.actor_user_id == actor_user_id)
    if action:
        conds.append(AuditLog.action == action)
    if entity_type:
        conds.append(AuditLog.entity_type == entity_type)
    if board_id is not None:
        conds.append(AuditLog.board_id == board_id)
    if card_id is not None:
        conds.append(AuditLog.card_id == card_id)
    if date_from:
        conds.append(AuditLog.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        conds.append(AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=timezone.utc))
    if q:
        conds.append(AuditLog.summary.ilike(f"%{q}%"))

    total = (await db.execute(select(func.count()).select_from(AuditLog).where(*conds))).scalar() or 0
    rows = (await db.execute(
        select(AuditLog).where(*conds).order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit).offset(offset)
    )).scalars().all()

    items = [
        AuditLogOut(
            id=r.id, created_at=r.created_at, actor_type=r.actor_type, actor_user_id=r.actor_user_id,
            actor_name=r.actor_name, actor_email=r.actor_email, action=r.action,
            entity_type=r.entity_type, entity_id=r.entity_id, entity_label=r.entity_label,
            board_id=r.board_id, card_id=r.card_id, summary=r.summary,
            changes=(json.loads(r.changes) if r.changes else None),
            ip=r.ip, path=r.path,
        )
        for r in rows
    ]
    return AuditLogPage(total=total, items=items)
```

- [ ] **Step 2: Registrar no `main.py`**

Em `backend/app/main.py`, adicionar `logs` ao import dos routers e o include:
```python
from app.routers import auth, boards, lists, cards, labels, notifications, attachments, reminders, automations, integration, logs
```
```python
app.include_router(logs.router, prefix="/api")
```

- [ ] **Step 3: Rebuildar e verificar (inclui o 403 do coordenador)**

```bash
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
ADM=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
# admin lista
curl -s "http://localhost:8000/api/logs?limit=3" -H "Authorization: Bearer $ADM" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("total",d["total"]);[print(" -",i["action"],i["entity_type"],"|",i["summary"]) for i in d["items"]]'
# filtro por acao + busca
curl -s "http://localhost:8000/api/logs?action=login&limit=2" -H "Authorization: Bearer $ADM" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("logins:",d["total"])'
curl -s "http://localhost:8000/api/logs?q=quadro&limit=2" -H "Authorization: Bearer $ADM" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("busca quadro:",d["total"])'
# coordenador -> 403 (cria um coord de teste)
curl -s -X POST http://localhost:8000/api/auth/users -H "Authorization: Bearer $ADM" -H 'Content-Type: application/json' -d '{"name":"Coord Log","email":"coordlog@example.com","password":"teste123","initials":"CL","role":"coordenador"}' >/dev/null
COORD=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"coordlog@example.com","password":"teste123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -s -o /dev/null -w 'coordenador em /logs: %{http_code}\n' http://localhost:8000/api/logs -H "Authorization: Bearer $COORD"
```
Expected: admin recebe `total` > 0 e as linhas; filtro por `action=login` e busca `q=quadro` retornam contagens; **coordenador em /logs: 403**.
(O usuário `coordlog@example.com` é limpo na Task 6.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/logs.py backend/app/main.py
git commit -m "feat(auditoria): endpoint GET /api/logs com filtros, busca e paginacao

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — página `/logs` (só Administrador) + changelog

**Files:**
- Modify: `frontend/src/types/index.ts` (tipo `AuditLog`)
- Create: `frontend/src/pages/LogsPage.tsx`
- Modify: `frontend/src/App.tsx` (rota `/logs`)
- Modify: `frontend/src/layouts/MainLayout.tsx` (item de menu `adminStrict`)
- Modify: `frontend/src/data/changelog.ts` (v1.3.0)

**Interfaces:**
- Consumes: `GET /api/logs` (Task 4); `api.get` de `lib/api.ts`; `useAuth()`.

- [ ] **Step 1: Tipo `AuditLog`**

Em `frontend/src/types/index.ts`, adicionar:
```ts
export interface AuditLog {
  id: number;
  created_at: string;
  actor_type: string;
  actor_user_id: number | null;
  actor_name: string;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  entity_label: string | null;
  board_id: number | null;
  card_id: number | null;
  summary: string;
  changes: Record<string, { de: unknown; para: unknown }> | null;
  ip: string | null;
  path: string | null;
}
```

- [ ] **Step 2: Página de logs**

`frontend/src/pages/LogsPage.tsx`:
```tsx
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import type { AuditLog, User } from "../types";

const ACTIONS = ["criar", "editar", "mover", "excluir", "login", "login_falhou", "acesso_negado"];
const ENTITIES = [
  "quadro", "lista", "card", "etiqueta_quadro", "etiqueta_card", "membro_quadro", "membro_card",
  "comentario", "checklist", "item_checklist", "anexo", "lembrete", "automacao", "usuario", "sessao",
];

const ACTION_CLASS: Record<string, string> = {
  criar: "bg-emerald-500/15 text-emerald-400",
  editar: "bg-sky-500/15 text-sky-400",
  mover: "bg-violet-500/15 text-violet-400",
  excluir: "bg-red-500/15 text-red-400",
  login: "bg-slate-500/15 text-slate-400",
  login_falhou: "bg-amber-500/15 text-amber-400",
  acesso_negado: "bg-red-500/15 text-red-400",
};

const PAGE = 50;

export function LogsPage() {
  const { user: me } = useAuth();
  const navigate = useNavigate();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  const [fActor, setFActor] = useState("");
  const [fAction, setFAction] = useState("");
  const [fEntity, setFEntity] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fQ, setFQ] = useState("");

  const isAdmin = me?.role === "administrador";

  const buildQuery = useCallback((off: number) => {
    const p = new URLSearchParams();
    p.set("limit", String(PAGE));
    p.set("offset", String(off));
    if (fActor) p.set("actor_user_id", fActor);
    if (fAction) p.set("action", fAction);
    if (fEntity) p.set("entity_type", fEntity);
    if (fFrom) p.set("date_from", fFrom);
    if (fTo) p.set("date_to", fTo);
    if (fQ.trim()) p.set("q", fQ.trim());
    return p.toString();
  }, [fActor, fAction, fEntity, fFrom, fTo, fQ]);

  const load = useCallback(async (off: number, append: boolean, query?: string) => {
    setLoading(true);
    try {
      const qs = query ?? buildQuery(off);
      const data = await api.get<{ total: number; items: AuditLog[] }>(`/logs?${qs}`);
      setTotal(data.total);
      setOffset(off);
      setLogs(prev => (append ? [...prev, ...data.items] : data.items));
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    if (!isAdmin) { navigate("/boards", { replace: true }); return; }
    api.get<User[]>("/auth/users").then(setUsers).catch(() => {});
    load(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  function aplicar() {
    setExpanded(null);
    load(0, false);
  }

  function limpar() {
    setFActor(""); setFAction(""); setFEntity(""); setFFrom(""); setFTo(""); setFQ("");
    setExpanded(null);
    const p = new URLSearchParams();
    p.set("limit", String(PAGE));
    p.set("offset", "0");
    load(0, false, p.toString());
  }

  const inputCls = "text-sm rounded-lg border border-slate-200 dark:border-border bg-transparent px-2.5 py-1.5 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/40";

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-5xl w-full mx-auto px-4 md:px-6 py-6 space-y-5">

        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">Logs</h1>
          <p className="text-sm text-slate-500 mt-0.5">Auditoria de tudo que acontece no sistema — {total} registro{total !== 1 ? "s" : ""}</p>
        </div>

        {/* Filtros */}
        <div className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-background-surface p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <select value={fActor} onChange={e => setFActor(e.target.value)} className={inputCls}>
              <option value="">Todas as pessoas</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select value={fAction} onChange={e => setFAction(e.target.value)} className={inputCls}>
              <option value="">Todas as ações</option>
              {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={fEntity} onChange={e => setFEntity(e.target.value)} className={inputCls}>
              <option value="">Todos os tipos</option>
              {ENTITIES.map(e2 => <option key={e2} value={e2}>{e2}</option>)}
            </select>
            <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} className={inputCls} />
            <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} className={inputCls} />
            <input
              value={fQ}
              onChange={e => setFQ(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") aplicar(); }}
              placeholder="Buscar no texto…"
              className={inputCls}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={aplicar} className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 transition-colors">Aplicar</button>
            <button onClick={limpar} className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-border text-slate-500 hover:bg-slate-50 dark:hover:bg-background-elevated transition-colors">Limpar</button>
          </div>
        </div>

        {/* Lista */}
        <div className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-background-surface divide-y divide-slate-100 dark:divide-border overflow-hidden">
          {logs.length === 0 && !loading && (
            <p className="text-sm text-slate-500 italic text-center py-10">Nenhum registro encontrado.</p>
          )}
          {logs.map(l => (
            <div key={l.id}>
              <button
                onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-background-elevated transition-colors flex items-start gap-3"
              >
                <span className="text-xs text-slate-400 shrink-0 w-32 pt-0.5">
                  {new Date(l.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className={cn("shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full h-fit", ACTION_CLASS[l.action] ?? "bg-slate-500/15 text-slate-400")}>
                  {l.action}
                </span>
                <span className="flex-1 min-w-0 text-sm text-slate-700 dark:text-slate-200">
                  <strong className="font-semibold text-slate-900 dark:text-white">{l.actor_name}</strong>{" "}
                  {l.summary}
                </span>
                <span className="shrink-0 text-[10px] text-slate-400 pt-1">{l.entity_type}</span>
              </button>
              {expanded === l.id && (
                <div className="px-4 pb-4 pt-1 bg-slate-50 dark:bg-background-elevated text-xs space-y-2">
                  <p className="text-slate-500">
                    {l.actor_type} · {l.actor_email ?? "—"} · {l.ip ?? "—"} · {l.path ?? "—"}
                  </p>
                  {l.changes ? (
                    <table className="w-full">
                      <thead>
                        <tr className="text-slate-400">
                          <th className="text-left font-semibold py-1">Campo</th>
                          <th className="text-left font-semibold py-1">De</th>
                          <th className="text-left font-semibold py-1">Para</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-600 dark:text-slate-300">
                        {Object.entries(l.changes).map(([campo, v]) => (
                          <tr key={campo} className="border-t border-slate-200 dark:border-border">
                            <td className="py-1 pr-3 font-medium">{campo}</td>
                            <td className="py-1 pr-3 text-slate-400">{String(v?.de ?? "—")}</td>
                            <td className="py-1">{String(v?.para ?? "—")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-slate-400 italic">Sem detalhes de alteração.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {logs.length < total && (
          <div className="flex justify-center">
            <button
              onClick={() => load(offset + PAGE, true)}
              disabled={loading}
              className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 dark:border-border text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-background-elevated disabled:opacity-50 transition-colors"
            >
              {loading ? "Carregando…" : `Carregar mais (${logs.length}/${total})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rota `/logs`**

Em `frontend/src/App.tsx`, adicionar o import e a rota junto das outras (dentro do `MainLayout`, ao lado de `usuarios`):
```tsx
import { LogsPage } from "./pages/LogsPage";
```
```tsx
                    <Route path="logs" element={<LogsPage />} />
```

- [ ] **Step 4: Item de menu (Administrador estrito)**

Em `frontend/src/layouts/MainLayout.tsx`:
- Adicionar um ícone simples antes de `NAV_ITEMS`:
```tsx
function IconLogs() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}
```
- Substituir o `NAV_ITEMS` inteiro. **Atenção:** todos os itens precisam da chave `adminStrict` — se só o item "Logs" a tiver, o TypeScript infere um union e `item.adminStrict` **não compila**.
```tsx
const NAV_ITEMS = [
  { label: "Dashboard", icon: <IconDashboard />, to: "/",         adminOnly: false, adminStrict: false },
  { label: "Boards",    icon: <IconBoards />,    to: "/boards",   adminOnly: false, adminStrict: false },
  { label: "Usuários",  icon: <IconUsers />,     to: "/usuarios",  adminOnly: true,  adminStrict: false },
  { label: "Logs",      icon: <IconLogs />,      to: "/logs",      adminOnly: true,  adminStrict: true },
];
```
- Ajustar o predicado do filtro do nav para tratar os dois casos (hoje ele é `!item.adminOnly || user?.role === "administrador" || user?.role === "coordenador"`):
```tsx
          {NAV_ITEMS.filter(item =>
            item.adminStrict
              ? user?.role === "administrador"
              : !item.adminOnly || user?.role === "administrador" || user?.role === "coordenador"
          ).map(({ label, icon, to }) => {
```

- [ ] **Step 5: Changelog v1.3.0**

Em `frontend/src/data/changelog.ts`, adicionar como **primeiro** item do array `CHANGELOG`:
```ts
  {
    version: "1.3.0",
    date: "2026-07-13",
    changes: [
      { kind: "novidade", text: "Auditoria completa: o sistema registra quem fez cada alteração (até adicionar ou remover uma etiqueta), além de logins e tentativas bloqueadas." },
      { kind: "novidade", text: "Nova página Logs (exclusiva do Administrador) com filtros por pessoa, ação, tipo, período, busca e paginação." },
    ],
  },
```

- [ ] **Step 6: Build**

Run (de `frontend/`): `npm run build`
Expected: PASSA (tsc + vite, sem erros). A versão exibida vira `1.3.0`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/LogsPage.tsx frontend/src/App.tsx frontend/src/layouts/MainLayout.tsx frontend/src/data/changelog.ts
git commit -m "feat(auditoria): pagina de Logs (admin estrito) com filtros, busca e paginacao + changelog v1.3.0

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Bateria de verificação end-to-end (os 10 critérios de aceite)

**Files:**
- Nenhum arquivo de produção esperado (apenas correções se algo falhar).
- Create (temporário, **não commitar**): `/tmp/claude-1000/audit-e2e.sh` (script de verificação).

**Interfaces:**
- Consumes: tudo das Tasks 1–5.

> **Objetivo:** provar, com evidência, que a auditoria cobre **todas** as ações — e que o que **não** deve logar, não loga. Se algum critério falhar, **corrigir o código** (e commitar a correção) e rodar de novo.

- [ ] **Step 1: Garantir o ambiente**

```bash
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
ADM=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
# marca o ponto de corte: só olhamos logs criados a partir daqui
MARK=$(docker compose exec -T backend python -c "
import asyncio
from sqlalchemy import text
from app.database import AsyncSessionLocal
async def main():
    async with AsyncSessionLocal() as db:
        r = await db.execute(text('select coalesce(max(id),0) from audit_log'))
        print(r.scalar())
asyncio.run(main())
" | tr -d '\r')
echo "MARK=$MARK"
```

- [ ] **Step 2: Exercitar TODAS as ações (script)**

Escrever e rodar `/tmp/claude-1000/audit-e2e.sh` (temporário, **não commitar**):
```bash
#!/usr/bin/env bash
set -euo pipefail
B=http://localhost:8000/api
J='Content-Type: application/json'
ADM=$(curl -s -X POST $B/auth/login -H "$J" -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
A="Authorization: Bearer $ADM"
id() { python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])'; }

# 1. quadro
BID=$(curl -s -X POST $B/boards -H "$A" -H "$J" -d '{"title":"ZZ Auditoria E2E"}' | id)
# 2. listas
L1=$(curl -s -X POST $B/boards/$BID/lists -H "$A" -H "$J" -d '{"title":"Origem"}' | id)
L2=$(curl -s -X POST $B/boards/$BID/lists -H "$A" -H "$J" -d '{"title":"Destino"}' | id)
# 3. etiqueta do quadro
LB=$(curl -s -X POST $B/boards/$BID/labels -H "$A" -H "$J" -d '{"name":"Urgente","color":"#ef4444"}' | id)
# 4. card
CID=$(curl -s -X POST $B/lists/$L1/cards -H "$A" -H "$J" -d '{"title":"Card E2E"}' | id)
# 5. editar (title)
curl -s -o /dev/null -X PATCH $B/lists/$L1/cards/$CID -H "$A" -H "$J" -d '{"title":"Card E2E renomeado"}'
# 6. REORDENAR (so position) -> NAO deve logar
curl -s -o /dev/null -X PATCH $B/lists/$L1/cards/$CID -H "$A" -H "$J" -d '{"position":123456.0}'
# 7. MOVER (list_id) -> acao "mover"
curl -s -o /dev/null -X PATCH $B/lists/$L1/cards/$CID -H "$A" -H "$J" -d "{\"list_id\":$L2}"
# 8/9. etiqueta no card: adicionar e remover
curl -s -o /dev/null -X POST $B/lists/$L2/cards/$CID/labels -H "$A" -H "$J" -d "{\"label_id\":$LB}"
curl -s -o /dev/null -X DELETE $B/lists/$L2/cards/$CID/labels/$LB -H "$A"
# 10. membro no card: adicionar e remover (user 1 = admin)
curl -s -o /dev/null -X POST $B/lists/$L2/cards/$CID/members/1 -H "$A"
curl -s -o /dev/null -X DELETE $B/lists/$L2/cards/$CID/members/1 -H "$A"
# 11. comentario
curl -s -o /dev/null -X POST $B/lists/$L2/cards/$CID/comments -H "$A" -H "$J" -d '{"body":"comentario de auditoria"}'
# 12. checklist + item + marcar + excluir
CL=$(curl -s -X POST $B/lists/$L2/cards/$CID/checklists -H "$A" -H "$J" -d '{"title":"Checklist E2E"}' | id)
IT=$(curl -s -X POST $B/lists/$L2/cards/$CID/checklists/$CL/items -H "$A" -H "$J" -d '{"text":"item 1"}' | id)
curl -s -o /dev/null -X PATCH $B/lists/$L2/cards/$CID/checklists/$CL/items/$IT -H "$A" -H "$J" -d '{"checked":true}'
curl -s -o /dev/null -X DELETE $B/lists/$L2/cards/$CID/checklists/$CL/items/$IT -H "$A"
curl -s -o /dev/null -X DELETE $B/lists/$L2/cards/$CID/checklists/$CL -H "$A"
# 13. lembrete criar + excluir
RM=$(curl -s -X POST $B/lists/$L2/cards/$CID/reminders -H "$A" -H "$J" -d '{"remind_at":"2030-01-01T10:00:00Z"}' | id)
curl -s -o /dev/null -X DELETE $B/lists/$L2/cards/$CID/reminders/$RM -H "$A"
# 14. automacao criar + excluir
AU=$(curl -s -X POST $B/boards/$BID/automations -H "$A" -H "$J" -d "{\"trigger_list_id\":$L2}" | id)
curl -s -o /dev/null -X DELETE $B/boards/$BID/automations/$AU -H "$A"
# 15. integracao (ator = source)
KEY=$(grep '^INTEGRATION_API_KEY=' backend/.env | cut -d= -f2-)
curl -s -o /dev/null -X POST $B/integration/cards -H "$J" -H "X-API-Key: $KEY" \
  -d '{"source":"gestorhs","external_id":"e2e-1","board":"ZZ Auditoria E2E Integracao","list":"Recebido","title":"OS e2e"}'
# 16. login falho + login OK
curl -s -o /dev/null -X POST $B/auth/login -H "$J" -d '{"email":"healthsafetyti@gmail.com","password":"errada"}' || true
curl -s -o /dev/null -X POST $B/auth/login -H "$J" -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}'
# 17. tentativa bloqueada (coordenador em /logs -> 403)
COORD=$(curl -s -X POST $B/auth/login -H "$J" -d '{"email":"coordlog@example.com","password":"teste123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -s -o /dev/null -w 'coord /logs: %{http_code}\n' $B/logs -H "Authorization: Bearer $COORD"
# 18. excluir card e quadro (o log deles PRECISA sobreviver)
curl -s -o /dev/null -X DELETE $B/lists/$L2/cards/$CID -H "$A"
curl -s -o /dev/null -X DELETE $B/boards/$BID -H "$A"
echo "E2E OK — BID=$BID CID=$CID"
```
Rodar: `bash /tmp/claude-1000/audit-e2e.sh` (a partir da raiz do repo, para o `grep` do `backend/.env` funcionar).
Expected: imprime `coord /logs: 403` e `E2E OK — …` sem erro.

- [ ] **Step 3: Conferir o log (evidência)**

```bash
docker compose exec -T backend python -c "
import asyncio, os
from sqlalchemy import text
from app.database import AsyncSessionLocal
MARK = int(os.environ.get('MARK','0'))
async def main():
    async with AsyncSessionLocal() as db:
        r = await db.execute(text('select action, entity_type, actor_name, summary from audit_log where id > :m order by id'), {'m': MARK})
        rows = r.fetchall()
        print('total de linhas novas:', len(rows))
        for x in rows: print(' ', x[0], '|', x[1], '|', x[2], '|', x[3])
        c = await db.execute(text(\"select count(*) from audit_log where id > :m and entity_type='card' and action='editar' and changes like '%position%' and changes not like '%list_id%' and changes not like '%title%'\"), {'m': MARK})
        print('linhas de reordenacao (esperado 0):', c.scalar())
asyncio.run(main())
" 
```
Expected (conferir um a um contra os critérios do spec):
- Existe **1 linha por ação** dos passos 1–5, 7–18, com `actor_name` correto e `summary` legível.
- A etiqueta gera `adicionou a etiqueta "Urgente" ao card ...` e `removeu a etiqueta "Urgente" do card ...`.
- O passo 7 gera `mover` com `de "Origem" para "Destino"`.
- O passo 6 (**reordenar**) **não** gera linha → `linhas de reordenacao (esperado 0): 0`.
- Integração: linhas com `actor_name` = o `source` enviado.
- `login`, `login_falhou` e `acesso_negado` presentes.
- **Excluir o card não apagou** as linhas anteriores dele (elas continuam no resultado).

- [ ] **Step 4: Conferir a segurança do endpoint e o mascaramento**

```bash
# coordenador -> 403 ; membro -> 403 ; admin -> 200
curl -s -o /dev/null -w 'coord /logs: %{http_code}\n' http://localhost:8000/api/logs -H "Authorization: Bearer $COORD"
curl -s -o /dev/null -w 'admin /logs: %{http_code}\n' http://localhost:8000/api/logs -H "Authorization: Bearer $ADM"
# password_hash nunca no log
docker compose exec -T backend python -c "
import asyncio
from sqlalchemy import text
from app.database import AsyncSessionLocal
async def main():
    async with AsyncSessionLocal() as db:
        r = await db.execute(text(\"select count(*) from audit_log where changes like '%\\\$2b\\\$%' or changes like '%password_hash\\\": {\\\"de\\\": \\\"\\\$%'\"))
        print('hashes vazados (esperado 0):', r.scalar())
asyncio.run(main())
"
```
Expected: `coord /logs: 403`, `admin /logs: 200`, `hashes vazados (esperado 0): 0`.

- [ ] **Step 5: Limpeza dos dados de teste**

Excluir (como admin) o quadro `ZZ Auditoria E2E`, o quadro da integração e o quadro `ZZ Auditoria Teste` (criado na Task 2), e o usuário `coordlog@example.com`. **Não apagar linhas de `audit_log`** (é append-only — as linhas de teste permanecem, o que é esperado).
Confirmar que não sobraram quadros com prefixo `ZZ ` nem o usuário de teste.

- [ ] **Step 6: Se algo falhou — corrigir e repetir**

Se qualquer critério não bateu, corrigir o código (o motor em `backend/app/audit.py` é o lugar mais provável), rebuildar, rodar a bateria de novo e commitar a correção:
```bash
git add -A backend/
git commit -m "fix(auditoria): <o que foi corrigido>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Se tudo passou de primeira, **não há commit nesta task** — o entregável é a evidência no relatório.

---

## Notas finais

- Após as 6 tasks: revisão final de branch → **finishing-a-development-branch** (merge na `main` + push).
- **Deploy:** nada de env nova; a tabela `audit_log` nasce sozinha pelo `create_all` no primeiro start em produção.
- A página `/logs` é a razão de o **Administrador estrito** (`get_admin_user`) existir — ele já estava reservado desde o perfil Coordenador.
