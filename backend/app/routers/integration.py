from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from app.database import get_db
from app.dependencies import require_integration_key
from app.core.config import settings
from app.models.board import Board
from app.models.list import List
from app.models.card import Card, Priority
from app.models.notification import Notification
from app.models.reminder import Reminder, ReminderSent
from app.schemas.integration import IntegrationCardIn, IntegrationCardRef
from app.routers.cards import _card_options, _card_to_dict

router = APIRouter(prefix="/integration", tags=["integration"], dependencies=[Depends(require_integration_key)])


async def _ensure_board(db: AsyncSession, name: str) -> Board:
    board = (await db.execute(
        select(Board).where(Board.title == name).order_by(Board.id).limit(1)
    )).scalar_one_or_none()
    if board is None:
        board = Board(title=name, owner_id=settings.INTEGRATION_OWNER_ID)
        db.add(board)
        await db.flush()
    return board


async def _ensure_list(db: AsyncSession, board_id: int, name: str) -> List:
    lst = (await db.execute(
        select(List).where(List.board_id == board_id, List.title == name).order_by(List.id).limit(1)
    )).scalar_one_or_none()
    if lst is None:
        last = (await db.execute(
            select(List.position).where(List.board_id == board_id).order_by(List.position.desc()).limit(1)
        )).scalar_one_or_none()
        lst = List(board_id=board_id, title=name, position=(last or 0) + 1)
        db.add(lst)
        await db.flush()
    return lst


async def _last_position(db: AsyncSession, list_id: int) -> float:
    last = (await db.execute(
        select(Card.position).where(Card.list_id == list_id).order_by(Card.position.desc()).limit(1)
    )).scalar_one_or_none()
    return (last or 0.0) + 65536.0


@router.post("/cards")
async def upsert_card(body: IntegrationCardIn, db: AsyncSession = Depends(get_db)):
    sent = body.model_dump(exclude_unset=True)
    board = await _ensure_board(db, body.board)
    lst = await _ensure_list(db, board.id, body.list)
    card = (await db.execute(
        select(Card).where(Card.external_source == body.source, Card.external_id == body.external_id)
    )).scalar_one_or_none()
    if card is None:
        card = Card(
            list_id=lst.id,
            title=body.title,
            description=body.description,
            due_date=body.due_date,
            priority=body.priority or Priority.medium,
            position=await _last_position(db, lst.id),
            external_source=body.source,
            external_id=body.external_id,
        )
        db.add(card)
    else:
        card.title = body.title
        if "description" in sent:
            card.description = body.description
        if "due_date" in sent:
            card.due_date = body.due_date
        if "priority" in sent and body.priority is not None:
            card.priority = body.priority
        if card.list_id != lst.id:
            card.list_id = lst.id
            card.position = await _last_position(db, lst.id)
    await db.commit()
    result = await db.execute(select(Card).where(Card.id == card.id).options(*_card_options()))
    return _card_to_dict(result.scalar_one())


@router.delete("/cards", status_code=status.HTTP_204_NO_CONTENT)
async def delete_external_card(body: IntegrationCardRef, db: AsyncSession = Depends(get_db)):
    card = (await db.execute(
        select(Card).where(Card.external_source == body.source, Card.external_id == body.external_id)
    )).scalar_one_or_none()
    if card is None:
        raise HTTPException(status_code=404, detail="Card não encontrado")
    cid = card.id
    await db.execute(sql_delete(Notification).where(Notification.card_id == cid))
    await db.execute(sql_delete(Reminder).where(Reminder.card_id == cid))
    await db.execute(sql_delete(ReminderSent).where(ReminderSent.card_id == cid))
    await db.delete(card)
    await db.commit()
