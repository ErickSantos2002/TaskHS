-- Impede a mesma pessoa entrar duas vezes no mesmo quadro.
-- Roda via psql; create_all nao altera tabela existente.

-- 1) remove duplicatas pre-existentes, mantendo a linha mais antiga
DELETE FROM board_members a
 USING board_members b
 WHERE a.id > b.id
   AND a.board_id = b.board_id
   AND a.user_id  = b.user_id;

-- 2) cria a constraint (idempotente: PG nao tem ADD CONSTRAINT IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'board_members_board_user_uniq'
  ) THEN
    ALTER TABLE board_members
      ADD CONSTRAINT board_members_board_user_uniq UNIQUE (board_id, user_id);
  END IF;
END $$;
