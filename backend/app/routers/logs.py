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

# Brasil não tem horário de verão desde 2019 — offset fixo, sem depender de tzdata.
TZ_BR = timezone(timedelta(hours=-3))


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
        conds.append(AuditLog.created_at >= datetime.combine(date_from, time.min, tzinfo=TZ_BR))
    if date_to:
        conds.append(AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=TZ_BR))
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
