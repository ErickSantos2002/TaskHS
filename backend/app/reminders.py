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
