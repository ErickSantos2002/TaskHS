# Membros de card: quem está no card está no quadro — Design

**Data:** 2026-07-16
**Status:** aprovado
**Antecede:** `2026-07-16-acesso-quadros-design.md` (v1.4.0), que criou a tranca de membresia

## Objetivo

Estabelecer e sustentar uma invariante: **quem está atribuído a um card é membro
do quadro daquele card**. Com ela, notificação e lembrete nunca falam de um card
que a pessoa não consegue abrir.

## O problema

A v1.4.0 trancou o acesso aos quadros, mas a atribuição de card ficou de fora.
Verificado no código em 2026-07-16:

| Onde | O quê |
|---|---|
| `cards.py:254` (`add_card_member`) | não valida nada — nem que a pessoa é membro do quadro, nem que o usuário existe (FK estouraria em 500) |
| `cards.py:259-265` | manda `Notification` com **o título do card** para quem não alcança o quadro |
| `reminders.py:62` | o loop busca `CardMember` **sem filtro de quadro** — manda lembrete de vencimento, com o título, para sempre |
| `reminders.py:31` | lembretes **pessoais** também disparam sem checar o quadro |
| `BoardPage.tsx:287` | o seletor de membros do card oferece **as 27 pessoas** da empresa |

Cenário concreto: Maria (membro do quadro "Serviço") atribui o João, que não é
membro. João recebe *"Você foi adicionado ao card «Orçamento Cliente X»"*, clica, e
bate na tela de sem-acesso. E passa a receber *"«Orçamento Cliente X» vence amanhã"*
indefinidamente — o título de um card de um quadro que ele não alcança.

**Nada disso é explorável hoje**, e por um motivo irônico: o seletor de membros do
card estava quebrado para os 20 membros comuns (usava um endpoint elevado-only), então
**ninguém nunca conseguiu atribuir ninguém**. Verificado: `SELECT count(*) FROM
card_members` = **0** no banco inteiro; o import do Trello também não cria essas linhas.
A v1.4.0 consertou o seletor — o que **liga** o problema. Daí a urgência.

**Consequência boa:** não há dado velho para migrar. A invariante nasce limpa, sem
backfill.

## Decisões

**Só membros do quadro podem ser atribuídos a um card.** É o modelo do próprio Trello,
que o TaskHS substitui. Quer atribuir alguém de fora? Adicione ao quadro primeiro.
Descartado: "atribuir adiciona ao quadro automaticamente" (daria acesso ao quadro
inteiro sem a pessoa perceber, transformando qualquer membro em porta de entrada) e
"atribui mas não notifica" (a atribuição viraria decorativa — a pessoa está no card,
não sabe, e não consegue abrir).

**Remover do quadro avisa antes.** A tela diz quantos cards a pessoa ocupa e pede
confirmação. Descartado bloquear a remoção enquanto houver cards (para tirar quem saiu
da empresa, seria preciso caçar card por card).

**Mover card entre quadros tira quem não é do destino.** É o que o Trello faz.
Descartado bloquear o movimento: travaria um arrastar-e-soltar com mensagem de erro,
no fluxo mais usado do sistema.

## Arquitetura

Quatro peças. As três primeiras sustentam a invariante nos três caminhos que a
quebram; a quarta é a rede.

### 1. A regra na escrita

`add_card_member` (`cards.py:251-267`) passa a exigir:
- o usuário existe e está ativo → senão `404 "Usuário não encontrado"`
- o usuário tem linha em `board_members` do quadro do card → senão
  `403 "Essa pessoa não é membro deste quadro"`

### 2. O seletor do card

Passa a listar os membros do quadro (`GET /boards/{id}/members`) em vez das 27 pessoas
de `/auth/users/basic`. `CardDetailModal` não recebe `boardId` hoje — é uma prop nova.

Os dois lados têm que andar juntos: só o backend faria o seletor oferecer 27 pessoas e
o backend recusar 26 — a UI ofereceria o que o backend recusa.

### 3. Remoção e movimento, com a invariante mantida

- `BoardMemberOut` ganha `assigned_cards: int` — quantos cards **daquele quadro** a
  pessoa ocupa. Subquery agregada, sem N+1. Conta todos os cards (arquivados
  inclusive), porque a remoção afeta todos.
- `DELETE /boards/{id}/members/{user_id}` limpa `CardMember` e `Reminder` da pessoa nos
  cards daquele quadro, **na mesma transação** da remoção.
- UI: se `assigned_cards > 0`, o `X` pede confirmação — *"{Nome} está em N cards deste
  quadro. Remover vai tirá-la deles e apagar os lembretes pessoais dela aqui."*
- `update_card`, ao mover um card **para outro quadro**, remove os `CardMember` e
  `Reminder` de quem não é membro do quadro de destino, na mesma transação do
  movimento.

### 4. A rede: o loop de lembretes filtra por membresia

`reminders.py` passa a exigir membresia do quadro nos dois caminhos: automáticos
(`:62`, via `CardMember`) e pessoais (`:31`, via `Reminder`).

**Por que, se a regra já é garantida na escrita:** porque o loop é o único lugar que
**empurra** dado para as pessoas — título de card, direto no sino. Se a invariante furar
por qualquer caminho (bug futuro, SQL manual, um import novo), o custo é vazamento; o
filtro faz o custo ser zero. Esta branch existe justamente porque a v1.4.0 encontrou 11
caminhos de furo que ninguém tinha previsto.

Nota: o filtro **não** consulta `is_elevated`. Um administrador que não seja membro do
quadro alcança o quadro pela tranca, mas só recebe lembrete se estiver atribuído ao
card — e para estar atribuído, precisa ser membro (regra 1). Não há caso especial.

## Verificação

Não há suíte de testes no projeto; a verificação é manual (curl + navegador).

| Cenário | Esperado |
|---|---|
| atribuir não-membro a um card | `403` |
| atribuir membro do quadro | `201` + notificação |
| atribuir usuário inexistente | `404` (não 500) |
| seletor do card, como membro comum | lista **só** os membros do quadro |
| `GET /boards/{id}/members` | traz `assigned_cards` correto |
| remover membro com cards | some dos cards; os `Reminder` dele naquele quadro somem |
| mover card para outro quadro | quem não é do destino sai do card |
| loop de lembretes com `CardMember` órfão (inserido à mão) | **não** notifica |
| loop de lembretes com membro legítimo | notifica normalmente |

O último par é o que prova a rede, e é o único cenário que precisa de montagem: inserir
um `CardMember` órfão direto no banco (simulando a invariante furada por um caminho que
não previmos), rodar o ciclo à mão e confirmar que **nada** é gerado para ele — enquanto
um membro legítimo no mesmo card recebe normalmente. Rodar o ciclo sem esperar os 60s:

```bash
docker compose exec -T backend python -c "import asyncio; from app.reminders import run_reminder_cycle; asyncio.run(run_reminder_cycle())"
```

**Banco:** dev aponta para o banco de **produção**, que agora está deployado
(`taskhs.healthsafetytech.com`). Nomear todo dado de teste com prefixo `zzz` e limpar
imediatamente — a listagem da v1.4.0 mostra **todos** os quadros para todo mundo, então
quadro de teste aparece para a empresa inteira enquanto existir. **Nunca apagar linhas
de `audit_log`.**

## Changelog

Versão **1.4.1** (correção): a invariante fecha um vazamento e alinha o
comportamento ao do Trello, sem funcionalidade nova visível.
