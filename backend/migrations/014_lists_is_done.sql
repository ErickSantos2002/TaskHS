-- Dashboard por quadro (v2.9.0): listas "de concluido". Card numa lista marcada
-- sai do alerta de 72 h uteis do Dashboard. Marcada no drawer do quadro pelo
-- dono ou elevado. Ver spec 2026-10-27-dashboard-por-quadro-design.md.
ALTER TABLE lists ADD COLUMN IF NOT EXISTS is_done BOOLEAN NOT NULL DEFAULT false;
