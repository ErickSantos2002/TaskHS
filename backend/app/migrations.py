"""Aplicador de migrations no startup.

POR QUE EXISTE: o schema nasce de Base.metadata.create_all, que só cria tabelas
que faltam — nunca altera tabela existente. Mudança de coluna sempre dependeu de
alguém lembrar de rodar o .sql à mão antes do deploy. Em 2026-07-20 esse passo
foi esquecido: o backend subiu declarando boards.icon, a coluna não existia, e a
produção parou. Agora o deploy aplica sozinho.

COMO FUNCIONA: uma tabela-registro (schema_migrations) guarda o nome de cada
arquivo já aplicado. No boot, roda em ordem só os que faltam, cada um na sua
transação, e anota. Arquivo já anotado nunca roda de novo.

POR QUE O REGISTRO, e não só rodar tudo sempre: a 003 NÃO é idempotente (mexe em
users.is_admin e depois derruba a coluna); reaplicá-la num banco já migrado
quebraria. As outras usam IF NOT EXISTS, mas não dá para contar com isso.

SE UMA MIGRATION FALHAR o app NÃO sobe, de propósito: subir com o schema errado é
o que causou o incidente. Deploy que falha é barulhento e reversível; app de pé
com schema errado corrompe dados em silêncio.
"""
import logging
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger("migrations")

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

# Aplicadas à mão antes deste runner existir. São marcadas como já aplicadas na
# primeira vez que o registro é criado, para não reaplicar num banco que já as
# tem (a 003 quebraria). Em banco novo isso também é correto: o create_all já
# cria as tabelas com o schema atual, então elas seriam no-op de qualquer forma.
BASELINE = {
    "001_card_attachments.sql",
    "002_card_external_ref.sql",
    "003_user_role.sql",
    "004_board_members_unique.sql",
    "005_card_members_unique.sql",
    "006_board_obs_integration.sql",
}

# Trava de sessão do Postgres: se dois containers subirem juntos (janela de
# deploy), só um aplica; o outro espera e depois vê tudo como aplicado.
_LOCK_ID = 4820573910


async def run_migrations(conn: AsyncConnection) -> None:
    """Aplica os .sql pendentes. Chamar DEPOIS do create_all.

    A ordem importa: create_all cria as tabelas que faltam, e as migrations
    alteram tabelas que já existem. Invertido, um banco novo tentaria alterar
    tabela inexistente.
    """
    if not MIGRATIONS_DIR.is_dir():
        logger.warning("pasta de migrations não encontrada em %s — nada a fazer", MIGRATIONS_DIR)
        return

    await conn.execute(text("SELECT pg_advisory_lock(:id)"), {"id": _LOCK_ID})
    try:
        await conn.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " name TEXT PRIMARY KEY,"
            " applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        ))

        aplicadas = set((await conn.execute(text("SELECT name FROM schema_migrations"))).scalars().all())

        if not aplicadas:
            # Primeira vez: registra o baseline sem executar nada.
            for nome in sorted(BASELINE):
                await conn.execute(
                    text("INSERT INTO schema_migrations (name) VALUES (:n) ON CONFLICT DO NOTHING"),
                    {"n": nome},
                )
            aplicadas = set(BASELINE)
            logger.info("registro de migrations criado; %d marcadas como baseline", len(BASELINE))

        pendentes = sorted(p for p in MIGRATIONS_DIR.glob("*.sql") if p.name not in aplicadas)
        if not pendentes:
            logger.info("schema em dia (%d migrations aplicadas)", len(aplicadas))
            return

        # asyncpg: .execute() do driver usa o protocolo simples, que aceita
        # varias instruções e blocos DO $$ num arquivo só. Passar pelo
        # SQLAlchemy prepararia a query e quebraria nesses arquivos.
        raw = await conn.get_raw_connection()
        driver = raw.driver_connection

        for caminho in pendentes:
            logger.info("aplicando migration %s", caminho.name)
            try:
                await driver.execute(caminho.read_text(encoding="utf-8"))
            except Exception:
                logger.exception("FALHA na migration %s — o app não vai subir", caminho.name)
                raise
            await conn.execute(
                text("INSERT INTO schema_migrations (name) VALUES (:n) ON CONFLICT DO NOTHING"),
                {"n": caminho.name},
            )
            logger.info("migration %s aplicada", caminho.name)
    finally:
        await conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": _LOCK_ID})
