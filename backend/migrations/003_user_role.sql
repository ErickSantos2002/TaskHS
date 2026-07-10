-- Papéis de usuário: substitui o booleano is_admin por role.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'membro';
UPDATE users SET role = CASE WHEN is_admin THEN 'administrador' ELSE 'membro' END;
ALTER TABLE users DROP COLUMN IF EXISTS is_admin;
