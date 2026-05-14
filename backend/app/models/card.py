from datetime import datetime, date, timezone
from sqlalchemy import String, ForeignKey, Float, DateTime, Date, Text, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum
from app.database import Base


class Priority(str, enum.Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    list_id: Mapped[int] = mapped_column(ForeignKey("lists.id"))
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[Priority] = mapped_column(SAEnum(Priority), default=Priority.medium)
    position: Mapped[float] = mapped_column(Float, default=65536.0)
    due_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    list: Mapped["List"] = relationship("List", back_populates="cards")
    labels: Mapped[list["CardLabel"]] = relationship("CardLabel", back_populates="card", cascade="all, delete-orphan")
    members: Mapped[list["CardMember"]] = relationship("CardMember", back_populates="card", cascade="all, delete-orphan")
    comments: Mapped[list["CardComment"]] = relationship("CardComment", back_populates="card", cascade="all, delete-orphan")
    attachments: Mapped[list["CardAttachment"]] = relationship("CardAttachment", back_populates="card", cascade="all, delete-orphan")


class CardLabel(Base):
    __tablename__ = "card_labels"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"))
    label: Mapped[str] = mapped_column(String(60))
    color: Mapped[str] = mapped_column(String(7), default="#0ea5e9")

    card: Mapped["Card"] = relationship("Card", back_populates="labels")


class CardMember(Base):
    __tablename__ = "card_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    card: Mapped["Card"] = relationship("Card", back_populates="members")
    user: Mapped["User"] = relationship("User", back_populates="card_memberships")


class CardComment(Base):
    __tablename__ = "card_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"))
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    card: Mapped["Card"] = relationship("Card", back_populates="comments")
    author: Mapped["User"] = relationship("User", back_populates="comments")


class CardAttachment(Base):
    __tablename__ = "card_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"))
    filename: Mapped[str] = mapped_column(String(255))
    url: Mapped[str] = mapped_column(String(1000))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    card: Mapped["Card"] = relationship("Card", back_populates="attachments")
