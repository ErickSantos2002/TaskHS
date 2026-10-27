"""Dashboard: indicadores de um quadro (ou de todos) e o alerta de 72 h úteis.

O alerta é da Qualidade: card criado há mais de 72 horas úteis (ver
app/horas_uteis.py) que ainda não chegou numa lista "de concluído" do quadro
(`List.is_done`, marcada no drawer). Quadro sem lista marcada conta tudo.

`Card.done` (a caixinha "concluído" do card) e `due_date_completed` NÃO tiram o
card do alerta, de propósito: na operação a caixinha tem outro significado.
Só a lista onde o card está decide.

Fora dos chokepoints da lixeira: toda query aqui filtra `deleted_at IS NULL` em
card, lista e quadro à mão.
"""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, user_can_access_board
from app.horas_uteis import horas_uteis, LIMITE_HORAS
from app.models.board import Board, BoardMember
from app.models.card import Card
from app.models.list import List
from app.models.user import User
from app.schemas.dashboard import DashboardOut

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


async def _quadros_visiveis(user: User, db: AsyncSession) -> list[int]:
    """Mesmo recorte de /boards/stats e de can_open: elevado vê todos."""
    stmt = select(Board.id).where(Board.deleted_at.is_(None))
    if not user.is_elevated:
        stmt = stmt.join(BoardMember, BoardMember.board_id == Board.id).where(BoardMember.user_id == user.id)
    return list((await db.execute(stmt)).scalars().all())


@router.get("", response_model=DashboardOut)
async def get_dashboard(
    board_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if board_id is not None:
        if not await user_can_access_board(board_id, current_user, db):
            # Elevado alcança todo quadro vivo, então falso para ele é "não
            # existe". Para os outros, 403 sempre: não revela se o quadro existe.
            if current_user.is_elevated:
                raise HTTPException(status_code=404, detail="Board não encontrado")
            raise HTTPException(status_code=403, detail="Sem acesso a este quadro")
        board_ids = [board_id]
    else:
        board_ids = await _quadros_visiveis(current_user, db)

    lista_viva = (List.deleted_at.is_(None), List.board_id.in_(board_ids))
    listas = (await db.execute(
        select(List.id, List.title, List.is_done)
        .join(Board, Board.id == List.board_id)
        .where(*lista_viva, Board.deleted_at.is_(None), List.archived == False)
        .order_by(List.board_id, List.position)
    )).all()

    ativos = (await db.execute(
        select(
            Card.id, Card.title, Card.list_id, Card.created_at, Card.due_date, Card.due_date_completed,
            List.title, List.is_done, Board.id, Board.title,
        )
        .join(List, List.id == Card.list_id)
        .join(Board, Board.id == List.board_id)
        .where(
            Card.deleted_at.is_(None), *lista_viva, Board.deleted_at.is_(None),
            Card.archived == False, List.archived == False,
        )
        .order_by(Card.created_at)
    )).all()

    arquivados = (await db.execute(
        select(func.count(Card.id))
        .join(List, List.id == Card.list_id)
        .join(Board, Board.id == List.board_id)
        .where(
            Card.deleted_at.is_(None), *lista_viva, Board.deleted_at.is_(None),
            or_(Card.archived == True, List.archived == True),
        )
    )).scalar_one()

    agora = datetime.now(timezone.utc)
    hoje = date.today()  # mesma régua de /boards/stats
    total_por_lista: dict[int, int] = {}
    atrasados_por_lista: dict[int, int] = {}
    atrasados = []
    prazo_vencido = vencem_hoje = em_concluido = 0
    for (card_id, title, list_id, created_at, due_date, due_ok,
         list_title, list_done, b_id, b_title) in ativos:
        total_por_lista[list_id] = total_por_lista.get(list_id, 0) + 1
        if due_date is not None and not due_ok:
            prazo_vencido += due_date < hoje
            vencem_hoje += due_date == hoje
        if list_done:
            em_concluido += 1
            continue
        horas = horas_uteis(created_at, agora)
        if horas > LIMITE_HORAS:
            atrasados_por_lista[list_id] = atrasados_por_lista.get(list_id, 0) + 1
            atrasados.append({
                "card_id": card_id, "list_id": list_id, "board_id": b_id,
                "board_title": b_title, "list_title": list_title, "title": title,
                "created_at": created_at, "horas_uteis": round(horas, 1),
            })

    return {
        "board_id": board_id,
        "kpis": {
            "cards_ativos": len(ativos),
            "listas": len(listas),
            "arquivados": arquivados,
            "prazo_vencido": prazo_vencido,
            "vencem_hoje": vencem_hoje,
            "em_concluido": em_concluido,
            "atrasados": len(atrasados),
        },
        # O gráfico por lista só faz sentido dentro de um quadro.
        "listas": [] if board_id is None else [
            {"id": l_id, "title": l_title, "is_done": l_done,
             "total": total_por_lista.get(l_id, 0), "atrasados": atrasados_por_lista.get(l_id, 0)}
            for l_id, l_title, l_done in listas
        ],
        "atrasados": atrasados,
    }
