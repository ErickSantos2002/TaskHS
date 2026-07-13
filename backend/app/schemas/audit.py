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
