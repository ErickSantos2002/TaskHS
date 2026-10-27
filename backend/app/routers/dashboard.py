"""Dashboard: indicadores de um quadro (ou de todos) e o alerta de 72 h úteis.

O alerta é da Qualidade: card criado há mais de 72 horas úteis (ver
app/horas_uteis.py) que ainda não chegou numa lista "de concluído" do quadro
(`List.is_done`, marcada no drawer). Quadro sem lista marcada conta tudo.

`Card.done` (a caixinha "concluído" do card) e `due_date_completed` NÃO tiram o
card do alerta, de propósito: na operação a caixinha tem outro significado.
Só a lista onde o card está decide.

Rankings (v2.11.0): "movimentar" é MOVER o card de lista, feito por uma pessoa
— `audit_log` com entity_type='card', action='mover', actor_type='usuario'. A
integração fica de fora. Os rankings de "mais cards" são a foto de agora; os de
movimento dependem do período (dias corridos, no horário de Brasília).

Travados por setor (v2.12.0): segunda régua, por lista — card há mais de 24 h
úteis (`LIMITE_HORAS_LISTA`) na lista atual (`Card.list_entered_at`), numa lista
com setor (`List.setor_id`) e fora das listas de concluído. Somado por setor,
para a Qualidade ver onde o processo trava. Ver spec
2026-10-27-travados-por-setor-design.md.

Fora dos chokepoints da lixeira: toda query aqui filtra `deleted_at IS NULL` em
card, lista e quadro à mão.
"""
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, user_can_access_board
from app.horas_uteis import horas_uteis, LIMITE_HORAS, LIMITE_HORAS_LISTA, TZ_BR
from app.models.audit import AuditLog
from app.models.board import Board, BoardMember
from app.models.card import Card, CardMember
from app.models.list import List
from app.models.setor import Setor
from app.models.user import User
from app.schemas.dashboard import DashboardOut

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

PERIODOS = (7, 30, 90)
TOP = 8


def _top(contagem: dict[int, int], nomes: dict[int, str]) -> list[int]:
    """Ids dos TOP maiores, empate desempatado pelo nome."""
    return sorted(contagem, key=lambda i: (-contagem[i], nomes.get(i, "")))[:TOP]


async def _quadros_visiveis(user: User, db: AsyncSession) -> list[int]:
    """Mesmo recorte de /boards/stats e de can_open: elevado vê todos. Arquivado não conta."""
    stmt = select(Board.id).where(Board.deleted_at.is_(None), Board.archived_at.is_(None))
    if not user.is_elevated:
        stmt = stmt.join(BoardMember, BoardMember.board_id == Board.id).where(BoardMember.user_id == user.id)
    return list((await db.execute(stmt)).scalars().all())


@router.get("", response_model=DashboardOut)
async def get_dashboard(
    board_id: int | None = Query(None),
    periodo: int = Query(30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if periodo not in PERIODOS:
        raise HTTPException(status_code=422, detail="Período deve ser 7, 30 ou 90 dias")
    if board_id is not None:
        arquivado = (await db.execute(
            select(Board.archived_at).where(Board.id == board_id)
        )).scalar_one_or_none() is not None
        # Arquivado não tem painel: para o Dashboard é como se não existisse.
        if arquivado or not await user_can_access_board(board_id, current_user, db):
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
        select(List.id, List.title, List.is_done, List.setor_id)
        .join(Board, Board.id == List.board_id)
        .where(*lista_viva, Board.deleted_at.is_(None), List.archived == False)
        .order_by(List.board_id, List.position)
    )).all()

    ativos = (await db.execute(
        select(
            Card.id, Card.title, Card.list_id, Card.created_at, Card.list_entered_at,
            List.title, List.is_done, List.setor_id, Board.id, Board.title,
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

    agora = datetime.now(TZ_BR)
    total_por_lista: dict[int, int] = {}
    atrasados_por_lista: dict[int, int] = {}
    cards_por_quadro: dict[int, int] = {}
    nome_quadro: dict[int, str] = {}
    atrasados = []
    travados_setor = []
    em_concluido = 0
    for (card_id, title, list_id, created_at, entrou_na_lista,
         list_title, list_done, setor_id, b_id, b_title) in ativos:
        total_por_lista[list_id] = total_por_lista.get(list_id, 0) + 1
        cards_por_quadro[b_id] = cards_por_quadro.get(b_id, 0) + 1
        nome_quadro[b_id] = b_title
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
        if setor_id is not None:
            horas_lista = horas_uteis(entrou_na_lista, agora)
            if horas_lista > LIMITE_HORAS_LISTA:
                travados_setor.append({
                    "card_id": card_id, "list_id": list_id, "board_id": b_id,
                    "board_title": b_title, "list_title": list_title, "title": title,
                    "setor_id": setor_id, "list_entered_at": entrou_na_lista,
                    "horas_uteis": round(horas_lista, 1),
                })
    travados_setor.sort(key=lambda t: -t["horas_uteis"])

    # Setores do recorte: os que têm ao menos uma lista contável (ativa e fora
    # de concluído) — assim "Financeiro 0" aparece, e setor sem lista aqui não.
    setores_no_recorte = {setor for _, _, done, setor in listas if setor is not None and not done}
    nome_setor = dict((await db.execute(
        select(Setor.id, Setor.nome).where(Setor.id.in_(setores_no_recorte))
    )).all()) if setores_no_recorte else {}
    travados_por_setor = dict.fromkeys(nome_setor, 0)
    for t in travados_setor:
        travados_por_setor[t["setor_id"]] = travados_por_setor.get(t["setor_id"], 0) + 1

    # ── Movimentos no período: dias corridos inteiros, terminando hoje ──
    hoje = agora.date()
    dias = [hoje - timedelta(days=i) for i in range(periodo - 1, -1, -1)]
    desde = datetime.combine(dias[0], time.min, tzinfo=TZ_BR)
    movimentos = (await db.execute(
        select(AuditLog.board_id, AuditLog.actor_user_id, AuditLog.created_at).where(
            AuditLog.entity_type == "card", AuditLog.action == "mover",
            AuditLog.actor_type == "usuario", AuditLog.created_at >= desde,
            # Pelo quadro do evento: card que depois foi pra lixeira ainda conta.
            AuditLog.board_id.in_(board_ids),
        )
    )).all()
    por_dia = dict.fromkeys(dias, 0)
    mov_quadro: dict[int, int] = {}
    mov_pessoa: dict[int, int] = {}
    for b_id, user_id, quando in movimentos:
        dia = quando.astimezone(TZ_BR).date()
        if dia in por_dia:
            por_dia[dia] += 1
        mov_quadro[b_id] = mov_quadro.get(b_id, 0) + 1
        if user_id is not None:
            mov_pessoa[user_id] = mov_pessoa.get(user_id, 0) + 1

    # ── Pessoas com mais cards: membro de card ativo (foto de agora) ──
    cards_pessoa = dict((await db.execute(
        select(CardMember.user_id, func.count(CardMember.id))
        .join(Card, Card.id == CardMember.card_id)
        .join(List, List.id == Card.list_id)
        .join(Board, Board.id == List.board_id)
        .where(
            Card.deleted_at.is_(None), *lista_viva, Board.deleted_at.is_(None),
            Card.archived == False, List.archived == False,
        )
        .group_by(CardMember.user_id)
    )).all())

    pessoas = {
        u.id: u for u in (await db.execute(
            select(User).where(User.id.in_(set(mov_pessoa) | set(cards_pessoa)))
        )).scalars().all()
    }
    if mov_quadro:
        nome_quadro |= dict((await db.execute(
            select(Board.id, Board.title).where(Board.id.in_(mov_quadro))
        )).all())
    cor_quadro = dict((await db.execute(
        select(Board.id, Board.color).where(Board.id.in_(set(mov_quadro) | set(cards_por_quadro)))
    )).all())
    nome_pessoa = {i: u.name for i, u in pessoas.items()}

    def ranking_quadros(contagem: dict[int, int]) -> list[dict]:
        # Rankings de QUADRO só fazem sentido na visão de todos os quadros.
        if board_id is not None:
            return []
        return [{"id": i, "nome": nome_quadro.get(i, ""), "color": cor_quadro.get(i), "total": contagem[i]}
                for i in _top(contagem, nome_quadro)]

    def ranking_pessoas(contagem: dict[int, int]) -> list[dict]:
        # Usuário apagado some do ranking (não há nome para mostrar).
        contagem = {i: n for i, n in contagem.items() if i in pessoas}
        return [{"id": i, "nome": pessoas[i].name, "initials": pessoas[i].initials,
                 "avatar_url": pessoas[i].avatar_url, "total": contagem[i]}
                for i in _top(contagem, nome_pessoa)]

    return {
        "board_id": board_id,
        "periodo": periodo,
        "movimentos_por_dia": [{"dia": d, "total": n} for d, n in por_dia.items()],
        "quadros_mais_movimentados": ranking_quadros(mov_quadro),
        "quadros_com_mais_cards": ranking_quadros(cards_por_quadro),
        "pessoas_que_mais_movimentam": ranking_pessoas(mov_pessoa),
        "pessoas_com_mais_cards": ranking_pessoas(cards_pessoa),
        "kpis": {
            "cards_ativos": len(ativos),
            "listas": len(listas),
            "arquivados": arquivados,
            "em_concluido": em_concluido,
            "atrasados": len(atrasados),
        },
        # O gráfico por lista só faz sentido dentro de um quadro.
        "listas": [] if board_id is None else [
            {"id": l_id, "title": l_title, "is_done": l_done,
             "total": total_por_lista.get(l_id, 0), "atrasados": atrasados_por_lista.get(l_id, 0)}
            for l_id, l_title, l_done, _ in listas
        ],
        "atrasados": atrasados,
        "travados_por_setor": sorted(
            ({"setor_id": i, "nome": nome_setor.get(i, ""), "total": n} for i, n in travados_por_setor.items()),
            key=lambda x: (-x["total"], x["nome"]),
        ),
        "travados_setor": travados_setor,
    }
