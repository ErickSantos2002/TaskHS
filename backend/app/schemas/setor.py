from typing import Annotated
from pydantic import BaseModel, StringConstraints

NomeSetor = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class SetorOut(BaseModel):
    id: int
    nome: str
    ativo: bool
    listas: int = 0  # listas vivas marcadas com o setor (tela de admin)


class SetorCreate(BaseModel):
    nome: NomeSetor


class SetorUpdate(BaseModel):
    nome: NomeSetor | None = None
    ativo: bool | None = None
