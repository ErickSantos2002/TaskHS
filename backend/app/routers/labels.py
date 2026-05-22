from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.models.board import BoardLabel
from app.models.user import User
from app.dependencies import get_current_user

router = APIRouter(prefix="/boards/{board_id}/labels", tags=["labels"])


class BoardLabelCreate(BaseModel):
    name: str
    color: str = "#0ea5e9"


class BoardLabelUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


class BoardLabelOut(BaseModel):
    id: int
    board_id: int
    name: str
    color: str
    model_config = {"from_attributes": True}


@router.get("", response_model=list[BoardLabelOut])
async def get_labels(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(BoardLabel).where(BoardLabel.board_id == board_id).order_by(BoardLabel.id))
    return result.scalars().all()


@router.post("", response_model=BoardLabelOut, status_code=status.HTTP_201_CREATED)
async def create_label(board_id: int, body: BoardLabelCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    label = BoardLabel(board_id=board_id, name=body.name, color=body.color)
    db.add(label)
    await db.commit()
    await db.refresh(label)
    return label


@router.patch("/{label_id}", response_model=BoardLabelOut)
async def update_label(board_id: int, label_id: int, body: BoardLabelUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(BoardLabel).where(BoardLabel.id == label_id, BoardLabel.board_id == board_id))
    label = result.scalar_one_or_none()
    if not label:
        raise HTTPException(status_code=404, detail="Etiqueta não encontrada")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(label, field, value)
    await db.commit()
    await db.refresh(label)
    return label


@router.delete("/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_label(board_id: int, label_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(BoardLabel).where(BoardLabel.id == label_id, BoardLabel.board_id == board_id))
    label = result.scalar_one_or_none()
    if label:
        await db.delete(label)
        await db.commit()
