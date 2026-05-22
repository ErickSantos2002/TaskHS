from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, Integer, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class List(Base):
    __tablename__ = "lists"

    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id"))
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(255))
    position: Mapped[int] = mapped_column(Integer, default=0)
    color: Mapped[str] = mapped_column(String(7), default="#64748b")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    board: Mapped["Board"] = relationship("Board", back_populates="lists")
    cards: Mapped[list["Card"]] = relationship("Card", back_populates="list", cascade="all, delete-orphan", order_by="Card.position")
