from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel
from datetime import datetime
from app.database import get_db
from app.models.notification import Notification
from app.models.user import User
from app.dependencies import get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    id: int
    type: str
    message: str
    card_id: int | None
    board_id: int | None
    read: bool
    created_at: datetime
    model_config = {"from_attributes": True}


@router.get("", response_model=list[NotificationOut])
async def get_notifications(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
    )
    return result.scalars().all()


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(notification_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Notification).where(Notification.id == notification_id, Notification.user_id == current_user.id))
    n = result.scalar_one_or_none()
    if n:
        n.read = True
        await db.commit()


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await db.execute(
        update(Notification).where(Notification.user_id == current_user.id, Notification.read == False).values(read=True)
    )
    await db.commit()
