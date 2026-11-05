"""Minhas tarefas: os cards em que a pessoa é membro, em todos os quadros.

Router próprio porque o prefixo do router `cards` exige `{list_id}`. Usa
`get_current_user` puro (sem os gates de lista): o recorte de acesso é a regra
de `user_can_access_list`, aplicada na própria query — elevado alcança todos os
quadros; os demais precisam de linha em `board_members`.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select, exists, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.board import Board, BoardMember
from app.models.card import Card, CardMember, Priority
from app.models.list import List as ListModel
from app.models.user import User
from app.schemas.minhas import MinhaTarefaOut

router = APIRouter(prefix="/cards", tags=["cards"])

LIMITE = 500


@router.get("/minhas", response_model=list[MinhaTarefaOut])
async def minhas_tarefas(
    abertas: bool = True,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(
            Card.id,
            Card.title,
            Board.id.label("board_id"),
            Board.title.label("board_title"),
            ListModel.id.label("list_id"),
            ListModel.title.label("list_title"),
            Card.due_date,
            Card.due_date_completed,
            Card.priority,
            Card.done,
        )
        .join(ListModel, ListModel.id == Card.list_id)
        .join(Board, Board.id == ListModel.board_id)
        .where(
            Card.deleted_at.is_(None),
            ListModel.deleted_at.is_(None),
            Board.deleted_at.is_(None),
            exists().where(CardMember.card_id == Card.id, CardMember.user_id == user.id),
        )
    )
    if not user.is_elevated:
        stmt = stmt.where(
            exists().where(BoardMember.board_id == Board.id, BoardMember.user_id == user.id)
        )
    if abertas:
        stmt = stmt.where(
            Card.done.is_not(True),
            Card.archived.is_not(True),
            ListModel.is_done.is_not(True),
            ListModel.archived.is_not(True),
            Board.archived_at.is_(None),
        )
    ordem_prioridade = case(
        (Card.priority == Priority.critical, 0),
        (Card.priority == Priority.high, 1),
        (Card.priority == Priority.medium, 2),
        else_=3,
    )
    stmt = stmt.order_by(
        Card.due_date.is_(None), Card.due_date, ordem_prioridade, Card.id
    ).limit(LIMITE)

    rows = (await db.execute(stmt)).all()
    return [
        MinhaTarefaOut(
            id=r.id,
            title=r.title,
            board_id=r.board_id,
            board_title=r.board_title,
            list_id=r.list_id,
            list_title=r.list_title,
            due_date=r.due_date,
            due_date_completed=bool(r.due_date_completed),
            priority=r.priority.value if hasattr(r.priority, "value") else str(r.priority),
            done=bool(r.done),
        )
        for r in rows
    ]
