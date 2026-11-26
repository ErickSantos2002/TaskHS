"""sort_mode da lista: so "manual" e "prazo"; default "manual"."""
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas.list import ListOut, ListUpdate


def test_list_update_aceita_modos():
    assert ListUpdate(sort_mode="prazo").sort_mode == "prazo"
    assert ListUpdate(sort_mode="manual").sort_mode == "manual"
    assert ListUpdate().model_dump(exclude_none=True) == {}


def test_list_update_rejeita_modo_desconhecido():
    with pytest.raises(ValidationError):
        ListUpdate(sort_mode="prioridade")


def test_list_out_default_manual():
    out = ListOut(id=1, board_id=1, title="x", description=None, color="#64748b",
                  position=0, created_at=datetime.now(timezone.utc))
    assert out.sort_mode == "manual"
