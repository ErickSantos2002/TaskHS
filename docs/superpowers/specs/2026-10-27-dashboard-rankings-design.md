# Dashboard com rankings de movimentação — design

**Data:** 2026-10-27 · **Versão alvo:** 2.11.0

## Intenção

Depois do lançamento da v2.9.0, o "Progresso geral" e os contadores de
"Vencidos"/"Vencem hoje" não foram usados — só 105 dos 726 cards ativos têm
data de entrega. O que o pessoal quer ver (palavras do Erick): **quadros mais
movimentados, quadros com mais cards, pessoas que mais movimentam cards,
pessoas que têm mais cards**, com "um ou dois gráficos".

O ranking de "pessoas com mais cards" tem também um papel de incentivo: hoje
quase ninguém entra como membro do card (4 vínculos em 726 cards). O Erick
espera que, vendo o ranking, o pessoal comece a entrar nos cards de que é
responsável.

## Decisões do Erick

- **"Movimentar" = mover o card de lista.** No log de auditoria: `audit_log`
  com `entity_type='card'`, `action='mover'`.
- **Seletor de período** com vários períodos.
- **"Pessoas com mais cards" = cards ativos em que a pessoa é membro**
  (`card_members`). Não usar "quem criou": boa parte dos cards de Serviço é
  criada pela integração.
- Sai do Dashboard: barra de "Progresso geral", "Vencidos", "Vencem hoje"
  (inclusive no painel de um quadro: "Prazo vencido" e "Vencem hoje").

## Decisões minhas

- Períodos: **7, 30 e 90 dias**, padrão 30. Fica na URL (`?periodo=7`), como o
  quadro (`?board=`).
- Só contam movimentações de **pessoa** (`actor_type='usuario'`); a
  integração não entra no ranking de pessoas nem nos números de movimentação.
- Rankings mostram o **top 8**, em barras horizontais (`div`, como o gráfico
  por lista da v2.9.0).
- Gráfico: **movimentações por dia** no período, colunas; sábado/domingo em
  cinza. Dia no fuso de Brasília (UTC−3, mesmo `TZ_BR`).
- Recorte de acesso: tudo é calculado só sobre os quadros que a pessoa pode
  abrir (elevado = todos os ativos; membro = os seus), ativos (sem lixeira, não
  arquivados). Pessoa que só movimentou em quadro que eu não vejo não aparece
  pra mim.
- Movimento de card que hoje está na lixeira/arquivado **conta** (aconteceu);
  o filtro é pelo quadro do evento (`audit_log.board_id`) estar visível.
- "Quadros com mais cards" e "Pessoas com mais cards" são **fotografia de
  agora** (não dependem do período); os de movimentação dependem do período.
  O rótulo diz isso.
- Clicar num quadro dos rankings troca o seletor para aquele quadro.
- Usuário inativo continua no ranking (o movimento existiu), com o nome atual.

## Telas

**Todos os quadros:** seletor de período + seletor de quadro no topo → alerta
de 72 h (como hoje) → gráfico "Movimentações por dia" com o total → grade 2×2:
Quadros mais movimentados · Quadros com mais cards · Pessoas que mais
movimentam · Pessoas com mais cards. Grade de "Boards recentes" sai (a página
Boards já faz isso).

**Um quadro:** alerta → Cards ativos, Listas, Arquivados, Em listas de
concluído → gráfico "Movimentações por dia" do quadro → Pessoas que mais
movimentam (no quadro) · Pessoas com mais cards (no quadro) → Cards por lista
(como hoje).

Vazio de "Pessoas com mais cards": *"Ninguém é membro de card ainda. Entre
como membro nos cards pelos quais você é responsável."*

## API

`GET /api/dashboard?board_id=&periodo=7|30|90` passa a devolver também:
`movimentos_por_dia: [{dia, total}]`, `quadros_mais_movimentados`,
`quadros_com_mais_cards`, `pessoas_que_mais_movimentam`,
`pessoas_com_mais_cards` (cada um `[{id, nome, total}]`, quadros com `color`;
pessoas com `initials`/`avatar_url`). Os KPIs `prazo_vencido`/`vencem_hoje`
saem. `periodo` fora de 7/30/90 → 422.

O `/boards/stats` deixa de ser chamado pelo Dashboard (não é removido).

## Não-objetivos

- Ranking por quem criou o card; ranking de comentários/anexos.
- Exportar ranking; filtro por pessoa.

## Fechamento

Changelog 2.11.0. Verificação: curl contra a API (somas e recortes de acesso)
+ navegador + `npm run build`.
