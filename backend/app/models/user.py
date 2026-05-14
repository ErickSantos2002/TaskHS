from datetime import datetime, timezone
from sqlalchemy import String, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    initials: Mapped[str] = mapped_column(String(4))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    boards: Mapped[list["Board"]] = relationship("Board", back_populates="owner", foreign_keys="Board.owner_id")
    board_memberships: Mapped[list["BoardMember"]] = relationship("BoardMember", back_populates="user")
    card_memberships: Mapped[list["CardMember"]] = relationship("CardMember", back_populates="user")
    comments: Mapped[list["CardComment"]] = relationship("CardComment", back_populates="author")
