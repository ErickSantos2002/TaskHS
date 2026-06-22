from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, Boolean, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Automation(Base):
    __tablename__ = "automations"

    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id"))
    trigger_type: Mapped[str] = mapped_column(String(50), default="card_moved_to_list")
    trigger_list_id: Mapped[int] = mapped_column(ForeignKey("lists.id"))
    action_type: Mapped[str] = mapped_column(String(50), default="mark_due_complete")
    action_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
