# Sincronização do quadro em tempo real (SSE) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O quadro reflete em tempo real (SSE) mudanças de qualquer pessoa ou da integração — mover/criar/excluir/arquivar card, listas, etiquetas, config do board e o conteúdo do card aberto — sem F5.

**Architecture:** Um hub de pub/sub **em memória** (1 worker) recebe "avisos de mudança" pendurados nos **hooks de sessão do `audit.py`** (`after_commit`), serializa a entidade numa task de fundo e faz fan-out para os assinantes SSE daquele board. O front abre um `EventSource` autenticado por **ticket efêmero** e reconcilia no estado normalizado; ao (re)conectar, refaz o baseline via um endpoint agregado `/snapshot`.

**Tech Stack:** FastAPI async + SQLAlchemy 2.0 (event hooks) + StreamingResponse SSE; React 19 + EventSource. Sem Alembic, sem suíte de testes.

## Global Constraints

- **Repo PÚBLICO**: nenhum segredo em arquivo versionado. SQL só via `./scripts/psql-dev.sh`. Nunca imprimir valor de segredo (`grep -c`). Segredos de login em `$TASKHS_*` (`backend/.env.dev-users`).
- **Banco de dev = PRODUÇÃO, no ar.** Verificação que MUTA dado (criar/mover card, PATCH board) é do **controlador**, com prefixo zzz + limpeza. NUNCA afetar os 3 cards `external_source='gestorhs'` (ids 255/256/257) nem apagar `audit_log`. Implementers fazem só boot/build e leitura.
- **1 worker de uvicorn** ([Dockerfile:22](../../../backend/Dockerfile#L22), sem `--workers`). O hub em memória depende disso — **não** introduzir multi-worker. Documentar a restrição (como os lembretes).
- **SSE**: response com `media_type="text/event-stream"` + headers `Cache-Control: no-cache` e `X-Accel-Buffering: no`; terminador de evento `\n\n`; keepalive `: ping\n\n`.
- **Sem suíte de testes** — verificação manual (curl/psql/2 navegadores/`npm run build`). Não inventar comando de teste.
- Cada mudança fecha com entrada no changelog. Versão alvo **1.8.0**. Branch: `feat/realtime-sse`.
- Autorização: a tranca de membresia do board (elevado ou membro) vale nas rotas novas; reusar os helpers de [dependencies.py](../../../backend/app/dependencies.py). Não inventar regra nova.

---

### Task 1: Hub de realtime + consumer + serialização + lifespan

**Files:**
- Create: `backend/app/realtime.py`
- Modify: `backend/app/main.py` (subir a `consumer()` no lifespan)

**Interfaces:**
- Produces: `realtime.subscribe(board_id) -> asyncio.Queue`, `realtime.unsubscribe(board_id, q)`, `realtime.enqueue_change(board_id, kind, entity_id, action)`, `realtime.publish_reload(board_id)`, `realtime.consumer()` (coroutine). `kind ∈ {"card","list","board","board_labels"}`; `action ∈ {"upsert","delete"}`. Eventos entregues às filas já são **dicts JSON-safe**.

- [ ] **Step 1: Escrever `backend/app/realtime.py`**

```python
import asyncio
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.card import Card
from app.models.list import List
from app.models.board import Board, BoardLabel

# Assinantes por board_id. Preenchido pelo endpoint /stream (Task 3).
_subscribers: dict[int, set[asyncio.Queue]] = {}
# Ponte sync->async: o hook after_commit (sync, no greenlet) enfileira aqui;
# a consumer() (async) drena, serializa e faz fan-out. Fila ilimitada.
_changes: "asyncio.Queue[tuple[int, str, int, str]]" = asyncio.Queue()


def subscribe(board_id: int) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _subscribers.setdefault(board_id, set()).add(q)
    return q


def unsubscribe(board_id: int, q: asyncio.Queue) -> None:
    subs = _subscribers.get(board_id)
    if subs:
        subs.discard(q)
        if not subs:
            _subscribers.pop(board_id, None)


def enqueue_change(board_id: int, kind: str, entity_id: int, action: str) -> None:
    """Chamado do hook SYNC after_commit (mesmo event loop). Nao bloqueia."""
    _changes.put_nowait((board_id, kind, entity_id, action))


def publish_reload(board_id: int) -> None:
    """Evento estrutural: 'recarregue o quadro'. Para bulk delete (excluir
    lista/quadro) e fim de import, que nao passam pelos hooks por card."""
    _changes.put_nowait((board_id, "reload", 0, "reload"))


def _fanout(board_id: int, event: dict) -> None:
    for q in list(_subscribers.get(board_id, ())):
        q.put_nowait(event)


async def _serialize(board_id: int, kind: str, entity_id: int, action: str) -> dict | None:
    if kind == "reload":
        return {"type": "board", "action": "reload", "board_id": board_id}
    if action == "delete":
        return {"type": kind, "action": "delete", "id": entity_id, "board_id": board_id}
    async with AsyncSessionLocal() as db:
        if kind == "card":
            # import tardio: evita ciclo (routers.cards importa muita coisa)
            from app.routers.cards import _card_options, _card_to_dict
            from app.schemas.card import CardOut
            res = await db.execute(select(Card).where(Card.id == entity_id).options(*_card_options()))
            card = res.scalar_one_or_none()
            if card is None:
                return None
            # CardOut.model_validate NO DICT achatado (nao no card cru): _card_to_dict
            # achata members->User; CardOut(members: list[UserOut]) descarta o
            # password_hash. Passar _card_to_dict direto no jsonable_encoder VAZARIA o
            # hash dos membros pra todos os assinantes do stream.
            return {"type": "card", "action": "upsert", "board_id": board_id,
                    "card": jsonable_encoder(CardOut.model_validate(_card_to_dict(card)).model_dump())}
        if kind == "list":
            from app.schemas.list import ListOut
            lst = await db.get(List, entity_id)
            if lst is None:
                return None
            return {"type": "list", "action": "upsert", "board_id": board_id,
                    "list": jsonable_encoder(ListOut.model_validate(lst).model_dump())}
        if kind == "board":
            from app.schemas.board import BoardOut
            board = await db.get(Board, entity_id)
            if board is None:
                return None
            return {"type": "board", "action": "upsert", "board_id": board_id,
                    "board": jsonable_encoder(BoardOut.model_validate(board).model_dump())}
        if kind == "board_labels":
            res = await db.execute(select(BoardLabel).where(BoardLabel.board_id == board_id).order_by(BoardLabel.id))
            labels = [{"id": l.id, "board_id": l.board_id, "name": l.name, "color": l.color}
                      for l in res.scalars().all()]
            return {"type": "board_labels", "action": "upsert", "board_id": board_id, "labels": labels}
    return None


import logging
_log = logging.getLogger(__name__)


async def consumer() -> None:
    """Task de fundo (sobe no lifespan). Serializa fora do caminho da request."""
    while True:
        board_id, kind, entity_id, action = await _changes.get()
        try:
            event = await _serialize(board_id, kind, entity_id, action)
            if event is not None:
                _fanout(board_id, event)
        except Exception:
            # Nunca derrubar o consumer por um evento ruim — mas registrar, senao
            # uma falha de serializacao some sem deixar rastro.
            _log.exception("falha ao serializar/entregar evento SSE (%s/%s/%s)", board_id, kind, entity_id)
```
(O `import logging` pode ir no topo do módulo junto dos demais imports.)

- [ ] **Step 2: Subir a `consumer()` no lifespan** — `backend/app/main.py`

No `lifespan` ([main.py:22-31](../../../backend/app/main.py#L22-L31)), ao lado do `reminder_loop`:
```python
    from app import realtime
    task = asyncio.create_task(reminder_loop())
    rt_task = asyncio.create_task(realtime.consumer())
    try:
        yield
    finally:
        task.cancel()
        rt_task.cancel()
```
(manter o `os.makedirs`/`create_all` que já existem antes.)

- [ ] **Step 3: Verificar boot**

Run: `docker compose up -d --build backend && sleep 4 && curl -s http://localhost:8000/api/health`
Expected: `{"status":"ok"}`. `docker compose logs --tail=30 backend` sem traceback (import de `realtime` e criação da `asyncio.Queue()` no import do módulo funcionam).

- [ ] **Step 4: Smoke test do hub (não muta banco)**

Run:
```bash
docker compose exec -T backend python -c "
import asyncio
from app import realtime
async def main():
    t = asyncio.create_task(realtime.consumer())
    q = realtime.subscribe(999999)
    realtime.publish_reload(999999)
    ev = await asyncio.wait_for(q.get(), timeout=3)
    print('EVENTO:', ev)
    realtime.unsubscribe(999999, q); t.cancel()
asyncio.run(main())
"
```
Expected: `EVENTO: {'type': 'board', 'action': 'reload', 'board_id': 999999}`. (Só exercita fila/fan-out; não toca em dados.)

- [ ] **Step 5: Commit**
```bash
git add backend/app/realtime.py backend/app/main.py
git commit -m "feat(rt): hub SSE em memoria + consumer no lifespan"
```

---

### Task 2: Emissão de eventos nos hooks do `audit.py`

**Files:**
- Modify: `backend/app/audit.py` (coletar SSE no `before_flush`/`after_flush`; publicar no novo `after_commit`; limpar no rollback)
- Modify: `backend/app/routers/lists.py` (`delete_list` → `publish_reload`)
- Modify: `backend/app/routers/boards.py` (`delete_board` e fim do `import` → `publish_reload`)

**Interfaces:**
- Consumes: `realtime.enqueue_change`, `realtime.publish_reload` (Task 1).
- Produces: toda mutação ORM de Card/List/Board/BoardLabel e filhos de card gera `enqueue_change`; bulk-deletes geram `publish_reload`.

- [ ] **Step 1: Helper de alvo SSE + coleta — topo de `audit.py`**

Depois dos imports/`ENTITY_TYPES` em [audit.py](../../../backend/app/audit.py), adicionar. **Já estão importados no módulo** ([audit.py:17-21](../../../backend/app/audit.py#L17-L21)): `Card, CardAttachment, CardComment, CardLabel, CardMember, Checklist, ChecklistItem, Board, BoardLabel, List` e a função `_card_ctx` — **não** reimportar. O único import novo é o do `realtime`:
```python
from app import realtime

# Entidades cuja mudanca reflete na tela do quadro (face + card aberto).
# Exclui Reminder (pessoal), BoardMember/Automation/User (fora do escopo v1).
_SSE_CARD_CHILD = {CardLabel, CardMember, CardComment, Checklist, ChecklistItem, CardAttachment}


def _sse_target(session, obj, raw_action):
    """(board_id, kind, serialize_id, action) para o SSE, ou None (nao emite)."""
    t = type(obj)
    if t is Card:
        lst = session.get(List, obj.list_id)
        if lst is None:
            return None
        return (lst.board_id, "card", obj.id, "delete" if raw_action == "delete" else "upsert")
    if t is List:
        return (obj.board_id, "list", obj.id, "delete" if raw_action == "delete" else "upsert")
    if t is Board:
        return (obj.id, "board", obj.id, "upsert")  # delete de board = reload estrutural
    if t is BoardLabel:
        return (obj.board_id, "board_labels", obj.board_id, "upsert")
    if t in _SSE_CARD_CHILD:
        if t is ChecklistItem:
            cl = session.get(Checklist, obj.checklist_id)
            card_id = cl.card_id if cl else None
        else:
            card_id = obj.card_id
        if card_id is None:
            return None
        _, board_id = _card_ctx(session, card_id)
        if board_id is None:
            return None
        return (board_id, "card", card_id, "upsert")  # filho mudou -> re-serializa o card
    return None
```

- [ ] **Step 2: Coletar `_sse_raw` no `before_flush`**

No fim de `_audit_before_flush` ([audit.py:253-283](../../../backend/app/audit.py#L253-L283)), depois do laço de `session.deleted`, adicionar (fica sob o mesmo early-return de `audit_silent`, então o import não spamma):
```python
    sse_raw = session.info.setdefault("_sse_raw", [])
    for obj in session.new:
        sse_raw.append((obj, "upsert"))
    for obj in session.dirty:
        if session.is_modified(obj, include_collections=False):
            sse_raw.append((obj, "upsert"))
    for obj in session.deleted:
        sse_raw.append((obj, "delete"))
```
(Diferente do audit, o SSE **não** ignora mudança só de `position` — reordenar dentro da lista é um move visível que precisa sincronizar.)

- [ ] **Step 3: Resolver alvos no `after_flush` (inclusive no ramo `audit_silent`)**

Em `_audit_after_flush` ([audit.py:286-317](../../../backend/app/audit.py#L286-L317)): no early-return de `audit_silent` (linhas 288-290), também descartar o `_sse_raw`:
```python
    if session.info.get("audit_silent"):
        session.info.pop("_audit_pending", None)
        session.info.pop("_sse_raw", None)
        return
```
E, no fim da função (depois do bloco que insere `AuditLog`), resolver os alvos e acumular em `_sse_pending`:
```python
    sse_raw = session.info.pop("_sse_raw", None)
    if sse_raw:
        pend = session.info.setdefault("_sse_pending", [])
        with session.no_autoflush:
            for obj, raw_action in sse_raw:
                tgt = _sse_target(session, obj, raw_action)
                if tgt is not None:
                    pend.append(tgt)
```

- [ ] **Step 4: Publicar no novo `after_commit`; limpar no rollback**

Adicionar o listener (depois do `_audit_after_flush`):
```python
@event.listens_for(Session, "after_commit")
def _sse_after_commit(session):
    pend = session.info.pop("_sse_pending", None)
    if not pend:
        return
    # Dedup por (board_id, kind, id): varios filhos do mesmo card viram 1 upsert;
    # delete vence upsert (card apagado + filhos em cascata no mesmo commit).
    best: dict[tuple, str] = {}
    for board_id, kind, eid, action in pend:
        key = (board_id, kind, eid)
        if best.get(key) == "delete":
            continue
        best[key] = action
    for (board_id, kind, eid), action in best.items():
        realtime.enqueue_change(board_id, kind, eid, action)
```
E nos dois rollbacks já existentes ([audit.py:320-327](../../../backend/app/audit.py#L320-L327)), descartar também os pendentes de SSE:
```python
@event.listens_for(Session, "after_rollback")
def _audit_after_rollback(session):
    session.info.pop("_audit_pending", None)
    session.info.pop("_sse_raw", None)
    session.info.pop("_sse_pending", None)

@event.listens_for(Session, "after_soft_rollback")
def _audit_after_soft_rollback(session, previous_transaction):
    session.info.pop("_audit_pending", None)
    session.info.pop("_sse_raw", None)
    session.info.pop("_sse_pending", None)
```

- [ ] **Step 5: `publish_reload` nos bulk-deletes e no import**

- `backend/app/routers/lists.py`, em `delete_list` ([lists.py:51](../../../backend/app/routers/lists.py#L51)), **após** o `await db.commit()`: `realtime.publish_reload(board_id)` (o `board_id` está no path). Import no topo: `from app import realtime`.
- `backend/app/routers/boards.py`, em `delete_board` ([boards.py:291](../../../backend/app/routers/boards.py#L291)), após o commit: `realtime.publish_reload(board_id)`.
- `backend/app/routers/boards.py`, no import (`generate()`), logo antes do `_sse("done", ...)` final ([boards.py:245-260](../../../backend/app/routers/boards.py#L245-L260) região), após o commit final: `realtime.publish_reload(board_id_do_quadro_importado)`. Import no topo do arquivo: `from app import realtime`.

- [ ] **Step 6: Verificar boot + emissão real (controlador faz o teste que muta dado)**

Run (implementer): `docker compose up -d --build backend && sleep 4 && curl -s http://localhost:8000/api/health` → `ok`; logs sem traceback. **Não** rodar mutação em dado real — deixar a bateria de mover card p/ o controlador (que usa board/card zzz e observa o `/stream` da Task 3). Reportar como DONE_WITH_CONCERNS anotando que a prova end-to-end depende da Task 3.

- [ ] **Step 7: Commit**
```bash
git add backend/app/audit.py backend/app/routers/lists.py backend/app/routers/boards.py
git commit -m "feat(rt): emitir eventos SSE pelos hooks de sessao (after_commit)"
```

---

### Task 3: Ticket efêmero + endpoints `/stream-ticket` e `/stream`

**Files:**
- Modify: `backend/app/core/security.py` (criar/decodificar ticket)
- Modify: `backend/app/dependencies.py` (`user_can_access_board`)
- Modify: `backend/app/routers/boards.py` (`POST /{board_id}/stream-ticket`, `GET /{board_id}/stream`)

**Interfaces:**
- Consumes: `realtime.subscribe/unsubscribe` (Task 1).
- Produces: `create_stream_ticket(email, board_id) -> str`, `decode_stream_ticket(token) -> dict | None`, `user_can_access_board(board_id, user, db) -> bool`; rotas `POST /api/boards/{id}/stream-ticket` (Bearer) e `GET /api/boards/{id}/stream?ticket=` (SSE).

- [ ] **Step 1: Ticket em `core/security.py`**

Adicionar (reusa `settings`, `jwt`, `timedelta`, `timezone`, `datetime` já importados em [security.py:1](../../../backend/app/core/security.py#L1)):
```python
def create_stream_ticket(subject: str, board_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(seconds=60)
    return jwt.encode(
        {"sub": subject, "board_id": board_id, "scope": "stream", "exp": expire},
        settings.SECRET_KEY, algorithm=settings.ALGORITHM,
    )


def decode_stream_ticket(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except Exception:
        return None
    if payload.get("scope") != "stream":
        return None
    return payload
```

- [ ] **Step 2: `user_can_access_board` em `dependencies.py`**

Adicionar (espelha `user_can_access_list`, [dependencies.py:64-79](../../../backend/app/dependencies.py#L64-L79)):
```python
async def user_can_access_board(board_id: int, user: User, db: AsyncSession) -> bool:
    if user.is_elevated:
        return True
    q = await db.execute(
        select(BoardMember.id).where(
            BoardMember.board_id == board_id,
            BoardMember.user_id == user.id,
        ).limit(1)
    )
    return q.scalars().first() is not None
```

- [ ] **Step 3: Endpoints em `boards.py`**

Imports no topo de [boards.py](../../../backend/app/routers/boards.py): `import asyncio`, `from app.core.security import create_stream_ticket, decode_stream_ticket`, `from app.dependencies import user_can_access_board`, `from app import realtime` (require_board_access_by_board_id e get_db já são importados). Adicionar as rotas:
```python
@router.post("/{board_id}/stream-ticket")
async def stream_ticket(board_id: int, current_user: User = Depends(require_board_access_by_board_id)):
    return {"ticket": create_stream_ticket(current_user.email, board_id)}


@router.get("/{board_id}/stream")
async def board_stream(board_id: int, ticket: str, db: AsyncSession = Depends(get_db)):
    payload = decode_stream_ticket(ticket)
    if not payload or payload.get("board_id") != board_id:
        raise HTTPException(status_code=401, detail="Ticket inválido")
    user = (await db.execute(
        select(User).where(User.email == payload["sub"], User.is_active == True)
    )).scalar_one_or_none()
    if user is None or not await user_can_access_board(board_id, user, db):
        raise HTTPException(status_code=403, detail="Sem acesso ao quadro")

    async def gen():
        q = realtime.subscribe(board_id)
        try:
            yield ": connected\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=20)
                    yield f"data: {_json.dumps(event, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            realtime.unsubscribe(board_id, q)

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```
(`_json` já é importado em boards.py: `import json as _json`. `StreamingResponse`, `HTTPException`, `select`, `User`, `AsyncSession`, `get_db`, `require_board_access_by_board_id` já estão no arquivo.)

- [ ] **Step 4: Boot + verificação de acesso (não-mutante)**

Run: `docker compose up -d --build backend && sleep 4`. Implementer (read-only, opcional): logar como admin (env `$TASKHS_*`, sem imprimir), `POST /api/boards/<id>/stream-ticket` → recebe `{"ticket": "..."}`; `curl -N "http://localhost:8000/api/boards/<id>/stream?ticket=<t>"` abre o stream (recebe `: connected` e depois `: ping` a cada ~20s). Ticket errado → 401. **Não** mutar dado — a prova de que o move aparece no stream é do controlador.

- [ ] **Step 5: Commit**
```bash
git add backend/app/core/security.py backend/app/dependencies.py backend/app/routers/boards.py
git commit -m "feat(rt): ticket efemero + endpoints /stream-ticket e /stream (SSE)"
```

---

### Task 4: Endpoint agregado `/snapshot`

**Files:**
- Modify: `backend/app/routers/boards.py` (`GET /{board_id}/snapshot`)

**Interfaces:**
- Produces: `GET /api/boards/{id}/snapshot` → `{board, lists, labels, cards_by_list}` (baseline atômico p/ (re)conectar e p/ o load inicial).

- [ ] **Step 1: Endpoint**

Em [boards.py](../../../backend/app/routers/boards.py), reusando `_card_options`/`_card_to_dict`, `BoardOut`, `ListOut`, `_get_board_or_404`, `require_board_access_by_board_id`. Imports no topo: `from app.routers.cards import _card_options, _card_to_dict`, `from app.schemas.list import ListOut` (BoardOut já importado; Card/List/BoardLabel já importados). Adicionar:
```python
@router.get("/{board_id}/snapshot")
async def board_snapshot(board_id: int,
                         current_user: User = Depends(require_board_access_by_board_id),
                         db: AsyncSession = Depends(get_db)):
    board = await _get_board_or_404(board_id, db)
    lists = (await db.execute(
        select(List).where(List.board_id == board_id, List.archived == False).order_by(List.position)
    )).scalars().all()
    labels = (await db.execute(
        select(BoardLabel).where(BoardLabel.board_id == board_id).order_by(BoardLabel.id)
    )).scalars().all()
    cards_by_list: dict[int, list] = {}
    for l in lists:
        res = await db.execute(
            select(Card).where(Card.list_id == l.id, Card.archived == False)
            .order_by(Card.position).options(*_card_options())
        )
            # CardOut.model_validate NO DICT achatado do _card_to_dict — NÃO no card cru:
        # _card_to_dict achata members->User; CardOut(members: list[UserOut]) descarta
        # password_hash. Passar _card_to_dict direto (sem CardOut) VAZARIA o hash, porque
        # este endpoint não tem response_model=CardOut pra filtrar. (Mesma armadilha da
        # serialização de card no realtime.py.)
        cards_by_list[l.id] = [CardOut.model_validate(_card_to_dict(c)).model_dump() for c in res.scalars().all()]
    return {
        "board": BoardOut.model_validate(board).model_dump(),
        "lists": [ListOut.model_validate(l).model_dump() for l in lists],
        "labels": [{"id": x.id, "board_id": x.board_id, "name": x.name, "color": x.color} for x in labels],
        "cards_by_list": cards_by_list,
    }
```
(Sem `response_model` na assinatura: o FastAPI aplica `jsonable_encoder` no dict retornado, então datetimes/enums viram JSON. Import: `from app.schemas.card import CardOut` no topo. Confirmar que o filtro de arquivados bate com o `GET /lists/{id}/cards` atual — ver [cards.py](../../../backend/app/routers/cards.py) `get_cards`.)

- [ ] **Step 2: Verificar (read-only, seguro)**

Run: rebuild; logar (admin, env sem imprimir); `GET /api/boards/<id>/snapshot` → JSON com `board`, `lists`, `labels` e `cards_by_list` (chaves = ids de lista, valores = arrays de card com `obs1..obs6` e demais campos). Comparar contagem de cards com o que a tela mostra.

- [ ] **Step 3: Commit**
```bash
git add backend/app/routers/boards.py
git commit -m "feat(rt): endpoint agregado /snapshot para baseline do quadro"
```

---

### Task 5: Frontend — hook `useBoardStream` + reconciliação + baseline via snapshot

**Files:**
- Create: `frontend/src/hooks/useBoardStream.ts`
- Modify: `frontend/src/pages/BoardPage.tsx` (load via `/snapshot`; dispatcher de eventos; ligar o hook)

**Interfaces:**
- Consumes: `GET /snapshot`, `POST /stream-ticket`, `GET /stream` (Tasks 3-4).
- Produces: a tela do quadro aplica eventos remotos no estado normalizado (`cardsByList`/`lists`/`boardLabels`/`board`).

- [ ] **Step 1: Hook `useBoardStream.ts`**

```ts
import { useEffect, useRef } from "react";
import { api, API_BASE } from "../lib/api";

/** Abre um EventSource por quadro, autenticado por ticket efemero, com
 *  reconexao MANUAL (pega ticket novo a cada tentativa — o auto-reconnect
 *  nativo reabriria a mesma URL com ticket vencido). */
export function useBoardStream(
  boardId: number,
  onEvent: (evt: any) => void,
  onOpen: () => void,
) {
  const onEventRef = useRef(onEvent);
  const onOpenRef = useRef(onOpen);
  onEventRef.current = onEvent;
  onOpenRef.current = onOpen;

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let backoff = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      if (stopped) return;
      try {
        const { ticket } = await api.post<{ ticket: string }>(`/boards/${boardId}/stream-ticket`, {});
        if (stopped) return;
        es = new EventSource(`${API_BASE}/boards/${boardId}/stream?ticket=${encodeURIComponent(ticket)}`);
        es.onopen = () => { backoff = 1000; onOpenRef.current(); };
        es.onmessage = (m) => { try { onEventRef.current(JSON.parse(m.data)); } catch { /* ignora */ } };
        es.onerror = () => {
          es?.close(); es = null;
          if (stopped) return;
          timer = setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 10000);
        };
      } catch {
        if (stopped) return;
        timer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 10000);
      }
    }
    connect();
    return () => { stopped = true; es?.close(); if (timer) clearTimeout(timer); };
  }, [boardId]);
}
```

- [ ] **Step 2: `resync()` via `/snapshot` no BoardPage**

Substituir o load inicial ([BoardPage.tsx:1822-1843](../../../frontend/src/pages/BoardPage.tsx#L1822-L1843)) por uma função reutilizável (usada no mount e no (re)connect/reload):
```tsx
  const resync = useCallback(async () => {
    const snap = await api.get<{
      board: Board; lists: BoardList[]; labels: BoardLabel[];
      cards_by_list: Record<number, Card[]>;
    }>(`/boards/${boardId}/snapshot`);
    setBoard(snap.board);
    setLists(snap.lists);
    setBoardLabels(snap.labels);
    setCardsByList(snap.cards_by_list);
  }, [boardId]);

  useEffect(() => { resync().catch(() => {}); }, [resync]);
```
(Importar `useCallback`. Remover o `Promise.all` + N+1 antigos. Conferir que nenhum outro trecho dependia dos setStates intermediários daquele bloco.)

- [ ] **Step 3: Dispatcher de eventos**

Adicionar no BoardPage (usa updates funcionais — não fecha sobre o estado atual):
```tsx
  const applyStreamEvent = useCallback((evt: any) => {
    if (evt.type === "card" && evt.action === "upsert") {
      const card: Card = evt.card;
      setCardsByList(prev => {
        const next: Record<number, Card[]> = {};
        for (const [lid, cards] of Object.entries(prev)) {
          next[Number(lid)] = cards.filter(c => c.id !== card.id);
        }
        const bucket = next[card.list_id] ?? [];
        next[card.list_id] = [...bucket, card].sort((a, b) => a.position - b.position);
        return next;
      });
      setSelectedCard(sc => (sc && sc.id === card.id ? card : sc));
    } else if (evt.type === "card" && evt.action === "delete") {
      setCardsByList(prev => {
        const next: Record<number, Card[]> = {};
        for (const [lid, cards] of Object.entries(prev)) next[Number(lid)] = cards.filter(c => c.id !== evt.id);
        return next;
      });
      setSelectedCard(sc => (sc && sc.id === evt.id ? null : sc));
    } else if (evt.type === "list" && evt.action === "upsert") {
      const lst: BoardList = evt.list;
      setLists(prev => {
        const rest = prev.filter(l => l.id !== lst.id);
        return [...rest, lst].sort((a, b) => a.position - b.position);
      });
      setCardsByList(prev => (prev[lst.id] ? prev : { ...prev, [lst.id]: [] }));
    } else if (evt.type === "list" && evt.action === "delete") {
      setLists(prev => prev.filter(l => l.id !== evt.id));
      setCardsByList(prev => { const { [evt.id]: _drop, ...rest } = prev; return rest; });
    } else if (evt.type === "board_labels") {
      setBoardLabels(evt.labels);
    } else if (evt.type === "board" && evt.action === "upsert") {
      setBoard(evt.board);
    } else if (evt.type === "board" && evt.action === "reload") {
      resync().catch(() => {});
    }
  }, [resync]);
```

- [ ] **Step 4: Ligar o hook**

No corpo do BoardPage: `useBoardStream(boardId, applyStreamEvent, () => { resync().catch(() => {}); });`
(O `onOpen` refaz o baseline a cada (re)conexão — cobre eventos perdidos enquanto desconectado.)

- [ ] **Step 5: Build**

Run: `cd frontend && npm run build` → PASSA (tsc + vite).

- [ ] **Step 6: Commit**
```bash
git add frontend/src/hooks/useBoardStream.ts frontend/src/pages/BoardPage.tsx
git commit -m "feat(rt): stream do quadro no front (hook + reconciliacao + snapshot)"
```

---

### Task 6: Frontend — proteção do campo focado no card aberto

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx` (CardDetailModal)

**Interfaces:**
- Consumes: `selectedCard` atualizado por eventos remotos (Task 5).
- Produces: o card aberto reflete mudanças remotas **sem** apagar o campo que a pessoa está editando.

Contexto: hoje o modal só ressincroniza os campos locais quando `card.id` muda ([BoardPage.tsx:234-241](../../../frontend/src/pages/BoardPage.tsx#L234-L241)); com o stream, `selectedCard` passa a mudar de conteúdo com o **mesmo** id. Precisamos aplicar as mudanças remotas nos campos, exceto no que está focado.

- [ ] **Step 1: Rastrear o campo em edição**

No `CardDetailModal`, adicionar um ref e ligar `onFocus`/`onBlur` nos inputs de título e descrição:
```tsx
  const editingFieldRef = useRef<null | "title" | "description">(null);
```
No `<input>` do título: `onFocus={() => (editingFieldRef.current = "title")}` e `onBlur={(e) => { editingFieldRef.current = null; handleTitleBlur?.(e); }}` (preservar o handler de blur existente do título, se houver).
No `<textarea>` da descrição ([BoardPage.tsx:646-653](../../../frontend/src/pages/BoardPage.tsx#L646-L653)): `onFocus={() => (editingFieldRef.current = "description")}` e no `onBlur` existente (`handleDescriptionBlur`) adicionar `editingFieldRef.current = null;` no começo.

- [ ] **Step 2: Merge remoto respeitando o campo focado**

Adicionar um effect que roda quando o objeto `card` (prop) muda **mantendo o mesmo id** — aplica os campos que vêm do servidor, menos o focado:
```tsx
  useEffect(() => {
    // Campos de conteudo do card aberto atualizados ao vivo. O campo que a
    // pessoa esta editando naquele instante fica intocado ate ela sair (blur).
    if (editingFieldRef.current !== "title") setTitle(card.title);
    if (editingFieldRef.current !== "description") setDescription(card.description ?? "");
    setLabels(card.labels);
    setMembers(card.members);
    setComments(card.comments);
    setChecklists(card.checklists ?? []);
    setAttachments(card.attachments ?? []);
  }, [card]);
```
(O effect existente com dep `[card.id]` continua resetando tudo ao ABRIR/trocar de card — inclusive `editingFieldRef.current = null`. Adicionar essa limpeza no effect `[card.id]` para não herdar foco de um card anterior.)

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build` → PASSA.

- [ ] **Step 4: Commit**
```bash
git add frontend/src/pages/BoardPage.tsx
git commit -m "feat(rt): card aberto sincroniza ao vivo sem atropelar o campo em edicao"
```

---

### Task 7: Docs + changelog + CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (arquitetura: hub SSE, restrição de 1 worker)
- Modify: `frontend/src/data/changelog.ts` (v1.8.0 no topo)

**Interfaces:** nenhuma (docs).

- [ ] **Step 1: CLAUDE.md — nota de arquitetura**

Na seção de arquitetura do backend, adicionar um parágrafo:
```markdown
**Tempo real (SSE):** mudanças no quadro são empurradas via SSE. Um hub em memória ([app/realtime.py](backend/app/realtime.py)) recebe avisos pendurados nos hooks de sessão do audit ([audit.py](backend/app/audit.py), `after_commit`), serializa a entidade numa task de fundo (subida no `lifespan`) e faz fan-out para os assinantes do quadro. O front abre `EventSource` em `GET /api/boards/{id}/stream?ticket=` (ticket efêmero de ~60s tirado em `POST /api/boards/{id}/stream-ticket`); ao (re)conectar refaz o baseline por `GET /api/boards/{id}/snapshot`. **Assume 1 worker** (hub em memória) — igual aos lembretes; múltiplos workers exigiriam Redis pub/sub. Bulk delete (excluir lista/quadro) não passa pelos hooks por-card → emite `publish_reload` explícito.
```

- [ ] **Step 2: changelog — v1.8.0 no topo**

Primeiro item do array `CHANGELOG` ([changelog.ts:15-16](../../../frontend/src/data/changelog.ts#L15-L16)):
```ts
  {
    version: "1.8.0",
    date: "2026-07-17",
    changes: [
      { kind: "novidade", text: "O quadro agora atualiza em tempo real: quando alguém (ou a integração) move, cria, arquiva ou edita um cartão, listas ou etiquetas, todo mundo que está com o quadro aberto vê na hora, sem precisar atualizar a página. O cartão aberto também sincroniza ao vivo, sem apagar o que você está digitando." },
    ],
  },
```

- [ ] **Step 3: Build + versão**

Run: `cd frontend && npm run build` → PASSA. Rodapé passa a mostrar `v1.8.0` (deriva de `CHANGELOG[0]`).

- [ ] **Step 4: Commit**
```bash
git add CLAUDE.md frontend/src/data/changelog.ts
git commit -m "docs(rt): CLAUDE.md + changelog v1.8.0 (tempo real)"
```

---

## Verificação end-to-end (controlador, DB vivo — depois das tasks)

Com board/card **zzz** descartáveis + limpeza, e sem tocar nos 3 cards `gestorhs`:
1. Duas sessões (2 navegadores/abas, usuários diferentes) no mesmo quadro: mover card na A aparece na B em < ~1s. Criar/excluir/arquivar card e lista idem. Editar etiqueta do quadro idem.
2. `POST /api/integration/cards` (X-API-Key) movendo um card zzz → reflete ao vivo.
3. Card aberto nas duas abas: editar título na A aparece na B; enquanto a B digita a descrição, um update remoto **não** apaga o texto da B.
4. Excluir lista com cards (bulk) → a outra aba recebe `reload` e refaz o baseline; sem card fantasma.
5. Reiniciar o backend → EventSource reconecta (ticket novo) e refaz o baseline.
6. Não-membro: `POST /stream-ticket` → 403; `GET /stream` com ticket adulterado → 401.
7. `npm run build` e boot limpos.

## Self-review (na escrita do plano)

- **Cobertura da spec:** hub+consumer+lifespan (T1); emissão via hooks + bulk-delete reload + reorder-inclui-position (T2); ticket+stream (T3); snapshot (T4); hook+reconciliação+baseline (T5); campo focado (T6); docs+changelog (T7). Restrição 1-worker e X-Accel-Buffering nas constraints. ✓
- **Consistência de tipos:** `kind`/`action` iguais entre `realtime`, `_sse_target` e o dispatcher do front; evento de card carrega `card`, list carrega `list`, board carrega `board`, labels carrega `labels`; delete carrega `id`. ✓
- **Echo/idempotência:** aplicar o próprio evento é idempotente (mesma position/list); YAGNI de client-id mantido. ✓
- **Sem placeholder:** cada step tem código/comando real.
