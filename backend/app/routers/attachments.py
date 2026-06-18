import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.core.config import settings
from app.models.card import Card, CardAttachment
from app.models.user import User
from app.schemas.card import AttachmentOut
from app.dependencies import get_current_user

router = APIRouter(prefix="/lists/{list_id}/cards/{card_id}/attachments", tags=["attachments"])

ALLOWED_TYPES: dict[str, str] = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
}
MAX_SIZE = 10 * 1024 * 1024


def attachment_to_dict(a: CardAttachment) -> dict:
    ct = a.content_type or ""
    return {
        "id": a.id,
        "filename": a.filename,
        "content_type": a.content_type,
        "size": a.size,
        "uploaded_by": a.uploaded_by,
        "uploaded_at": a.uploaded_at,
        "is_image": ct.startswith("image/"),
    }


async def _get_card_or_404(card_id: int, list_id: int, db: AsyncSession) -> Card:
    result = await db.execute(select(Card).where(Card.id == card_id, Card.list_id == list_id))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card não encontrado")
    return card


@router.post("", response_model=list[AttachmentOut], status_code=status.HTTP_201_CREATED)
async def upload_attachments(
    list_id: int, card_id: int,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_card_or_404(card_id, list_id, db)
    created: list[CardAttachment] = []
    for f in files:
        if f.content_type not in ALLOWED_TYPES:
            raise HTTPException(status_code=400, detail=f"Tipo não permitido: {f.filename} ({f.content_type})")
        content = await f.read()
        if len(content) > MAX_SIZE:
            raise HTTPException(status_code=400, detail=f"Arquivo grande demais (máx 10 MB): {f.filename}")
        ext = ALLOWED_TYPES[f.content_type]
        stored_name = f"{uuid.uuid4().hex}{ext}"
        with open(os.path.join(settings.UPLOAD_DIR, stored_name), "wb") as out:
            out.write(content)
        att = CardAttachment(
            card_id=card_id,
            filename=f.filename or stored_name,
            stored_name=stored_name,
            content_type=f.content_type,
            size=len(content),
            uploaded_by=current_user.id,
        )
        db.add(att)
        created.append(att)
    await db.commit()
    for att in created:
        await db.refresh(att)
    return [attachment_to_dict(a) for a in created]


@router.get("/{attachment_id}/download")
async def download_attachment(
    list_id: int, card_id: int, attachment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(CardAttachment).where(CardAttachment.id == attachment_id, CardAttachment.card_id == card_id)
    )
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Anexo não encontrado")
    if att.stored_name:
        path = os.path.join(settings.UPLOAD_DIR, att.stored_name)
        if not os.path.isfile(path):
            raise HTTPException(status_code=404, detail="Arquivo não encontrado no disco")
        return FileResponse(path, filename=att.filename, media_type=att.content_type or "application/octet-stream")
    if att.url:
        return RedirectResponse(att.url)
    raise HTTPException(status_code=404, detail="Anexo sem arquivo")
