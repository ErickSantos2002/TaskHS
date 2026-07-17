# Observações de integração (obs1–obs6) — design

**Data:** 2026-07-17
**Versão alvo:** v1.7.0 (novidade)
**Status:** aprovado no brainstorming; aguardando revisão da spec

## Problema

A integração com o GestorHS grava os dados de cada etapa (Recebido, Laboratório,
Pós-Vendas, Financeiro, Preparando Retorno, Finalizado) **na descrição do card**
([integration.py:51-52](../../../backend/app/routers/integration.py#L51-L52) e
[:117-127](../../../backend/app/routers/integration.py#L117-L127) — a descrição é
gravada **verbatim**, sobrescrevendo tudo). Resultado: as pessoas não conseguem usar a
descrição para escrever informação de verdade, porque o GestorHS a entope e reescreve a
cada sincronização.

## Objetivo

Separar os dados da integração da descrição livre. O card ganha **6 campos de texto
genéricos** (`obs1`…`obs6`) que **só a integração escreve**; a **descrição volta a ser
100% das pessoas**. Cada obs recebe um **nome por quadro** (ex.: "Recebido",
"Laboratório"…) e é exibida como um chip clicável acima da descrição, abrindo uma
mini-modal só-leitura com o texto.

O recurso é **genérico e por-quadro**: um toggle liga/desliga a exibição num quadro, e
os nomes das obs são configuráveis. Um quadro pode usar as 6, ou só 3, ou nenhuma. A
nomenclatura neutra (`obs1`…`obs6`) permite reaproveitar em outros quadros/integrações
no futuro sem migration nova.

## Decisões (definidas no brainstorming)

1. **Integração x descrição:** a integração passa a escrever **só nas obs** e **para de
   tocar na descrição**. (O backend continua **aceitando** `description` por
   compatibilidade — o GestorHS é que deixa de enviá-la.)
2. **Obs vazia:** o chip da obs **aparece sempre** (quando a obs está nomeada e ativa),
   mas fica **esmaecido/desabilitado** enquanto não tiver conteúdo. Assim todos veem o
   fluxo completo de etapas.
3. **Edição:** as obs são **somente leitura** na UI. A mini-modal só exibe; ninguém
   edita à mão (evita que a próxima sincronização sobrescreva edição manual).
4. **Ativar/nomear obs:** **nome preenchido = obs ativa**. Não há checkbox separado. 6
   campos de nome no config do quadro; preencher o nome mostra a obs, deixar em branco
   esconde. Para usar só 3, nomeie só 3.
5. **Descrições antigas (backfill):** **nenhum** — não há script. A integração para de
   mandar descrição; o texto antigo que já está lá permanece até alguém apagar à mão.
   Zero risco de perda.

## Modelo de dados

### `cards` — 6 colunas novas
`obs1 … obs6 TEXT NULL`. Tipo `Text` (ilimitado, como `description`). Nullable.

### `boards` — 2 colunas novas
- `integration_enabled BOOLEAN NOT NULL DEFAULT false` — o toggle "este quadro recebe
  informações de integração?".
- `obs_labels JSONB NOT NULL DEFAULT '[]'` — array de até 6 strings; posição `i`
  (0-based) nomeia `obs{i+1}`. String vazia/ausente = obs inativa.

**Regra de exibição de uma obs no card:** `board.integration_enabled == true` **E**
`obs_labels[i]` é uma string não-vazia. Sem nome ⇒ não aparece, mesmo que a coluna tenha
dado.

### Migration `006_board_obs_integration.sql`
Segue o padrão dos arquivos em [backend/migrations/](../../../backend/migrations/) (SQL
idempotente, aplicado à mão via `./scripts/psql-dev.sh -f ...`). `create_all` **não
altera tabelas existentes**, então as colunas em `cards`/`boards` (tabelas que já
existem) precisam desta migration em dev e em produção.

```sql
-- Observações de integração: 6 campos de texto por card + config por quadro.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs1 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs2 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs3 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs4 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs5 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs6 TEXT;

ALTER TABLE boards ADD COLUMN IF NOT EXISTS integration_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS obs_labels JSONB NOT NULL DEFAULT '[]'::jsonb;
```

## Backend

### Model — [models/card.py](../../../backend/app/models/card.py)
`Card` ganha `obs1 … obs6: Mapped[str | None] = mapped_column(Text)`. Manter a ordem
atual (coleções antes do relationship `list`, para não sombrear o builtin).

### Model — [models/board.py](../../../backend/app/models/board.py)
`Board` ganha:
- `integration_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")`.
- `obs_labels: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")`.

### Schemas — [schemas/board.py](../../../backend/app/schemas/board.py)
- `BoardCreate`: `integration_enabled: bool = False`, `obs_labels: list[str] = []`.
- `BoardUpdate`: `integration_enabled: bool | None = None`, `obs_labels: list[str] | None = None`.
- `BoardOut`: inclui `integration_enabled: bool` e `obs_labels: list[str]`.
  `BoardListOut` herda ⇒ a listagem já os traz (usados pela UI para decidir exibição).
- **Validação de `obs_labels`** (validator): no máximo **6** itens; cada item string,
  `.strip()` aplicado, tamanho ≤ 60 chars. Mais que 6 ⇒ `422`.

### Serialização de card — [routers/cards.py](../../../backend/app/routers/cards.py)
`_card_to_dict` passa a incluir `obs1 … obs6`. (Sempre incluídos; são `null` em cards de
quadros sem integração — custo desprezível, e a UI decide o que mostrar.) Como a
integração também usa `_card_to_dict` para responder, a resposta do upsert já reflete as
obs.

### Integração — [routers/integration.py](../../../backend/app/routers/integration.py)
- `IntegrationCardIn` ganha `obs1 … obs6: str | None = None`.
- Criação (construtor do `Card`): passar os 6 obs.
- `_apply_updates`: para cada `obs{n}` presente em `sent` (`exclude_unset`), aplicar —
  **mesma semântica de update parcial** já usada por `description` (omitir preserva,
  `null` limpa).
- **`description` continua aceita e opcional** — nada é removido no backend. É o GestorHS
  que deixa de enviá-la. Backward-compatible: nenhum integrador antigo quebra.
- O flag `integration_enabled` **não** é checado aqui: a integração continua escrevendo
  por `list_id` como hoje. O flag é **só de exibição** no frontend. (O GestorHS mira só
  aquele quadro; não há ganho em validar o flag no upsert.)

### Autorização
**Sem checagem nova.** A config do quadro entra pelo `PATCH /boards/{id}` (`update_board`),
que já exige **dono ou elevado** ([boards.py]). Os campos `integration_enabled`/`obs_labels`
viajam nesse mesmo PATCH e herdam o gate. As obs no card são servidas pelo `_card_to_dict`
já trancado por membresia do quadro.

## Frontend

### Tipos — [types/index.ts](../../../frontend/src/types/index.ts)
- `Board` (e portanto `BoardListItem`): `+ integration_enabled: boolean`, `+ obs_labels: string[]`.
- `Card`: `+ obs1 … obs6: string | null`.

### Config do quadro — drawer em [BoardPage.tsx:2316](../../../frontend/src/pages/BoardPage.tsx#L2316)
Entre a Cor e o botão "Salvar alterações":
- Toggle **"Este quadro recebe informações de integração?"** (liga `integration_enabled`).
- Quando ligado, revela **6 inputs de nome** ("Nome da observação 1" … "6"), pré-preenchidos
  de `obs_labels`. Vazio = obs oculta.
- Estado do form estende os já existentes (`editBoardTitle/Description/Color`); `handleSaveBoard`
  ([:1954](../../../frontend/src/pages/BoardPage.tsx#L1954)) inclui `integration_enabled` e
  `obs_labels` no PATCH. O front sempre envia 6 entradas (padding com `""`).

### Card — chips acima da descrição em [BoardPage.tsx:638](../../../frontend/src/pages/BoardPage.tsx#L638)
Logo **antes** do bloco `{/* Description */}`, se `board.integration_enabled`:
- Renderiza uma linha de chips — um por obs **nomeada** (`obs_labels[i]` não-vazio).
- Cada chip mostra o nome. **Habilitado** se `card.obs{i+1}` tem conteúdo; **esmaecido/
  desabilitado** se vazio/null.
- Clique num chip habilitado → abre **mini-modal só-leitura** com título = nome da obs e
  corpo = texto da obs (texto plano, `whitespace-pre-wrap`, scroll se longo). Fechar por
  X / clique fora / Esc.
- O `CardDetailModal` precisa receber `integration_enabled` + `obs_labels` do board (já
  disponíveis na página; passar via props).

### Mini-modal
Componente pequeno e local (overlay + card central), no estilo dos modais existentes.
Só leitura; sem textarea editável.

## Docs

### [docs/integration.md](../../integration.md) — atualizar (obrigatório)
- **Seção 3.1** (tabela de campos do `POST /integration/cards`): adicionar
  `obs1 … obs6 | string | null | — | Texto da etapa/observação N (exibido no card se o
  quadro tiver integração ligada e a obs nomeada).`
- **Resposta 200** (exemplo JSON): incluir `obs1 … obs6`.
- **Seção 4.2** (update parcial): mencionar que `obs1…obs6` seguem a mesma regra
  (omitir preserva, `null` limpa).
- **Seção 4.5** ("o que a integração não faz") / visão geral: registrar que a descrição
  **não deve mais ser usada** pela integração — passou a ser campo livre do usuário; os
  dados de etapa vão nas obs.
- **Seção 6** (pseudo-código GestorHS): trocar `"description": os.obs` por
  `"obs1": ..., "obs2": ...` conforme as etapas, e **remover** o envio de `description`.
  Adicionar nota: no TaskHS, ligar o toggle de integração no quadro e nomear as obs.

### [CLAUDE.md](../../../CLAUDE.md) — atualizar (leve)
Uma linha na seção da integração/arquitetura registrando as obs e o toggle por quadro.

### [changelog.ts](../../../frontend/src/data/changelog.ts) — obrigatório
Nova entrada **v1.7.0** no topo (novidade): "Observações de integração — 6 campos que a
integração preenche sem poluir a descrição; configuráveis por quadro". `date: 2026-07-17`.

## Fora de escopo (YAGNI)

- Backfill / migração das descrições atuais (decidido: não fazer).
- Edição manual das obs pela UI.
- Mais de 6 obs, ou número dinâmico por quadro além dos 6 slots.
- Validação/checagem do `integration_enabled` no endpoint de integração.
- Alterar o lado do GestorHS (é outro repositório; aqui só documentamos o contrato).

## Verificação (manual — não há suíte de testes)

1. `./scripts/psql-dev.sh -f backend/migrations/006_board_obs_integration.sql` aplica sem erro.
2. `PATCH /boards/{id}` com `integration_enabled=true` + `obs_labels=["Recebido","Laboratório"]`
   grava e volta em `GET /boards/{id}` e na listagem.
3. `POST /api/integration/cards` (com `X-API-Key`) enviando `obs1`/`obs2` grava; `GET` do
   card mostra as obs; a `description` fica intacta.
4. No navegador: quadro com integração ligada mostra os chips acima da descrição; chip
   com conteúdo abre a mini-modal; chip vazio fica esmaecido; quadro **sem** o toggle não
   mostra nada disso.
5. `cd frontend && npm run build` passa.
