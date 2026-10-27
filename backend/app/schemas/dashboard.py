from datetime import date, datetime
from pydantic import BaseModel


class DashboardKpis(BaseModel):
    cards_ativos: int
    listas: int
    arquivados: int
    em_concluido: int
    atrasados: int


class DashboardLista(BaseModel):
    """Uma barra do gráfico "Cards por lista" (só no painel de um quadro)."""
    id: int
    title: str
    is_done: bool
    total: int
    atrasados: int


class DashboardAtrasado(BaseModel):
    """Uma linha do modal: card há mais de 72 h úteis fora de lista de concluído."""
    card_id: int
    list_id: int
    board_id: int
    board_title: str
    list_title: str
    title: str
    created_at: datetime
    horas_uteis: float


class MovimentoDia(BaseModel):
    dia: date
    total: int


class RankingQuadro(BaseModel):
    id: int
    nome: str
    color: str | None
    total: int


class RankingPessoa(BaseModel):
    id: int
    nome: str
    initials: str
    avatar_url: str | None
    total: int


class DashboardOut(BaseModel):
    board_id: int | None
    periodo: int
    kpis: DashboardKpis
    listas: list[DashboardLista]
    atrasados: list[DashboardAtrasado]
    # Movimento = card mudado de lista por uma pessoa (audit_log "mover").
    movimentos_por_dia: list[MovimentoDia]
    quadros_mais_movimentados: list[RankingQuadro]
    quadros_com_mais_cards: list[RankingQuadro]
    pessoas_que_mais_movimentam: list[RankingPessoa]
    pessoas_com_mais_cards: list[RankingPessoa]
