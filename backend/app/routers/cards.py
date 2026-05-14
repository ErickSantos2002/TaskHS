from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models.card import Card, CardComment, CardMember
from app.models.user import User
from app.schemas.card import CardCreate, CardUpdate, CardOut, CommentCreate, CommentOut
from app.dependencies import get_current_user

router = APIRouter(prefix="/lists/{list_id}/cards", tags=["cards"])


def _card_options():
    return [
        selectinload(Card.labels),
        selectinload(Card.members).selectinload(CardMember.user),
        selectinload(Card.comments).selectinload(CardComment.author),
        selectinload(Card.attachments),
    ]


async def _get_card_or_404(card_id: int, list_id: int, db: AsyncSession) -> Card:
    result = await db.execute(
        select(Card).where(Card.id == card_id, Card.list_id == list_id).options(*_card_options())
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card não encontrado")
    return card


@router.post("", response_model=CardOut, status_code=status.HTTP_201_CREATED)
async def create_card(list_id: int, body: CardCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = Card(**body.model_dump(), list_id=list_id)
    db.add(card)
    await db.commit()
    result = await db.execute(select(Card).where(Card.id == card.id).options(*_card_options()))
    return result.scalar_one()


@router.get("", response_model=list[CardOut])
async def get_cards(list_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Card).where(Card.list_id == list_id).order_by(Card.position).options(*_card_options())
    )
    return result.scalars().all()


@router.get("/{card_id}", response_model=CardOut)
async def get_card(list_id: int, card_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    return await _get_card_or_404(card_id, list_id, db)


@router.patch("/{card_id}", response_model=CardOut)
async def update_card(list_id: int, card_id: int, body: CardUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = await _get_card_or_404(card_id, list_id, db)
    data = body.model_dump(exclude_none=True)
    if "list_id" in data:
        card.list_id = data.pop("list_id")
    for field, value in data.items():
        setattr(card, field, value)
    await db.commit()
    result = await db.execute(select(Card).where(Card.id == card.id).options(*_card_options()))
    return result.scalar_one()


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(list_id: int, card_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = await _get_card_or_404(card_id, list_id, db)
    await db.delete(card)
    await db.commit()


@router.post("/{card_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def add_comment(list_id: int, card_id: int, body: CommentCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_card_or_404(card_id, list_id, db)
    comment = CardComment(card_id=card_id, author_id=current_user.id, body=body.body)
    db.add(comment)
    await db.commit()
    result = await db.execute(
        select(CardComment).where(CardComment.id == comment.id).options(selectinload(CardComment.author))
    )
    return result.scalar_one()


@router.post("/{card_id}/members/{user_id}", status_code=status.HTTP_201_CREATED)
async def add_card_member(list_id: int, card_id: int, user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_card_or_404(card_id, list_id, db)
    db.add(CardMember(card_id=card_id, user_id=user_id))
    await db.commit()
    return {"ok": True}


@router.delete("/{card_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_card_member(list_id: int, card_id: int, user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(CardMember).where(CardMember.card_id == card_id, CardMember.user_id == user_id))
    member = result.scalar_one_or_none()
    if member:
        await db.delete(member)
        await db.commit()
