-- Travados por setor (v2.12.0). Ver spec 2026-10-27-travados-por-setor-design.md.
-- Cadastro de setores (admin), setor de cada lista (drawer do quadro) e o
-- relógio da régua de 24 h úteis por lista (cards.list_entered_at).
-- Idempotente: pode rodar de novo sem estragar o que já foi corrigido à mão.
-- Aplicada sozinha no boot (app/migrations.py), na transação do runner.

CREATE TABLE IF NOT EXISTS setores (
    id         SERIAL PRIMARY KEY,
    nome       VARCHAR(80) NOT NULL,
    ativo      BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_setores_nome ON setores (lower(nome));

ALTER TABLE lists ADD COLUMN IF NOT EXISTS setor_id INTEGER REFERENCES setores(id) ON DELETE SET NULL;

-- Quando o card entrou na lista atual: último "mover" do audit para a lista
-- em que ele está; sem isso, a criação do card.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS list_entered_at TIMESTAMPTZ;
UPDATE cards c SET list_entered_at = COALESCE((
    SELECT max(a.created_at) FROM audit_log a
    WHERE a.entity_type = 'card' AND a.action = 'mover' AND a.card_id = c.id
      AND (a.changes::json -> 'list_id' ->> 'para')::int = c.list_id
), c.created_at)
WHERE c.list_entered_at IS NULL;
ALTER TABLE cards ALTER COLUMN list_entered_at SET DEFAULT now();
ALTER TABLE cards ALTER COLUMN list_entered_at SET NOT NULL;

INSERT INTO setores (nome)
SELECT n FROM unnest(ARRAY[
    'Financeiro', 'Laboratório', 'Expedição', 'Comercial', 'Vendas', 'Setup',
    'Suporte', 'RH', 'TI', 'Qualidade', 'Almoxarifado', 'Administração',
    'Diretoria', 'Marketing'
]) AS n
WHERE NOT EXISTS (SELECT 1 FROM setores s WHERE lower(s.nome) = lower(n));

-- Pré-preenchimento pelo nome da lista (minúsculo, sem acento). Só toca lista
-- sem setor; na ordem abaixo, o primeiro que bater ganha.
DO $$
DECLARE
    regra RECORD;
BEGIN
    FOR regra IN SELECT * FROM (VALUES
        (1, 'Financeiro', 'financeiro'),
        (2, 'Laboratório', 'laboratorio'),
        (3, 'Expedição', 'expedicao'),
        (4, 'Comercial', 'comercial'),
        (5, 'Vendas', 'vendas'),
        (6, 'Setup', 'setup'),
        (7, 'Suporte', 'suporte'),
        (8, 'RH', '\mrh\M'),
        (9, 'TI', '\mti\M'),
        (10, 'Qualidade', 'qualidade'),
        (11, 'Almoxarifado', 'almoxarifado'),
        (12, 'Administração', 'administracao'),
        (13, 'Diretoria', 'diretoria'),
        (14, 'Marketing', 'marc?keting')
    ) AS r(ordem, setor, padrao) ORDER BY ordem
    LOOP
        UPDATE lists l SET setor_id = s.id
        FROM setores s
        WHERE lower(s.nome) = lower(regra.setor)
          AND l.setor_id IS NULL AND l.deleted_at IS NULL
          AND lower(translate(l.title,
                'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')) ~ regra.padrao;
    END LOOP;
END $$;

-- Relatório para revisar: quadro · lista · setor atribuído.
SELECT b.title AS quadro, l.title AS lista, COALESCE(s.nome, '—') AS setor
FROM lists l
JOIN boards b ON b.id = l.board_id
LEFT JOIN setores s ON s.id = l.setor_id
WHERE l.deleted_at IS NULL AND b.deleted_at IS NULL AND b.archived_at IS NULL
ORDER BY b.title, l.position;
