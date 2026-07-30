from datetime import date
from pydantic import BaseModel


class SearchResultOut(BaseModel):
    """Uma linha do dropdown de busca.

    Traz o quadro e a lista junto porque o resultado é global: sem isso a
    pessoa não sabe de onde veio o card, e o front não tem como montar o link.
    """
    card_id: int
    list_id: int
    board_id: int
    board_title: str
    board_color: str | None
    list_title: str
    title: str
    priority: str
    due_date: date | None
    archived: bool
    snippet: str
    matched_field: str  # "titulo" | "descricao" | "obs" | "comentario"
