# Membro automático do card — design

**Data:** 2026-11-06 · **Versão alvo:** v2.14.0 (melhoria)

## Por quê

Ninguém lembra de se colocar como membro do card. Hoje são ~1.738 cards e só **46**
vínculos em `card_members`. Ser membro é o que faz a pessoa receber aviso de comentário
e os lembretes de vencimento (`reminders.py`) — e é o que mostra, na face do card, quem
está trabalhando nele. Com membro vazio, nada disso funciona.

**Regra (do Erick):** se a pessoa mexeu no conteúdo do card, ela é membro dele,
automaticamente. E os cards que já existem devem ser corrigidos com a mesma regra.

## Objetivos

1. Toda ação "de trabalho" num card coloca quem agiu como membro, na mesma transação.
2. Correção única dos cards existentes, a partir do histórico.

## Não-objetivos / anti-objetivos

- **Mover não conta** (arrastar entre listas, reordenar, "Mover para…"): é ação de quem
  organiza o quadro, e pode ser sem querer. Se contasse, coordenadores virariam membros
  de tudo — falha mesmo "funcionando".
- Arquivar/restaurar card e mandar card para a lixeira **não contam**.
- Lembrete pessoal **não conta** — é privado; virar membro o tornaria visível.
- Integração (`X-API-Key`), automações e o loop de lembretes **nunca** colocam ninguém:
  não são uma pessoa.
- **O agente do HS.OS (token de agente, v2.13.0) conta como a pessoa** (decisão do
  Erick): ação feita pelo agente em nome de alguém coloca essa pessoa como membro, ao
  vivo e no backfill (linhas de audit com "(via …)" no `summary` contam normalmente).
  O helper não filtra `get_actor().via`.
- Nenhuma mudança de UI além do que já acontece (o membro aparece no card via SSE).

## Regra ao vivo

Vira membro do card, quem (usuário autenticado) fizer:

| Ação | Endpoint (routers/cards.py, salvo indicação) |
|---|---|
| criar card | `create_card` |
| copiar card (membro do card **novo**) | `copy_card` |
| editar conteúdo: `title`, `description`, `priority`, `due_date`, `due_date_completed`, `done` | `update_card` — **só** se o corpo mudar um desses campos; `position`/`list_id` sozinhos não contam |
| comentar / editar o próprio comentário | `add_comment`, `edit_comment` |
| anexar arquivo | `routers/attachments.py: upload_attachments` |
| criar/excluir checklist; criar/editar/excluir item | `create_checklist`, `delete_checklist`, `add_checklist_item`, `update_checklist_item`, `delete_checklist_item` |
| pôr/tirar etiqueta | `add_label`, `remove_label` |

Não contam: `delete_comment`, `delete_attachment`, `archive_card`, `restore_card`,
`delete_card`, membros (`add/remove_card_member`), lembretes.

Em `update_card`, mudança de conteúdo **junto** com mover conta (a pessoa editou). Quando
o card troca de quadro no mesmo PATCH, a checagem de membro do quadro (abaixo) usa o
quadro de **destino** e roda **depois** da limpeza de membros que já existe ali.

**Condições para adicionar:**
- A pessoa precisa ser **membro do quadro** (`board_members`) do card. Elevado
  (admin/coordenador) que não é membro do quadro **não** vira membro do card — mantém a
  invariante atual do `add_card_member` (403 para quem não é do quadro), da qual
  dependem as notificações e o loop de lembretes.
- Já é membro → nada.
- **Saiu antes e mexe de novo → volta** (decisão do Erick: "mexeu, é membro").
- Sem notificação "Você foi adicionado…" (é a própria pessoa; o `add_card_member` já não
  notifica a si mesmo).

**Como (decidido aqui):** um helper único, ex. `garantir_membro_card(db, card_id,
board_id, user)`, chamado por cada endpoint acima **antes do commit**, na mesma
transação. Deve:
- gravar via ORM (`db.add(CardMember(...))`) para o `audit.py` registrar `membro_card /
  criar` com o ator — esse registro é o que permite à correção (e a qualquer pessoa)
  entender depois de onde veio o membro, e dispara o SSE (`CardMember` está em
  `_SSE_CARD_CHILD`);
- tolerar a corrida do unique `card_members_card_user_uniq` sem derrubar a ação
  principal (ex.: savepoint `begin_nested` + `IntegrityError`). Um comentário nunca
  pode falhar porque o membro já existia.
- A resposta do endpoint que devolve o card (`update_card`, `create_card`, `copy_card`)
  deve já trazer o novo membro.

Ordem em `add_comment`: as notificações de comentário vão para os membros do card
**exceto quem comentou** (já é assim). Adicionar o autor antes ou depois não muda nada
para ele; manter o filtro `!= current_user.id`.

## Correção dos cards existentes (backfill)

Script único, Python, no `backend/` (ex. `backend/scripts/backfill_membros_card.py`),
rodado dentro do container (`docker compose exec -T backend python -m ...`), usando o
ORM para que cada vínculo novo entre no `audit_log` (ator `sistema`).

**Fontes de "mexeu" por (card, usuário), com data:**
1. `audit_log` com `actor_type='usuario'`, `actor_user_id` e `card_id` não nulos, e:
   - `entity_type='card'`, `action='criar'`;
   - `entity_type='card'`, `action='editar'` **e** o JSON `changes` contém alguma das
     chaves `title`, `description`, `priority`, `due_date`, `due_date_completed`, `done`
     (ignorar edições só de `position`/`list_id`/`archived`/`deleted_at`);
   - `entity_type in ('comentario')` com `action in ('criar','editar')`;
   - `entity_type='anexo'`, `action='criar'`;
   - `entity_type in ('checklist','item_checklist','etiqueta_card')`, qualquer ação.
   - `entity_type='card'`, `action='mover'` **e** `changes` com alguma chave de conteúdo
     acima — edição feita no mesmo PATCH de um movimento é logada como `mover`.
   Histórico começa em 2026-07-13. Linhas `integracao`/`sistema` não contam.
2. `card_comments.author_id` (`created_at`).
3. `card_attachments.uploaded_by` (`uploaded_at`), quando não nulo.

⚠️ **Import do Trello não conta.** O import (`routers/boards.py`, ~l. 265) grava todo
comentário importado com `author_id = quem rodou o import`, e as linhas de audit do import
saem como `usuario` com o id dele. Contar isso faria o importador membro de todo card
importado — o mesmo "membro de tudo" que o projeto evita. O backfill **exclui** cards,
comentários, checklists e etiquetas criados pelo import (o construtor define a detecção —
ex.: `audit_log.path = 'POST /api/boards/import'`, ou a janela de tempo de cada import,
conferindo no banco qual funciona; só 11 linhas têm esse `path`, então provavelmente
será pela janela). O dry-run informa quantos pares foram descartados por isso.

**Edição pela automação não conta:** `mark_due_complete` muda `due_date_completed` no
mesmo PATCH do movimento. Ao vivo, comparar antes/depois do corpo **antes** de rodar as
automações. No backfill, linha `mover` cuja única chave de conteúdo é
`due_date_completed` é tratada como automação e ignorada (decisão minha — perde o raro
caso de alguém marcar concluído e mover no mesmo gesto).

**Para cada par (card, usuário), adiciona se:**
- o usuário está **ativo** e é **membro do quadro atual** do card;
- ainda não é membro;
- **não saiu depois**: se existe `audit_log` `membro_card / excluir` para esse par com
  data **posterior** à última atividade dele no card, respeitar a saída e não adicionar.
  Vale **qualquer** remoção (por si mesmo, por um coordenador ou pela limpeza do
  sistema) — decisão minha: ao vivo a pessoa só volta mexendo de novo, então o backfill
  não desfaz uma remoção que aconteceu depois do último gesto dela.
  (`entity_id` do audit é o id da linha de `card_members`; o par card/usuário sai de
  `card_id` + `changes`/`entity_label` — o construtor confere o formato real das linhas
  `membro_card` antes de confiar.)

Cards de todos os estados entram (ativos, arquivados, na lixeira), desde que existam:
membro em card arquivado/na lixeira é inofensivo (o loop de lembretes já ignora) e fica
certo se o card voltar.

**Modo de execução:**
- `--dry-run` (padrão): não grava; imprime total de vínculos a criar, por quadro (nome do
  quadro + quantidade) e por pessoa, e quantos pares foram pulados por "saiu depois" e
  por "não é membro do quadro".
- `--aplicar`: grava em lotes com commit, idempotente (rodar duas vezes não duplica).

O Erick roda os dois no Konsole (banco de produção), confere o dry-run antes de aplicar.
O plano deve trazer os comandos prontos. Nenhuma credencial no script ou no plano.

**Efeito colateral checado:** só 2 cards ativos estão atrasados hoje, então o loop de
lembretes não vai disparar uma onda de "atrasado" depois do backfill. Mesmo assim, o
dry-run deve informar quantos cards abertos com `due_date` vencida ganham membro novo.

## Changelog

Entrada `2.14.0`, `melhoria`: quem mexe no card (cria, edita, comenta, anexa, checklist,
etiqueta) vira membro automaticamente; mover não conta; cards antigos corrigidos.

## Deixado para o construtor

- Nome e local exato do helper e do script.
- Como detectar "mudou conteúdo" no `update_card` (comparar antes/depois ou olhar as
  chaves do corpo — comparar é melhor: PATCH que reenvia o mesmo título não é trabalho).
- Tamanho do lote do backfill.

## Verificação (manual — não há suíte de testes)

- curl com usuário de teste membro do quadro (nunca token de colaborador real): comentar,
  anexar, editar descrição, pôr etiqueta, mexer em checklist → aparece em `members`.
- Só mover (PATCH com `list_id`/`position`) → não vira membro.
- Elevado não-membro do quadro comenta → não vira membro, comentário funciona.
- Sair do card e comentar de novo → volta.
- `npm run build` passa; changelog no topo.
- Backfill: dry-run com números plausíveis; rodar `--aplicar` duas vezes → segunda cria 0.
