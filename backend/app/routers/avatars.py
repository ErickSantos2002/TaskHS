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

router = APIRouter(prefix="/avatars", tags=["avatars"])


@router.get("/{nome}")
async def get_avatar(nome: str):
    if not AVATAR_NAME_RE.fullmatch(nome):
        raise HTTPException(status_code=404, detail="Foto não encontrada")
    caminho = os.path.join(AVATAR_DIR, nome)
    if not os.path.isfile(caminho):
        raise HTTPException(status_code=404, detail="Foto não encontrada")
    return FileResponse(caminho, headers={"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})
