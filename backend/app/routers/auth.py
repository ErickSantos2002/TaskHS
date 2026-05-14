from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update as sql_update, delete as sql_delete
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserOut, TokenOut, LoginIn, UserAdminCreate, UserAdminUpdate
from app.core.security import hash_password, verify_password, create_access_token
from app.dependencies import get_current_user


async def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
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
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    token = create_access_token(user.email)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/users", response_model=list[UserOut])
async def list_users(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(User).order_by(User.name))
    return result.scalars().all()


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def admin_create_user(body: UserAdminCreate, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email já cadastrado")
    user = User(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        initials=body.initials[:4].upper(),
        is_admin=body.is_admin,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
async def admin_update_user(user_id: int, body: UserAdminUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_admin_user)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    await db.execute(sql_update(User).where(User.id == user_id).values(is_admin=body.is_admin).execution_options(synchronize_session=False))
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_user(user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_admin_user)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Não é possível excluir sua própria conta")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    await db.execute(sql_delete(User).where(User.id == user_id))
    await db.commit()
