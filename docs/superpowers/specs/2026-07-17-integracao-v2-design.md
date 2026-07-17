# Integração v2: id em vez de nome — Design

**Data:** 2026-07-17
**Status:** aprovado
**Depende de:** `2026-07-16-membros-de-card-design.md` (v1.4.1), que estabeleceu a
invariante **atribuído a um card ⇒ membro do quadro**.

## Objetivo

A API de integração passa a receber **`list_id`** em vez dos **nomes** do quadro e da
lista, e deixa de criar quadro ou lista sozinha. Junto, fecha o último caminho que
quebra a invariante de membros e um 500 conhecido no `delete_list`.

## O problema, e por que o nome é pior do que "frágil"

`_ensure_board` (`integration.py:20-28`) procura o quadro **pelo título vindo do corpo** e,
se não achar, **cria um quadro novo em silêncio**. `_ensure_list` (`:31-42`) faz o mesmo
com a lista.

Consequência: renomear "Serviço" para "Serviços" na tela faz o próximo card do GestorHS
**criar um quadro fantasma** chamado "Serviço", e as OS passam a cair lá. Sem erro, sem
aviso — descobre-se quando alguém pergunta por que sumiu OS.

**Isso não é hipótese: já aconteceu.** A auditoria registra a integração criando a lista
`"Recebido"` num `board_id=29` que hoje não existe mais (2026-07-13).

O argumento decisivo para o id não é que nome é frágil — é que **o modo de falha do nome
é silencioso e destrutivo** (cria estrutura fantasma que engole dados), enquanto o do id
é um **404 na cara do chamador, na primeira tentativa**. Falhar alto vence falhar em
silêncio, ainda mais numa integração que roda sozinha.

## Momento

O GestorHS **ainda não está em produção**: a auditoria mostra 588 movimentos entre
2026-07-13 e 2026-07-15, mas de apenas **2 cards distintos** — é o Erick exercitando o
fluxo em desenvolvimento. Trocar o contrato agora custa uma edição no GestorHS; trocar
depois custaria uma migração.

## Decisões

**Só `list_id`, sem `board_id`.** O `list_id` já determina o quadro (`List.board_id`).
Pedir os dois seria redundante e abriria a chance de mandar um par inconsistente
(`board_id` de um quadro, `list_id` de outro) — mais um estado inválido para tratar, sem
ganho.

**O "cria sozinho" some.** Era exatamente o que gerava fantasma. Custo aceito: para cada
integração nova, o quadro é criado na tela e o id copiado — um passo, uma vez.
Desfaz conscientemente uma decisão de junho (`2026-06-22-integracao-externa-design.md`),
que escolheu nome justamente para o sistema externo poder criar o quadro sozinho.

**Isto NÃO é o que conserta a invariante.** Trocar nome por id não muda o fato de que
`_apply_updates` (`:63-65`) move o card quando a lista difere — e o destino pode ser
outro quadro, levando `CardMember`/`Reminder`/`CardLabel` junto. São dois bugs distintos,
e os dois entram nesta branch.

## Arquitetura

### 1. O contrato: `list_id`

`IntegrationCardIn` (`backend/app/schemas/integration.py`): os campos `board: str` e
`list: str` dão lugar a **`list_id: int`**.

`upsert_card` resolve a lista por id e **404 se não existir**:
- `404 "Lista não encontrada"` — o id não existe

`_ensure_board`/`_ensure_list` são **removidos**. `settings.INTEGRATION_OWNER_ID` deixa de
ser usado aqui (era só para o dono do quadro criado sozinho) — conferir se algo mais o usa
antes de mexer no config.

### 2. A invariante, no movimento entre quadros

Quando o upsert move o card para uma lista de **outro quadro**, `_apply_updates` passa a
tirar do card quem não é membro do quadro de destino, e as etiquetas que não são de lá —
exatamente o que `update_card` (`routers/cards.py`) já faz.

**Via ORM (`await db.delete(obj)`), nunca bulk delete:** `CardMember`, `Reminder` e
`CardLabel` são tipos auditados, e o `audit.py` captura exclusões lendo
`session.deleted`, que bulk delete não popula — a exclusão sumiria do log em silêncio.
Isso já mordeu duas vezes neste projeto.

### 3. `delete_list` (o 500)

`lists.py:49-54` limpa só `Automation`. `delete_board` e `delete_card` limpam
`Reminder`/`ReminderSent`/`Notification`. Resultado: apagar uma lista cujo card tem
lembrete estoura `ForeignKeyViolationError` → **500**. É o irmão do 500 que prendeu um
quadro em produção, e agora que lembretes são usados de verdade, está alcançável.

Segue o padrão do `delete_board`: limpar as pontas antes de excluir.

### 4. O guia

`docs/integration.md` descreve o payload com nome em 7 lugares. Vira **v2**: o payload,
os exemplos, o pseudo-código do GestorHS e a seção de erros. O guia é o contrato que o
outro lado lê — deixá-lo desatualizado é pior do que não tê-lo.

## O que quebra

**O GestorHS.** O payload sai de `{"board": "Serviço", "list": "Recebido", ...}` para
`{"list_id": 42, ...}`. O Erick ajusta o lado dele — custo aceito explicitamente, e é a
razão de fazer agora, enquanto ainda é desenvolvimento.

Os 3 cards já criados (`external_source='gestorhs'`) **não são afetados**: eles são
encontrados por `(source, external_id)`, que não muda.

## Verificação

Não há suíte de testes no projeto; a verificação é manual (curl).

| Cenário | Esperado |
|---|---|
| upsert com `list_id` válido, card novo | `200`, card criado na lista certa |
| upsert com o mesmo `(source, external_id)` | atualiza, não duplica |
| **`list_id` inexistente** | **`404`** — e **nenhum** quadro/lista criado |
| mover o card para lista de **outro quadro**, com membro que não é de lá | o membro sai do card; as etiquetas do quadro antigo saem |
| mover dentro do **mesmo** quadro | ninguém sai |
| a exclusão pelo movimento | aparece no `audit_log` (ORM, não bulk) |
| `delete_list` de uma lista com card **com lembrete** | `204` (era **500**) |
| `DELETE /integration/cards` | segue funcionando |

**Banco:** dev aponta para o banco de **produção**, que está no ar. Prefixar todo dado de
teste com `zzz` e apagar imediatamente. **Nunca apagar linhas de `audit_log`.** As senhas
vêm de `$TASKHS_*` (`backend/.env.dev-users`, gitignorado); SQL via
`./scripts/psql-dev.sh`. O repositório é **público**.

## Changelog

Versão **1.6.0** (novidade/quebra de contrato da API de integração).
