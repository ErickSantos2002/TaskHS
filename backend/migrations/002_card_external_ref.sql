-- Vínculo de cards com entidades de sistemas externos (integração).
ALTER TABLE cards ADD COLUMN IF NOT EXISTS external_source VARCHAR(50);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);
-- Um card por (source, external_id). NULLs múltiplos são permitidos (cards normais).
ALTER TABLE cards ADD CONSTRAINT uq_card_external UNIQUE (external_source, external_id);
