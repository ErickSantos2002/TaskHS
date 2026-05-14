from datetime import datetime
from pydantic import BaseModel


class ListCreate(BaseModel):
    title: str
    description: str | None = None
    color: str = "#64748b"
    position: int = 0


class ListUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    color: str | None = None
    position: int | None = None


class ListOut(BaseModel):
    id: int
    board_id: int
    title: str
    description: str | None
    color: str
    position: int
    created_at: datetime

    model_config = {"from_attributes": True}
