from datetime import datetime
from pydantic import BaseModel


class ReminderCreate(BaseModel):
    remind_at: datetime


class ReminderOut(BaseModel):
    id: int
    card_id: int
    remind_at: datetime
    fired: bool
    created_at: datetime

    model_config = {"from_attributes": True}
