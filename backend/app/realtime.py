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
            res = await db.execute(select(Card).where(Card.id == entity_id).options(*_card_options()))
            card = res.scalar_one_or_none()
            if card is None:
                return None
            return {"type": "card", "action": "upsert", "board_id": board_id,
                    "card": jsonable_encoder(_card_to_dict(card))}
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


async def consumer() -> None:
    """Task de fundo (sobe no lifespan). Serializa fora do caminho da request."""
    while True:
        board_id, kind, entity_id, action = await _changes.get()
        try:
            event = await _serialize(board_id, kind, entity_id, action)
            if event is not None:
                _fanout(board_id, event)
        except Exception:
            # Nunca derrubar o consumer por um evento ruim.
            pass
