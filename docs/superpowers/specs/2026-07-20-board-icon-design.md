# Ícone do quadro — design

**Data:** 2026-07-20
**Status:** aprovado no brainstorming, aguardando revisão do Erick

## Problema

No drawer de Configurações do quadro só dá para escolher a **cor**. Com ~10
quadros por setor (TI, Vendas, Financeiro, RH, Laboratório, Expedição...), a cor
sozinha não basta para reconhecer o quadro de relance: as cores se repetem e o
que diferencia é o texto do nome, que exige leitura.

A pedido: um seletor de **ícone** logo abaixo do seletor de Cor.

## Escopo

**Dentro:** ícone por quadro, escolhido numa grade curada, editável no drawer de
Configurações, exibido em toda tela onde o quadro aparece.

**Fora (de propósito):**
- Ícone em lista/coluna — o pedido foi só para o quadro. Se for desejado, vira um
  ciclo próprio depois deste funcionar.
- Ícone em etiqueta.
- Upload de imagem própria como ícone.

## Dados

Campo novo em `Board` ([backend/app/models/board.py](../../../backend/app/models/board.py)),
irmão direto de `color`:

```python
icon: Mapped[str | None] = mapped_column(String(40))
```

**Nulo = sem ícone escolhido**, e o front cai no `IBoard` genérico que já é
usado hoje. Isso faz os quadros existentes continuarem funcionando sem
preenchimento nenhum, e dá um estado "Sem ícone" real para quem quiser limpar.

Guarda-se o **nome** do ícone (ex.: `"truck"`), não o SVG.

### Migration

`create_all` **não altera tabela existente** (ver CLAUDE.md), então a coluna
precisa de SQL manual — `backend/migrations/007_board_icon.sql`:

```sql
ALTER TABLE boards ADD COLUMN IF NOT EXISTS icon VARCHAR(40);
```

Rodar com `./scripts/psql-dev.sh -f backend/migrations/007_board_icon.sql`.

Sem `NOT NULL` e sem default: é aditiva, não trava a aplicação em execução, e o
rollback é um `DROP COLUMN` se preciso.

## API

`icon` entra em `BoardCreate`, `BoardUpdate` e `BoardOut`
([backend/app/schemas/board.py](../../../backend/app/schemas/board.py)).
`BoardListOut` herda de `BoardOut`, então a listagem ganha o campo de graça.

- `BoardCreate.icon: str | None = None`
- `BoardUpdate.icon: str | None = None`
- `BoardOut.icon: str | None`

**Permissão:** nenhuma linha nova. `update_board` já exige dono ou elevado, então
editar o ícone nasce com a mesma regra da cor.

**Validação:** o backend checa só o **formato** — `^[a-z0-9-]{1,40}$` — e não a
lista de nomes válidos. O catálogo é uma decisão de frontend; replicá-lo no
Python criaria dois lugares para editar toda vez que se quisesse um ícone novo, e
os dois sairiam de sincronia. Nome desconhecido não quebra nada: o front cai no
genérico.

`""` (string vazia) é normalizado para `None` no validator, para "limpar o
ícone" ter uma representação só no banco.

## Frontend

### Catálogo

Módulo novo `frontend/src/lib/boardIcons.tsx`, com um **mapa explícito** de nome
para componente `lucide-react` (já é dependência do projeto):

```tsx
export const BOARD_ICONS = {
  folder: Folder,
  users: Users,
  "bar-chart": BarChart3,
  wrench: Wrench,
  truck: Truck,
  // ~28 no total
} as const;
```

Mapa explícito e não import dinâmico por dois motivos: o Vite consegue
tree-shakear (só os 28 entram no bundle, não a biblioteca toda), e não existe o
risco de renderizar um nome arbitrário vindo do banco.

Cobertura pretendida, mirando os setores da empresa: pasta, pessoas, gráfico,
ferramenta, caminhão, dinheiro, frasco/laboratório, monitor, pacote, alvo,
escudo, telefone, engrenagem, prancheta, calendário, carrinho, documento, mala,
sino, estrela, casa, mapa, raio, chave, lâmpada, coração, marcador, tag.

Helper de renderização, com o fallback num lugar só:

```tsx
export function BoardIcon({ name, className }: { name?: string | null; className?: string })
```

Devolve o genérico quando `name` é nulo **ou** não está no mapa.

### Seletor

No drawer de Configurações ([BoardPage.tsx](../../../frontend/src/pages/BoardPage.tsx)),
imediatamente abaixo do seletor de Cor, seguindo a mesma linguagem visual dele:
grade de botões quadrados, o ativo com anel, cada ícone pintado com a cor
escolhida do quadro. Mais um botão **"Sem ícone"** que zera o campo.

Estado local `editBoardIcon`, salvo no mesmo "Salvar alterações" que já manda
título/descrição/cor — não é um botão separado.

### Exibição

Substitui o `IBoard` genérico nos quatro pontos onde o quadro se apresenta:

| Onde | Hoje |
|---|---|
| Grade de Boards | [BoardsPage.tsx:411](../../../frontend/src/pages/BoardsPage.tsx#L411) |
| Lista de Boards | [BoardsPage.tsx:466](../../../frontend/src/pages/BoardsPage.tsx#L466) |
| Dashboard | [DashboardPage.tsx:222](../../../frontend/src/pages/DashboardPage.tsx#L222) |
| Cabeçalho do quadro | [BoardPage.tsx:2347](../../../frontend/src/pages/BoardPage.tsx#L2347) |

Nos três primeiros o quadradinho colorido já existe — só troca o conteúdo. No
cabeçalho, hoje é uma bolinha de cor de 3x3; vira o ícone na cor do quadro.

**O cadeado ganha do ícone.** Na grade, quadro sem acesso mostra `ILock` no lugar
do ícone, e isso continua tendo prioridade: se o ícone sobrescrevesse o cadeado,
a pessoa perderia a informação de que não pode entrar.

### Tipo

`Board` em [types/index.ts](../../../frontend/src/types/index.ts) ganha
`icon?: string | null`.

## Casos de borda

- **Quadro antigo (icon nulo):** ícone genérico, como hoje. Nada muda até alguém
  escolher.
- **Nome de ícone desconhecido** (catálogo encolheu, ou lixo no banco): cai no
  genérico. Não quebra a tela.
- **Quadro trancado:** cadeado tem prioridade (acima).
- **Contraste:** o ícone herda a cor do quadro, igual ao que já acontece com o
  quadradinho de fundo — sem regra de contraste nova.

## Verificação

Não há suíte de testes no projeto; a verificação é manual:

1. `./scripts/psql-dev.sh -c "\d boards"` mostra a coluna `icon`.
2. `npm run build` passa.
3. No drawer: escolher ícone → Salvar → o ícone aparece no cabeçalho, na grade,
   na lista e no Dashboard.
4. "Sem ícone" → volta ao genérico.
5. Quadro que a pessoa não é membro continua com cadeado na grade.
6. Modo claro e escuro.

## Changelog

Fecha com entrada nova em `frontend/src/data/changelog.ts` — novidade, minor
(v1.9.0).
