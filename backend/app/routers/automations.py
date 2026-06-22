from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.automation import Automation
from app.models.board import Board
from app.models.list import List
from app.models.user import User
from app.schemas.automation import AutomationCreate, AutomationUpdate, AutomationOut
from app.dependencies import get_current_user

router = APIRouter(prefix="/boards/{board_id}/automations", tags=["automations"])


async def _get_board_or_404(board_id: int, db: AsyncSession) -> Board:
    board = (await db.execute(select(Board).where(Board.id == board_id))).scalar_one_or_none()
    if not board:
        raise HTTPException(status_code=404, detail="Board não encontrado")
    return board


def _require_owner_or_admin(board: Board, user: User) -> None:
    if board.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas o dono ou administrador pode gerenciar automações")


async def _validate_list_in_board(list_id: int, board_id: int, db: AsyncSession) -> None:
    lst = (await db.execute(
        select(List).where(List.id == list_id, List.board_id == board_id)
    )).scalar_one_or_none()
    if not lst:
        raise HTTPException(status_code=400, detail="Lista não pertence a este board")


@router.get("", response_model=list[AutomationOut])
async def list_automations(board_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_board_or_404(board_id, db)
    rows = (await db.execute(
        select(Automation).where(Automation.board_id == board_id).order_by(Automation.id)
    )).scalars().all()
    return rows


@router.post("", response_model=AutomationOut, status_code=status.HTTP_201_CREATED)
async def create_automation(board_id: int, body: AutomationCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    _require_owner_or_admin(board, current_user)
    await _validate_list_in_board(body.trigger_list_id, board_id, db)
    auto = Automation(
        board_id=board_id,
        trigger_type=body.trigger_type,
        trigger_list_id=body.trigger_list_id,
        action_type=body.action_type,
        enabled=body.enabled,
        created_by=current_user.id,
    )
    db.add(auto)
    await db.commit()
    await db.refresh(auto)
    return auto


@router.patch("/{automation_id}", response_model=AutomationOut)
async def update_automation(board_id: int, automation_id: int, body: AutomationUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    _require_owner_or_admin(board, current_user)
    auto = (await db.execute(
        select(Automation).where(Automation.id == automation_id, Automation.board_id == board_id)
    )).scalar_one_or_none()
    if not auto:
        raise HTTPException(status_code=404, detail="Automação não encontrada")
    data = body.model_dump(exclude_none=True)
    if "trigger_list_id" in data:
        await _validate_list_in_board(data["trigger_list_id"], board_id, db)
    for k, v in data.items():
        setattr(auto, k, v)
    await db.commit()
    await db.refresh(auto)
    return auto


@router.delete("/{automation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_automation(board_id: int, automation_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    board = await _get_board_or_404(board_id, db)
    _require_owner_or_admin(board, current_user)
    auto = (await db.execute(
        select(Automation).where(Automation.id == automation_id, Automation.board_id == board_id)
    )).scalar_one_or_none()
    if not auto:
        raise HTTPException(status_code=404, detail="Automação não encontrada")
    await db.delete(auto)
    await db.commit()
