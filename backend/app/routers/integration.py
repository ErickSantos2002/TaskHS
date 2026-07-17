from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.dependencies import require_integration_key
from app.models.list import List
from app.models.card import Card, Priority
from app.models.notification import Notification
from app.models.reminder import Reminder, ReminderSent
from app.schemas.integration import IntegrationCardIn, IntegrationCardRef
from app.routers.cards import _card_options, _card_to_dict
from app.audit_context import set_actor_identity

router = APIRouter(prefix="/integration", tags=["integration"], dependencies=[Depends(require_integration_key)])


async def _get_list_or_404(db: AsyncSession, list_id: int) -> List:
    """A lista tem que existir. A integracao NUNCA cria quadro nem lista.

    Era o "cria sozinho" que gerava fantasma: um titulo que nao batia fazia um quadro
    novo nascer em silencio, e as OS caiam nele. Agora o erro e alto e imediato.
    """
    lst = (await db.execute(select(List).where(List.id == list_id))).scalar_one_or_none()
    if lst is None:
        raise HTTPException(status_code=404, detail="Lista não encontrada")
    return lst


async def _last_position(db: AsyncSession, list_id: int) -> float:
    last = (await db.execute(
        select(Card.position).where(Card.list_id == list_id).order_by(Card.position.desc()).limit(1)
    )).scalar_one_or_none()
    return (last or 0.0) + 65536.0


async def _apply_updates(card: Card, body: IntegrationCardIn, sent: dict, lst: "List", db: AsyncSession) -> None:
    """Apply upsert fields to an existing card (shared by normal update and IntegrityError recovery)."""
    card.title = body.title
    if "description" in sent:
        card.description = body.description
    if "due_date" in sent:
        card.due_date = body.due_date
    if "priority" in sent and body.priority is not None:
        card.priority = body.priority
    if "archived" in sent and body.archived is not None:
        card.archived = body.archived
    if card.list_id != lst.id:
        card.list_id = lst.id
        card.position = await _last_position(db, lst.id)


@router.post("/cards")
async def upsert_card(body: IntegrationCardIn, db: AsyncSession = Depends(get_db)):
    set_actor_identity("integracao", None, body.source, None)
    sent = body.model_dump(exclude_unset=True)
    lst = await _get_list_or_404(db, body.list_id)
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
            archived=body.archived or False,
        )
        db.add(card)
        try:
            await db.commit()
        except IntegrityError:
            # A concurrent request already inserted this (source, external_id) — recover gracefully.
            await db.rollback()
            card = (await db.execute(
                select(Card).where(Card.external_source == body.source, Card.external_id == body.external_id)
            )).scalar_one()
            await _apply_updates(card, body, sent, lst, db)
            await db.commit()
    else:
        await _apply_updates(card, body, sent, lst, db)
        await db.commit()
    result = await db.execute(select(Card).where(Card.id == card.id).options(*_card_options()))
    return _card_to_dict(result.scalar_one())


@router.delete("/cards", status_code=status.HTTP_204_NO_CONTENT)
async def delete_external_card(body: IntegrationCardRef, db: AsyncSession = Depends(get_db)):
    set_actor_identity("integracao", None, body.source, None)
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
