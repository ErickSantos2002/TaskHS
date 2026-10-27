# Arquivar quadro — design

**Data:** 2026-10-27 · **Versão alvo:** 2.10.0

## Intenção

O Erick quer tirar de circulação o quadro "Gestão de Atividades (serviços)"
sem excluir: os dados podem ser importantes no futuro. Excluir (lixeira, v2.7.0)
some com o quadro para quem não é administrador e passa a ideia de "lixo".
Arquivar é outra coisa: o quadro **sai de vista e dos números**, mas continua
**consultável, só para leitura**.

Decisões do Erick (seguiu a recomendação): seção "Quadros arquivados" na página
de Boards; quadro arquivado abre **só para leitura**; **só administrador**
arquiva e desarquiva. O resto ficou a meu critério ("eu confio em você").

## Comportamento

**Arquivar/desarquivar**
- Só `is_admin` (papel administrador; coordenador não). Botão "Arquivar quadro"
  no drawer do quadro (perto da zona de perigo); "Desarquivar" na faixa do
  quadro arquivado.
- Quadro na lixeira não arquiva (404). Arquivar o que já está arquivado é
  idempotente.
- Após arquivar/desarquivar, `realtime.publish_reload(board_id)`: quem está com
  o quadro aberto recarrega e passa a ver (ou deixa de ver) a faixa.

**O que some**
- `GET /api/boards` (vitrine, seletor do Dashboard, "mover para outro quadro"):
  não lista arquivados.
- `/api/boards/stats` e `/api/dashboard` (ambos os modos): não contam.
  `/api/dashboard?board_id=<arquivado>` → 404 para elevado, 403 para os demais
  (igual a quadro inexistente). *Minha decisão.*
- Busca global: não acha card de quadro arquivado. *Minha decisão.*
- Lembretes: o loop não gera notificação (nem automática por prazo, nem manual)
  para card de quadro arquivado. O lembrete manual não é marcado `fired`, então
  dispara se o quadro for desarquivado. *Minha decisão.*

**O que continua**
- `GET /api/boards/archived`: os arquivados, no mesmo formato da vitrine
  (`BoardListOut` + `archived_at`), com `can_open` pela mesma regra.
- Abrir o quadro: `GET /boards/{id}`, snapshot e SSE funcionam (mesma regra de
  membresia). Notificações antigas que apontam para o quadro abrem o card.
- Integração (`X-API-Key`) não é bloqueada: dado de máquina não pode se perder.
  *Minha decisão.* O quadro 144 não tem integração.
- Excluir quadro arquivado (lixeira) continua permitido ao dono/elevado.

**Somente leitura** — no backend, que é a garantia:
- Qualquer método que não seja `GET`/`HEAD`/`OPTIONS` nos routers trancados por
  quadro (`lists`, `labels`, `automations`, lixeira do quadro) ou por lista
  (`cards`, `attachments`, `reminders`) responde **409 "Quadro arquivado:
  somente leitura"**. Ordem: 403 (acesso) → 404 (lixeira) → 409 (arquivado).
- Destino no corpo (`update_card`/`copy_card` com `list_id`/`target_list_id`):
  destino em quadro arquivado → 409.
- Em `boards.py`, por endpoint: `update_board`, `set_done_lists`,
  `add_member`, `remove_member` → 409. (`stream-ticket` é POST mas continua
  liberado.)

**Somente leitura** — no front, para a tela não mentir:
- Faixa no topo do quadro: "Quadro arquivado em dd/mm/aaaa — somente
  leitura", com "Desarquivar" para administrador.
- Sem arrastar cards/listas, sem "Adicionar card"/"Adicionar lista".
- Modal do card e drawer: controles de edição desabilitados (fechar continua).
- Página de Boards: seção recolhível "Quadros arquivados (N)" no fim, mesmos
  cartões da vitrine (cadeado para quem não pode abrir).

## Dados

Migration `015_board_archived.sql` (aplicada no boot):
`boards.archived_at TIMESTAMPTZ NULL`, `boards.archived_by INTEGER NULL
REFERENCES users(id) ON DELETE SET NULL`. Exposto como `archived_at` em
`BoardOut`/`BoardListOut`. "Ativo" = `deleted_at IS NULL AND archived_at IS
NULL`; "vivo" (lixeira) não muda.

## Não-objetivos

- Arquivar automaticamente, ou arquivar lista de quadros em lote.
- Permitir comentar em quadro arquivado.
- Mexer em `can_open` / regra de membresia.

## Fechamento

Changelog `2.10.0`. Verificação por curl + navegador + `npm run build`.
