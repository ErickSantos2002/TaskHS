# Quadro "fora do alerta de atrasos" — design

Data: 2026-11-10 · Origem: pedido vindo do HS.OS (Guardi), confirmado com o Erick.

## Por quê

`List.is_done` (v2.9.0, migration 014) faz dois papéis hoje:

1. tira a lista do **alerta de 72 h úteis** e dos **travados por setor** do Dashboard
   ([routers/dashboard.py](../../../backend/app/routers/dashboard.py));
2. diz que o card naquela lista está **concluído**. É o que `GET /cards/minhas?abertas=true`
   usa para esconder o card ([routers/minhas.py](../../../backend/app/routers/minhas.py)).

O Erick marcou **todas** as listas de três quadros como "de concluído" só para eles não
contarem nos atrasados da empresa, porque os cards desses quadros ficam abertos bem mais
tempo que o fluxo padrão. O efeito colateral foi que os cards dele em "EM ANDAMENTO - ERICK"
(T.I. 2) sumiram de "Minhas tarefas", e o Guardi (bot do HS.OS, que lê `/cards/minhas`
com token de agente) responde que ele não tem nenhuma tarefa aberta.

A saída é separar os dois papéis: uma **configuração por quadro** decide se ele entra no
alerta, e `is_done` volta a significar só "lista de concluído".

## Objetivos

- Nova coluna `boards.fora_do_alerta BOOLEAN NOT NULL DEFAULT false`.
- Quadro com `fora_do_alerta = true` **não entra** no alerta de 72 h (`atrasados`,
  `atrasados_por_lista`) nem nos travados por setor (`travados_setor`,
  `travados_por_setor`). Os cards dele continuam abertos para todo o resto.
- `is_done` continua como está no código: `/cards/minhas` **não muda**.
- Liga/desliga no **drawer de editar quadro**, só para dono ou elevado, a mesma regra do
  `update_board` e do `set_done_lists`.
- Migração de dados dos três quadros confirmados (abaixo).
- Entrada no changelog.

## Fora do escopo

- Nada muda no HS.OS. O `taskhs_minhas` passa a funcionar sozinho assim que as listas forem
  desmarcadas.
- Os outros quadros com algumas listas finais marcadas (134–139, 142, 145) estão corretos
  e ficam como estão.
- Nenhuma mudança em rankings, movimentos, cards por pessoa ou contagens por lista do
  Dashboard: quadro fora do alerta continua aparecendo nesses números.

## Anti-objetivos

- O card **não pode** sumir de "Minhas tarefas" por causa dessa configuração. Ela só afeta
  as réguas de atraso.
- Não inferir nada por nome de lista no código. A migração usa ids explícitos, já
  confirmados.

## Como funciona

### Backend

- **Modelo/migration:** `backend/migrations/018_board_fora_do_alerta.sql` com
  `ALTER TABLE boards ADD COLUMN IF NOT EXISTS fora_do_alerta BOOLEAN NOT NULL DEFAULT false;`
  e o campo em `models/board.py`. O runner aplica a migration no boot
  ([app/migrations.py](../../../backend/app/migrations.py)).
- **Schemas:** `fora_do_alerta` no `BoardOut` e no `BoardUpdate` (opcional, `None` = não
  mexe), no mesmo padrão do `integration_enabled`. Ele vai junto nas duas serializações
  manuais de `boards.py` que hoje levam `integration_enabled` (linhas ~53 e ~83).
- **Edição:** pelo `PATCH /boards/{id}` existente (`update_board`). A trava de dono/elevado
  e a de quadro arquivado já estão lá. Não criar endpoint novo.
- **Dashboard** (`get_dashboard`): buscar `Board.fora_do_alerta` junto na query `ativos`.
  No loop, a ordem é (*minha decisão*): contadores (`total_por_lista`/`cards_por_quadro`)
  como hoje → `if list_done: em_concluido += 1; continue` como hoje (card em `FINALIZADO`
  continua contando como concluído) → `if fora_do_alerta: continue` antes das duas réguas.
  Assim a configuração só tira das réguas os cards ainda **não** concluídos, e o KPI "Em
  listas de concluído" continua batendo com os ✓ do gráfico por lista. Isso vale tanto na visão geral quanto na visão
  filtrada por `board_id`.
- **Setores do recorte** (`setores_no_recorte`): listas de quadro fora do alerta não entram,
  senão aparece "Financeiro 0" por causa de um quadro que nem está sendo medido. Para isso
  a query `listas` precisa trazer `Board.fora_do_alerta`.

### Frontend

- `types/index.ts`: `fora_do_alerta: boolean` no tipo `Board`.
- **Drawer de editar quadro** (`BoardPage.tsx`, perto de onde está `editIntegrationEnabled`
  e das listas de concluído): um checkbox **"Fora do alerta de atrasos"** com uma linha de
  ajuda, algo como *"Os cards deste quadro não entram no alerta de 72 h nem nos travados por
  setor do Dashboard. Continuam abertos em Minhas tarefas."* Vai no mesmo `PATCH` do
  salvar, como o `integration_enabled`. Só aparece para quem já vê os outros campos de dono.
- **Dashboard filtrado num quadro fora do alerta** (*minha decisão*): no lugar das réguas
  vazias, mostrar uma nota curta, "Este quadro está fora do alerta de atrasos", para
  ninguém achar que está tudo em dia. O builder decide onde ela fica.

### Migração de dados

Vai na própria `018`, depois do `ALTER`, por id (ids não são segredo; o repo é público,
mas isso não é credencial). Todos os quadros são do Erick, e as listas foram confirmadas
por ele em 2026-11-10.

| Quadro | `fora_do_alerta` | Listas que continuam `is_done = true` | Demais listas do quadro |
|---|---|---|---|
| 154 T.I. 2 | true | 372 `FINALIZADO` | `false` |
| 143 Expedição | true | nenhuma | `false` |
| 144 Gestão de Atividades (serviços) | true | 291, 295, 299, 304 (`Processo para calibração concluída - <mês>`) | `false` |

- A 144 está **arquivada** desde hoje, então o Dashboard e `/cards/minhas` já a ignoram.
  Ela entra na migração assim mesmo, *por decisão minha*, para que, se for desarquivada,
  não volte com o problema.
- "Demais listas" inclui as arquivadas e as da lixeira desses quadros. Elas estão fora do
  drawer, e se ficassem marcadas, o problema voltaria ao serem restauradas.
- SQL no formato `UPDATE lists SET is_done = (id IN (...)) WHERE board_id = X;`, um por
  quadro, mais `UPDATE boards SET fora_do_alerta = true WHERE id IN (143,144,154);`.
  Em banco novo (sem esses ids) não faz nada.

⚠️ dev = produção, e as migrations rodam no boot. **Não subir o backend local com a 018
antes do merge/deploy**, senão a migração roda em produção pelo backend local, antes da
hora. A verificação de backend é feita depois do deploy, ou com o Erick ciente.

## Como verificar (manual, não há suíte)

1. Depois da 018: `./scripts/psql-dev.sh -c "SELECT id, fora_do_alerta FROM boards WHERE id IN (143,144,154);"`
   e contagem de `is_done` por quadro batendo com a tabela acima.
2. `GET /api/cards/minhas?abertas=true` como o Erick: aparecem os cards de "EM ANDAMENTO -
   ERICK" (T.I. 2).
3. `GET /api/dashboard` (elevado): nenhum item de `atrasados`/`travados_setor` com
   `board_id` 143 ou 154; os outros quadros iguais a antes.
4. Drawer: ligar e desligar persiste; membro comum não vê o controle; `PATCH` de não-dono
   continua 403.
5. `npm run build` passa.

## Deixado para o builder

- O texto exato e a posição do checkbox e da nota no Dashboard.
- Se a nota do Dashboard precisa de campo novo no `DashboardOut` ou se o front deduz do
  board carregado.

## Changelog

Minor, `melhoria`: quadro pode ficar "fora do alerta de atrasos" sem marcar listas como
concluídas, e os cards voltam a aparecer em Minhas tarefas.
