from datetime import datetime, date
from typing import Any
from pydantic import BaseModel, Field, field_validator
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
    content_type: str | None = None
    size: int | None = None
    uploaded_by: int | None = None
    uploaded_at: datetime
    is_image: bool = False

    model_config = {"from_attributes": True}

    @field_validator("is_image", mode="before")
    @classmethod
    def derive_is_image(cls, v: Any, info: Any) -> Any:
        return v


class ChecklistItemOut(BaseModel):
    id: int
    text: str
    checked: bool
    model_config = {"from_attributes": True}


class ChecklistOut(BaseModel):
    id: int
    title: str
    items: list[ChecklistItemOut] = []
    model_config = {"from_attributes": True}


class ChecklistCreate(BaseModel):
    title: str


class ChecklistItemCreate(BaseModel):
    text: str


class ChecklistItemUpdate(BaseModel):
    text: str | None = None
    checked: bool | None = None


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
    due_date_completed: bool | None = None
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
    due_date_completed: bool = False
    archived: bool = False
    created_at: datetime
    updated_at: datetime
    labels: list[LabelOut] = []
    members: list[UserOut] = []
    comments: list[CommentOut] = []
    attachments: list[AttachmentOut] = []
    checklists: list[ChecklistOut] = []

    model_config = {"from_attributes": True}

    @field_validator("labels", "comments", "attachments", "checklists", mode="before")
    @classmethod
    def default_list(cls, v: Any) -> Any:
        if v is None:
            return []
        if isinstance(v, list):
            return v
        try:
            return list(v)
        except TypeError:
            return [v]


class CommentCreate(BaseModel):
    # 20 mil caracteres cobre ate uma thread de e-mail colada num card (fluxo real
    # aqui), e a coluna e Text (ilimitada). O limite NAO e o que protege a regex de
    # mencoes — quem faz isso e o teto {1,120} do nome em app/mentions.py, medido:
    # 160 KB em 4ms com o teto, 1.3s sem. Este limite e so sanidade de payload.
    body: str = Field(min_length=1, max_length=20000)
