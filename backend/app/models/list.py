from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, Integer, DateTime, Boolean, text
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
    # Lista "de concluido" (migration 014): card aqui sai do alerta de 72 h do Dashboard.
    is_done: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    # Setor da lista (migration 016): soma dos "travados por setor" do Dashboard.
    setor_id: Mapped[int | None] = mapped_column(ForeignKey("setores.id", ondelete="SET NULL"), nullable=True)
    # Lixeira (migration 013). NULL = viva.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    board: Mapped["Board"] = relationship("Board", back_populates="lists")
    cards: Mapped[list["Card"]] = relationship("Card", back_populates="list", cascade="all, delete-orphan", order_by="Card.position")
