-- Observações de integração: 6 campos de texto por card + config por quadro.
-- create_all só cria tabela que falta; cards e boards já existem, então as
-- colunas novas entram por aqui (dev e produção), via ./scripts/psql-dev.sh -f.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs1 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs2 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs3 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs4 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs5 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs6 TEXT;

ALTER TABLE boards ADD COLUMN IF NOT EXISTS integration_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS obs_labels JSONB NOT NULL DEFAULT '[]'::jsonb;
