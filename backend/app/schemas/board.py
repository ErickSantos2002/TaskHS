from datetime import datetime
from pydantic import BaseModel, field_validator
from app.models.board import BoardRole


def _norm_obs_labels(v: list[str] | None) -> list[str] | None:
    """Até 6 nomes; cada um trimado e limitado a 60 chars. Vazio = obs oculta."""
    if v is None:
        return v
    if len(v) > 6:
        raise ValueError("no máximo 6 observações")
    return [(s or "").strip()[:60] for s in v]


class BoardCreate(BaseModel):
    title: str
    description: str | None = None
    color: str = "#0ea5e9"
    integration_enabled: bool = False
    obs_labels: list[str] = []

    @field_validator("obs_labels")
    @classmethod
    def _v_obs(cls, v): return _norm_obs_labels(v)


class BoardUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    color: str | None = None
    integration_enabled: bool | None = None
    obs_labels: list[str] | None = None

    @field_validator("obs_labels")
    @classmethod
    def _v_obs(cls, v): return _norm_obs_labels(v)


class BoardOut(BaseModel):
    id: int
    title: str
    description: str | None
    color: str
    owner_id: int
    created_at: datetime
    integration_enabled: bool
    obs_labels: list[str]

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
    assigned_cards: int


class BoardMemberBriefOut(BaseModel):
    """Membro como aparece na LISTAGEM de quadros, que todo mundo enxerga.

    Enxuto de propósito, espelhando o UserBasicOut de /auth/users/basic: nome e
    iniciais bastam para o avatar do cadeado. O e-mail fica só no
    GET /boards/{id}/members, que está atrás da tranca de membresia.
    """
    id: int
    name: str
    initials: str


class BoardListOut(BoardOut):
    """Item da listagem de quadros.

    Só a listagem tem esses campos; GET /boards/{id} segue devolvendo BoardOut,
    porque a tela do quadro não desenha cadeado.
    """
    can_open: bool
    owner_name: str
    members: list[BoardMemberBriefOut]
