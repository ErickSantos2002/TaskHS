# Cards travados por setor — design

**Data:** 2026-10-27 · **Versão alvo:** 2.12.0

## Intenção

A Qualidade quer saber **quais setores estão travando o processo**. O Nicholson
perguntou "quantos cards estão parados no Financeiro?", e hoje não há como
responder sem contar quadro por quadro: vários quadros têm uma lista Financeiro,
outros têm Laboratório (o de Serviços tem mais de uma) e assim por diante. O
Nicholson só consulta o número. Quem age é a **Qualidade**, que procura o setor
pra entender por que o processo parou. A tratativa acontece fora do sistema,
igual à do alerta de 72 h.

Hoje o Dashboard já tem o alerta de 72 h úteis, contado a partir da **criação do
card** (por quadro, v2.9.0). Esta feature cria uma **segunda régua, menor e por
lista**.

## Decisões do Erick

- **Régua por lista: o card não pode ficar mais de 24 h na mesma lista.** O
  relógio começa quando o card entra na lista atual. A régua de 72 h
  continua como está.
- **Agrupamento por etiqueta de setor em cada lista**, e não pelo nome da lista.
  Os nomes são bagunçados demais: `Financeiro`/`💰 Financeiro`/`💰Financeiro`,
  `Laboratório`/`Laboratorio`/`🔬Laboratório Calibração`/`🔬LIBERADOS DO LABORATÓRIO`,
  e há casos ambíguos como `Despachado (Correios)` e `Aguardando Coleta`.
- **Pré-preencher a etiqueta pelo nome** da lista. Depois a empresa corrige o
  que ficou errado.
- **Os setores são um cadastro no admin**, não uma lista fixa no código. Setor
  novo não pode depender de deploy.
- **O bloco no Dashboard** (aprovado como descrito): fica abaixo do alerta de
  72 h, com o título "Travados por setor (24 h úteis na lista)" e uma barra por
  setor, do maior para o menor. Clicar no setor abre a lista dos cards travados
  dele, com card, quadro, lista e tempo parado, no mesmo estilo do modal do
  alerta de 72 h. O bloco respeita o seletor de quadro: em "Todos", soma os
  quadros todos; com um quadro escolhido, mostra só os setores dele. Lista sem
  setor e lista "de concluído" não entram na conta.

## Decisões minhas (o Erick pode revisar)

- **24 h *úteis*:** a mesma régua de `app/horas_uteis.py` (segunda a sexta,
  horário de Brasília, feriado conta). Assim um card que entrou na sexta à
  tarde não aparece travado na segunda de manhã. Constante nova
  `LIMITE_HORAS_LISTA = 24`, ao lado de `LIMITE_HORAS`.
- **Quando o card entrou na lista:** coluna nova `cards.list_entered_at`
  (timestamptz, NOT NULL). Não calcular pelo `audit_log` a cada request: o
  Dashboard roda sobre todo card ativo.
  - Ela é gravada em **todo lugar que muda o `list_id`** de um card: criação
    (= `created_at`), `update_card` quando o `list_id` muda, `copy_card` (o card
    novo começa agora), upsert/movimento da integração e import do Trello (=
    `created_at` do card). Mudar só a `position` dentro da mesma lista **não**
    zera o relógio. Restaurar da lixeira não mexe nela.
  - **Desarquivar o card zera o relógio** (tela, `cards.py` unarchive, e campo
    `archived` no upsert da integração): um card que passou meses arquivado
    não pode voltar já "travado". **Desarquivar a lista não zera** (igual à
    lixeira) — caso raro, e zerar exigiria atualizar todos os cards dela.
  - Quem implementa deve achar todos os pontos com um `grep` por atribuições a
    `list_id` em `backend/app`. Um ponto esquecido deixa o relógio parado e o
    card aparece travado sem estar.
  - **Backfill** (na migration): para cada card, o `created_at` do último
    `audit_log` com `entity_type='card'`, `action='mover'`, `card_id` = o card e
    `changes::json->'list_id'->>'para'` = o `list_id` atual. Se não houver,
    usar `created_at`. O audit tem os "mover" desde 2026-07-13 (de usuário e
    da integração), então isso cobre todos os cards criados no TaskHS.
- **Quem conta como travado:** card vivo e não arquivado, numa lista viva, não
  arquivada, **com setor** e **não `is_done`**, num quadro vivo e não
  arquivado, visível para a pessoa (o mesmo recorte de `_quadros_visiveis`), e
  `horas_uteis(list_entered_at, agora) > 24`.
- **Setores sem nenhum travado** aparecem no bloco com 0, em cinza, no fim da
  lista. Para a Qualidade, "Financeiro 0" também é informação. Entra no bloco
  todo setor que tenha pelo menos uma lista contada no recorte atual. Se
  nenhuma lista do recorte tiver setor, o bloco mostra um estado vazio que
  explica onde se marca o setor (drawer do quadro).

### Cadastro de setores

- Tabela `setores`: `id`, `nome` (único, sem diferenciar maiúsculas), `ativo`
  (bool, default true), `created_at`.
- **Não há exclusão, só desativar.** Setor desativado some do seletor do drawer,
  mas as listas que já o usam continuam marcadas e continuam contando no
  Dashboard. Assim desativar nunca apaga histórico sem querer. Para tirar uma
  lista do setor, troque a etiqueta no drawer.
- API `/api/setores`: `GET` para qualquer autenticado (o drawer precisa), com
  `?todos=1` para incluir os inativos (a tela de admin usa). `POST` e `PATCH
  /{id}` (`nome`, `ativo`) só para **administrador** (`get_admin_user`).
  Nome duplicado dá 409.
- Tela **`/setores`**, com item no menu lateral visível só para administrador,
  ao lado de Usuários/Logs e com o mesmo visual da tela de Usuários. Tem uma
  tabela simples (nome, nº de listas que usam, ativo) e um botão "Novo setor";
  renomear e ativar/desativar são feitos na própria linha.

### Etiqueta na lista

- Coluna `lists.setor_id` (FK → `setores.id`, nullable, `ON DELETE SET NULL`).
  Vai no `ListOut` e no snapshot do quadro (`setor_id`).
- **Drawer do quadro**, na mesma seção em que se marcam as listas de concluído:
  cada lista ativa ganha um `<select>` "Setor" (opção "— sem setor —" + os
  setores ativos; se a lista estiver num setor inativo, ele aparece como
  opção, marcado "(inativo)"). É salvo pelo mesmo botão "Salvar" do drawer.
- Endpoint `PUT /api/boards/{board_id}/list-setores`, corpo
  `{"setores": {"<list_id>": <setor_id|null>, ...}}`. Segue o mesmo critério e
  a mesma forma do `set_done_lists`: dono ou elevado, quadro gravável
  (`assert_board_writable`), mexe só em lista ativa, lista de outro quadro dá
  400 e setor inexistente dá 400. Diferente do `done-lists`, ele **só altera
  as listas presentes no corpo**. Assim, uma lista arquivada mantém o setor.
  - Setor que estava inativo e continua igual é aceito. Atribuir setor inativo
    *novo* dá 400.

### Pré-preenchimento (migration `016_setores.sql`)

1. Cria `setores`, `lists.setor_id` e `cards.list_entered_at` (com o backfill
   acima, depois `SET NOT NULL`).
2. Insere os setores iniciais: Financeiro, Laboratório, Expedição, Comercial,
   Vendas, Setup, Suporte, RH, TI, Qualidade, Almoxarifado, Administração,
   Diretoria, Marketing.
3. Marca as listas vivas pelo nome. Para comparar, o título é normalizado:
   minúsculas, sem acento (via `translate`, já que a extensão `unaccent` pode
   não existir) e sem emoji. A lista recebe o setor quando contém a palavra:
   `financeiro`, `laboratorio`, `expedicao`, `comercial`, `vendas`, `setup`,
   `suporte`, `rh` (palavra inteira), `ti` (palavra inteira), `qualidade`,
   `almoxarifado`, `administracao`, `diretoria`, `marketing`/`marcketing`.
   Listas `is_done` também recebem etiqueta (não atrapalha, porque não
   contam). Os ambíguos (`Despachado`, `Aguardando Coleta`, `Coletado`) ficam
   **sem setor**, porque nenhuma palavra bate. Isso é de propósito: o Erick
   decide no drawer.
   - "Não precisa de Setup" vai cair em Setup e "LIBERADOS DO LABORATÓRIO" em
     Laboratório. Isso é aceito, porque o relatório do passo 4 serve
     justamente para corrigir.
4. Termina com um `SELECT` que lista quadro · lista · setor atribuído (incluindo
   as que ficaram sem setor), para o Erick revisar logo depois de rodar.

Roda-se com `./scripts/psql-dev.sh -f backend/migrations/016_setores.sql`, como
as anteriores. A migration precisa ser idempotente (`IF NOT EXISTS`,
`ON CONFLICT DO NOTHING`, e o passo 3 só toca listas com `setor_id IS NULL`).

### Dashboard

- `GET /api/dashboard` ganha dois campos:
  - `travados_por_setor`: `[{setor_id, nome, total}]`, ordenado por total
    decrescente e, no empate, pelo nome.
  - `travados_setor`: `[{card_id, title, board_id, board_title, list_id,
    list_title, setor_id, list_entered_at, horas_uteis}]`, para o modal
    (filtrado no front pelo setor clicado, ordenado do mais parado para o
    menos).
  - Os cálculos reaproveitam o loop sobre `ativos` que já existe em
    `routers/dashboard.py` (é só acrescentar `List.setor_id` e
    `Card.list_entered_at` ao select).
- Front: o componente novo fica abaixo do `AlertaAtrasados` no
  `DashboardPage.tsx`, com barras horizontais em `div` (o mesmo padrão dos
  rankings da v2.11.0). Clicar na barra abre o modal no estilo do
  `AtrasadosModal` (pode ser o mesmo componente parametrizado), com o texto
  "Contando só dias de semana, desde que o card entrou na lista atual." Clicar
  no card abre o quadro, como no modal de 72 h.

## Não-objetivos

- Não mudar a régua de 72 h nem o modal dela.
- Sem notificação, e-mail ou sino para card travado. É só consulta.
- Sem limite de horas configurável por setor (por enquanto é 24 h para todos).
- Sem histórico ou série temporal de travados. É a foto de agora.
- Sem tabela de feriados.

## Anti-objetivos (falharia mesmo "funcionando")

- **Card aparecer travado sem estar**, porque algum caminho mudou o `list_id`
  sem atualizar `list_entered_at`. Isso tira a credibilidade do número diante
  da Qualidade. Verificar a integração em especial: 1.728 dos "mover" vêm dela.
- Card excluído/arquivado ou de quadro arquivado entrar na conta (ver os
  filtros da lixeira no CLAUDE.md).
- Membro comum ver número de quadro a que não tem acesso.

## Verificação (manual — não há suíte)

- Rodar a migration e conferir o relatório de pré-preenchimento.
- Para um card movido de lista via UI, conferir que `list_entered_at` mudou. No
  mesmo card, reordenar dentro da lista e conferir que não mudou. Repetir com um
  movimento pela integração.
- Com a API em "Todos" e em um quadro, conferir que a soma de
  `travados_por_setor` bate com uma contagem SQL independente.
- Login como membro comum (bateria `.env.dev-users`) e conferir que só entram
  os quadros dele, que `/setores` não aparece e que `POST /api/setores` dá 403.
- `npm run build` passa.
- Entrada v2.12.0 no `changelog.ts`.
