import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.user import User, Role
from app.schemas.user import UserCreate, UserOut, TokenOut, LoginIn, UserAdminCreate, UserAdminUpdate
from app.core.security import hash_password, verify_password, create_access_token, decode_token
from app.core.config import settings
from app.core import sso_tickets
from app.services import microsoft_auth
from app.dependencies import get_current_user
from app.models.audit import AuditLog
from app.audit_context import get_actor

logger = logging.getLogger("audit")


async def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return current_user


async def get_elevated_user(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_elevated:
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores e coordenadores")
    return current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(body: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email já cadastrado")
    user = User(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        initials=body.initials[:4].upper(),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token(user.email)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    actor = get_actor()
    if not user or not verify_password(body.password, user.password_hash):
        db.add(AuditLog(
            actor_type="usuario", actor_user_id=(user.id if user else None),
            actor_name=(user.name if user else body.email)[:120], actor_email=body.email[:255],
            action="login_falhou", entity_type="sessao", entity_id=(user.id if user else None),
            entity_label=body.email[:255], summary=f"tentativa de login falhou ({body.email})",
            ip=(actor.ip[:45] if actor.ip else None), path=(actor.path[:255] if actor.path else None),
        ))
        await db.commit()
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    db.add(AuditLog(
        actor_type="usuario", actor_user_id=user.id, actor_name=user.name[:120], actor_email=user.email[:255],
        action="login", entity_type="sessao", entity_id=user.id, entity_label=user.email[:255],
        summary=f'"{user.name}" entrou no sistema', ip=(actor.ip[:45] if actor.ip else None), path=(actor.path[:255] if actor.path else None),
    ))
    await db.commit()
    token = create_access_token(user.email)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/users", response_model=list[UserOut])
async def list_users(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_elevated_user)):
    result = await db.execute(select(User).order_by(User.name))
    return result.scalars().all()


class UserBasicOut(BaseModel):
    """Lista de pessoas para os seletores (membros de card, membros de quadro).

    Enxuta de propósito: só o necessário para escolher alguém. O /auth/users
    continua restrito a administrador/coordenador porque devolve dados de
    gestão (papel, ativo, data de criação).
    """
    id: int
    name: str
    initials: str

    model_config = {"from_attributes": True}


@router.get("/users/basic", response_model=list[UserBasicOut])
async def list_users_basic(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(User).where(User.is_active == True).order_by(User.name))
    return result.scalars().all()


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def admin_create_user(body: UserAdminCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_elevated_user)):
    if current_user.role != Role.administrador and body.role == Role.administrador:
        raise HTTPException(status_code=403, detail="Apenas administradores podem criar administradores")
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email já cadastrado")
    user = User(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        initials=body.initials[:4].upper(),
        role=body.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
async def admin_update_user(user_id: int, body: UserAdminUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_elevated_user)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if current_user.role != Role.administrador and (user.role == Role.administrador or body.role == Role.administrador):
        raise HTTPException(status_code=403, detail="Apenas administradores podem gerenciar administradores")
    user.role = body.role
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_user(user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_elevated_user)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Não é possível excluir sua própria conta")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if user.role == Role.administrador and current_user.role != Role.administrador:
        raise HTTPException(status_code=403, detail="Apenas administradores podem excluir administradores")
    await db.delete(user)
    await db.commit()


class SsoExchangeIn(BaseModel):
    ticket: str


def _erro_login(motivo: str) -> RedirectResponse:
    """Devolve o navegador para o /login do front com o motivo na query."""
    return RedirectResponse(url=f"{settings.FRONTEND_URL.rstrip('/')}/login?erro={motivo}", status_code=302)


@router.get("/sso/status")
async def sso_status():
    """Diz ao front se deve mostrar o botão 'Entrar com Microsoft'."""
    return {"enabled": settings.sso_enabled}


@router.get("/microsoft")
async def microsoft_login():
    if not settings.sso_enabled:
        raise HTTPException(status_code=503, detail="Login com Microsoft não está configurado")
    # msal é bloqueante: fora do event loop, senão trava os SSE abertos.
    url = await asyncio.to_thread(microsoft_auth.get_authorization_url)
    return RedirectResponse(url=url, status_code=302)


@router.get("/microsoft/callback")
async def microsoft_callback(
    code: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    if not settings.sso_enabled:
        raise HTTPException(status_code=503, detail="Login com Microsoft não está configurado")
    if error or not code:
        return _erro_login("falha_microsoft")

    try:
        ms_token = await asyncio.to_thread(microsoft_auth.exchange_code_for_token, code)
        email = await microsoft_auth.get_user_email(ms_token)
    except Exception as e:
        logger.warning("SSO Microsoft: falha ao autenticar (%s)", type(e).__name__)
        return _erro_login("falha_microsoft")

    if not email:
        return _erro_login("falha_microsoft")

    resultado = await db.execute(select(User).where(User.email == email))
    user = resultado.scalar_one_or_none()
    actor = get_actor()
    ip = actor.ip[:45] if actor.ip else None
    path = actor.path[:255] if actor.path else None

    if not user or not user.is_active:
        motivo = "usuario_nao_encontrado" if not user else "usuario_inativo"
        db.add(AuditLog(
            actor_type="usuario", actor_user_id=(user.id if user else None),
            actor_name=(user.name if user else email)[:120], actor_email=email[:255],
            action="login_falhou", entity_type="sessao", entity_id=(user.id if user else None),
            entity_label=email[:255],
            summary=f"login via Microsoft recusado ({motivo}): {email}",
            ip=ip, path=path,
        ))
        await db.commit()
        return _erro_login(motivo)

    db.add(AuditLog(
        actor_type="usuario", actor_user_id=user.id, actor_name=user.name[:120],
        actor_email=user.email[:255], action="login", entity_type="sessao",
        entity_id=user.id, entity_label=user.email[:255],
        summary=f'"{user.name}" entrou no sistema via Microsoft',
        ip=ip, path=path,
    ))
    await db.commit()

    ticket = sso_tickets.issue(create_access_token(user.email))
    return RedirectResponse(
        url=f"{settings.FRONTEND_URL.rstrip('/')}/auth/callback?ticket={ticket}",
        status_code=302,
    )


@router.post("/sso/exchange", response_model=TokenOut)
async def sso_exchange(body: SsoExchangeIn, db: AsyncSession = Depends(get_db)):
    """Troca o ticket de uso único pelo JWT. 400 (não 401) de propósito:
    o cliente HTTP do front trata 401 como sessão expirada e redireciona
    sem mensagem — aqui queremos que a tela de callback explique."""
    token = sso_tickets.redeem(body.ticket)
    email = decode_token(token) if token else None
    if not email:
        raise HTTPException(status_code=400, detail="Ticket inválido ou expirado")

    resultado = await db.execute(select(User).where(User.email == email))
    user = resultado.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="Ticket inválido ou expirado")

    return TokenOut(access_token=token, user=UserOut.model_validate(user))
