from datetime import datetime
from pydantic import BaseModel


class DashboardKpis(BaseModel):
    cards_ativos: int
    listas: int
    arquivados: int
    prazo_vencido: int
    vencem_hoje: int
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


class DashboardOut(BaseModel):
    board_id: int | None
    kpis: DashboardKpis
    listas: list[DashboardLista]
    atrasados: list[DashboardAtrasado]
