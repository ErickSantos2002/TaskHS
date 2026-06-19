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
