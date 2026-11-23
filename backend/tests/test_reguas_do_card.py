"""reguas_do_card: as duas réguas da Qualidade (Dashboard e selo do modal)."""
from datetime import datetime

from app.horas_uteis import TZ_BR, reguas_do_card


def _br(*a):
    return datetime(*a, tzinfo=TZ_BR)


AGORA = _br(2026, 11, 23, 12)  # segunda 12:00


def test_criado_semana_passada_estoura_72h():
    # Segunda anterior 12:00 → 5 dias úteis = 120 h.
    r = reguas_do_card(_br(2026, 11, 16, 12), AGORA, None, AGORA)
    assert r["horas_criacao"] == 120.0 and r["atrasado"] is True


def test_fim_de_semana_nao_conta():
    # Sexta 12:00 → segunda 12:00 = 24 h úteis (sábado e domingo fora).
    r = reguas_do_card(_br(2026, 11, 20, 12), _br(2026, 11, 20, 12), 1, AGORA)
    assert r["horas_criacao"] == 24.0 and r["atrasado"] is False
    assert r["horas_lista"] == 24.0 and r["travado"] is False  # limite é "mais de 24"


def test_travado_so_com_setor():
    entrou = _br(2026, 11, 19, 12)  # quinta → 48 h úteis
    assert reguas_do_card(entrou, entrou, 3, AGORA)["travado"] is True
    sem_setor = reguas_do_card(entrou, entrou, None, AGORA)
    assert sem_setor["horas_lista"] is None and sem_setor["travado"] is False
