# Dashboard por quadro + alerta de 72 h úteis — design

**Data:** 2026-10-27 · **Versão alvo:** 2.9.0 (melhoria/novidade → minor)

## Intenção

Hoje o Dashboard (`frontend/src/pages/DashboardPage.tsx`) mostra só um painel
geral (quadros, cards ativos, vencidos, vencem hoje, taxa de conclusão) e a
grade de quadros. O Erick quer:

1. **Filtrar o Dashboard por quadro**, com indicadores daquele quadro.
2. Um **indicador principal para a Qualidade**: quantos e quais cards foram
   criados há **mais de 72 horas úteis** e ainda não chegaram ao fim do processo,
   e em que lista estão.

O uso: alguém da Qualidade abre o Dashboard, vê o número, clica, vê a lista dos
cards e clica para ir direto ao card. **A cobrança é feita com o setor fora do
sistema.** O TaskHS não registra justificativa, tratativa nem responsável.

## Objetivos

- Seletor de quadro no topo do Dashboard (**layout A**: lista suspensa,
  escolhido pelo Erick num mockup). "Todos os quadros" é a opção padrão.
- Painel por quadro com os indicadores abaixo.
- Alerta de 72 h úteis clicável → janela (modal) com os cards → "Abrir" leva ao
  quadro com o card aberto.
- Marcação, por quadro, de quais listas são **"de concluído"**.

## Não-objetivos

- Registrar tratativa/justificativa de card atrasado (decisão do Erick: tratamento
  é fora do sistema).
- Feriados (só sábado e domingo são descontados). *Minha decisão; dá para
  adicionar depois uma tabela de feriados.*
- Limite configurável (fica fixo em 72 h). *Minha decisão.*
- Notificação/sino ou e-mail para card atrasado.
- Novos indicadores além dos listados: o Erick disse que vai pedindo depois.

## Regra das 72 horas úteis (decisão do Erick)

- Conta-se a partir de `Card.created_at`.
- **Só contam horas de segunda a sexta**, 24 h por dia. Sábado e domingo
  inteiros são descontados. Ex.: criado sexta 15:00 → estoura quarta 15:00;
  criado sábado 10:00 → o relógio começa segunda 00:00 → estoura quinta 00:00.
- Fuso: **America/Sao_Paulo** para decidir o que é sábado/domingo (*minha
  decisão*; datas no banco são UTC).
- O card **deixa de contar** quando está numa **lista de concluído** do seu
  quadro (decisão do Erick). Ele não "zera": se sair da lista de concluído,
  volta a contar com a idade desde a criação.
- **A caixinha "concluído" do card (`Card.done`) NÃO influencia** — nem
  `due_date_completed`. Decisão do Erick: a caixinha hoje tem outro
  significado na operação. Só a lista onde o card está decide.
- **Não contam**: card arquivado, card em lista arquivada, e o que está na
  lixeira (card/lista/quadro com `deleted_at`). *Minha decisão.*
- Quadro **sem nenhuma lista de concluído marcada** conta todos os cards vivos.
- Observação: os cards importados do Trello (jul/2026) têm `created_at` = data
  do import, não a original. Isso só os faz parecer mais novos; não exige ação.
- Card movido de outro quadro (v2.8.0) mantém `created_at` original.

O cálculo pode ser em Python (são ~2 mil cards) ou SQL; fica a critério do
implementador, desde que seja uma função só, reaproveitada pelo painel e pela
lista do modal.

## Listas de concluído

- Nova coluna `lists.is_done boolean NOT NULL DEFAULT false` — migration
  `backend/migrations/014_*.sql`, aplicada sozinha no boot pelo runner
  (`backend/app/migrations.py`). Escrever com `ADD COLUMN IF NOT EXISTS`. *Minha
  decisão:* não rodar à mão — o dev aponta para o banco de produção e o runner
  não registraria a execução manual.
- Configuradas no **drawer do quadro**, ao lado da configuração de integração:
  uma lista de checkboxes com as listas vivas do quadro. Quem pode alterar:
  **dono do quadro ou administrador**, o mesmo critério de `update_board`.
- Exposto no JSON da lista (`is_done`) para o front saber.

## Indicadores do painel de um quadro

| Indicador | Definição |
|---|---|
| **Mais de 72 h úteis** (destaque, vermelho, clicável) | regra acima |
| Cards ativos | vivos, não arquivados, em lista viva não arquivada |
| Listas | listas vivas não arquivadas |
| Arquivados | cards vivos com `archived = true` ou em lista arquivada |
| Prazo vencido | ativos com `due_date < hoje` e `due_date_completed = false` (mesma regra do `/stats` atual) |
| Vencem hoje | mesma regra do `/stats` atual |
| Em listas de concluído | ativos em lista `is_done` |
| **Cards por lista** (gráfico de barras horizontais) | por lista ativa, na ordem do quadro: total e quantos estão acima de 72 h (parte vermelha); listas de concluído marcadas com ✓ |

## Visão "Todos os quadros"

Mantém o painel geral atual e **acrescenta o alerta de 72 h somado** de todos os
quadros que a pessoa pode abrir. O modal, nesse caso, ganha a coluna **Quadro**
e um filtro por quadro. *Minha decisão: a Qualidade costuma olhar a empresa
toda.* A grade de quadros continua embaixo.

## Modal "cards acima de 72 h úteis"

- Colunas: card (título), quadro (só na visão Todos), lista atual, criado em
  (data/hora local), tempo útil decorrido (em dias úteis, ou horas quando < 1 dia).
- Ordem: **mais antigo primeiro**.
- Filtro por lista (e por quadro na visão Todos).
- "Abrir" navega para `/boards/{board_id}?card={card_id}&list={list_id}`, o
  mesmo deep-link que a busca global já usa (`GlobalSearch.tsx`).

## Acesso

- Mesmo critério de `can_open`/`/stats`: elevado (administrador/coordenador)
  vê todos os quadros; membro comum, só os quadros em que tem linha em
  `board_members`. O seletor lista só esses quadros.
- Endpoint por quadro precisa da tranca de membresia (gate por endpoint em
  `boards.py`, como as demais rotas com `board_id` ali). Endpoint da visão
  Todos usa o mesmo recorte do `/stats`.
- **Filtrar `deleted_at IS NULL` nos três níveis** (card, lista, quadro) em
  toda query nova: ela fica fora dos chokepoints da lixeira.

## Front

- Quadro escolhido fica na URL (`/dashboard?board=136`), para dar F5 e
  compartilhar o link. *Minha decisão.*
- Seguir o visual escuro atual (`StatCard` etc. do `DashboardPage.tsx`).

## Deixado para o implementador

- Formato exato dos endpoints e se a lista do modal vem no mesmo payload ou
  em chamada separada.
- Biblioteca (ou não) para o gráfico de barras: barras em `div` bastam.

## Fechamento

- Entrada `2.9.0` no `frontend/src/data/changelog.ts`.
- Verificação manual (curl + navegador + `npm run build`); não há suíte de testes.
- A migration 014 sobe sozinha no boot (runner de `backend/app/migrations.py`).
