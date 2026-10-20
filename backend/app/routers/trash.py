"""Lixeira (v2.7.0): listar, restaurar e apagar de vez.

Excluir card/lista/quadro só marca `deleted_at` (ver delete_card, delete_list,
delete_board). Este é o ÚNICO lugar que apaga essas linhas de verdade — e só
para administrador, e só o que já está na lixeira. Ver spec 2026-10-20-lixeira.

A lixeira não propaga para os filhos: excluir a lista marca só a lista. Por isso
a aba de cards mostra só card excluído de lista VIVA — o de lista morta volta
junto com ela e aparece pela lista.
"""
import logging
import os
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from app.database import get_db
from app.core.config import settings
from app.models.board import Board
from app.models.list import List
from app.models.card import Card, CardAttachment, CardComment, Checklist
from app.models.user import User
from app.models.notification import Notification
from app.models.reminder import Reminder, ReminderSent
from app.models.automation import Automation
from app.dependencies import get_current_user, require_board_access_by_board_id
from app.routers.auth import get_admin_user
from app.routers.cards import _card_options
from app import realtime

logger = logging.getLogger("trash")

board_trash_router = APIRouter(prefix="/boards/{board_id}/trash", tags=["trash"],
                               dependencies=[Depends(require_board_access_by_board_id)])
admin_trash_router = APIRouter(prefix="/trash", tags=["trash"])

USUARIO_REMOVIDO = "integração ou usuário removido"


def _nome(nome: str | None) -> str:
    # Sem nome = exclusão pela integração (deleted_by nulo) ou usuário já apagado
    # (a FK é ON DELETE SET NULL). As duas chegam como None.
    return nome if nome else USUARIO_REMOVIDO


def _count(col, *where):
    return select(func.count(col)).where(*where).scalar_subquery()


async def _stored_names(card_ids, db: AsyncSession) -> list[str]:
    if not card_ids:
        return []
    return [n for n in (await db.execute(
        select(CardAttachment.stored_name).where(
            CardAttachment.card_id.in_(card_ids), CardAttachment.stored_name.isnot(None),
        )
    )).scalars().all()]


def _remove_attachment_files(stored_names: list[str]) -> None:
    """Apaga do disco os arquivos dos anexos. Chamar DEPOIS do commit: se o
    commit falhar, o arquivo ainda está lá e o banco também."""
    for nome in stored_names:
        path = os.path.join(settings.UPLOAD_DIR, nome)
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            logger.exception("falha ao apagar anexo %s", path)


async def _clear_card_refs(card_ids, db: AsyncSession) -> None:
    """Linhas que apontam para card sem cascade no ORM (FK NO ACTION) — o que o
    delete_card/delete_list/delete_board antigos faziam antes de apagar."""
    if not card_ids:
        return
    await db.execute(sql_delete(Notification).where(Notification.card_id.in_(card_ids)))
    await db.execute(sql_delete(Reminder).where(Reminder.card_id.in_(card_ids)))
    await db.execute(sql_delete(ReminderSent).where(ReminderSent.card_id.in_(card_ids)))


# ── Lixeira do quadro: cards e listas ─────────────────────────────────────────

@board_trash_router.get("")
async def get_board_trash(board_id: int, db: AsyncSession = Depends(get_db)):
    U = aliased(User)
    cards = (await db.execute(
        select(
            Card.id, Card.title, Card.list_id, List.title, Card.deleted_at, Card.deleted_by, U.name,
            _count(CardComment.id, CardComment.card_id == Card.id, CardComment.deleted_at.is_(None)),
            _count(CardAttachment.id, CardAttachment.card_id == Card.id),
            _count(Checklist.id, Checklist.card_id == Card.id),
        )
        .join(List, List.id == Card.list_id)
        .outerjoin(U, U.id == Card.deleted_by)
        .where(List.board_id == board_id, List.deleted_at.is_(None), Card.deleted_at.isnot(None))
        .order_by(Card.deleted_at.desc())
    )).all()
    lists = (await db.execute(
        select(
            List.id, List.title, List.color, List.deleted_at, List.deleted_by, U.name,
            _count(Card.id, Card.list_id == List.id, Card.deleted_at.is_(None)),
        )
        .outerjoin(U, U.id == List.deleted_by)
        .where(List.board_id == board_id, List.deleted_at.isnot(None))
        .order_by(List.deleted_at.desc())
    )).all()
    return {
        "cards": [
            {"id": cid, "title": t, "list_id": lid, "list_title": lt, "deleted_at": da,
             "deleted_by_name": _nome(nome), "comments": nc, "attachments": na, "checklists": nk}
            for cid, t, lid, lt, da, db_, nome, nc, na, nk in cards
        ],
        "lists": [
            {"id": lid, "title": t, "color": c, "deleted_at": da,
             "deleted_by_name": _nome(nome), "cards": n}
            for lid, t, c, da, db_, nome, n in lists
        ],
    }


async def _trashed_card_or_404(board_id: int, card_id: int, db: AsyncSession) -> Card:
    """Card NA LIXEIRA deste quadro, numa lista viva. Card vivo dá 404: apagar de
    vez sem passar pela lixeira não existe."""
    card = (await db.execute(
        select(Card).join(List, List.id == Card.list_id).where(
            Card.id == card_id, List.board_id == board_id,
            List.deleted_at.is_(None), Card.deleted_at.isnot(None),
        ).options(*_card_options())
    )).scalar_one_or_none()
    if card is None:
        raise HTTPException(status_code=404, detail="Card não encontrado na lixeira")
    return card


async def _trashed_list_or_404(board_id: int, list_id: int, db: AsyncSession) -> List:
    lst = (await db.execute(
        select(List).where(List.id == list_id, List.board_id == board_id, List.deleted_at.isnot(None))
    )).scalar_one_or_none()
    if lst is None:
        raise HTTPException(status_code=404, detail="Lista não encontrada na lixeira")
    return lst


@board_trash_router.post("/cards/{card_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_card(board_id: int, card_id: int, db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    # Qualquer membro restaura (decisão do Erick): restaurar não destrói nada.
    # Volta na mesma lista e posição; se estava arquivado, volta arquivado.
    card = await _trashed_card_or_404(board_id, card_id, db)
    card.deleted_at = None
    card.deleted_by = None
    await db.commit()  # o audit registra "restaurar" e o SSE manda o upsert


@board_trash_router.post("/lists/{list_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_list(board_id: int, list_id: int, db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    lst = await _trashed_list_or_404(board_id, list_id, db)
    lst.deleted_at = None
    lst.deleted_by = None
    await db.commit()
    # O upsert da lista chegaria sem os cards: recarga estrutural.
    realtime.publish_reload(board_id)


@board_trash_router.delete("/cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def purge_card(board_id: int, card_id: int, db: AsyncSession = Depends(get_db),
                     current_user: User = Depends(get_admin_user)):
    card = await _trashed_card_or_404(board_id, card_id, db)
    arquivos = await _stored_names([card.id], db)
    await _clear_card_refs([card.id], db)
    await db.delete(card)  # filhos vão em cascata pelo ORM (e entram no audit)
    await db.commit()
    _remove_attachment_files(arquivos)


@board_trash_router.delete("/lists/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def purge_list(board_id: int, list_id: int, db: AsyncSession = Depends(get_db),
                     current_user: User = Depends(get_admin_user)):
    lst = await _trashed_list_or_404(board_id, list_id, db)
    card_ids = (await db.execute(select(Card.id).where(Card.list_id == list_id))).scalars().all()
    arquivos = await _stored_names(card_ids, db)
    await db.execute(sql_delete(Automation).where(Automation.trigger_list_id == list_id))
    await _clear_card_refs(card_ids, db)
    await db.delete(lst)
    await db.commit()
    _remove_attachment_files(arquivos)


# ── Lixeira de quadros: só administrador ──────────────────────────────────────

async def _trashed_board_or_404(board_id: int, db: AsyncSession) -> Board:
    board = (await db.execute(
        select(Board).where(Board.id == board_id, Board.deleted_at.isnot(None))
    )).scalar_one_or_none()
    if board is None:
        raise HTTPException(status_code=404, detail="Quadro não encontrado na lixeira")
    return board


@admin_trash_router.get("/boards")
async def get_boards_trash(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_admin_user)):
    Dono = aliased(User)
    Quem = aliased(User)
    n_listas = _count(List.id, List.board_id == Board.id, List.deleted_at.is_(None))
    n_cards = (
        select(func.count(Card.id))
        .join(List, List.id == Card.list_id)
        .where(List.board_id == Board.id, List.deleted_at.is_(None), Card.deleted_at.is_(None))
        .correlate(Board).scalar_subquery()
    )
    rows = (await db.execute(
        select(Board, Dono.name, Quem.name, n_listas, n_cards)
        .join(Dono, Dono.id == Board.owner_id)
        .outerjoin(Quem, Quem.id == Board.deleted_by)
        .where(Board.deleted_at.isnot(None))
        .order_by(Board.deleted_at.desc())
    )).all()
    return [
        {"id": b.id, "title": b.title, "color": b.color, "icon": b.icon, "owner_name": dono,
         "deleted_at": b.deleted_at, "deleted_by_name": _nome(quem),
         "lists": nl, "cards": nc}
        for b, dono, quem, nl, nc in rows
    ]


@admin_trash_router.post("/boards/{board_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_board(board_id: int, db: AsyncSession = Depends(get_db),
                        current_user: User = Depends(get_admin_user)):
    board = await _trashed_board_or_404(board_id, db)
    board.deleted_at = None
    board.deleted_by = None
    await db.commit()
    realtime.publish_reload(board_id)


@admin_trash_router.delete("/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def purge_board(board_id: int, db: AsyncSession = Depends(get_db),
                      current_user: User = Depends(get_admin_user)):
    board = await _trashed_board_or_404(board_id, db)
    list_ids = (await db.execute(select(List.id).where(List.board_id == board_id))).scalars().all()
    card_ids = (await db.execute(select(Card.id).where(Card.list_id.in_(list_ids)))).scalars().all() if list_ids else []
    arquivos = await _stored_names(card_ids, db)
    await _clear_card_refs(card_ids, db)
    await db.execute(sql_delete(Notification).where(Notification.board_id == board_id))
    await db.execute(sql_delete(Automation).where(Automation.board_id == board_id))
    await db.delete(board)
    await db.commit()
    _remove_attachment_files(arquivos)
