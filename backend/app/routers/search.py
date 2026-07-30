"""Busca global: acha card em qualquer quadro que a pessoa possa ver.

Pedido de Serviços: achar um atendimento pelo número de série do aparelho, que
a integração grava no meio do texto de obs1..obs6 — daí a varredura incluir
essas colunas, e não só título/descrição. Os comentários entraram no mesmo
espírito: muito do que se sabe de um atendimento foi escrito na conversa.

O recorte de acesso é um SUBSELECT no WHERE, nunca um pós-filtro em Python:
card de quadro alheio não chega a ser materializado, então não há como vazar
por descuido de serialização.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, case
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.board import Board, BoardMember
from app.models.card import Card, CardComment
from app.models.list import List as ListModel
from app.models.user import User
from app.schemas.search import SearchResultOut

router = APIRouter(prefix="/search", tags=["search"])

# As duas strings do translate() têm de ter o MESMO comprimento e a mesma
# ordem — é um mapa caractere a caractere. Só minúsculas: o lower() vem antes.
_DE = "áàâãäéèêëíìîïóòôõöúùûüçñ"
_PARA = "aaaaaeeeeiiiiooooouuuucn"
_TRANS = str.maketrans(_DE, _PARA)

TAMANHO_MINIMO_TERMO = 2
CONTEXTO_ANTES = 40
CONTEXTO_DEPOIS = 80


def normalizar(texto: str) -> str:
    """O mesmo que lower() + translate() fazem no SQL, só que em Python.

    Precisa ser o mesmo dos dois lados: é assim que o snippet acha no texto
    original o trecho que o banco casou.
    """
    return texto.lower().translate(_TRANS)


def escapar_like(termo: str) -> str:
    """`%` e `_` são curingas do LIKE.

    Sem escapar, digitar "%" na caixa devolveria o banco inteiro.
    """
    return termo.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def termos_de(q: str) -> list[str]:
    """Quebra a busca em palavras normalizadas, descartando as curtas demais."""
    return [t for t in normalizar(q).split() if len(t) >= TAMANHO_MINIMO_TERMO]


def _comentarios_do_card():
    """Os comentários vivos do card colados num texto só.

    Subquery correlacionada e agregada DE PROPÓSITO, em vez de JOIN: com JOIN,
    um card com três comentários casando viraria três linhas no resultado, e a
    lógica de "todas as palavras" passaria a valer por comentário, não por card
    (buscar "cliente prazo" deixaria de achar o card em que cada palavra está
    num comentário diferente).
    """
    return (
        select(func.coalesce(func.string_agg(CardComment.body, " "), ""))
        .where(CardComment.card_id == Card.id, CardComment.deleted_at.is_(None))
        .correlate(Card)
        .scalar_subquery()
    )


def _feno():
    """title + description + obs1..6 + comentários num texto só, sem acento.

    concat_ws ignora NULL sozinho — não precisa de coalesce em cada coluna.
    """
    juntos = func.concat_ws(
        " ",
        Card.title, Card.description,
        Card.obs1, Card.obs2, Card.obs3, Card.obs4, Card.obs5, Card.obs6,
        _comentarios_do_card(),
    )
    return func.translate(func.lower(juntos), _DE, _PARA)


def montar_snippet(card: Card, termo: str, comentarios: list[str]) -> tuple[str, str]:
    """(trecho, campo) do primeiro campo do card que contém o termo.

    É o que faz a linha do dropdown mostrar "…Série VAM5D0008 / Patr. 8" em vez
    de repetir o título do card. Os comentários vêm por último: quando o termo
    está no card e também numa conversa, o campo do card explica melhor.
    """
    candidatos = [
        ("titulo", card.title),
        ("descricao", card.description),
        ("obs", card.obs1), ("obs", card.obs2), ("obs", card.obs3),
        ("obs", card.obs4), ("obs", card.obs5), ("obs", card.obs6),
        *(("comentario", c) for c in comentarios),
    ]
    for campo, texto in candidatos:
        if not texto:
            continue
        # Quebra de linha vira espaço: a linha do dropdown é uma só.
        limpo = " ".join(texto.split())
        pos = normalizar(limpo).find(termo)
        if pos < 0:
            continue
        ini = max(0, pos - CONTEXTO_ANTES)
        fim = min(len(limpo), pos + len(termo) + CONTEXTO_DEPOIS)
        trecho = limpo[ini:fim]
        if ini > 0:
            trecho = "…" + trecho
        if fim < len(limpo):
            trecho = trecho + "…"
        return trecho, campo
    return card.title, "titulo"


@router.get("", response_model=list[SearchResultOut])
async def search(
    q: str = Query(..., max_length=200),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    termos = termos_de(q)
    if not termos:
        return []

    feno = _feno()
    stmt = (
        select(Card, ListModel.title, ListModel.archived, Board.id, Board.title, Board.color)
        .join(ListModel, ListModel.id == Card.list_id)
        .join(Board, Board.id == ListModel.board_id)
    )

    # Todas as palavras, em qualquer ordem, em qualquer um dos campos.
    # A f-string monta o VALOR do padrão, não SQL: o .like() do SQLAlchemy
    # manda esse valor como parâmetro bindado. Não trocar por texto cru.
    for t in termos:
        stmt = stmt.where(feno.like(f"%{escapar_like(t)}%", escape="\\"))

    # A TRANCA. Elevado (administrador/coordenador) enxerga tudo, como no resto
    # do sistema; o resto só alcança quadro em que tem linha em board_members.
    if not current_user.is_elevated:
        # aliased: sem isto o SQLAlchemy correlaciona o `lists` do subselect com
        # o `lists` do JOIN de fora e o filtro deixa de filtrar.
        LV = aliased(ListModel)
        listas_visiveis = (
            select(LV.id)
            .join(BoardMember, BoardMember.board_id == LV.board_id)
            .where(BoardMember.user_id == current_user.id)
        )
        stmt = stmt.where(Card.list_id.in_(listas_visiveis))

    # Casou no título primeiro; depois, o mexido mais recentemente.
    titulo = func.translate(func.lower(Card.title), _DE, _PARA)
    casou_titulo = case(
        (titulo.like(f"%{escapar_like(termos[0])}%", escape="\\"), 0),
        else_=1,
    )
    stmt = stmt.order_by(casou_titulo, Card.updated_at.desc()).limit(limit)

    linhas = (await db.execute(stmt)).all()

    # Os comentários dos cards que sobraram, numa consulta só — o snippet
    # precisa do texto original para recortar o trecho, e o string_agg da query
    # de cima serve para casar, não para exibir.
    comentarios: dict[int, list[str]] = {}
    ids = [linha[0].id for linha in linhas]
    if ids:
        q_comentarios = (
            select(CardComment.card_id, CardComment.body)
            .where(CardComment.card_id.in_(ids), CardComment.deleted_at.is_(None))
            .order_by(CardComment.created_at)
        )
        for card_id, body in (await db.execute(q_comentarios)).all():
            comentarios.setdefault(card_id, []).append(body)

    resultados: list[SearchResultOut] = []
    for card, list_title, list_archived, board_id, board_title, board_color in linhas:
        snippet, campo = montar_snippet(card, termos[0], comentarios.get(card.id, []))
        resultados.append(SearchResultOut(
            card_id=card.id,
            list_id=card.list_id,
            board_id=board_id,
            board_title=board_title,
            board_color=board_color,
            list_title=list_title,
            title=card.title,
            priority=card.priority.value,
            due_date=card.due_date,
            # Card em lista arquivada também sumiu da cara do quadro: o front
            # precisa tratar os dois casos igual na hora de abrir.
            archived=card.archived or list_archived,
            snippet=snippet,
            matched_field=campo,
        ))
    return resultados
