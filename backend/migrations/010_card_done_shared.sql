-- 010: "concluído" passa a ser COMPARTILHADO (flag no card), não mais por usuário.
--
-- Rodada automaticamente no boot pelo runner (app/migrations.py), depois do
-- create_all. Aditiva e idempotente.
--
-- A versão anterior guardava a marcação por usuário na tabela card_done (privada).
-- Agora é um booleano do próprio card, que entra no SSE e todos veem. As marcações
-- individuais eram privadas/experimentais e NÃO viram compartilhadas (semântica
-- diferente) — a tabela órfã é removida.

ALTER TABLE cards ADD COLUMN IF NOT EXISTS done BOOLEAN NOT NULL DEFAULT false;

DROP TABLE IF EXISTS card_done;
