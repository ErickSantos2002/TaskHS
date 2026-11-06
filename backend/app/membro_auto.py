"""Membro automático do card (v2.14.0).

Quem mexe no CONTEÚDO de um card vira membro dele: cria, edita título/descrição/
data/prioridade/conclusão, comenta, anexa, mexe em checklist ou etiqueta. Mover,
reordenar, arquivar e lixeira NÃO contam — são gestos de quem organiza o quadro.

Chamado pelos endpoints ANTES do commit, na mesma transação. Grava pelo ORM de
propósito: o audit.py registra "membro_card / criar" com o ator e o SSE propaga
para a tela. Bulk insert passaria por fora dos dois.
"""
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.board import BoardMember
from app.models.card import Card, CardMember
from app.models.list import List

# Campos do card cuja mudança conta como "mexeu". position/list_id (mover) ficam de
# fora. O backfill (scripts/backfill_membros_card.py) usa a mesma tupla.
CAMPOS_CONTEUDO = ("title", "description", "priority", "due_date", "due_date_completed", "done")


async def garantir_membro_card(
    db: AsyncSession, card_id: int, user_id: int, board_id: int | None = None,
) -> bool:
    """Coloca o usuário como membro do card, se ainda não for. True se criou.

    Só vale para membro do quadro — a mesma invariante do add_card_member, da qual
    dependem as notificações e o loop de lembretes. Elevado de fora do quadro
    continua podendo mexer, só não vira membro.

    Nunca derruba a ação principal: a corrida no unique card_members_card_user_uniq
    cai num savepoint e é engolida.
    """
    if board_id is None:
        board_id = (await db.execute(
            select(List.board_id).join(Card, Card.list_id == List.id).where(Card.id == card_id)
        )).scalar_one_or_none()
        if board_id is None:
            return False

    eh_do_quadro = (await db.execute(
        select(BoardMember.id)
        .where(BoardMember.board_id == board_id, BoardMember.user_id == user_id)
        .limit(1)
    )).scalars().first() is not None
    if not eh_do_quadro:
        return False

    ja = (await db.execute(
        select(CardMember.id)
        .where(CardMember.card_id == card_id, CardMember.user_id == user_id)
        .limit(1)
    )).scalars().first()
    if ja is not None:
        return False

    # Descarrega o que já está pendente (o comentário, o anexo...) ANTES do savepoint:
    # se o savepoint voltar atrás, só pode levar junto o CardMember — nunca a ação
    # principal que entrou no mesmo flush.
    await db.flush()
    try:
        async with db.begin_nested():
            db.add(CardMember(card_id=card_id, user_id=user_id))
            await db.flush()
    except IntegrityError:
        return False
    return True
