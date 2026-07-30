# Busca global — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma caixa de busca na topbar que encontra qualquer card — inclusive pelo número de série que a integração grava em `obs1..obs6` — em todos os quadros a que a pessoa tem acesso.

**Architecture:** Um endpoint novo `GET /api/search` faz uma query só: junta `cards → lists → boards`, recorta o acesso por subselect em `board_members` (nunca pós-filtro em Python), e casa todos os termos contra `title + description + obs1..obs6` concatenados, normalizados por `lower()` + `translate()`. No front, um componente isolado `GlobalSearch` no `MainLayout` mostra os resultados num dropdown e navega para `/boards/:id?card=&list=`, deep link que ganha um fallback para abrir também card arquivado.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + PostgreSQL (sem extensão nova); React 19 + TypeScript + Tailwind v4 + React Router 7.

**Spec:** [docs/superpowers/specs/2026-07-30-busca-global-design.md](../specs/2026-07-30-busca-global-design.md)

## Global Constraints

- **Não há suíte de testes** neste projeto (nem pytest, nem testes no front). Toda verificação é manual: `curl`, navegador, `npm run build`. Não invente comandos de teste nem crie framework de teste.
- **Repositório PÚBLICO.** Nunca escreva senha, `PGPASSWORD`, `SECRET_KEY` ou `DATABASE_URL` em arquivo versionado, comando de exemplo ou mensagem de commit. Credencial de login para verificação vem de variável de ambiente lida de `backend/.env.dev-users` (gitignorado).
- **Sem migration:** esta feature não cria nem altera coluna nenhuma.
- **Interface e mensagens em português.**
- **Cada mudança fecha com entrada nova no changelog** (`frontend/src/data/changelog.ts`), versão desta feature: **1.13.0**.
- Backend roda em Docker: `docker compose up -d --build`; após editar Python, `docker compose restart backend` (ou o `--reload` do compose, se ativo) e conferir `docker compose logs -f backend`.
- O front roda com `cd frontend && npm run dev` (http://localhost:5173).

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/app/schemas/search.py` *(novo)* | O formato de um resultado de busca (`SearchResultOut`). Só isso. |
| `backend/app/routers/search.py` *(novo)* | O endpoint, o filtro de acesso, a query de casamento e o recorte do snippet. Arquivo pequeno e autocontido — não encosta em router existente. |
| `backend/app/main.py` *(modificar)* | Duas linhas: importar e montar o router. |
| `frontend/src/types/index.ts` *(modificar)* | `SearchResult`, espelhando o schema Pydantic. |
| `frontend/src/components/GlobalSearch.tsx` *(novo)* | A caixa, o debounce, o dropdown, o teclado e a navegação. Componente isolado — o `BoardPage.tsx` já tem ~3200 linhas e não deve crescer por causa disto. |
| `frontend/src/layouts/MainLayout.tsx` *(modificar)* | Monta o `<GlobalSearch />` no espaço vazio da topbar. |
| `frontend/src/pages/BoardPage.tsx` *(modificar)* | Fallback do deep link para card arquivado + faixa "Cartão arquivado" no modal. |
| `frontend/src/data/changelog.ts` *(modificar)* | Entrada 1.13.0. |

---

## Task 1: Endpoint `GET /api/search`

**Files:**
- Create: `backend/app/schemas/search.py`
- Create: `backend/app/routers/search.py`
- Modify: `backend/app/main.py:13` (import) e `backend/app/main.py:89` (include_router)

**Interfaces:**
- Consumes: `get_current_user` ([backend/app/dependencies.py](../../../backend/app/dependencies.py)), `User.is_elevated`, os models `Card`, `List as ListModel`, `Board`, `BoardMember`.
- Produces: `GET /api/search?q=<str>&limit=<int>` → `list[SearchResultOut]` com os campos `card_id, list_id, board_id, board_title, board_color, list_title, title, priority, due_date, archived, snippet, matched_field`. A Task 2 consome exatamente esses nomes.

- [ ] **Step 1: Criar o schema do resultado**

Criar `backend/app/schemas/search.py`:

```python
from datetime import date
from pydantic import BaseModel


class SearchResultOut(BaseModel):
    """Uma linha do dropdown de busca.

    Traz o quadro e a lista junto porque o resultado é global: sem isso a
    pessoa não sabe de onde veio o card, e o front não tem como montar o link.
    """
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
    matched_field: str  # "titulo" | "descricao" | "obs"
```

- [ ] **Step 2: Escrever o router**

Criar `backend/app/routers/search.py` com exatamente este conteúdo:

```python
"""Busca global: acha card em qualquer quadro que a pessoa possa ver.

Pedido de Serviços: achar um atendimento pelo número de série do aparelho, que
a integração grava no meio do texto de obs1..obs6 — daí a varredura incluir
essas colunas, e não só título/descrição.

O recorte de acesso é um SUBSELECT no WHERE, nunca um pós-filtro em Python:
card de quadro alheio não chega a ser materializado, então não há como vazar
por descuido de serialização.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, case
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.board import Board, BoardMember
from app.models.card import Card
from app.models.list import List as ListModel
from app.models.user import User
from app.schemas.search import SearchResultOut

router = APIRouter(prefix="/search", tags=["search"])

# As duas strings do translate() têm de ter o MESMO comprimento e a mesma
# ordem — é um mapa caractere a caractere. Só minúsculas: o lower() vem antes.
_DE = "áàâãäéèêëíìîïóòôõöúùûüçñ"
_PARA = "aaaaaeeeeiiiiooooouuuucn"
_TRANS = str.maketrans(_DE, _PARA)

TAMANHO_MINIMO_TERMO = 2
CONTEXTO_ANTES = 40
CONTEXTO_DEPOIS = 80


def normalizar(texto: str) -> str:
    """O mesmo que lower() + translate() fazem no SQL, só que em Python.

    Precisa ser o mesmo dos dois lados: é assim que o snippet acha no texto
    original o trecho que o banco casou.
    """
    return texto.lower().translate(_TRANS)


def escapar_like(termo: str) -> str:
    """`%` e `_` são curingas do LIKE.

    Sem escapar, digitar "%" na caixa devolveria o banco inteiro.
    """
    return termo.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def termos_de(q: str) -> list[str]:
    """Quebra a busca em palavras normalizadas, descartando as curtas demais."""
    return [t for t in normalizar(q).split() if len(t) >= TAMANHO_MINIMO_TERMO]


def _feno():
    """title + description + obs1..6 num texto só, minúsculo e sem acento.

    concat_ws ignora NULL sozinho — não precisa de coalesce em cada coluna.
    """
    juntos = func.concat_ws(
        " ",
        Card.title, Card.description,
        Card.obs1, Card.obs2, Card.obs3, Card.obs4, Card.obs5, Card.obs6,
    )
    return func.translate(func.lower(juntos), _DE, _PARA)


def montar_snippet(card: Card, termo: str) -> tuple[str, str]:
    """(trecho, campo) do primeiro campo do card que contém o termo.

    É o que faz a linha do dropdown mostrar "…Série VAM5D0008 / Patr. 8" em vez
    de repetir o título do card.
    """
    candidatos = [
        ("titulo", card.title),
        ("descricao", card.description),
        ("obs", card.obs1), ("obs", card.obs2), ("obs", card.obs3),
        ("obs", card.obs4), ("obs", card.obs5), ("obs", card.obs6),
    ]
    for campo, texto in candidatos:
        if not texto:
            continue
        # Quebra de linha vira espaço: a linha do dropdown é uma só.
        limpo = " ".join(texto.split())
        pos = normalizar(limpo).find(termo)
        if pos < 0:
            continue
        ini = max(0, pos - CONTEXTO_ANTES)
        fim = min(len(limpo), pos + len(termo) + CONTEXTO_DEPOIS)
        trecho = limpo[ini:fim]
        if ini > 0:
            trecho = "…" + trecho
        if fim < len(limpo):
            trecho = trecho + "…"
        return trecho, campo
    return card.title, "titulo"


@router.get("", response_model=list[SearchResultOut])
async def search(
    q: str = Query(..., max_length=200),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    termos = termos_de(q)
    if not termos:
        return []

    feno = _feno()
    stmt = (
        select(Card, ListModel.title, ListModel.archived, Board.id, Board.title, Board.color)
        .join(ListModel, ListModel.id == Card.list_id)
        .join(Board, Board.id == ListModel.board_id)
    )

    # Todas as palavras, em qualquer ordem, em qualquer um dos campos.
    # A f-string monta o VALOR do padrão, não SQL: o .like() do SQLAlchemy
    # manda esse valor como parâmetro bindado. Não trocar por texto cru.
    for t in termos:
        stmt = stmt.where(feno.like(f"%{escapar_like(t)}%", escape="\\"))

    # A TRANCA. Elevado (administrador/coordenador) enxerga tudo, como no resto
    # do sistema; o resto só alcança quadro em que tem linha em board_members.
    if not current_user.is_elevated:
        # aliased: sem isto o SQLAlchemy correlaciona o `lists` do subselect com
        # o `lists` do JOIN de fora e o filtro deixa de filtrar.
        LV = aliased(ListModel)
        listas_visiveis = (
            select(LV.id)
            .join(BoardMember, BoardMember.board_id == LV.board_id)
            .where(BoardMember.user_id == current_user.id)
        )
        stmt = stmt.where(Card.list_id.in_(listas_visiveis))

    # Casou no título primeiro; depois, o mexido mais recentemente.
    titulo = func.translate(func.lower(Card.title), _DE, _PARA)
    casou_titulo = case(
        (titulo.like(f"%{escapar_like(termos[0])}%", escape="\\"), 0),
        else_=1,
    )
    stmt = stmt.order_by(casou_titulo, Card.updated_at.desc()).limit(limit)

    linhas = (await db.execute(stmt)).all()

    resultados: list[SearchResultOut] = []
    for card, list_title, list_archived, board_id, board_title, board_color in linhas:
        snippet, campo = montar_snippet(card, termos[0])
        resultados.append(SearchResultOut(
            card_id=card.id,
            list_id=card.list_id,
            board_id=board_id,
            board_title=board_title,
            board_color=board_color,
            list_title=list_title,
            title=card.title,
            priority=card.priority.value,
            due_date=card.due_date,
            # Card em lista arquivada também sumiu da cara do quadro: o front
            # precisa tratar os dois casos igual na hora de abrir.
            archived=card.archived or list_archived,
            snippet=snippet,
            matched_field=campo,
        ))
    return resultados
```

- [ ] **Step 3: Montar o router no app**

Em `backend/app/main.py`, linha 13, acrescentar `search` à lista de imports:

```python
from app.routers import auth, boards, lists, cards, labels, notifications, attachments, reminders, automations, integration, logs, search
```

E depois da linha `app.include_router(logs.router, prefix="/api")` (linha 89), acrescentar:

```python
app.include_router(search.router, prefix="/api")
```

- [ ] **Step 4: Subir o backend e conferir que ele carregou**

```bash
cd /home/ericks/github/TaskHS
docker compose up -d --build
docker compose logs --tail=30 backend
curl -s http://localhost:8000/api/health
```

Esperado: log sem traceback e `{"status":"ok"}` (ou equivalente). Se der `ImportError`, o import da linha 13 está errado.

- [ ] **Step 5: Pegar tokens de verificação (sem escrever senha em lugar nenhum)**

```bash
cd /home/ericks/github/TaskHS
set -a; source backend/.env.dev-users; set +a

token() {  # uso: token "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW"
  curl -s http://localhost:8000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])'
}
TK_ADMIN=$(token "$TASKHS_ADMIN_EMAIL" "$TASKHS_ADMIN_PW")
TK_MEMBRO=$(token "$TASKHS_MEMBRO_EMAIL" "$TASKHS_MEMBRO_PW")
test -n "$TK_ADMIN" && test -n "$TK_MEMBRO" && echo "tokens ok"
```

Esperado: `tokens ok`. **Nunca** ecoe o conteúdo de `$TASKHS_*_PW` nem cole o token numa mensagem de commit.

- [ ] **Step 6: Verificar o casamento — número de série, acento e curinga**

```bash
busca() { curl -s -G http://localhost:8000/api/search -H "Authorization: Bearer $1" \
            --data-urlencode "q=$2" | python3 -m json.tool; }

busca "$TK_ADMIN" "VAM5D0008"     # nº de série real, dentro de uma obs
busca "$TK_ADMIN" "calibracao"    # sem acento, tem de achar "Calibração"
busca "$TK_ADMIN" "CALIBRAÇÃO"    # com acento e maiúsculo, mesmo resultado
busca "$TK_ADMIN" "%"             # curinga escapado: NÃO pode listar tudo
busca "$TK_ADMIN" "a"             # 1 caractere: lista vazia, sem erro 500
```

Esperado:
- `VAM5D0008` → pelo menos um resultado, com `"matched_field": "obs"` e o `snippet` mostrando o pedaço `…Série VAM5D0008 / Patr. 8`.
- `calibracao` e `CALIBRAÇÃO` → a mesma quantidade de resultados.
- `%` → `[]` (ou só cards que tenham literalmente o caractere `%`), **nunca** 20 resultados aleatórios.
- `a` → `[]`.

Se `%` devolver muita coisa, o `escape="\\"` não está sendo aplicado.

- [ ] **Step 7: Verificar a tranca (o ponto crítico)**

Descobrir um termo que só existe em quadro do qual o usuário membro **não** participa:

```bash
./scripts/psql-dev.sh -c "
  SELECT u.id, u.name, u.role FROM users u WHERE u.email = '$TASKHS_MEMBRO_EMAIL';"
./scripts/psql-dev.sh -c "
  SELECT b.id, b.title FROM boards b
  WHERE b.id NOT IN (SELECT board_id FROM board_members bm
                     JOIN users u ON u.id = bm.user_id
                     WHERE u.email = '$TASKHS_MEMBRO_EMAIL');"
```

Escolher um quadro dessa lista e pegar uma palavra distintiva do título de um card dele:

```bash
./scripts/psql-dev.sh -c "
  SELECT c.id, c.title FROM cards c
  JOIN lists l ON l.id = c.list_id
  WHERE l.board_id = <ID_DO_QUADRO_ALHEIO> LIMIT 5;"
```

Então:

```bash
busca "$TK_MEMBRO" "<palavra do card alheio>"   # esperado: []
busca "$TK_ADMIN"  "<palavra do card alheio>"   # esperado: o card aparece
busca "$TK_MEMBRO" "<palavra de card de quadro DELE>"  # esperado: aparece
```

Os três resultados precisam bater. Se o membro enxergar o card alheio, **pare** — o subselect não está filtrando (provável causa: faltou o `aliased`).

- [ ] **Step 8: Commit**

```bash
cd /home/ericks/github/TaskHS
git add backend/app/schemas/search.py backend/app/routers/search.py backend/app/main.py
git commit -m "feat(busca): endpoint /api/search varrendo titulo, descricao e obs1..6

O recorte de acesso e um subselect em board_members dentro do WHERE, nao um
pos-filtro: card de quadro alheio nao e materializado. Termos em AND, acentos
normalizados por translate() (sem extensao no banco), % e _ escapados.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: A caixa de busca na topbar

**Files:**
- Modify: `frontend/src/types/index.ts` (acrescentar `SearchResult` ao final)
- Create: `frontend/src/components/GlobalSearch.tsx`
- Modify: `frontend/src/layouts/MainLayout.tsx:273` (o `<div className="flex-1" />`)

**Interfaces:**
- Consumes: `GET /api/search?q=&limit=` da Task 1 (campos exatos listados lá); `api.get` de [frontend/src/lib/api.ts](../../../frontend/src/lib/api.ts); `useNavigate` do react-router.
- Produces: componente `<GlobalSearch />` (sem props) e o tipo `SearchResult`. Navega para `/boards/{board_id}?card={card_id}&list={list_id}` — formato que a Task 3 consome.

- [ ] **Step 1: Acrescentar o tipo**

No final de `frontend/src/types/index.ts`:

```ts
export interface SearchResult {
  card_id: number;
  list_id: number;
  board_id: number;
  board_title: string;
  board_color: string | null;
  list_title: string;
  title: string;
  priority: Priority;
  due_date: string | null;
  archived: boolean;
  snippet: string;
  matched_field: "titulo" | "descricao" | "obs";
}
```

- [ ] **Step 2: Escrever o componente**

Criar `frontend/src/components/GlobalSearch.tsx`:

```tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import type { SearchResult } from "../types";

const MINIMO = 2;
const DEBOUNCE_MS = 250;

function IconSearch() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
    </svg>
  );
}

/** Destaca os termos no trecho. Sem HTML vindo do backend: o realce é feito
 *  aqui, quebrando a string em pedaços.
 *
 *  O realce é literal, sem normalizar acento: quem digita "calibracao" acha o
 *  card (isso é o backend), mas o "Calibração" do texto não fica em negrito.
 *  É cosmético e proposital — normalizar aqui exigiria mapear índice a índice
 *  entre o texto original e o normalizado. */
function Realce({ texto, termos }: { texto: string; termos: string[] }) {
  if (termos.length === 0) return <>{texto}</>;
  const escapados = termos.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const partes = texto.split(new RegExp(`(${escapados.join("|")})`, "gi"));
  const alvo = new Set(termos.map(t => t.toLowerCase()));
  return (
    <>
      {partes.map((p, i) =>
        alvo.has(p.toLowerCase())
          ? <mark key={i} className="bg-primary/25 text-primary font-semibold rounded-sm px-0.5">{p}</mark>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<SearchResult[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const caixaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Cada busca leva um número; resposta que não é da última é descartada.
  // Sem isto, a busca lenta de "VAM" chega depois e sobrescreve "VAM5D0008".
  const requisicaoRef = useRef(0);

  const termos = q.trim().split(/\s+/).filter(t => t.length >= MINIMO);

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < MINIMO) {
      setResultados([]); setBuscando(false); setErro(false);
      return;
    }
    setBuscando(true);
    const id = ++requisicaoRef.current;
    const timer = setTimeout(() => {
      api.get<SearchResult[]>(`/search?q=${encodeURIComponent(texto)}&limit=20`)
        .then(rs => {
          if (id !== requisicaoRef.current) return;   // resposta velha
          setResultados(rs); setErro(false); setMarcado(0);
        })
        .catch(() => { if (id === requisicaoRef.current) { setResultados([]); setErro(true); } })
        .finally(() => { if (id === requisicaoRef.current) setBuscando(false); });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  // Ctrl+K / ⌘+K foca a caixa de qualquer lugar do app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    function onClickFora(e: MouseEvent) {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false);
    }
    if (aberto) document.addEventListener("mousedown", onClickFora);
    return () => document.removeEventListener("mousedown", onClickFora);
  }, [aberto]);

  const abrir = useCallback((r: SearchResult) => {
    setAberto(false);
    setQ("");
    navigate(`/boards/${r.board_id}?card=${r.card_id}&list=${r.list_id}`);
  }, [navigate]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (aberto) setAberto(false); else setQ("");
      return;
    }
    if (!aberto || resultados.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setMarcado(m => (m + 1) % resultados.length); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setMarcado(m => (m - 1 + resultados.length) % resultados.length); }
    if (e.key === "Enter")     { e.preventDefault(); abrir(resultados[marcado]); }
  }

  const mostrarPainel = aberto && q.trim().length >= MINIMO;

  return (
    <div className="relative w-full max-w-md" ref={caixaRef}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"><IconSearch /></span>
      <input
        ref={inputRef}
        value={q}
        onChange={e => { setQ(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        onKeyDown={onKeyDown}
        type="text"
        placeholder="Buscar card em todos os quadros…"
        className="w-full pl-9 pr-14 py-2 text-sm rounded-lg border border-border bg-background-elevated text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors"
      />
      <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-500 border border-border rounded px-1.5 py-0.5 pointer-events-none">Ctrl K</kbd>

      {mostrarPainel && (
        <div className="absolute left-0 top-full mt-2 w-full rounded-xl bg-background-surface border border-border shadow-2xl z-50 overflow-hidden">
          {buscando && <p className="text-xs text-slate-500 px-4 py-3">Buscando…</p>}
          {!buscando && erro && <p className="text-xs text-red-400 px-4 py-3">Não foi possível buscar agora.</p>}
          {!buscando && !erro && resultados.length === 0 && (
            <p className="text-xs text-slate-500 px-4 py-3">Nenhum resultado para “{q.trim()}”.</p>
          )}
          <div className="max-h-96 overflow-y-auto">
            {resultados.map((r, i) => (
              <button
                key={r.card_id}
                onClick={() => abrir(r)}
                onMouseEnter={() => setMarcado(i)}
                className={cn(
                  "w-full text-left px-4 py-2.5 border-b border-border/50 last:border-b-0 transition-colors",
                  i === marcado ? "bg-background-elevated" : "hover:bg-background-elevated",
                )}
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-200 truncate flex-1">
                    <Realce texto={r.title} termos={termos} />
                  </p>
                  {r.archived && (
                    <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-500/20 text-slate-400">Arquivado</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                  <span style={r.board_color ? { color: r.board_color } : undefined}>{r.board_title}</span>
                  {" › "}{r.list_title}
                </p>
                {r.matched_field !== "titulo" && (
                  <p className="text-[11px] text-slate-400 mt-1 truncate">
                    <Realce texto={r.snippet} termos={termos} />
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Montar no MainLayout**

Em `frontend/src/layouts/MainLayout.tsx`, acrescentar o import no topo (junto dos outros de `../components/`):

```tsx
import { GlobalSearch } from "../components/GlobalSearch";
```

E substituir a linha 273 — hoje é só um espaçador:

```tsx
          <div className="flex-1" />
```

por:

```tsx
          <div className="flex-1 flex justify-center px-4">
            <GlobalSearch />
          </div>
```

- [ ] **Step 4: Conferir que compila**

```bash
cd /home/ericks/github/TaskHS/frontend
npm run build
```

Esperado: `✓ built`. Erro de tipo aqui costuma ser `Priority` não importado em `types/index.ts` (já está no arquivo) ou nome de campo diferente do que a Task 1 devolve.

- [ ] **Step 5: Verificar no navegador**

Com `npm run dev` rodando e logado como **administrador**:

1. A caixa aparece no centro da topbar em `/dashboard`, `/boards` e dentro de um quadro.
2. Digitar `VAM5D0008` → dropdown com o card da ULTRACARGO, mostrando `Serviços › Recebido` e o trecho da obs com o termo em destaque.
3. `↓` e `↑` andam pela lista; `Enter` abre o card no quadro certo, com o modal já aberto.
4. `Ctrl+K` de qualquer página foca a caixa.
5. `Esc` fecha o dropdown; `Esc` de novo limpa a caixa.
6. Clicar fora fecha o dropdown.
7. Digitar rápido `calibracao` e conferir que o resultado final corresponde ao texto que ficou na caixa (guarda contra resposta fora de ordem).

- [ ] **Step 6: Verificar como membro comum**

Sair, entrar com a conta de **membro** (`$TASKHS_MEMBRO_EMAIL`) e repetir a busca de um termo de quadro alheio: o dropdown tem de dizer "Nenhum resultado". E um termo de quadro dele tem de achar normalmente.

- [ ] **Step 7: Commit**

```bash
cd /home/ericks/github/TaskHS
git add frontend/src/types/index.ts frontend/src/components/GlobalSearch.tsx frontend/src/layouts/MainLayout.tsx
git commit -m "feat(busca): caixa de busca global na topbar

Componente proprio (o BoardPage ja tem 3200 linhas), com debounce de 250ms,
guarda contra resposta fora de ordem, Ctrl+K, navegacao por setas e realce dos
termos feito no front — o backend devolve texto cru, sem HTML.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Abrir card arquivado vindo da busca

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx:2305-2311` (efeito do deep link)
- Modify: `frontend/src/pages/BoardPage.tsx:778` (cabeçalho do `CardDetailModal`, para a faixa)
- Modify: `frontend/src/pages/BoardPage.tsx:2834-2849` (passar a prop nova ao modal)

**Interfaces:**
- Consumes: o link `/boards/{id}?card={cardId}&list={listId}` produzido pela Task 2; o endpoint já existente `GET /api/lists/{list_id}/cards/{card_id}` (não filtra arquivado e é trancado por `require_board_access_by_list_id`).
- Produces: prop nova `onRestore: (card: Card) => void` no `CardDetailModal`, usada só pela faixa de arquivado.

- [ ] **Step 1: Fallback no deep link**

Em `frontend/src/pages/BoardPage.tsx`, substituir o efeito das linhas 2305-2311:

```tsx
  // Deep link: /boards/:id?card=<id> abre o card já aberto (usado pelos links da página de Logs).
  useEffect(() => {
    const cardId = Number(searchParams.get("card"));
    if (!cardId) return;
    const alvo = Object.values(cardsByList).flat().find(c => c.id === cardId);
    if (alvo) setSelectedCard(alvo);
  }, [searchParams, cardsByList]);
```

por:

```tsx
  // Deep link: /boards/:id?card=<id> abre o card já aberto (Logs e busca global).
  // Com &list=<id>, também abre card ARQUIVADO: ele não está em cardsByList (o
  // /snapshot filtra archived), então busca o card avulso — o endpoint por
  // list_id continua trancado, list_id forjado dá 403, não 200.
  useEffect(() => {
    const cardId = Number(searchParams.get("card"));
    if (!cardId) return;
    if (selectedCard?.id === cardId) return;
    const alvo = Object.values(cardsByList).flat().find(c => c.id === cardId);
    if (alvo) { setSelectedCard(alvo); return; }
    const listId = Number(searchParams.get("list"));
    if (!listId) return;
    let cancelado = false;
    api.get<Card>(`/lists/${listId}/cards/${cardId}`)
      .then(c => { if (!cancelado) setSelectedCard(c); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [searchParams, cardsByList, selectedCard?.id]);
```

- [ ] **Step 2: Limpar o `list` da URL ao fechar**

Na função `fecharCard` (logo abaixo, hoje linhas 2313-2320), remover também o parâmetro `list`:

```tsx
  function fecharCard() {
    setSelectedCard(null);
    if (searchParams.get("card") || searchParams.get("list")) {
      const p = new URLSearchParams(searchParams);
      p.delete("card");
      p.delete("list");
      setSearchParams(p, { replace: true });
    }
  }
```

- [ ] **Step 3: Restaurar a partir do modal**

Ainda em `BoardPage.tsx`, ao lado de `handleRestoreCard` (linha 2418), acrescentar uma função que serve ao card aberto no modal:

```tsx
  // Restaurar direto do modal (card aberto pela busca global, que inclui
  // arquivados). Diferente de handleRestoreCard, aqui não há linha na lista de
  // arquivados para remover — o card volta pro quadro e o modal segue aberto.
  async function handleRestoreFromModal(card: Card) {
    try {
      const restored = await api.post<Card>(`/lists/${card.list_id}/cards/${card.id}/restore`, {});
      setCardsByList(prev => ({
        ...prev,
        [restored.list_id]: [...(prev[restored.list_id] ?? []).filter(c => c.id !== restored.id), restored],
      }));
      setSelectedCard(restored);
    } catch {}
  }
```

- [ ] **Step 4: Faixa "Cartão arquivado" no modal**

Na assinatura de `CardDetailModal` (linha 193), acrescentar a prop ao objeto desestruturado e ao tipo:

```tsx
function CardDetailModal({ card, boardId, listTitle, lists, boardLabels, currentUser, integrationEnabled, obsLabels, onClose, onCardUpdate, onCardDelete, onCardCopy, onRestore }: {
```

e, dentro do bloco de tipos (junto de `onCardCopy: (newCard: Card) => void;`):

```tsx
  onRestore: (card: Card) => void;
```

Depois, dentro do JSX, logo **antes** da barra de prioridade (a linha 775, `{/* Priority color bar */}`), inserir:

```tsx
        {card.archived && (
          <div className="flex items-center justify-between gap-3 px-6 py-2 bg-slate-500/15 border-b border-border">
            <p className="text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Cartão arquivado</span> — não aparece no quadro.
            </p>
            <button
              onClick={() => onRestore(card)}
              className="text-xs px-2.5 py-1 rounded-md bg-primary/15 text-primary hover:bg-primary/25 transition-colors font-semibold shrink-0"
            >
              Restaurar
            </button>
          </div>
        )}
```

- [ ] **Step 5: Passar a prop**

Na renderização do modal (linhas 2834-2849), acrescentar depois de `onCardCopy={handleCardCopy}`:

```tsx
          onRestore={handleRestoreFromModal}
```

E, como o card arquivado pode estar numa lista arquivada (que não está em `lists`), trocar a linha do `listTitle` por uma que não fica vazia:

```tsx
          listTitle={lists.find(l => l.id === selectedCard.list_id)?.title ?? "lista arquivada"}
```

- [ ] **Step 6: Conferir que compila**

```bash
cd /home/ericks/github/TaskHS/frontend
npm run build
```

Esperado: `✓ built`.

- [ ] **Step 7: Verificar no navegador**

1. Arquivar um card qualquer (menu do card → Arquivar) e anotar um termo do título dele.
2. Buscar esse termo na caixa da topbar → o resultado aparece com o selo `Arquivado`.
3. Clicar → o quadro abre com o modal do card, e no topo a faixa **"Cartão arquivado"**.
4. Clicar em **Restaurar** → a faixa some e o card volta a aparecer na lista atrás do modal.
5. Fechar o modal → a URL volta a ser `/boards/:id`, sem `?card=` nem `&list=`.
6. Buscar um card **não** arquivado e clicar → abre normalmente, como antes (nada regrediu).
7. Conferir que os links da página de **Logs** (que usam `?card=` sem `&list=`) continuam abrindo o card.

- [ ] **Step 8: Commit**

```bash
cd /home/ericks/github/TaskHS
git add frontend/src/pages/BoardPage.tsx
git commit -m "feat(busca): abrir card arquivado a partir do resultado

O deep link ganha &list= e, quando o card nao esta no quadro carregado, busca
avulso em GET /lists/{list}/cards/{card} — endpoint que ja existe e segue
trancado. O modal mostra a faixa 'Cartao arquivado' com botao de restaurar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Changelog e verificação final

**Files:**
- Modify: `frontend/src/data/changelog.ts:15` (topo do array `CHANGELOG`)

**Interfaces:**
- Consumes: nada. Produces: `APP_VERSION` passa a ser `1.13.0` (deriva de `CHANGELOG[0]`).

- [ ] **Step 1: Entrada no changelog**

Em `frontend/src/data/changelog.ts`, logo depois de `export const CHANGELOG: ChangelogVersion[] = [`, inserir:

```ts
  {
    version: "1.13.0",
    date: "2026-07-30",
    changes: [
      { kind: "novidade", text: "Busca global na barra do topo: encontra cards em todos os quadros a que você tem acesso, de qualquer página. Além do título e da descrição, ela varre os campos de observação que a integração preenche — então dá para achar um atendimento pelo número de série do aparelho. Ignora acentos (\"calibracao\" acha \"Calibração\"), aceita várias palavras em qualquer ordem, e o atalho Ctrl+K abre a busca de onde você estiver." },
      { kind: "novidade", text: "Cards arquivados também aparecem no resultado da busca, marcados com o selo \"Arquivado\". Ao abrir um deles, o cartão mostra um aviso no topo com um botão para restaurá-lo direto dali." },
    ],
  },
```

- [ ] **Step 2: Conferir a versão no rodapé**

```bash
cd /home/ericks/github/TaskHS/frontend
npm run build
```

Esperado: `✓ built`. No navegador, o rodapé da sidebar mostra **v1.13.0**, e clicar nele abre o changelog com a entrada nova no topo.

- [ ] **Step 3: Bateria final de verificação**

Com backend e front no ar, em uma passada só:

| # | Ação | Esperado |
|---|---|---|
| 1 | Buscar `VAM5D0008` como admin | card da ULTRACARGO, snippet com o nº de série destacado |
| 2 | Buscar `calibracao` | acha "Calibração" |
| 3 | Buscar `%` | "Nenhum resultado" |
| 4 | Buscar termo de quadro alheio como **membro** | "Nenhum resultado" |
| 5 | O mesmo termo como **admin** | acha |
| 6 | `Ctrl+K` → `↓↓` → `Enter` | abre o 3º resultado |
| 7 | Resultado arquivado → clicar → Restaurar | faixa some, card volta ao quadro |
| 8 | Fechar o modal | URL limpa |
| 9 | Link de card na página de Logs | continua abrindo |
| 10 | `npm run build` | passa |

- [ ] **Step 4: Commit**

```bash
cd /home/ericks/github/TaskHS
git add frontend/src/data/changelog.ts
git commit -m "chore(changelog): busca global (v1.13.0)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Notas para quem executar

- **A tranca é o item de maior risco desta feature.** O Step 7 da Task 1 não é formalidade: o repositório já teve incidente de exposição, e uma busca que devolve card de quadro alheio é um vazamento silencioso — ninguém percebe olhando a tela.
- **Não crie migration.** Nenhuma coluna nova.
- **Não instale extensão no Postgres.** O `translate()` é nativo justamente para não haver passo manual no deploy.
- **Não mexa nos routers existentes.** A busca é um arquivo novo; se você se pegou editando `cards.py` ou `boards.py`, algo saiu do plano.
- Se o `BoardPage.tsx` ficar difícil de editar por causa do tamanho, edite por âncora de texto exata (as linhas citadas podem ter deslizado alguns números entre as tasks).
