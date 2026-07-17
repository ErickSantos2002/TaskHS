from datetime import date
from pydantic import BaseModel
from app.models.card import Priority


class IntegrationCardIn(BaseModel):
    source: str
    external_id: str
    # list_id, e nao os nomes do quadro e da lista: o nome fazia a integracao CRIAR um
    # quadro fantasma em silencio quando o titulo nao batia (renomear "Servico" na tela
    # bastava). Ja aconteceu: a auditoria registra a integracao criando a lista
    # "Recebido" num board_id=29. Com id, o erro e um 404 na cara do chamador.
    # So o list_id: ele ja determina o quadro (List.board_id), e pedir board_id junto
    # abriria a chance de mandar um par inconsistente.
    list_id: int
    title: str
    description: str | None = None
    due_date: date | None = None
    priority: Priority | None = None
    archived: bool | None = None
    obs1: str | None = None
    obs2: str | None = None
    obs3: str | None = None
    obs4: str | None = None
    obs5: str | None = None
    obs6: str | None = None


class IntegrationCardRef(BaseModel):
    source: str
    external_id: str
