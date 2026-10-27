"""Horas úteis: o relógio do alerta de 72 h do Dashboard.

Regra da Qualidade (spec 2026-10-27-dashboard-por-quadro-design.md): contam as
24 h de cada dia de segunda a sexta; sábado e domingo inteiros não contam.
Feriado conta como dia útil — ainda não há tabela de feriados.

O que é "sábado" é decidido no horário de Brasília, não em UTC: um card criado
segunda 01:00 UTC foi criado domingo 22:00 aqui, e essas duas horas não contam.
Offset fixo, como em routers/logs.py — o Brasil não tem horário de verão desde
2019, e assim não dependemos de tzdata no container.
"""
from datetime import datetime, timedelta, timezone

TZ_BR = timezone(timedelta(hours=-3))
LIMITE_HORAS = 72
# Régua por lista (travados por setor): horas úteis desde que o card entrou na lista.
LIMITE_HORAS_LISTA = 24

# Uma segunda-feira 00:00 em Brasília qualquer, só para servir de régua.
_SEGUNDA = datetime(2024, 1, 1, tzinfo=TZ_BR)
_DIA = 86400


def _segundos_uteis_desde_a_regua(t: datetime) -> float:
    """Segundos de segunda a sexta entre a régua e `t`.

    Conta fechada por semanas (5 dias úteis cada) + o resto da semana, em vez de
    andar dia a dia: o Dashboard calcula isto para todo card ativo, e um laço
    por dia crescia com a idade dos cards.
    """
    segundos = (t - _SEGUNDA).total_seconds()
    dias, no_dia = divmod(segundos, _DIA)
    semanas, dia_da_semana = divmod(int(dias), 7)  # 0 = segunda … 6 = domingo
    uteis = semanas * 5 * _DIA + min(dia_da_semana, 5) * _DIA
    if dia_da_semana < 5:
        uteis += no_dia
    return uteis


def horas_uteis(inicio: datetime, fim: datetime) -> float:
    """Horas de segunda a sexta (horário de Brasília) entre `inicio` e `fim`.

    Os dois precisam ter fuso (o banco devolve timestamptz). `fim <= inicio` dá 0.
    """
    if fim <= inicio:
        return 0.0
    return (_segundos_uteis_desde_a_regua(fim) - _segundos_uteis_desde_a_regua(inicio)) / 3600
