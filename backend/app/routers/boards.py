from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models.board import Board, BoardMember, BoardRole
from app.models.user import User
from app.schemas.board import BoardCreate, BoardUpdate, BoardOut, BoardMemberAdd
from app.dependencies import get_current_user

router = APIRouter(prefix="/boards", tags=["boards"])


async def _get_board_or_404(board_id: int, db: AsyncSession) -> Board:
    result = await db.execute(select(Board).where(Board.id == board_id))
    board = result.scalar_one_or_none()
    if not board:
        raise HTTPException(status_code=404, detail="Board não encontrado")
    return board


@router.post("", response_model=BoardOut, status_code=status.HTTP_201_CREATED)
async def create_board(body: BoardCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = Board(**body.model_dump(), owner_id=current_user.id)
    db.add(board)
    await db.flush()
    db.add(BoardMember(board_id=board.id, user_id=current_user.id, role=BoardRole.owner))
    await db.commit()
    await db.refresh(board)
    return board


@router.get("", response_model=list[BoardOut])
async def list_boards(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Board)
        .join(BoardMember, BoardMember.board_id == Board.id)
        .where(BoardMember.user_id == current_user.id)
        .order_by(Board.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{board_id}", response_model=BoardOut)
async def get_board(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    return await _get_board_or_404(board_id, db)


@router.patch("/{board_id}", response_model=BoardOut)
async def update_board(board_id: int, body: BoardUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(board, field, value)
    await db.commit()
    await db.refresh(board)
    return board


@router.delete("/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    if board.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Apenas o dono pode excluir o board")
    await db.delete(board)
    await db.commit()


@router.post("/{board_id}/members", status_code=status.HTTP_201_CREATED)
async def add_member(board_id: int, body: BoardMemberAdd, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    member = BoardMember(board_id=board.id, user_id=body.user_id, role=body.role)
    db.add(member)
    await db.commit()
    return {"ok": True}
