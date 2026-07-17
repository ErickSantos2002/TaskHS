# Menções em comentários (@) — Design

**Data:** 2026-07-17
**Status:** aprovado
**Depende de:** `2026-07-16-membros-de-card-design.md` (v1.4.1), que estabeleceu a
invariante **atribuído a um card ⇒ membro do quadro** e a regra
"marcável/atribuível = membro do quadro".

## Objetivo

Digitar `@` num comentário abre a lista de pessoas do quadro; escolher uma insere a
menção; a pessoa recebe uma notificação de que foi marcada.

## Por que agora, e não antes

A pergunta central de qualquer feature de menção é **quem pode ser mencionado**. Sem uma
resposta, ela seria inventada aqui — e provavelmente errada, oferecendo as 27 pessoas da
empresa e vazando o texto do comentário para quem não abre o quadro. A v1.4.1 já
respondeu: **membro do quadro**, e deixou o `GET /boards/{id}/members` pronto, já usado
pelo seletor de membros do card. A menção herda a regra em vez de criar uma nova.

## Decisões

**Marcar não adiciona a pessoa ao card.** É o que o Trello faz. Marcar é "olha isso
aqui", atribuir é "isso é seu" — duas intenções. Adicionar junto faria a pessoa começar a
receber lembrete de vencimento de um card em que ela só foi consultada. Descartado também
"perguntar na hora": põe uma decisão no meio de escrever um comentário.

**O token guarda o nome, e o comentário antigo mostra o nome da época.** Renome é raro
(os 26 nomes já foram acertados uma vez) e o histórico é honesto: o comentário registra o
que a pessoa escreveu, não uma versão reescrita depois. Descartado resolver o id na
renderização: obrigaria a tela do card a carregar a lista de pessoas só para isso, e faria
um comentário antigo "dizer" algo que ninguém escreveu.

## Arquitetura

### 1. O formato: `@[Adriana Paz](14)`

O corpo do comentário continua uma string. **Sem tabela nova** — os ids estão no próprio
texto, e "listar todas as menções a mim" não é um requisito (YAGNI).

Descartado `@Adriana Paz` em texto puro: os nomes deste sistema **têm espaço**, então
`@Adriana Paz Silva` é ambíguo (onde termina o nome?); dois "Adriana" são
indistinguíveis; e quem escrever um `@` literal vira menção sem querer. O id no token
elimina os três problemas.

### 2. O seletor (frontend)

Digitou `@` no campo de comentário → abre a lista dos membros do quadro
(`GET /boards/{id}/members`, o mesmo do seletor de membros do card) → filtra conforme
digita → escolher insere `@[Nome](id)` no texto.

### 3. A validação (backend) — o ponto crítico

`add_comment` extrai os ids do corpo com regex e **valida cada um contra
`board_members`** do quadro do card. Ids que não passam são ignorados (nenhuma
notificação), mas o texto do comentário fica como foi escrito.

**Por que a validação é obrigatória:** o corpo vem do cliente. Sem ela, qualquer pessoa
forja `@[Quem Quiser](99)` no `body` e o sistema entrega ao usuário 99 uma notificação
com o texto que o atacante escolher, de um quadro que ele não abre. Seria abrir um quarto
vazamento na mesma semana em que três foram fechados. Com a validação, a menção herda a
regra existente: **marcável = membro do quadro**.

### 4. Notificação, sem duplicar

Tipo novo: `card_mention` — *"{Autor} mencionou você em «{card}»: {trecho}"*.

Quem é mencionado **e** é membro do card receberia duas notificações (menção + comentário).
Recebe **só a de menção**: é a mais específica. A notificação de comentário
(`card_comment`) continua indo para os membros do card **não** mencionados, com o filtro
de membresia que a v1.4.1 já pôs ali.

### 5. Renderização

O corpo do comentário é renderizado hoje como texto puro num `<p>` com
`whitespace-pre-wrap` (`BoardPage.tsx`). Passa a ser montado por partes: texto normal +
a menção como chip destacado, com o nome guardado no token.

Menção a quem depois saiu do quadro continua aparecendo no texto — é o registro do que foi
dito. Ela só deixa de gerar notificação, porque a validação passa a barrar.

## Verificação

Não há suíte de testes no projeto; a verificação é manual (curl + navegador).

| Cenário | Esperado |
|---|---|
| mencionar membro do quadro | `card_mention` para ele |
| **forjar `@[X](id)` de não-membro** | **nenhuma notificação** — o teste central |
| forjar id inexistente | nenhuma notificação, sem 500 |
| mencionado **e** membro do card | **uma** notificação (`card_mention`), não duas |
| membro do card não mencionado | `card_comment`, como hoje |
| mencionar a si mesmo | nenhuma notificação (espelha a guarda que já existe) |
| corpo sem menção | comportamento de hoje, intacto |
| renderização | o chip aparece; texto ao redor preservado, inclusive quebras de linha |

**Banco:** dev aponta para o banco de **produção**, que está deployada e no ar. Prefixar
todo dado de teste com `zzz` e apagar imediatamente — a listagem mostra **todos** os
quadros para todo mundo. **Nunca apagar linhas de `audit_log`.** As senhas das baterias
vêm de `$TASKHS_*` (`backend/.env.dev-users`, gitignorado); o repositório é **público**.

## Changelog

Versão **1.5.0** (novidade).
