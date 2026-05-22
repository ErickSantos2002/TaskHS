from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.models.list import List
from app.models.card import Card
from app.models.user import User
from app.schemas.list import ListCreate, ListUpdate, ListOut
from app.dependencies import get_current_user

router = APIRouter(prefix="/boards/{board_id}/lists", tags=["lists"])


async def _get_list_or_404(list_id: int, board_id: int, db: AsyncSession) -> List:
    result = await db.execute(select(List).where(List.id == list_id, List.board_id == board_id))
    lst = result.scalar_one_or_none()
    if not lst:
        raise HTTPException(status_code=404, detail="Lista não encontrada")
    return lst


@router.post("", response_model=ListOut, status_code=status.HTTP_201_CREATED)
async def create_list(board_id: int, body: ListCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    lst = List(**body.model_dump(), board_id=board_id)
    db.add(lst)
    await db.commit()
    await db.refresh(lst)
    return lst


@router.get("", response_model=list[ListOut])
async def get_lists(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(List).where(List.board_id == board_id, List.archived == False).order_by(List.position))
    return result.scalars().all()


@router.patch("/{list_id}", response_model=ListOut)
async def update_list(board_id: int, list_id: int, body: ListUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    lst = await _get_list_or_404(list_id, board_id, db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(lst, field, value)
    await db.commit()
    await db.refresh(lst)
    return lst


@router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_list(board_id: int, list_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    lst = await _get_list_or_404(list_id, board_id, db)
    await db.delete(lst)
    await db.commit()


@router.post("/{list_id}/archive", response_model=ListOut)
async def archive_list(board_id: int, list_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    lst = await _get_list_or_404(list_id, board_id, db)
    lst.archived = True
    await db.commit()
    await db.refresh(lst)
    return lst


@router.post("/{list_id}/restore", response_model=ListOut)
async def restore_list(board_id: int, list_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(List).where(List.id == list_id, List.board_id == board_id))
    lst = result.scalar_one_or_none()
    if not lst:
        raise HTTPException(status_code=404, detail="Lista não encontrada")
    lst.archived = False
    await db.commit()
    await db.refresh(lst)
    return lst
