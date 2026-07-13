from datetime import datetime, timezone
from sqlalchemy import String, Integer, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class AuditLog(Base):
    """Log de auditoria — append-only. SEM foreign keys de propósito: o histórico
    precisa sobreviver à exclusão do usuário/quadro/card (snapshots nos campos *_name/label/summary)."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    actor_type: Mapped[str] = mapped_column(String(20), default="sistema")
    actor_user_id: Mapped[int | None] = mapped_column(Integer, index=True)
    actor_name: Mapped[str] = mapped_column(String(120), default="sistema")
    actor_email: Mapped[str | None] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(20), index=True)
    entity_type: Mapped[str] = mapped_column(String(40), index=True)
    entity_id: Mapped[int | None] = mapped_column(Integer)
    entity_label: Mapped[str | None] = mapped_column(String(255))
    board_id: Mapped[int | None] = mapped_column(Integer, index=True)
    card_id: Mapped[int | None] = mapped_column(Integer, index=True)
    summary: Mapped[str] = mapped_column(Text)
    changes: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(String(45))
    path: Mapped[str | None] = mapped_column(String(255))
