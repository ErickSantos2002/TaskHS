from datetime import date
from pydantic import BaseModel


class MinhaTarefaOut(BaseModel):
    """Um card em que a pessoa é membro, com quadro e lista para dar contexto."""
    id: int
    title: str
    board_id: int
    board_title: str
    list_id: int
    list_title: str
    due_date: date | None
    due_date_completed: bool
    priority: str
    done: bool
