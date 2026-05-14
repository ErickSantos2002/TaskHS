from datetime import datetime, date
from pydantic import BaseModel
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
    position: int = 0


class CardUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: Priority | None = None
    due_date: date | None = None
    position: int | None = None
    list_id: int | None = None


class CardOut(BaseModel):
    id: int
    list_id: int
    title: str
    description: str | None
    priority: Priority
    position: int
    due_date: date | None
    created_at: datetime
    updated_at: datetime
    labels: list[LabelOut] = []
    members: list[UserOut] = []
    comments: list[CommentOut] = []
    attachments: list[AttachmentOut] = []

    model_config = {"from_attributes": True}


class CommentCreate(BaseModel):
    body: str
