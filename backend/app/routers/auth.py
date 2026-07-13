from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.user import User, Role
from app.schemas.user import UserCreate, UserOut, TokenOut, LoginIn, UserAdminCreate, UserAdminUpdate
from app.core.security import hash_password, verify_password, create_access_token
from app.dependencies import get_current_user
from app.models.audit import AuditLog
from app.audit_context import get_actor


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
            actor_name=(user.name if user else body.email), actor_email=body.email,
            action="login_falhou", entity_type="sessao", entity_id=(user.id if user else None),
            entity_label=body.email, summary=f"tentativa de login falhou ({body.email})",
            ip=actor.ip, path=actor.path,
        ))
        await db.commit()
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    db.add(AuditLog(
        actor_type="usuario", actor_user_id=user.id, actor_name=user.name, actor_email=user.email,
        action="login", entity_type="sessao", entity_id=user.id, entity_label=user.email,
        summary=f'"{user.name}" entrou no sistema', ip=actor.ip, path=actor.path,
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
