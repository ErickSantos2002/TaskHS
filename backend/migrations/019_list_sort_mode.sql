-- Ordenacao da lista (v2.18.0). "manual" = Card.position (como sempre foi);
-- "prazo" = o front ordena os cards por due_date ao desenhar a coluna. A
-- position nunca e reescrita, entao voltar para "manual" devolve a ordem antiga.
-- Ver spec 2026-11-26-ordenar-lista-por-prazo-design.md.
ALTER TABLE lists ADD COLUMN IF NOT EXISTS sort_mode VARCHAR(10) NOT NULL DEFAULT 'manual';
