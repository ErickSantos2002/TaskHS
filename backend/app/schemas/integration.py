from datetime import date
from pydantic import BaseModel
from app.models.card import Priority


class IntegrationCardIn(BaseModel):
    source: str
    external_id: str
    board: str
    list: str
    title: str
    description: str | None = None
    due_date: date | None = None
    priority: Priority | None = None


class IntegrationCardRef(BaseModel):
    source: str
    external_id: str
