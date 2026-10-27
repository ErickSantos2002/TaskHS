"""Cadastro de setores (travados por setor, v2.12.0).

Ler é para qualquer autenticado — o drawer do quadro oferece os setores no
seletor de cada lista. Criar/editar é só administrador. Não há exclusão: setor
desativado some do seletor, mas as listas marcadas continuam contando no
Dashboard (spec 2026-10-27-travados-por-setor-design.md).
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.list import List
from app.models.setor import Setor
from app.models.user import User
from app.routers.auth import get_admin_user
from app.schemas.setor import SetorOut, SetorCreate, SetorUpdate

router = APIRouter(prefix="/setores", tags=["setores"])


async def _contagem_listas(db: AsyncSession) -> dict[int, int]:
    return dict((await db.execute(
        select(List.setor_id, func.count(List.id))
        .where(List.setor_id.is_not(None), List.deleted_at.is_(None))
        .group_by(List.setor_id)
    )).all())


async def _out(setor: Setor, db: AsyncSession) -> dict:
    return {"id": setor.id, "nome": setor.nome, "ativo": setor.ativo,
            "listas": (await _contagem_listas(db)).get(setor.id, 0)}


async def _nome_livre(nome: str, db: AsyncSession, exceto: int | None = None) -> None:
    stmt = select(Setor.id).where(func.lower(Setor.nome) == nome.lower())
    if exceto is not None:
        stmt = stmt.where(Setor.id != exceto)
    if (await db.execute(stmt.limit(1))).first() is not None:
        raise HTTPException(status_code=409, detail="Já existe um setor com esse nome")


@router.get("", response_model=list[SetorOut])
async def list_setores(todos: bool = Query(False), db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    stmt = select(Setor).order_by(Setor.nome)
    if not todos:
        stmt = stmt.where(Setor.ativo == True)
    setores = (await db.execute(stmt)).scalars().all()
    contagem = await _contagem_listas(db)
    return [{"id": s.id, "nome": s.nome, "ativo": s.ativo, "listas": contagem.get(s.id, 0)} for s in setores]


@router.post("", response_model=SetorOut, status_code=status.HTTP_201_CREATED)
async def create_setor(body: SetorCreate, db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_admin_user)):
    await _nome_livre(body.nome, db)
    setor = Setor(nome=body.nome, ativo=True)
    db.add(setor)
    await db.commit()
    return await _out(setor, db)


@router.patch("/{setor_id}", response_model=SetorOut)
async def update_setor(setor_id: int, body: SetorUpdate, db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_admin_user)):
    setor = await db.get(Setor, setor_id)
    if setor is None:
        raise HTTPException(status_code=404, detail="Setor não encontrado")
    if body.nome is not None:
        await _nome_livre(body.nome, db, exceto=setor_id)
        setor.nome = body.nome
    if body.ativo is not None:
        setor.ativo = body.ativo
    await db.commit()
    return await _out(setor, db)
