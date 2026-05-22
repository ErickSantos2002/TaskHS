from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, DateTime, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum
from app.database import Base


class BoardRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    member = "member"
    viewer = "viewer"


class Board(Base):
    __tablename__ = "boards"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(500))
    color: Mapped[str] = mapped_column(String(7), default="#0ea5e9")
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    owner: Mapped["User"] = relationship("User", back_populates="boards", foreign_keys=[owner_id])
    members: Mapped[list["BoardMember"]] = relationship("BoardMember", back_populates="board", cascade="all, delete-orphan")
    lists: Mapped[list["List"]] = relationship("List", back_populates="board", cascade="all, delete-orphan", order_by="List.position")
    labels: Mapped[list["BoardLabel"]] = relationship("BoardLabel", back_populates="board", cascade="all, delete-orphan", order_by="BoardLabel.id")


class BoardLabel(Base):
    __tablename__ = "board_labels"

    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id"))
    name: Mapped[str] = mapped_column(String(60))
    color: Mapped[str] = mapped_column(String(7), default="#0ea5e9")

    board: Mapped["Board"] = relationship("Board", back_populates="labels")
    card_assignments: Mapped[list["CardLabel"]] = relationship("CardLabel", back_populates="board_label", cascade="all, delete-orphan")


class BoardMember(Base):
    __tablename__ = "board_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    role: Mapped[BoardRole] = mapped_column(SAEnum(BoardRole), default=BoardRole.member)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    board: Mapped["Board"] = relationship("Board", back_populates="members")
    user: Mapped["User"] = relationship("User", back_populates="board_memberships")
