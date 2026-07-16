-- Impede a mesma pessoa ser atribuida duas vezes ao mesmo card.
-- Roda via psql; create_all nao altera tabela existente.

-- 1) remove duplicatas pre-existentes, mantendo a linha mais antiga
DELETE FROM card_members a
 USING card_members b
 WHERE a.id > b.id
   AND a.card_id = b.card_id
   AND a.user_id = b.user_id;

-- 2) cria a constraint (idempotente: PG nao tem ADD CONSTRAINT IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'card_members_card_user_uniq'
      AND conrelid = 'card_members'::regclass
  ) THEN
    ALTER TABLE card_members
      ADD CONSTRAINT card_members_card_user_uniq UNIQUE (card_id, user_id);
  END IF;
END $$;
