-- Lixeira (v2.7.0): excluir card/lista/quadro passa a marcar deleted_at em vez
-- de apagar. A lixeira NAO propaga para os filhos: excluir a lista marca so a
-- lista, e os cards somem por tabela. Ver spec 2026-10-20-lixeira-design.md.
-- deleted_by e so rastro: ON DELETE SET NULL para nao travar a exclusao de usuario.
ALTER TABLE cards  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
ALTER TABLE cards  ADD COLUMN IF NOT EXISTS deleted_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE lists  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
ALTER TABLE lists  ADD COLUMN IF NOT EXISTS deleted_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS deleted_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;
