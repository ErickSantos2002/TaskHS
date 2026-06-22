from __future__ import annotations
from datetime import datetime, date, timezone
from sqlalchemy import String, ForeignKey, Float, DateTime, Date, Text, Boolean, Enum as SAEnum, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum
from app.database import Base
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from app.models.board import BoardLabel


class Priority(str, enum.Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


class Card(Base):
    __tablename__ = "cards"
    __table_args__ = (UniqueConstraint("external_source", "external_id", name="uq_card_external"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    list_id: Mapped[int] = mapped_column(ForeignKey("lists.id"))
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[Priority] = mapped_column(SAEnum(Priority), default=Priority.medium)
    position: Mapped[float] = mapped_column(Float, default=65536.0)
    due_date: Mapped[date | None] = mapped_column(Date)
    due_date_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    external_source: Mapped[str | None] = mapped_column(String(50))
    external_id: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    list: Mapped["List"] = relationship("List", back_populates="cards")
    labels: Mapped[list["CardLabel"]] = relationship("CardLabel", back_populates="card", cascade="all, delete-orphan")
    members: Mapped[list["CardMember"]] = relationship("CardMember", back_populates="card", cascade="all, delete-orphan")
    comments: Mapped[list["CardComment"]] = relationship("CardComment", back_populates="card", cascade="all, delete-orphan")
    attachments: Mapped[list["CardAttachment"]] = relationship("CardAttachment", back_populates="card", cascade="all, delete-orphan")
    checklists: Mapped[list["Checklist"]] = relationship("Checklist", back_populates="card", cascade="all, delete-orphan")


class CardLabel(Base):
    __tablename__ = "card_labels"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"))
    label_id: Mapped[int] = mapped_column(ForeignKey("board_labels.id"))

    card: Mapped["Card"] = relationship("Card", back_populates="labels")
    board_label: Mapped["BoardLabel"] = relationship("BoardLabel", back_populates="card_assignments")


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
    url: Mapped[str | None] = mapped_column(String(1000))
    stored_name: Mapped[str | None] = mapped_column(String(255))
    content_type: Mapped[str | None] = mapped_column(String(255))
    size: Mapped[int | None] = mapped_column(Integer)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    card: Mapped["Card"] = relationship("Card", back_populates="attachments")


class Checklist(Base):
    __tablename__ = "card_checklists"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"))
    title: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    card: Mapped["Card"] = relationship("Card", back_populates="checklists")
    items: Mapped[list["ChecklistItem"]] = relationship("ChecklistItem", back_populates="checklist", cascade="all, delete-orphan", order_by="ChecklistItem.id")


class ChecklistItem(Base):
    __tablename__ = "card_checklist_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    checklist_id: Mapped[int] = mapped_column(ForeignKey("card_checklists.id"))
    text: Mapped[str] = mapped_column(String(500))
    checked: Mapped[bool] = mapped_column(Boolean, default=False)

    checklist: Mapped["Checklist"] = relationship("Checklist", back_populates="items")
