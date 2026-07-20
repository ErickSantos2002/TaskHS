-- 007: icone do quadro
--
-- create_all() so cria tabela que falta, nao altera tabela existente, entao a
-- coluna precisa entrar por SQL manual. Rodar com:
--   ./scripts/psql-dev.sh -f backend/migrations/007_board_icon.sql
--
-- Aditiva e nullable de proposito: NULL = "sem icone escolhido", e o frontend
-- cai no icone generico. Assim os quadros que ja existem seguem funcionando sem
-- backfill. Rollback: ALTER TABLE boards DROP COLUMN icon;

ALTER TABLE boards ADD COLUMN IF NOT EXISTS icon VARCHAR(40);
