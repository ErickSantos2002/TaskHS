# Busca global — design

**Data:** 2026-07-30
**Status:** aprovado no brainstorming, aguardando revisão do Erick

## Problema

Hoje só existe busca **dentro** de um quadro: o campo "Buscar card…" no cabeçalho
do [BoardPage](../../../frontend/src/pages/BoardPage.tsx), que filtra em memória os
cards já carregados daquele quadro. Para achar um cartão sem saber em qual quadro
ele está, a pessoa abre quadro por quadro.

O pedido concreto veio de **Serviços**: eles precisam achar um atendimento pelo
**número de série do aparelho**. Esse dado não está no título nem na descrição —
está no meio do texto que a integração grava nos campos `obs1..obs6`, no formato

```
Cliente: ULTRACARGO LOGISTICA S.A.
Aparelho: Iblow10-c · Série VAM5D0008 / Patr. 8
Serviço: Calibração
```

Ou seja: a busca precisa varrer as observações, não só título/descrição.

E precisa fazer isso **sem furar a autorização por membresia** (v1.4.0): um
membro comum não pode receber, nem por acidente, um card de quadro do qual não
participa.

## Escopo

**Dentro:**
- Endpoint `GET /api/search` que varre `title`, `description` e `obs1..obs6` dos
  cards que a pessoa **pode ver**.
- Caixa de busca na topbar do `MainLayout`, presente em todas as páginas, com
  dropdown de resultados e navegação por teclado.
- Clique no resultado abre o card no quadro, **inclusive se estiver arquivado**.

- **Comentários** (acrescentado a pedido do Erick em 2026-07-30, depois do
  desenho original): o texto dos comentários vivos entra na mesma varredura.
  Muito do que se sabe de um atendimento foi escrito na conversa — inclusive
  números de série que nunca chegaram aos campos do card.

**Fora (de propósito):**
- Itens de checklist e nomes de anexo. Se Serviços sentir falta, é um
  incremento pequeno depois.
- Buscar **quadros** por nome — com 11 quadros, a página de Boards já resolve.
- Filtros (quadro, prioridade, etiqueta, período) e paginação. Se virarem
  necessidade, o caminho é uma página `/busca` dedicada, não inchar o dropdown.
- Full-text search, `pg_trgm`, `unaccent` e índice para o `LIKE`. Ver
  "Desempenho" — o único índice criado é o de chave estrangeira dos comentários.

## Volume (o que justifica a solução simples)

Medido em 2026-07-30 no banco em uso: **1233 cards**, 80 com observações
preenchidas, 16 arquivados, **11 quadros**. Extensões instaladas: só `plpgsql`.

Nessa ordem de grandeza um *sequential scan* com `LIKE` custa poucos
milissegundos. Full-text/trigram seria complexidade sem retorno — e `unaccent`
exigiria `CREATE EXTENSION` no banco de produção antes do deploy, um passo
manual que, esquecido, derruba a busca inteira.

## Backend

### Router novo

`backend/app/routers/search.py`, prefixo `/api/search`, montado no
[main.py](../../../backend/app/main.py). Não encosta em router existente.

A tranca é `get_current_user` — **não** as dependencies de quadro
([dependencies.py](../../../backend/app/dependencies.py)), porque a busca não
tem `board_id` nem `list_id` na URL: o recorte de acesso é o resultado, não a
entrada.

```
GET /api/search?q=<texto>&limit=20
```

- `q`: obrigatório. Depois de normalizado, precisa ter **≥ 2 caracteres**;
  abaixo disso devolve lista vazia (não erro) — o front nem chega a chamar.
- `limit`: default 20, teto 50.

### Autorização: filtro em SQL, nunca checagem por card

Este é o ponto crítico. A regra é a mesma de `user_can_access_list`, só que
aplicada de uma vez ao conjunto:

```python
if not current_user.is_elevated:
    listas_visiveis = (
        select(ListModel.id)
        .join(BoardMember, BoardMember.board_id == ListModel.board_id)
        .where(BoardMember.user_id == current_user.id)
    )
    stmt = stmt.where(Card.list_id.in_(listas_visiveis))
```

Elevado (administrador/coordenador) não recebe filtro — coerente com o resto do
sistema, onde o coordenador enxerga todos os fluxos.

Fazer isso como subselect e não como pós-filtro em Python é deliberado: card de
quadro alheio **nunca é materializado**, então não há como vazar por um descuido
de serialização, e não há N+1.

### O casamento

Os **comentários** entram por uma subquery correlacionada agregada, não por
JOIN:

```sql
(SELECT coalesce(string_agg(cc.body, ' '), '')
   FROM card_comments cc
  WHERE cc.card_id = cards.id AND cc.deleted_at IS NULL)
```

Com JOIN, um card com três comentários casando viraria três linhas no
resultado, e o "todas as palavras" passaria a valer **por comentário** em vez de
por card — buscar `cliente prazo` deixaria de achar o card em que cada palavra
está num comentário diferente. Comentário excluído (soft delete) fica de fora.

Isso exige um índice em `card_comments(card_id)` — migration `009`, aplicada
sozinha no boot pelo runner de migrations. O Postgres não indexa chave
estrangeira por conta própria, e sem o índice cada card varria a tabela de
comentários inteira: o `EXPLAIN ANALYZE` mostrava 1237 varreduras numa busca só.

Todos os campos viram um "monte de feno" único por card, normalizado por
`lower()` + `translate()` (nativo do Postgres, sem extensão):

```sql
translate(
  lower(coalesce(cards.title,'') || ' ' || coalesce(cards.description,'') || ' ' ||
        coalesce(cards.obs1,'')  || ' ' || … || ' ' || coalesce(cards.obs6,'')),
  'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
  'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'
) LIKE :termo1 AND … LIKE :termoN
```

(o `lower()` vem antes, então as maiúsculas acentuadas no `translate` são
redundância barata, não obrigação.)

**Todos os termos, em qualquer ordem, em qualquer campo.** `q` é quebrado em
palavras por espaço; cada palavra passa pela mesma normalização em Python e vira
um `LIKE '%palavra%'` em `AND`. Assim `ultracargo iblow` acha o card com o
cliente numa obs e o aparelho em outra, e `VAM5D0008` sozinho funciona igual.

**Escape obrigatório:** `%`, `_` e `\` do termo são escapados antes de virar
padrão (`LIKE :p ESCAPE '\'`). Sem isso, digitar `%` na caixa devolve o banco
inteiro.

`q` sempre vai como **parâmetro bindado** — nada de f-string montando SQL.

### Ordenação e resposta

Ordem: **casou no título primeiro** (`CASE WHEN <título casa> THEN 0 ELSE 1`),
depois `cards.updated_at DESC`. Limite aplicado no SQL.

Cada item da resposta (schema novo em `backend/app/schemas/search.py`):

```python
class SearchResultOut(BaseModel):
    card_id: int
    list_id: int
    board_id: int
    board_title: str
    board_color: str | None
    list_title: str
    title: str
    priority: str
    due_date: date | None
    archived: bool
    snippet: str
    matched_field: str   # "titulo" | "descricao" | "obs" | "comentario"
```

`archived` é `card.archived OR list.archived`: card em lista arquivada também
sumiu da cara do quadro e precisa do mesmo tratamento na hora de abrir.

O JOIN com `lists` e `boards` já é necessário para o filtro de acesso, então
`board_title`/`list_title` saem de graça na mesma query — sem consulta extra.

### O snippet

Montado em **Python**, não no SQL (é formatação, não busca). Para cada card do
resultado: percorre `title`, `description`, `obs1..obs6` e, por último, os
comentários, acha o primeiro campo que contém o **primeiro termo** (comparando
as versões normalizadas), e recorta ~120 caracteres em volta dele, com `…` nas
pontas cortadas. Quebras de linha viram espaço — o dropdown mostra uma linha só.

Os comentários vêm por último de propósito: quando o termo está no card **e**
numa conversa, o campo do card explica melhor de onde veio o resultado. Quando
a origem é um comentário, o front prefixa a linha com "em comentário:" — sem
isso, o trecho parece um dado do próprio card.

Os textos dos comentários chegam por uma consulta só, pelos `card_id` dos até 20
cards que sobraram: o `string_agg` da query de casamento serve para casar, não
para exibir.

É o snippet que produz a linha útil `…Aparelho: Iblow10-c · Série VAM5D0008 /
Patr. 8`, que é justamente o que Serviços quer conferir antes de clicar.

O front recebe o texto cru e destaca o termo por conta própria (evita HTML vindo
do backend).

## Frontend

### Componente próprio

`frontend/src/components/GlobalSearch.tsx`, montado no
[MainLayout](../../../frontend/src/layouts/MainLayout.tsx) naquele
`<div className="flex-1" />` vazio da topbar. Fica disponível no Dashboard, em
Boards, no quadro, em Logs — em tudo que está dentro do layout.

Componente separado, e não mais um pedaço do `BoardPage`, porque aquele arquivo
já tem ~3200 linhas: é o arquivo mais arriscado de editar do projeto, e a busca
não tem nada a ver com a mecânica do quadro.

### Comportamento

- **Debounce de 250 ms** e mínimo de 2 caracteres antes de chamar a API.
- **Guarda contra resposta fora de ordem:** um contador de requisição; resposta
  cujo id não é o último é descartada. Sem isso, a busca lenta de `VAM` chega
  depois e sobrescreve o resultado de `VAM5D0008`.
- **Teclado:** `Ctrl+K` / `⌘+K` foca a caixa de qualquer lugar (com
  `preventDefault`); `↑`/`↓` andam pelos resultados; `Enter` abre o marcado;
  `Esc` fecha o dropdown (e, com ele já fechado, limpa a caixa). Clique fora
  fecha.
- **Estados visíveis:** "Buscando…", "Nenhum resultado para *x*", e erro de rede
  com uma linha discreta — nunca dropdown vazio e mudo.

### Cada resultado

```
┌──────────────────────────────────────────────┐
│ ULTRACARGO LOGISTICA S.A.        [Arquivado] │
│ Serviços › Recebido                          │
│ …Aparelho: Iblow10-c · Série VAM5D0008 / P…  │
└──────────────────────────────────────────────┘
```

Título do card em destaque, `Quadro › Lista` em cinza pequeno, snippet com os
termos em negrito, selo `Arquivado` quando `archived`. Estilo herdado do que já
existe (mesmas classes de `bg-background-surface`, `border-border`, e o padrão do
dropdown do sino, que é o vizinho na topbar).

## Abrir o resultado

Clique/`Enter` → `navigate('/boards/{board_id}?card={card_id}&list={list_id}')`
e fecha o dropdown.

O deep link `?card=` **já existe** no BoardPage (a página de Logs usa), mas só
encontra card presente em `cardsByList`, que é carregado sem arquivados. Como os
arquivados entram no resultado, o efeito do deep link ganha um fallback:

```
não achou em cardsByList  e  veio &list=<id>
   → GET /lists/{list_id}/cards/{card_id}   (endpoint já existente, não filtra archived)
   → abre o modal com o card retornado
```

O `&list=` evita ter que criar um `GET /api/cards/{id}` novo — e um endpoint sem
`list_id` na URL ficaria fora do gate de router de `cards`, que é exatamente a
armadilha descrita no CLAUDE.md. A rota buscada continua trancada por
`require_board_access_by_list_id`: um `list_id` forjado dá 403, não 200.

No modal, quando `card.archived`, uma faixa discreta no topo: **"Cartão
arquivado"**, com o botão de restaurar que já existe na tela de Arquivados. Não
bloqueia edição — só informa por que aquele card não aparece no quadro.

Quando o card **não** está arquivado, nada muda: o fluxo atual já funciona.

## Desempenho

Uma query de casamento (scan sequencial em 1233 linhas, `LIMIT 20`) mais uma
consulta dos comentários dos até 20 cards que sobraram, usada só para recortar
o snippet. Medido: ~110 ms de banco por busca antes do índice, menos depois. Em
desenvolvimento a resposta leva ~500 ms, mas isso é o banco remoto — qualquer
endpoint autenticado custa ~350 ms aqui; a busca acrescenta ~100 ms.

O único índice novo é o de `card_comments(card_id)` (chave estrangeira, acima).
Nada de índice para o `LIKE`: um B-tree não serve para `LIKE '%x%'` e um GIN de
trigram seria peso morto nesse volume. Se um dia a base passar de ~50 mil cards
e a busca começar a pesar, o caminho é `pg_trgm` + índice GIN sobre a mesma
expressão — a query não precisa mudar de forma.

O front só chama a API a partir de 2 caracteres e com debounce, então digitar um
número de série de 9 caracteres gera ~1 requisição, não 9.

## Riscos e o que verificar

Não há suíte de testes no projeto; a verificação é manual.

| Risco | Como verificar |
|---|---|
| **Vazamento de card de quadro alheio** (o risco principal) | `curl` no `/api/search` com token de um **membro comum**, buscando um termo que só existe em quadro do qual ele não participa → resultado vazio. O mesmo termo com token de admin → aparece. |
| Termo com `%` ou `_` devolvendo tudo | `q=%` → nenhum resultado (ou só cards que tenham literalmente `%`). |
| Acento | `calibracao` acha "Calibração"; `CALIBRAÇÃO` acha o mesmo card. |
| Número de série real | `VAM5D0008` na caixa → o card da ULTRACARGO aparece com o snippet da obs. |
| Comentário | Termo que só existe num comentário (ex.: `curto conserto`) acha o card, com origem `comentario` e sem duplicar o card no resultado. |
| Card arquivado | Buscar um arquivado, clicar, e o modal abrir com a faixa "Cartão arquivado". |
| Resposta fora de ordem | Digitar rápido um termo longo e conferir que o resultado final corresponde ao texto que ficou na caixa. |
| Build | `cd frontend && npm run build` passando. |

## Changelog

Fecha com entrada nova em
[frontend/src/data/changelog.ts](../../../frontend/src/data/changelog.ts) como
**novidade**, versão **1.13.0** (funcionalidade nova → minor).
