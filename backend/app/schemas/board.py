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


class BoardMemberOut(BaseModel):
    """Uma pessoa dentro de um quadro.

    `id` é o id do USUÁRIO (não o da linha de board_members): é o que a API de
    remoção recebe e o que o frontend usa como chave.
    """
    id: int
    name: str
    email: str
    initials: str
    board_role: BoardRole
