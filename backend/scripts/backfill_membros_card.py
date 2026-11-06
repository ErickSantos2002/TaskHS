"""Backfill do membro automático (v2.14.0): aplica a regra "mexeu, é membro" ao passado.

Uso (dentro do container do backend, cwd /app):
    python -m scripts.backfill_membros_card            # dry-run: só mostra os números
    python -m scripts.backfill_membros_card --aplicar  # grava

Fontes de "mexeu" (mesma regra do app/membro_auto.py):
  - audit_log de usuário (inclui o agente do HS.OS, que age como a pessoa):
    card criado; card editado/movido com mudança de conteúdo (CAMPOS_CONTEUDO);
    comentário criado/editado; anexo criado; checklist, item e etiqueta do card.
    Movimento cuja única mudança de conteúdo é due_date_completed é a automação
    mark_due_complete — não conta.
  - card_comments.author_id e card_attachments.uploaded_by.

Fica de fora:
  - Import do Trello: ele gravou todo comentário importado como do importador.
    Atividade nos quadros importados até 10 min depois do import é descartada.
  - Quem não é membro do quadro, quem está inativo, quem já é membro.
  - Quem foi tirado do card (por qualquer um) DEPOIS da última vez que mexeu nele.

Grava pelo ORM (CardMember via db.add) para cada vínculo entrar no audit_log com
ator "sistema". Idempotente: rodar de novo cria 0.
"""
import argparse
import asyncio
from collections import Counter

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

import app.audit  # noqa: F401 — registra os listeners de auditoria
from app.database import AsyncSessionLocal
from app.membro_auto import CAMPOS_CONTEUDO
from app.models.card import CardMember

CAMPOS_MOVER = [c for c in CAMPOS_CONTEUDO if c != "due_date_completed"]

SQL = text("""
WITH imp AS (
    SELECT entity_id AS board_id, created_at + interval '10 minutes' AS ate
    FROM audit_log
    -- Pelo texto, nao pelo path: um import (quadro "T.I. 2", set/2026) foi gravado
    -- como "sistema" e sem path, e o filtro por path deixava o importador passar.
    WHERE entity_type = 'quadro' AND action = 'criar' AND entity_id IS NOT NULL
      AND summary LIKE 'importou o quadro %do Trello%'
),
ativ AS (
    SELECT a.card_id, a.actor_user_id AS user_id, a.created_at AS quando
    FROM audit_log a
    WHERE a.actor_type = 'usuario' AND a.actor_user_id IS NOT NULL AND a.card_id IS NOT NULL
      AND (
           (a.entity_type = 'card' AND a.action = 'criar')
        OR (a.entity_type = 'card' AND a.action = 'editar' AND a.changes IS NOT NULL
            AND a.changes::jsonb ?| CAST(:campos AS text[]))
        OR (a.entity_type = 'card' AND a.action = 'mover' AND a.changes IS NOT NULL
            AND a.changes::jsonb ?| CAST(:campos_mover AS text[]))
        OR (a.entity_type = 'comentario' AND a.action IN ('criar', 'editar'))
        OR (a.entity_type = 'anexo' AND a.action = 'criar')
        OR (a.entity_type IN ('checklist', 'item_checklist', 'etiqueta_card'))
      )
    UNION ALL
    SELECT card_id, author_id, created_at FROM card_comments
    UNION ALL
    SELECT card_id, uploaded_by, uploaded_at FROM card_attachments WHERE uploaded_by IS NOT NULL
),
marcado AS (
    SELECT a.card_id, a.user_id, a.quando, l.board_id,
           (imp.board_id IS NOT NULL AND a.quando <= imp.ate) AS do_import
    FROM ativ a
    JOIN cards c ON c.id = a.card_id
    JOIN lists l ON l.id = c.list_id
    LEFT JOIN imp ON imp.board_id = l.board_id
),
pares AS (
    SELECT card_id, user_id, board_id,
           max(quando) FILTER (WHERE NOT do_import) AS ultima
    FROM marcado
    GROUP BY card_id, user_id, board_id
)
SELECT p.card_id, p.user_id, p.board_id, p.ultima,
       b.title AS quadro, u.name AS pessoa, u.is_active,
       EXISTS (SELECT 1 FROM board_members bm
               WHERE bm.board_id = p.board_id AND bm.user_id = p.user_id) AS eh_do_quadro,
       EXISTS (SELECT 1 FROM card_members cm
               WHERE cm.card_id = p.card_id AND cm.user_id = p.user_id) AS ja_membro,
       EXISTS (SELECT 1 FROM audit_log x
               WHERE x.entity_type = 'membro_card' AND x.action = 'excluir'
                 AND x.card_id = p.card_id AND x.changes IS NOT NULL
                 AND (x.changes::jsonb -> 'user_id' ->> 'de')::int = p.user_id
                 AND x.created_at > p.ultima) AS saiu_depois,
       (c.due_date < current_date AND NOT c.due_date_completed AND NOT c.archived
        AND c.deleted_at IS NULL AND l.deleted_at IS NULL AND b.deleted_at IS NULL
        AND b.archived_at IS NULL) AS atrasado_aberto
FROM pares p
JOIN cards c ON c.id = p.card_id
JOIN lists l ON l.id = c.list_id
JOIN boards b ON b.id = p.board_id
JOIN users u ON u.id = p.user_id
""")


async def main(aplicar: bool) -> None:
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            SQL, {"campos": list(CAMPOS_CONTEUDO), "campos_mover": CAMPOS_MOVER}
        )).mappings().all()

        pulados = Counter()
        criar = []
        for r in rows:
            if r["ja_membro"]:
                pulados["já é membro"] += 1
            elif r["ultima"] is None:
                pulados["só atividade do import do Trello"] += 1
            elif not r["is_active"]:
                pulados["usuário inativo"] += 1
            elif not r["eh_do_quadro"]:
                pulados["não é membro do quadro"] += 1
            elif r["saiu_depois"]:
                pulados["saiu do card depois de mexer"] += 1
            else:
                criar.append(r)

        por_quadro = Counter(r["quadro"] for r in criar)
        por_pessoa = Counter(r["pessoa"] for r in criar)
        atrasados = {r["card_id"] for r in criar if r["atrasado_aberto"]}

        print(f"Pares (card, pessoa) com atividade: {len(rows)}")
        print(f"Vínculos de membro a criar: {len(criar)} em {len({r['card_id'] for r in criar})} cards")
        for motivo, n in pulados.most_common():
            print(f"  pulados — {motivo}: {n}")
        print(f"Cards abertos e atrasados que ganham membro (vão gerar lembrete): {len(atrasados)}")
        print("\nPor quadro:")
        for nome, n in por_quadro.most_common():
            print(f"  {n:5d}  {nome}")
        print("\nPor pessoa:")
        for nome, n in por_pessoa.most_common():
            print(f"  {n:5d}  {nome}")

        if not aplicar:
            print("\nDRY-RUN: nada foi gravado. Rode com --aplicar para gravar.")
            return

        criados = 0
        for i, r in enumerate(criar, 1):
            # Pré-check de novo: o app ao vivo pode ter criado entre a consulta e aqui.
            ja = (await db.execute(
                select(CardMember.id).where(
                    CardMember.card_id == r["card_id"], CardMember.user_id == r["user_id"]
                ).limit(1)
            )).scalars().first()
            if ja is not None:
                continue
            try:
                async with db.begin_nested():
                    db.add(CardMember(card_id=r["card_id"], user_id=r["user_id"]))
                    await db.flush()
                criados += 1
            except IntegrityError:
                pass
            if i % 200 == 0:
                await db.commit()
        await db.commit()
        print(f"\nAPLICADO: {criados} vínculos criados.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Backfill do membro automático do card")
    ap.add_argument("--aplicar", action="store_true", help="grava (sem isto, só dry-run)")
    asyncio.run(main(ap.parse_args().aplicar))
