-- Travados por setor (v2.12.0): re-backfill de cards.list_entered_at.
-- A 016 rodou no banco de produção ANTES do deploy do código que mantém o
-- relógio (listener em models/card.py). Nesse intervalo, mover card ou
-- desarquivar não atualizou list_entered_at — o card apareceria "travado" sem
-- estar. Esta migration roda no boot do deploy e só puxa o relógio para frente,
-- pelo audit: último "mover" para a lista atual e último desarquivar.
-- Idempotente: rodar de novo não muda nada.

UPDATE cards c SET list_entered_at = m.ultimo
FROM (
    SELECT a.card_id, (a.changes::json -> 'list_id' ->> 'para')::int AS list_id, max(a.created_at) AS ultimo
    FROM audit_log a
    WHERE a.entity_type = 'card' AND a.action = 'mover'
    GROUP BY 1, 2
) m
WHERE m.card_id = c.id AND m.list_id = c.list_id AND m.ultimo > c.list_entered_at;

UPDATE cards c SET list_entered_at = d.ultimo
FROM (
    SELECT a.card_id, max(a.created_at) AS ultimo
    FROM audit_log a
    WHERE a.entity_type = 'card' AND a.action = 'editar'
      AND a.changes::json -> 'archived' ->> 'para' = 'false'
    GROUP BY 1
) d
WHERE d.card_id = c.id AND NOT c.archived AND d.ultimo > c.list_entered_at;
