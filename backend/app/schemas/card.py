from datetime import datetime, date
from typing import Any
from pydantic import BaseModel, field_validator
from app.models.card import Priority
from app.schemas.user import UserOut


class LabelOut(BaseModel):
    id: int
    label: str
    color: str
    model_config = {"from_attributes": True}


class CommentOut(BaseModel):
    id: int
    body: str
    author: UserOut
    created_at: datetime
    model_config = {"from_attributes": True}


class AttachmentOut(BaseModel):
    id: int
    filename: str
    url: str
    uploaded_at: datetime
    model_config = {"from_attributes": True}


class CardCreate(BaseModel):
    title: str
    description: str | None = None
    priority: Priority = Priority.medium
    due_date: date | None = None


class CardUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: Priority | None = None
    due_date: date | None = None
    position: float | None = None
    list_id: int | None = None


class CardOut(BaseModel):
    id: int
    list_id: int
    title: str
    description: str | None
    priority: Priority
    position: float
    due_date: date | None
    created_at: datetime
    updated_at: datetime
    labels: list[LabelOut] = []
    members: list[UserOut] = []
    comments: list[CommentOut] = []
    attachments: list[AttachmentOut] = []

    model_config = {"from_attributes": True}

    @field_validator("labels", "comments", "attachments", mode="before")
    @classmethod
    def default_list(cls, v: Any) -> Any:
        return v if v is not None else []

    @field_validator("members", mode="before")
    @classmethod
    def extract_users(cls, v: Any) -> Any:
        if not v:
            return []
        # Card.members is list[CardMember] — extract the nested .user
        if hasattr(v[0], "user"):
            return [m.user for m in v if m.user is not None]
        return v


class CommentCreate(BaseModel):
    body: str
