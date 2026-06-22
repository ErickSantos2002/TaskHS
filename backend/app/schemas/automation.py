from datetime import datetime
from pydantic import BaseModel


class AutomationCreate(BaseModel):
    trigger_list_id: int
    trigger_type: str = "card_moved_to_list"
    action_type: str = "mark_due_complete"
    enabled: bool = True


class AutomationUpdate(BaseModel):
    enabled: bool | None = None
    trigger_list_id: int | None = None
    action_type: str | None = None


class AutomationOut(BaseModel):
    id: int
    board_id: int
    trigger_type: str
    trigger_list_id: int
    action_type: str
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}
