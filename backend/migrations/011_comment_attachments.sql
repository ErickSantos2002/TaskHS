-- 011: imagem enviada dentro de um comentário.
--
-- Rodada automaticamente no boot pelo runner (app/migrations.py), depois do
-- create_all. Aditiva e idempotente.
--
-- comment_id NULL  = anexo solto, subido pelo bloco Anexos (o de sempre).
-- comment_id != NULL = imagem que veio junto daquele comentário. Continua sendo
-- anexo do card (card_id preenchido), então o bloco Anexos a exibe sem mudança.
--
-- ON DELETE SET NULL NÃO É ENFEITE: Card.comments e Card.attachments têm
-- cascade="all, delete-orphan" no ORM, e o SQLAlchemy apaga as coleções filhas
-- sem ordem garantida ENTRE elas. Se os comentários forem apagados antes dos
-- anexos, a FK estoura e delete_card devolve 500. Com SET NULL não existe ordem
-- errada possível.

ALTER TABLE card_attachments
  ADD COLUMN IF NOT EXISTS comment_id INTEGER REFERENCES card_comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_card_attachments_comment_id
  ON card_attachments (comment_id);
