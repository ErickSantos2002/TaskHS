-- Arquivar quadro (v2.10.0): quadro arquivado sai da vitrine, do Dashboard, da
-- busca e dos lembretes, mas continua consultavel so para leitura. Diferente da
-- lixeira (deleted_at). Ver spec 2026-10-27-arquivar-quadro-design.md.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS archived_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;
