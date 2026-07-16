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
        )
    )
    if q.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="Você não é membro deste quadro")
    return current_user


async def require_board_access_by_list_id(
    list_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Mesma tranca, para routers cujo prefixo tem {list_id} e não {board_id}.

    Resolve lista -> quadro no próprio JOIN. Lista inexistente cai em 403 (e não
    404) para não revelar a existência de listas de quadros alheios; para o
    usuário elevado, o gate passa e o endpoint devolve o 404 normal.
    """
    if current_user.is_elevated:
        return current_user
    q = await db.execute(
        select(BoardMember.id)
        .join(ListModel, ListModel.board_id == BoardMember.board_id)
        .where(ListModel.id == list_id, BoardMember.user_id == current_user.id)
    )
    if q.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="Você não é membro deste quadro")
    return current_user
