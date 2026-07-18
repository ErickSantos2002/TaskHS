from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.core.security import decode_token
from app.models.user import User
from app.models.board import BoardMember
from app.models.list import List as ListModel
from app.audit_context import set_actor_identity

bearer = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials
    email = decode_token(token)
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")
    result = await db.execute(select(User).where(User.email == email, User.is_active == True))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário não encontrado")
    set_actor_identity("usuario", user.id, user.name, user.email)
    return user


async def require_integration_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    from app.core.config import settings
    if not settings.INTEGRATION_API_KEY or x_api_key != settings.INTEGRATION_API_KEY:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key inválida")
    set_actor_identity("integracao", None, "integração", None)


async def require_board_access_by_board_id(
    board_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Tranca dos routers cujo prefixo tem {board_id}.

    Elevado (administrador/coordenador) entra em qualquer quadro — decisão de
    produto registrada na spec: coordenador é o papel de qualidade e ver todos
    os fluxos internos é a função dele.
    """
    if current_user.is_elevated:
        return current_user
    q = await db.execute(
        select(BoardMember.id).where(
            BoardMember.board_id == board_id,
            BoardMember.user_id == current_user.id,
        ).limit(1)
    )
    if q.scalars().first() is None:
        raise HTTPException(status_code=403, detail="Você não é membro deste quadro")
    return current_user


async def user_can_access_board(board_id: int, user: User, db: AsyncSession) -> bool:
    if user.is_elevated:
        return True
    q = await db.execute(
        select(BoardMember.id).where(
            BoardMember.board_id == board_id,
            BoardMember.user_id == user.id,
        ).limit(1)
    )
    return q.scalars().first() is not None


async def user_can_access_list(list_id: int, user: User, db: AsyncSession) -> bool:
    """A regra crua: esta pessoa alcança o quadro desta lista?

    Elevado (administrador/coordenador) alcança qualquer um. Lista inexistente
    devolve False para não-elevado — o JOIN não acha nada — o que é o que
    queremos: não revelar a existência de listas de quadros alheios.
    """
    if user.is_elevated:
        return True
    q = await db.execute(
        select(BoardMember.id)
        .join(ListModel, ListModel.board_id == BoardMember.board_id)
        .where(ListModel.id == list_id, BoardMember.user_id == user.id)
        .limit(1)
    )
    return q.scalars().first() is not None


async def assert_board_access_by_list_id(list_id: int, user: User, db: AsyncSession) -> None:
    """A mesma tranca, para chamar DENTRO de um endpoint.

    Existe porque alguns endpoints recebem a lista de destino no CORPO da
    requisição, e a dependency de router só valida o que está na URL.
    """
    if not await user_can_access_list(list_id, user, db):
        raise HTTPException(status_code=403, detail="Você não é membro deste quadro")


async def require_board_access_by_list_id(
    list_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Tranca dos routers cujo prefixo tem {list_id}."""
    await assert_board_access_by_list_id(list_id, current_user, db)
    return current_user
