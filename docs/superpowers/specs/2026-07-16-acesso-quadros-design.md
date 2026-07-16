# Acesso a quadros: vitrine aberta, porta fechada — Design

**Data:** 2026-07-16
**Status:** aprovado

## Objetivo

Todo mundo enxerga todos os quadros da empresa (para conhecer os fluxos), mas
só entra nos quadros em que é membro. Administrador e coordenador entram em
todos.

## Motivação e o achado que define o escopo

O pedido original era "abrir a listagem e pôr um cadeado nos quadros em que a
pessoa não é membro". Ao investigar, o cadeado que se imaginava existir **não
existe em nenhuma camada**.

Reproduzido em 2026-07-16 com a conta de um membro comum (Adriana Paz,
não-membro do quadro 20):

| Requisição | Resultado |
|---|---|
| `GET /api/boards` | `[]` — a listagem esconde o quadro |
| `GET /api/boards/20/lists` | **HTTP 200** — todas as listas |
| `GET /api/lists/20/cards` | **HTTP 200** — os cards, com nomes de clientes |

A única coisa que hoje segura um quadro é o **filtro da query** em
`list_boards` (`backend/app/routers/boards.py:46-54`). Os routers de listas,
cards, etiquetas, anexos e lembretes exigem apenas `get_current_user` — nenhum
deles verifica membresia. Qualquer pessoa autenticada que digite `/boards/20`
lê o quadro inteiro.

**Consequência para o escopo:** abrir a listagem e pôr só um ícone de cadeado
removeria a única barreira existente e a substituiria por um desenho. O
trabalho real é criar a barreira no backend; o ícone é a parte fácil.

Dois furos correlatos, encontrados na mesma investigação:

1. **`add_member` (`boards.py:307-313`) não verifica nada.** Qualquer usuário
   autenticado pode adicionar qualquer pessoa (inclusive a si mesmo) a
   qualquer quadro, com qualquer papel — inclusive `owner`. Um cadeado com
   botão de destrancar ao lado não é cadeado.
2. **`board_members` não tem unique em `(board_id, user_id)`** — dá para
   duplicar membro.

E uma lacuna que o resto depende:

3. **Não existe tela para gerenciar membros de um quadro.** O
   `POST /boards/{id}/members` existe, mas nenhum código do frontend o chama;
   não há `GET` nem `DELETE`. Hoje a membresia só nasce ao criar um quadro ou
   importar do Trello, e ambos põem apenas o criador como `owner`. Sem essa
   tela, a tranca não tem chave.

## Arquitetura

Três peças.

### 1. A tranca (backend)

Uma dependency reutilizável em `app/dependencies.py`, em duas formas:

- `require_board_access_by_board_id` — routers com `board_id` na URL
- `require_board_access_by_list_id` — resolve `lista → quadro` e checa igual

A regra, definida em um lugar só:

> elevado (administrador/coordenador) passa; senão exige linha em
> `board_members`; senão `403 "Você não é membro deste quadro"`.

**Aplicada no router, não por endpoint:**

```python
router = APIRouter(prefix="/boards/{board_id}/lists",
                   dependencies=[Depends(require_board_access_by_board_id)])
```

**Por quê no router:** cobertura por construção. `cards.py` tem 19 endpoints;
protegendo um a um, a tranca vale até alguém acrescentar o vigésimo e
esquecer. No router, endpoints futuros já nascem trancados.

| Router | Prefixo | Gate |
|---|---|---|
| `lists` | `/boards/{board_id}/lists` | por `board_id` |
| `labels` | `/boards/{board_id}/labels` | por `board_id` |
| `automations` | `/boards/{board_id}/automations` | por `board_id` (mantém dono/admin nas escritas) |
| `cards` | `/lists/{list_id}/cards` | por `list_id` |
| `attachments` | `/lists/{list_id}/cards/{card_id}/attachments` | por `list_id` |
| `reminders` | `/lists/{list_id}/cards/{card_id}/reminders` | por `list_id` |
| `boards` (detalhe) | `/boards/{board_id}` | por endpoint — o router tem rotas sem `board_id` (`GET /boards`, `POST /boards`, `/boards/stats`, `/boards/import`) |
| `integration` | `/integration` | **intocado** — usa `X-API-Key`, não tem usuário |

`add_member` passa a exigir **dono ou elevado**, espelhando `update_board`.

**Auditoria de graça:** o handler global de `StarletteHTTPException`
(`main.py:52-67`) já grava `acesso_negado`. Toda batida num quadro trancado
vira log automaticamente, sem código novo.

### 2. Membros do quadro (a chave)

- `GET /boards/{id}/members` — **novo**. Visível a membro do quadro ou elevado.
- `POST /boards/{id}/members` — ganha autorização (dono ou elevado).
- `DELETE /boards/{id}/members/{user_id}` — **novo**. Dono ou elevado.
  **Não permite remover o dono do quadro** (`board.owner_id`), senão o quadro
  fica órfão.
- Migration manual: unique `(board_id, user_id)` em `board_members`.
  Segue o padrão de `backend/migrations/` (rodada via psql), porque
  `create_all` não altera tabela existente.
- UI: seção "Membros" dentro do modal **Configurações do board**, que já existe
  em `BoardPage.tsx`.

### 3. A vitrine (o pedido original)

- `GET /boards` devolve **todos** os quadros.
- `BoardOut` ganha `can_open: bool` e `members: User[]`.
- **`can_open` é calculado no backend**, pela mesma regra da tranca. Uma fonte
  só: se o frontend recalculasse, cadeado e tranca poderiam divergir e a tela
  mentiria.
- Quadro trancado na listagem: visualmente apagado, ícone de cadeado, avatares
  dos membros. Clique → aviso curto: *"Você não é membro deste quadro. Fale com
  {dono} para pedir acesso."*
- `api.ts` passa a tratar `403` (hoje trata só `401`), para o acesso direto por
  URL cair numa tela amigável em vez de erro genérico.

## Decisões explícitas

**Coordenador entra em todos os quadros.** Decisão do Erick, com justificativa:
coordenador é o papel de qualidade da empresa, e ver todos os fluxos internos é
a função dele — não um efeito colateral. Vale inclusive para quadros futuros de
Financeiro/RH; foi avaliado que não haverá informação confidencial a esse ponto.
São 5 pessoas hoje.

**`/boards/stats` continua contando só os quadros em que a pessoa é membro.**
É o painel pessoal; contar quadro que ela não pode abrir inflaria o número sem
utilidade.

**Não haverá "pedir acesso" com notificação.** Avaliado e descartado por YAGNI:
seria um subsistema novo (modelo de pedido, aprovação, estados). Com 27 pessoas,
o aviso dizendo com quem falar resolve. Reavaliar se o pessoal reclamar.

**Não haverá povoamento de membresia na virada.** O quadro 20 ("Serviço") tem
hoje um único membro (Erick H., `owner`), e é um quadro de teste que o Erick vai
apagar e reimportar, adicionando membros manualmente pela nova tela. Se houvesse
quadro real em uso, ligar a tranca sem povoar antes trancaria 20 pessoas para
fora — registrado aqui porque o risco volta se a ordem mudar.

## Verificação

Não há suíte de testes no projeto; a verificação é manual (curl + navegador).

A bateria abaixo é a mesma que expôs o furo, agora invertida. Com token de um
membro comum não-membro do quadro:

| Requisição | Esperado |
|---|---|
| `GET /api/boards/{id}/lists` | `403` |
| `GET /api/lists/{id}/cards` | `403` |
| `POST /api/boards/{id}/members` (auto-adição) | `403` |
| `GET /api/boards` | `200`, quadro presente com `can_open: false` |

Com token de administrador **e** de coordenador: todas `200`.

No navegador: quadro trancado aparece apagado com cadeado e avatares; clique
mostra o aviso; `/boards/{id}` digitado na URL cai na tela amigável; a seção
Membros adiciona e remove; a auditoria registra `acesso_negado` nas tentativas.

## Changelog

Versão **1.4.0** (novidade + correção de segurança), conforme a regra
obrigatória do `CLAUDE.md`.
