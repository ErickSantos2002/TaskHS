from datetime import datetime
from pydantic import BaseModel
from app.models.board import BoardRole


class BoardCreate(BaseModel):
    title: str
    description: str | None = None
    color: str = "#0ea5e9"


class BoardUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    color: str | None = None


class BoardOut(BaseModel):
    id: int
    title: str
    description: str | None
    color: str
    owner_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


class BoardMemberAdd(BaseModel):
    user_id: int
    role: BoardRole = BoardRole.member
