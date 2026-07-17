# Observações de integração (obs1–obs6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao card 6 campos de texto (`obs1`…`obs6`) que só a integração preenche, exibidos como chips read-only acima da descrição, configuráveis por quadro — liberando a descrição para as pessoas.

**Architecture:** 6 colunas `TEXT` em `cards` + 2 colunas em `boards` (`integration_enabled BOOL`, `obs_labels JSONB`). A integração passa a gravar as obs e para de tocar na descrição (backend segue aceitando `description` por compat). O frontend mostra chips (esmaecidos quando vazios) que abrem uma mini-modal só-leitura; a config vive no drawer do quadro, atrás do gate `update_board` (dono/admin) já existente.

**Tech Stack:** FastAPI async + SQLAlchemy 2.0 + PostgreSQL (JSONB); React 19 + Vite + Tailwind v4. Migrations SQL manuais (sem Alembic). **Sem suíte de testes** — verificação é manual (psql/curl/`npm run build`/navegador); não inventar comandos de teste.

## Global Constraints

- Segredos NUNCA em arquivo versionado. Rodar SQL só via `./scripts/psql-dev.sh`. Nunca imprimir valor de segredo (`.env`), usar `grep -c` para presença. Repo é **público**.
- `DATABASE_URL` async (`postgresql+asyncpg://`). `create_all` **não altera tabela existente** → colunas novas em `cards`/`boards` exigem a migration manual (Task 1).
- Autorização é gate de router; a config do quadro herda o gate de `update_board` (dono/elevado) — **não** adicionar checagem nova.
- Toda mudança fecha com entrada nova no changelog (`frontend/src/data/changelog.ts`), mais recente no topo. Versão alvo: **1.7.0** (novidade).
- Datas ISO `YYYY-MM-DD`. Interface e mensagens em português.
- Branch de trabalho: `feat/observacoes-integracao`. Commit ao fim de cada task.

---

### Task 1: Migration + models (colunas no banco)

**Files:**
- Create: `backend/migrations/006_board_obs_integration.sql`
- Modify: `backend/app/models/card.py:22-34` (adicionar obs1..obs6)
- Modify: `backend/app/models/board.py:1-23` (imports + colunas do Board)

**Interfaces:**
- Produces: `Card.obs1 … Card.obs6: str | None`; `Board.integration_enabled: bool`; `Board.obs_labels: list[str]`.

- [ ] **Step 1: Escrever a migration SQL**

Create `backend/migrations/006_board_obs_integration.sql`:
```sql
-- Observações de integração: 6 campos de texto por card + config por quadro.
-- create_all só cria tabela que falta; cards e boards já existem, então as
-- colunas novas entram por aqui (dev e produção), via ./scripts/psql-dev.sh -f.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs1 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs2 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs3 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs4 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs5 TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS obs6 TEXT;

ALTER TABLE boards ADD COLUMN IF NOT EXISTS integration_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS obs_labels JSONB NOT NULL DEFAULT '[]'::jsonb;
```

- [ ] **Step 2: Adicionar as colunas obs no model Card**

In `backend/app/models/card.py`, após a linha `description:` (`card.py:25`), adicionar:
```python
    obs1: Mapped[str | None] = mapped_column(Text)
    obs2: Mapped[str | None] = mapped_column(Text)
    obs3: Mapped[str | None] = mapped_column(Text)
    obs4: Mapped[str | None] = mapped_column(Text)
    obs5: Mapped[str | None] = mapped_column(Text)
    obs6: Mapped[str | None] = mapped_column(Text)
```
(`Text` já está importado em `card.py:2`. Colocar ANTES das coleções/`list` relationship, junto das colunas escalares.)

- [ ] **Step 3: Adicionar imports e colunas no model Board**

In `backend/app/models/board.py`, trocar o import da linha 2 por:
```python
from sqlalchemy import String, ForeignKey, DateTime, Enum as SAEnum, UniqueConstraint, Boolean, text
from sqlalchemy.dialects.postgresql import JSONB
```
E, dentro de `class Board`, após `created_at` (`board.py:23`), adicionar:
```python
    integration_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    obs_labels: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
```

- [ ] **Step 4: Aplicar a migration no banco de dev**

Run: `./scripts/psql-dev.sh -f backend/migrations/006_board_obs_integration.sql`
Expected: sem erro (linhas `ALTER TABLE`). Reexecutar é seguro (idempotente).

- [ ] **Step 5: Verificar as colunas no banco**

Run:
```bash
./scripts/psql-dev.sh -c "SELECT column_name FROM information_schema.columns WHERE table_name='cards' AND column_name LIKE 'obs%' ORDER BY 1;"
./scripts/psql-dev.sh -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='boards' AND column_name IN ('integration_enabled','obs_labels');"
```
Expected: `obs1`…`obs6`; `integration_enabled boolean`, `obs_labels jsonb`.

- [ ] **Step 6: Subir o backend e confirmar que mapeia sem erro**

Run: `docker compose up -d --build backend && sleep 4 && curl -s http://localhost:8000/api/health`
Expected: `{"status":"ok"}` (ou equivalente 200). Sem exceção de mapeamento nos logs (`docker compose logs --tail=30 backend`).

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/006_board_obs_integration.sql backend/app/models/card.py backend/app/models/board.py
git commit -m "feat(obs): colunas obs1-6 no card e config de integracao no board"
```

---

### Task 2: Backend — schemas, integração e serialização

**Files:**
- Modify: `backend/app/schemas/board.py` (campos + validator)
- Modify: `backend/app/schemas/integration.py:6-20` (obs no IntegrationCardIn)
- Modify: `backend/app/routers/integration.py:50-58` e `:117-127` (aplicar/gravar obs)
- Modify: `backend/app/routers/cards.py:52-82` (expor obs no `_card_to_dict`)
- Modify: `backend/app/routers/boards.py:41-54` e `:67-79` (obs nos dicts manuais)

**Interfaces:**
- Consumes: `Board.integration_enabled`, `Board.obs_labels`, `Card.obs1..obs6` (Task 1).
- Produces: `POST/GET` de card retornam `obs1..obs6`; `GET/PATCH/POST /boards` retornam `integration_enabled` + `obs_labels`. `IntegrationCardIn.obs1..obs6: str | None`.

- [ ] **Step 1: Board schemas — campos + validator**

In `backend/app/schemas/board.py`, trocar a linha 2 por:
```python
from pydantic import BaseModel, field_validator
```
Adicionar, após os imports (antes de `class BoardCreate`), o normalizador:
```python
def _norm_obs_labels(v: list[str] | None) -> list[str] | None:
    """Até 6 nomes; cada um trimado e limitado a 60 chars. Vazio = obs oculta."""
    if v is None:
        return v
    if len(v) > 6:
        raise ValueError("no máximo 6 observações")
    return [(s or "").strip()[:60] for s in v]
```
Em `BoardCreate` adicionar os campos + validator:
```python
class BoardCreate(BaseModel):
    title: str
    description: str | None = None
    color: str = "#0ea5e9"
    integration_enabled: bool = False
    obs_labels: list[str] = []

    @field_validator("obs_labels")
    @classmethod
    def _v_obs(cls, v): return _norm_obs_labels(v)
```
Em `BoardUpdate`:
```python
class BoardUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    color: str | None = None
    integration_enabled: bool | None = None
    obs_labels: list[str] | None = None

    @field_validator("obs_labels")
    @classmethod
    def _v_obs(cls, v): return _norm_obs_labels(v)
```
Em `BoardOut`, adicionar após `created_at`:
```python
    integration_enabled: bool
    obs_labels: list[str]
```
(`BoardListOut` herda de `BoardOut` — ganha os campos automaticamente.)

- [ ] **Step 2: IntegrationCardIn — obs1..obs6**

In `backend/app/schemas/integration.py`, dentro de `IntegrationCardIn`, após `archived` (`integration.py:20`):
```python
    obs1: str | None = None
    obs2: str | None = None
    obs3: str | None = None
    obs4: str | None = None
    obs5: str | None = None
    obs6: str | None = None
```

- [ ] **Step 3: Integração — gravar obs na criação e no update**

In `backend/app/routers/integration.py`, no `_apply_updates`, após o bloco `archived` (`integration.py:57-58`), adicionar:
```python
    for n in range(1, 7):
        key = f"obs{n}"
        if key in sent:
            setattr(card, key, getattr(body, key))
```
E na criação do `Card` (`integration.py:117-127`), adicionar os kwargs antes do fechamento `)`:
```python
            obs1=body.obs1, obs2=body.obs2, obs3=body.obs3,
            obs4=body.obs4, obs5=body.obs5, obs6=body.obs6,
```
(A `description` **continua** sendo aceita e gravada como hoje — nada é removido. É o GestorHS que deixa de enviá-la.)

- [ ] **Step 4: Serialização do card — expor obs**

In `backend/app/routers/cards.py`, no dict de `_card_to_dict`, após `"description": card.description,` (`cards.py:57`):
```python
        "obs1": card.obs1, "obs2": card.obs2, "obs3": card.obs3,
        "obs4": card.obs4, "obs5": card.obs5, "obs6": card.obs6,
```

- [ ] **Step 5: Boards — incluir os 2 campos nos dicts manuais**

In `backend/app/routers/boards.py`, no `_board_list_item` (dict a partir de `boards.py:41`), após `"created_at": board.created_at,`:
```python
        "integration_enabled": board.integration_enabled,
        "obs_labels": board.obs_labels,
```
E no `create_board` (dict a partir de `boards.py:67`), após `"created_at": board.created_at,`:
```python
        "integration_enabled": board.integration_enabled,
        "obs_labels": board.obs_labels,
```
(O `update_board` e `GET /boards/{id}` usam `response_model=BoardOut` sobre o ORM — pegam os campos sozinhos, sem mudança.)

- [ ] **Step 6: Rebuild e verificar o board (config)**

Run: `docker compose up -d --build backend && sleep 4`
Then (carregar credenciais e token de admin conforme CLAUDE.md — `set -a; source backend/.env.dev-users; set +a`), pegar um `BOARD_ID` de teste e:
```bash
# login → TOKEN (exemplo; usar o fluxo já conhecido do projeto)
curl -s -X PATCH "http://localhost:8000/api/boards/$BOARD_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"integration_enabled": true, "obs_labels": ["Recebido","Laboratório","","","",""]}'
```
Expected: JSON do board com `"integration_enabled": true` e `"obs_labels": ["Recebido","Laboratório","","","",""]`.

- [ ] **Step 7: Verificar a integração gravando obs (e descrição intacta)**

Run (com `X-API-Key` e um `list_id` válido do quadro de teste):
```bash
curl -s -X POST "http://localhost:8000/api/integration/cards" \
  -H "Content-Type: application/json" -H "X-API-Key: $INTEGRATION_API_KEY" \
  -d '{"source":"teste-obs","external_id":"OBS-1","list_id":'$LIST_ID',"title":"Card obs","obs1":"chegou 17/07","obs2":"em análise"}'
```
Expected: JSON do card com `"obs1":"chegou 17/07"`, `"obs2":"em análise"`, `"obs3":null`…`"obs6":null`, `"description":null`. Reenviar com `"obs1":"atualizado"` muda só obs1. (Limpar depois: `DELETE /integration/cards` com o mesmo par.)

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas/board.py backend/app/schemas/integration.py backend/app/routers/integration.py backend/app/routers/cards.py backend/app/routers/boards.py
git commit -m "feat(obs): API grava/expoe obs e config de integracao do quadro"
```

---

### Task 3: Frontend — tipos + config do quadro (toggle + nomes)

**Files:**
- Modify: `frontend/src/types/index.ts:13-20` (Board) e `:103-120` (Card)
- Modify: `frontend/src/pages/BoardPage.tsx` (estado, `openEditBoard`, `handleSaveBoard`, JSX do drawer)

**Interfaces:**
- Consumes: `PATCH /boards/{id}` aceitando `integration_enabled` + `obs_labels` (Task 2).
- Produces: `Board.integration_enabled: boolean`, `Board.obs_labels: string[]`, `Card.obs1..obs6: string | null` disponíveis no front. Estado `editIntegrationEnabled`, `editObsLabels` para a Task 4 reusar o board salvo.

- [ ] **Step 1: Tipos — Board e Card**

In `frontend/src/types/index.ts`, em `interface Board` (após `created_at`, `index.ts:19`):
```typescript
  integration_enabled: boolean;
  obs_labels: string[];
```
Em `interface Card` (após `updated_at`, `index.ts:114`):
```typescript
  obs1: string | null;
  obs2: string | null;
  obs3: string | null;
  obs4: string | null;
  obs5: string | null;
  obs6: string | null;
```

- [ ] **Step 2: Estado do formulário de config**

In `frontend/src/pages/BoardPage.tsx`, após `editBoardColor` (`BoardPage.tsx:1703`):
```tsx
  const [editIntegrationEnabled, setEditIntegrationEnabled] = useState(false);
  const [editObsLabels, setEditObsLabels] = useState<string[]>(["", "", "", "", "", ""]);
```

- [ ] **Step 3: Inicializar ao abrir o drawer**

In `openEditBoard` (`BoardPage.tsx:1938`), após `setEditBoardColor(board.color);` (`:1942`):
```tsx
    setEditIntegrationEnabled(board.integration_enabled);
    setEditObsLabels([0, 1, 2, 3, 4, 5].map(i => board.obs_labels[i] ?? ""));
```

- [ ] **Step 4: Enviar no PATCH**

In `handleSaveBoard` (`BoardPage.tsx:1958-1962`), adicionar ao corpo do `api.patch`:
```tsx
        integration_enabled: editIntegrationEnabled,
        obs_labels: editObsLabels.map(s => s.trim()),
```

- [ ] **Step 5: JSX — toggle + 6 nomes no drawer**

In `frontend/src/pages/BoardPage.tsx`, logo após o bloco da Cor (fecha em `BoardPage.tsx:2362`) e ANTES do botão "Salvar alterações" (`:2363`):
```tsx
              <div className="space-y-2 pt-1 border-t border-border">
                <label className="flex items-start gap-2 cursor-pointer select-none pt-3">
                  <input
                    type="checkbox"
                    checked={editIntegrationEnabled}
                    onChange={e => setEditIntegrationEnabled(e.target.checked)}
                    className="mt-0.5 accent-primary"
                  />
                  <span className="text-xs font-semibold text-slate-400">Este quadro recebe informações de integração?</span>
                </label>
                {editIntegrationEnabled && (
                  <div className="space-y-2 pl-1">
                    <p className="text-[11px] text-slate-500">Nomeie cada observação que a integração preenche. Deixe em branco para escondê-la.</p>
                    {editObsLabels.map((name, i) => (
                      <input
                        key={i}
                        value={name}
                        maxLength={60}
                        onChange={e => setEditObsLabels(prev => prev.map((v, j) => (j === i ? e.target.value : v)))}
                        placeholder={`Nome da observação ${i + 1}…`}
                        className="w-full text-sm bg-background-elevated rounded-lg border border-border px-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder-slate-500"
                      />
                    ))}
                  </div>
                )}
              </div>
```

- [ ] **Step 6: Build do frontend**

Run: `cd frontend && npm run build`
Expected: `tsc -b && vite build` PASSA sem erro de tipo.

- [ ] **Step 7: Verificar no navegador**

Abrir o quadro de teste → engrenagem (Configurações do board) → marcar o toggle → nomear "Recebido"/"Laboratório" → Salvar. Reabrir o drawer: o toggle e os nomes persistem (vêm de `GET /boards/{id}`).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/BoardPage.tsx
git commit -m "feat(obs): config de integracao do quadro (toggle + nomes) no frontend"
```

---

### Task 4: Frontend — chips das obs + mini-modal read-only

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx:160-171` (props do CardDetailModal), `:2301-2313` (invocação), `:172-206` (estado), `:638` (chips), fim do render do modal (mini-modal)

**Interfaces:**
- Consumes: `board.integration_enabled`, `board.obs_labels`, `card.obs1..obs6` (Tasks 1–3).
- Produces: nada para tasks seguintes (feature de UI terminal).

- [ ] **Step 1: Props do CardDetailModal**

In `frontend/src/pages/BoardPage.tsx`, na assinatura do `CardDetailModal` (`BoardPage.tsx:160`), adicionar `integrationEnabled, obsLabels` ao destructuring e ao tipo:
```tsx
function CardDetailModal({ card, boardId, listTitle, lists, boardLabels, currentUser, integrationEnabled, obsLabels, onClose, onCardUpdate, onCardDelete, onCardCopy }: {
  card: Card;
  boardId: number;
  listTitle: string;
  lists: BoardList[];
  boardLabels: BoardLabel[];
  currentUser: { id: number; is_admin: boolean; role: "administrador" | "coordenador" | "membro" } | null;
  integrationEnabled: boolean;
  obsLabels: string[];
  onClose: () => void;
  onCardUpdate: (updated: Partial<Card> & { id: number }) => void;
  onCardDelete: (cardId: number) => void;
  onCardCopy: (newCard: Card) => void;
}) {
```

- [ ] **Step 2: Passar as props na invocação**

In `frontend/src/pages/BoardPage.tsx`, na chamada `<CardDetailModal ...>` (`BoardPage.tsx:2302`), após `currentUser={currentUser}`:
```tsx
          integrationEnabled={board?.integration_enabled ?? false}
          obsLabels={board?.obs_labels ?? []}
```

- [ ] **Step 3: Estado da mini-modal**

In `CardDetailModal`, junto dos outros `useState` (ex.: após `const [lightbox, setLightbox] = useState<string | null>(null);`, `BoardPage.tsx:198`):
```tsx
  const [obsOpen, setObsOpen] = useState<number | null>(null);
  const obsValues = [card.obs1, card.obs2, card.obs3, card.obs4, card.obs5, card.obs6];
```

- [ ] **Step 4: JSX — chips acima da descrição**

In `frontend/src/pages/BoardPage.tsx`, imediatamente ANTES do comentário `{/* Description */}` (`BoardPage.tsx:638`):
```tsx
            {/* Observações de integração */}
            {integrationEnabled && obsLabels.some(n => n.trim()) && (
              <div className="flex flex-wrap gap-2">
                {obsLabels.map((name, i) => {
                  if (!name.trim()) return null;
                  const value = obsValues[i];
                  const hasContent = !!(value && value.trim());
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={!hasContent}
                      onClick={() => setObsOpen(i)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                        hasContent
                          ? "bg-background-elevated border-border text-slate-200 hover:border-primary/60"
                          : "bg-background-elevated/40 border-border/50 text-slate-500 cursor-default"
                      )}
                      title={hasContent ? undefined : "Sem informação ainda"}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            )}

```

- [ ] **Step 5: JSX — a mini-modal (read-only)**

In `frontend/src/pages/BoardPage.tsx`, adicionar junto ao lightbox no fim do render do `CardDetailModal` (procurar `lightbox && (` e colocar este bloco logo depois do fechamento dele):
```tsx
          {obsOpen !== null && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setObsOpen(null)}>
              <div className="absolute inset-0 bg-black/50" />
              <div className="relative bg-background-surface border border-border rounded-xl shadow-2xl w-full max-w-md max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                  <h3 className="text-sm font-semibold text-slate-200">{obsLabels[obsOpen]}</h3>
                  <button onClick={() => setObsOpen(null)} className="p-1 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-background-elevated transition-colors"><IX /></button>
                </div>
                <div className="p-4 overflow-y-auto text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {obsValues[obsOpen]}
                </div>
              </div>
            </div>
          )}
```
(`IX` e `cn` já são usados neste arquivo e estão em escopo de módulo.)

- [ ] **Step 6: Build do frontend**

Run: `cd frontend && npm run build`
Expected: PASSA sem erro de tipo.

- [ ] **Step 7: Verificar no navegador**

Quadro com integração ligada + card com `obs1`/`obs2` (do teste da Task 2): acima da descrição aparecem os chips "Recebido"/"Laboratório"; o com conteúdo abre a mini-modal com o texto; um chip nomeado mas sem conteúdo fica esmaecido e não clica. Num quadro **sem** o toggle, nenhum chip aparece.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/BoardPage.tsx
git commit -m "feat(obs): chips das obs acima da descricao + mini-modal read-only"
```

---

### Task 5: Docs + changelog

**Files:**
- Modify: `docs/integration.md` (contrato)
- Modify: `CLAUDE.md` (nota de arquitetura)
- Modify: `frontend/src/data/changelog.ts:15-16` (nova versão no topo)

**Interfaces:**
- Consumes: comportamento final das Tasks 2–4.
- Produces: nada (docs).

- [ ] **Step 1: integration.md — tabela de campos (seção 3.1)**

In `docs/integration.md`, na tabela de campos do `POST /integration/cards` (após a linha `archived`, `integration.md:129`), adicionar:
```markdown
| `obs1` … `obs6` | string \| null | — | Texto de uma etapa/observação. Exibido no card **só se** o quadro tiver a integração ligada e a obs correspondente nomeada. Mesma regra de update parcial do `description` (omitir preserva; `null` limpa). |
```

- [ ] **Step 2: integration.md — exemplo de resposta (seção 3.1)**

No JSON de resposta `200 OK` (`integration.md:148-165`), adicionar após a linha `"description": ...,`:
```jsonc
  "obs1": "chegou 17/07", "obs2": "em análise", "obs3": null,
  "obs4": null, "obs5": null, "obs6": null,
```

- [ ] **Step 3: integration.md — semântica e "não faz"**

Na seção 4.2 (update parcial, `integration.md:214`), acrescentar um item citando que `obs1…obs6` seguem a mesma regra de `description`. Na seção 4.5 / visão geral, acrescentar a frase:
```markdown
- **A descrição não é mais usada pela integração.** Ela passou a ser campo livre do
  usuário; os dados de cada etapa vão nas obs (`obs1…obs6`). Nomeie as obs e ligue o
  toggle "Este quadro recebe informações de integração?" nas Configurações do quadro.
```

- [ ] **Step 4: integration.md — pseudo-código GestorHS (seção 6)**

In `docs/integration.md`, no `payload` do exemplo (`integration.md:307-316`), **remover** a linha `"description": os.obs or None,` e colocar as obs conforme as etapas, por exemplo:
```python
        "obs1": os.obs_recebido or None,
        "obs2": os.obs_laboratorio or None,
        "obs3": os.obs_pos_vendas or None,
        "obs4": os.obs_financeiro or None,
        "obs5": os.obs_preparando_retorno or None,
        "obs6": os.obs_finalizado or None,
```
(Ajustar os nomes dos atributos ao que existe no GestorHS — os `os.obs_*` acima são ilustrativos.)

- [ ] **Step 5: CLAUDE.md — nota leve**

In `CLAUDE.md`, na descrição do router `integration` (seção "Routers"), acrescentar uma frase:
```markdown
A integração grava os dados de etapa em `Card.obs1..obs6` (não mais na descrição); a exibição desses campos como chips acima da descrição é ligada por quadro via `Board.integration_enabled` + `Board.obs_labels` (nomes das obs), configurados no drawer do quadro (dono/admin).
```

- [ ] **Step 6: changelog — v1.7.0 no topo**

In `frontend/src/data/changelog.ts`, inserir como primeiro item do array `CHANGELOG` (antes do `1.6.0`, `changelog.ts:16`):
```ts
  {
    version: "1.7.0",
    date: "2026-07-17",
    changes: [
      { kind: "novidade", text: "Observações de integração: quadros que recebem dados de outro sistema (ex.: GestorHS) agora mostram esses dados em botões acima da descrição — um por etapa (Recebido, Laboratório, etc.) — que abrem uma janelinha com o texto. A descrição volta a ser 100% sua. Ligue e nomeie as etapas nas Configurações do quadro." },
    ],
  },
```

- [ ] **Step 7: Conferir versão e build**

Run: `cd frontend && npm run build`
Expected: PASSA. O rodapé da sidebar/login passa a exibir `v1.7.0` (deriva de `CHANGELOG[0]`).

- [ ] **Step 8: Conferir que nenhum doc versionado tem segredo**

Run: `git grep -nE "password|PGPASSWORD|senha.*=|123" -- docs/integration.md CLAUDE.md`
Expected: sem linha que exponha valor de segredo (o `123` pode casar em texto inócuo — inspecionar; não pode haver credencial).

- [ ] **Step 9: Commit**

```bash
git add docs/integration.md CLAUDE.md frontend/src/data/changelog.ts
git commit -m "docs(obs): contrato de integracao, CLAUDE.md e changelog v1.7.0"
```

---

## Self-review (feito na escrita do plano)

- **Cobertura da spec:** DB (Task 1) ✓; backend API + integração + serialização + board dicts (Task 2) ✓; tipos + config drawer (Task 3) ✓; chips + mini-modal read-only, obs vazia esmaecida, só aparece com toggle (Task 4) ✓; docs/integration.md + CLAUDE.md + changelog v1.7.0 (Task 5) ✓. Sem backfill (fora de escopo) ✓. Sem checagem nova de authz (herda `update_board`) ✓.
- **Consistência de tipos:** `obs_labels: list[str]`/`string[]` em todas as camadas; `obs1..obs6: str | None`/`string | null`; nomes `integration_enabled`/`integrationEnabled`, `obsLabels` batem entre props e invocação.
- **Sem placeholder:** todo step tem código/comando real.
