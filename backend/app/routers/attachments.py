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
from app.dependencies import get_current_user, require_board_access_by_list_id

router = APIRouter(prefix="/lists/{list_id}/cards/{card_id}/attachments", tags=["attachments"],
                   dependencies=[Depends(require_board_access_by_list_id)])

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
    "text/xml": ".xml",
    "application/xml": ".xml",
}
# Aceitos pela extensão do nome quando o navegador manda um content_type genérico.
# NF-e baixada de portal costuma chegar como application/octet-stream, e recusá-la
# quebraria o uso do financeiro (foi o pedido). O conteúdo não é executado — só guardado.
ALLOWED_EXTS_FALLBACK: dict[str, str] = {".xml": "application/xml"}
MAX_SIZE = 10 * 1024 * 1024


def _resolve_ext(filename: str | None, content_type: str | None) -> tuple[str, str] | None:
    """Devolve (extensão, content_type a gravar) ou None se não permitido.

    1º pela tabela de content_type; senão, pela extensão do nome (fallback do XML).
    """
    if content_type in ALLOWED_TYPES:
        return ALLOWED_TYPES[content_type], content_type
    nome = (filename or "").lower()
    for ext, ct in ALLOWED_EXTS_FALLBACK.items():
        if nome.endswith(ext):
            # content_type genérico vira o correto, para o download servir como XML.
            return ext, content_type if content_type in (ct, "text/xml") else ct
    return None


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
        resolvido = _resolve_ext(f.filename, f.content_type)
        if resolvido is None:
            raise HTTPException(status_code=400, detail=f"Tipo não permitido: {f.filename} ({f.content_type})")
        ext, content_type = resolvido
        content = await f.read()
        if len(content) > MAX_SIZE:
            raise HTTPException(status_code=400, detail=f"Arquivo grande demais (máx 10 MB): {f.filename}")
        stored_name = f"{uuid.uuid4().hex}{ext}"
        with open(os.path.join(settings.UPLOAD_DIR, stored_name), "wb") as out:
            out.write(content)
        att = CardAttachment(
            card_id=card_id,
            filename=f.filename or stored_name,
            stored_name=stored_name,
            content_type=content_type,
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
    await _get_card_or_404(card_id, list_id, db)
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


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    list_id: int, card_id: int, attachment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_card_or_404(card_id, list_id, db)
    result = await db.execute(
        select(CardAttachment).where(CardAttachment.id == attachment_id, CardAttachment.card_id == card_id)
    )
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Anexo não encontrado")
    if att.uploaded_by != current_user.id and not current_user.is_elevated:
        raise HTTPException(status_code=403, detail="Apenas o autor do anexo ou um administrador pode excluí-lo")
    if att.stored_name:
        path = os.path.join(settings.UPLOAD_DIR, att.stored_name)
        if os.path.isfile(path):
            os.remove(path)
    await db.delete(att)
    await db.commit()
