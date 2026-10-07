"""Fotos de perfil. Servidas SEM autenticação, de propósito.

O avatar aparece dezenas de vezes por tela; com download autenticado (como os
anexos) cada um exigiria fetch + objectURL no front. O nome do arquivo é um
UUID v4 sem listagem — não dá para adivinhar a foto de alguém. Trocar a foto
gera nome novo, por isso o cache pode ser imutável.
"""
import os
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core.config import settings

AVATAR_DIR = os.path.join(settings.UPLOAD_DIR, "avatars")
# Validar ANTES de tocar no disco: é a barreira contra path traversal.
AVATAR_NAME_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|png|webp)$")
# Tipo explícito pela extensão: o mimetypes do Python 3.12 no container não
# conhece .webp e o FileResponse caía em text/plain — com o nosniff, navegadores
# mais rígidos recusavam exibir a foto (2026-10-07: só parte das pessoas via).
AVATAR_MEDIA_TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}

router = APIRouter(prefix="/avatars", tags=["avatars"])


@router.get("/{nome}")
async def get_avatar(nome: str):
    m = AVATAR_NAME_RE.fullmatch(nome)
    if not m:
        raise HTTPException(status_code=404, detail="Foto não encontrada")
    caminho = os.path.join(AVATAR_DIR, nome)
    if not os.path.isfile(caminho):
        raise HTTPException(status_code=404, detail="Foto não encontrada")
    return FileResponse(caminho, media_type=AVATAR_MEDIA_TYPES[m.group(1)], headers={"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})
