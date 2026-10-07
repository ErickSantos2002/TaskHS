-- Foto de perfil: nome do arquivo em UPLOAD_DIR/avatars/ (<uuid hex>.<ext>).
-- NULL = sem foto, o front mostra as iniciais.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(64);
