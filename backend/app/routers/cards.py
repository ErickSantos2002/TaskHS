from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from app.database import get_db
from app.models.card import Card, CardComment, CardMember, CardLabel, Checklist, ChecklistItem
from app.models.board import BoardLabel
from app.models.list import List
from app.models.notification import Notification
from app.models.user import User
from app.schemas.card import (
    CardCreate, CardUpdate, CardOut, CommentCreate, CommentOut,
    ChecklistCreate, ChecklistOut, ChecklistItemCreate, ChecklistItemUpdate, ChecklistItemOut,
)
from app.dependencies import get_current_user


class CardCopyBody(BaseModel):
    title: str | None = None
    target_list_id: int | None = None

router = APIRouter(prefix="/lists/{list_id}/cards", tags=["cards"])


def _card_options():
    return [
        selectinload(Card.labels).selectinload(CardLabel.board_label),
        selectinload(Card.members).selectinload(CardMember.user),
        selectinload(Card.comments).selectinload(CardComment.author),
        selectinload(Card.attachments),
        selectinload(Card.checklists).selectinload(Checklist.items),
    ]


def _to_list(v) -> list:
    if not v:
        return []
    if isinstance(v, list):
        return v
    try:
        return list(v)
    except TypeError:
        return [v]


def _card_to_dict(card: Card) -> dict:
    return {
        "id": card.id,
        "list_id": card.list_id,
        "title": card.title,
        "description": card.description,
        "priority": card.priority,
        "position": card.position,
        "due_date": card.due_date,
        "due_date_completed": card.due_date_completed,
        "archived": card.archived,
        "created_at": card.created_at,
        "updated_at": card.updated_at,
        "labels": [
            {"id": m.board_label.id, "label": m.board_label.name, "color": m.board_label.color}
            for m in _to_list(card.labels) if m.board_label is not None
        ],
        "members": [m.user for m in _to_list(card.members) if m.user is not None],
        "comments": _to_list(card.comments),
        "attachments": _to_list(card.attachments),
        "checklists": _to_list(card.checklists),
    }


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
    last = await db.execute(select(Card.position).where(Card.list_id == list_id).order_by(Card.position.desc()).limit(1))
    last_pos = last.scalar_one_or_none() or 0.0
    card = Card(**body.model_dump(), list_id=list_id, position=last_pos + 65536.0)
    db.add(card)
    await db.commit()
    result = await db.execute(select(Card).where(Card.id == card.id).options(*_card_options()))
    return _card_to_dict(result.scalar_one())


@router.get("", response_model=list[CardOut])
async def get_cards(list_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Card).where(Card.list_id == list_id, Card.archived == False).order_by(Card.position).options(*_card_options())
    )
    return [_card_to_dict(c) for c in result.scalars().all()]


@router.get("/{card_id}", response_model=CardOut)
async def get_card(list_id: int, card_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _card_to_dict(await _get_card_or_404(card_id, list_id, db))


@router.patch("/{card_id}", response_model=CardOut)
async def update_card(list_id: int, card_id: int, body: CardUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Card).where(Card.id == card_id, Card.list_id == list_id).options(*_card_options())
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card não encontrado")
    data = body.model_dump(exclude_none=True)
    for k, v in data.items():
        setattr(card, k, v)
    await db.commit()
    return _card_to_dict(card)


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(list_id: int, card_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = await _get_card_or_404(card_id, list_id, db)
    await db.delete(card)
    await db.commit()


@router.post("/{card_id}/copy", response_model=CardOut, status_code=status.HTTP_201_CREATED)
async def copy_card(list_id: int, card_id: int, body: CardCopyBody = None, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if body is None:
        body = CardCopyBody()
    original = await _get_card_or_404(card_id, list_id, db)
    target_list_id = body.target_list_id or list_id
    title = body.title or original.title

    last = await db.execute(select(Card.position).where(Card.list_id == target_list_id).order_by(Card.position.desc()).limit(1))
    last_pos = last.scalar_one_or_none() or 0.0

    new_card = Card(
        list_id=target_list_id,
        title=title,
        description=original.description,
        priority=original.priority,
        due_date=original.due_date,
        position=last_pos + 65536.0,
    )
    db.add(new_card)
    await db.flush()

    for lbl in _to_list(original.labels):
        db.add(CardLabel(card_id=new_card.id, label=lbl.label, color=lbl.color))

    for m in _to_list(original.members):
        db.add(CardMember(card_id=new_card.id, user_id=m.user_id))

    for cl in _to_list(original.checklists):
        new_cl = Checklist(card_id=new_card.id, title=cl.title)
        db.add(new_cl)
        await db.flush()
        for item in _to_list(cl.items):
            db.add(ChecklistItem(checklist_id=new_cl.id, text=item.text, checked=False))

    await db.commit()
    result = await db.execute(select(Card).where(Card.id == new_card.id).options(*_card_options()))
    return _card_to_dict(result.scalar_one())


@router.post("/{card_id}/archive", response_model=CardOut)
async def archive_card(list_id: int, card_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = await _get_card_or_404(card_id, list_id, db)
    card.archived = True
    await db.commit()
    return _card_to_dict(card)


@router.post("/{card_id}/restore", response_model=CardOut)
async def restore_card(list_id: int, card_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Card).where(Card.id == card_id, Card.list_id == list_id).options(*_card_options())
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card não encontrado")
    card.archived = False
    await db.commit()
    return _card_to_dict(card)


@router.post("/{card_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def add_comment(list_id: int, card_id: int, body: CommentCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = await _get_card_or_404(card_id, list_id, db)
    comment = CardComment(card_id=card_id, author_id=current_user.id, body=body.body)
    db.add(comment)
    lst = await db.execute(select(List).where(List.id == list_id))
    lst_obj = lst.scalar_one_or_none()
    board_id = lst_obj.board_id if lst_obj else None
    members_result = await db.execute(select(CardMember).where(CardMember.card_id == card_id))
    for m in members_result.scalars().all():
        if m.user_id != current_user.id:
            db.add(Notification(
                user_id=m.user_id,
                type="card_comment",
                message=f"{current_user.name} comentou em \"{card.title}\": {body.body[:80]}{'…' if len(body.body) > 80 else ''}",
                card_id=card_id,
                board_id=board_id,
            ))
    await db.commit()
    result = await db.execute(
        select(CardComment).where(CardComment.id == comment.id).options(selectinload(CardComment.author))
    )
    return result.scalar_one()


@router.post("/{card_id}/members/{user_id}", status_code=status.HTTP_201_CREATED)
async def add_card_member(list_id: int, card_id: int, user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    card = await _get_card_or_404(card_id, list_id, db)
    db.add(CardMember(card_id=card_id, user_id=user_id))
    if user_id != current_user.id:
        lst = await db.execute(select(List).where(List.id == list_id))
        lst_obj = lst.scalar_one_or_none()
        board_id = lst_obj.board_id if lst_obj else None
        db.add(Notification(
            user_id=user_id,
            type="card_member",
            message=f"Você foi adicionado ao card \"{card.title}\" por {current_user.name}.",
            card_id=card_id,
            board_id=board_id,
        ))
    await db.commit()
    return {"ok": True}


@router.delete("/{card_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_card_member(list_id: int, card_id: int, user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(CardMember).where(CardMember.card_id == card_id, CardMember.user_id == user_id))
    member = result.scalar_one_or_none()
    if member:
        await db.delete(member)
        await db.commit()


class CardLabelBody(BaseModel):
    label_id: int


@router.post("/{card_id}/labels", status_code=status.HTTP_201_CREATED)
async def add_label(list_id: int, card_id: int, body: CardLabelBody, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_card_or_404(card_id, list_id, db)
    existing = await db.execute(select(CardLabel).where(CardLabel.card_id == card_id, CardLabel.label_id == body.label_id))
    if existing.scalar_one_or_none():
        return {"ok": True}
    db.add(CardLabel(card_id=card_id, label_id=body.label_id))
    await db.commit()
    return {"ok": True}


@router.delete("/{card_id}/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_label(list_id: int, card_id: int, label_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(CardLabel).where(CardLabel.card_id == card_id, CardLabel.label_id == label_id))
    label = result.scalar_one_or_none()
    if label:
        await db.delete(label)
        await db.commit()


# ── Checklists ────────────────────────────────────────────────────

@router.post("/{card_id}/checklists", response_model=ChecklistOut, status_code=status.HTTP_201_CREATED)
async def create_checklist(list_id: int, card_id: int, body: ChecklistCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _get_card_or_404(card_id, list_id, db)
    checklist = Checklist(card_id=card_id, title=body.title)
    db.add(checklist)
    await db.commit()
    result = await db.execute(
        select(Checklist).where(Checklist.id == checklist.id).options(selectinload(Checklist.items))
    )
    return result.scalar_one()


@router.delete("/{card_id}/checklists/{checklist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_checklist(list_id: int, card_id: int, checklist_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Checklist).where(Checklist.id == checklist_id, Checklist.card_id == card_id))
    checklist = result.scalar_one_or_none()
    if checklist:
        await db.delete(checklist)
        await db.commit()


@router.post("/{card_id}/checklists/{checklist_id}/items", response_model=ChecklistItemOut, status_code=status.HTTP_201_CREATED)
async def add_checklist_item(list_id: int, card_id: int, checklist_id: int, body: ChecklistItemCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    exists = await db.execute(select(Checklist.id).where(Checklist.id == checklist_id, Checklist.card_id == card_id))
    if not exists.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Checklist não encontrado")
    item = ChecklistItem(checklist_id=checklist_id, text=body.text)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/{card_id}/checklists/{checklist_id}/items/{item_id}", response_model=ChecklistItemOut)
async def update_checklist_item(list_id: int, card_id: int, checklist_id: int, item_id: int, body: ChecklistItemUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(ChecklistItem).where(ChecklistItem.id == item_id, ChecklistItem.checklist_id == checklist_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    data = body.model_dump(exclude_none=True)
    for k, v in data.items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{card_id}/checklists/{checklist_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_checklist_item(list_id: int, card_id: int, checklist_id: int, item_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(ChecklistItem).where(ChecklistItem.id == item_id, ChecklistItem.checklist_id == checklist_id))
    item = result.scalar_one_or_none()
    if item:
        await db.delete(item)
        await db.commit()
