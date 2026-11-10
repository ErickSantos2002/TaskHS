-- Quadro "fora do alerta de atrasos" (v2.15.0). Separa dois papeis que o
-- lists.is_done acumulava: tirar do alerta de 72 h / travados por setor do
-- Dashboard e dizer que o card esta concluido (usado por /cards/minhas).
-- Quadro com fora_do_alerta = true nao entra nas reguas; os cards seguem abertos.
-- Ver spec 2026-11-10-fora-do-alerta-design.md.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS fora_do_alerta BOOLEAN NOT NULL DEFAULT false;

-- Dados: quadros que tinham TODAS as listas marcadas como "de concluido" so
-- para sair do alerta (confirmado com o dono em 2026-11-10). Ficam marcadas
-- apenas as listas que sao de concluido de fato. Inclui listas arquivadas e na
-- lixeira, para o problema nao voltar ao restaura-las. Banco sem esses ids: no-op.
UPDATE boards SET fora_do_alerta = true WHERE id IN (143, 144, 154);
UPDATE lists SET is_done = (id = 372) WHERE board_id = 154;                       -- T.I. 2: FINALIZADO
UPDATE lists SET is_done = false WHERE board_id = 143;                            -- Expedicao
UPDATE lists SET is_done = (id IN (291, 295, 299, 304)) WHERE board_id = 144;     -- Gestao de Atividades: "calibracao concluida"
