-- 008: edição e exclusão (soft) de comentários de card.
-- create_all não altera tabela existente (ver CLAUDE.md); rodar via ./scripts/psql-dev.sh -f.
-- edited_at:      marcado na 1ª edição em diante (nulo = nunca editado).
-- original_body:  texto da 1ª versão, gravado só na 1ª edição (nulo = nunca editado).
-- deleted_at:     soft delete — a linha fica, a UI mostra "Comentário excluído" (nulo = ativo).
ALTER TABLE card_comments ADD COLUMN IF NOT EXISTS edited_at     TIMESTAMPTZ;
ALTER TABLE card_comments ADD COLUMN IF NOT EXISTS original_body TEXT;
ALTER TABLE card_comments ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ;
