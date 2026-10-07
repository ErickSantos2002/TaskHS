# Perfil do usuário (nome e foto) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada pessoa edita o próprio nome e foto numa modal "Meu perfil", aberta por um menu no canto superior direito (que também passa a abrigar o tema e o Sair); a foto aparece em todo lugar onde hoje há iniciais.

**Architecture:** Coluna `users.avatar` (nome do arquivo); arquivo em `UPLOAD_DIR/avatars/<uuid>.webp`; servido sem auth por `GET /api/avatars/{nome}`. `User.avatar_url` entra em todos os schemas/dicts que já levam `initials`. No front, um componente `<Avatar>` substitui todos os círculos de iniciais; `ProfileModal` faz o redimensionamento no canvas antes do upload.

**Tech Stack:** FastAPI async + SQLAlchemy 2.0 + Postgres; React 19 + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-07-perfil-usuario-design.md`

## Global Constraints

- **Sem suíte de testes.** Verificação = curl + navegador + `npm run build` + `npm run lint`. Não criar pytest/vitest.
- **O backend de dev aponta para o banco de PRODUÇÃO.** Toda alteração feita durante a verificação (nome, foto) tem de ser **desfeita no fim do mesmo passo**: renomear de volta para o nome original e `DELETE /api/auth/me/avatar`. Uma foto deixada no banco aponta para um arquivo que só existe no volume local — em produção daria imagem quebrada.
- **Repo público:** nenhuma senha em arquivo, commit ou saída de comando. Login nas verificações: `set -a; source backend/.env.dev-users; set +a` e usar `$TASKHS_ADMIN_PW`. Nunca `cat backend/.env`.
- **Subir o backend:** `docker compose up -d --build` na raiz (porta 8000). Se a 8000 estiver ocupada pelo `gestorhs-backend`, parar ele primeiro (`docker stop gestorhs-backend`) e avisar no relatório.
- Formatos aceitos: `image/jpeg`, `image/png`, `image/webp`. Tamanho máximo: **2 MB** (`2 * 1024 * 1024`). Tipo inválido → **400**; grande demais → **413**.
- Nome: `strip()`, **1–120** caracteres; fora disso → **422**.
- Iniciais: primeira letra do primeiro nome + primeira do último, maiúsculas; nome de uma palavra → 1 letra.
- `avatar_url` no JSON é **relativo ao `API_BASE`**: `"/avatars/<nome>"` (sem o `/api`). O front monta `${API_BASE}${avatar_url}`. (Assim funciona com qualquer `VITE_API_URL`.)
- Regex do nome do arquivo servido: `^[0-9a-f]{32}\.(jpg|png|webp)$`.
- Header do GET da foto: `Cache-Control: public, max-age=31536000, immutable`.
- Textos de UI em português. Changelog: **v2.5.0**, `kind: "novidade"`, data `2026-10-07`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Path traversal no GET da foto** (`/api/avatars/..%2F..%2Fetc%2Fpasswd`, `/api/avatars/x.svg`) → 404 sem tocar no disco. Teste em Task 2, Step 5.
2. **Upload de arquivo que não é imagem ou > 2 MB** (PDF, SVG, 3 MB) → 400/413 com mensagem em português, sem arquivo órfão no disco e sem alterar `users.avatar`. Teste em Task 2, Step 5.
3. **Foto que não carrega** (arquivo apagado do volume, URL 404) → avatar volta para as iniciais, não mostra ícone de imagem quebrada. Teste em Task 3, Step 6.
4. **Nome só com espaços / vazio / 121 caracteres** → 422 e a modal mostra o erro sem fechar; botão Salvar desabilitado com nome vazio. Teste em Task 2, Step 5 e Task 4, Step 7.
5. **Trocar a foto duas vezes seguidas** → o arquivo antigo some do disco (não acumula lixo) e o header mostra a nova sem F5. Teste em Task 2, Step 5 e Task 4, Step 7.

---

### Task 1: Coluna `avatar` e `avatar_url` em toda serialização de usuário

**Files:**
- Create: `backend/migrations/012_user_avatar.sql`
- Modify: `backend/app/models/user.py`
- Modify: `backend/app/schemas/user.py` (`UserOut`)
- Modify: `backend/app/routers/auth.py` (`UserBasicOut`)
- Modify: `backend/app/schemas/board.py` (`BoardMemberOut` ~linha 95, `BoardMemberBriefOut` ~linha 104)
- Modify: `backend/app/routers/boards.py` (dicts nas linhas ~59, ~88, ~464)

**Interfaces:**
- Produces: `User.avatar: str | None` (coluna); `User.avatar_url -> str | None` (property, `"/avatars/<avatar>"` ou `None`); campo `avatar_url: str | None = None` em `UserOut`, `UserBasicOut`, `BoardMemberOut`, `BoardMemberBriefOut`.

- [ ] **Step 1: Migration**

`backend/migrations/012_user_avatar.sql`:

```sql
-- Foto de perfil: nome do arquivo em UPLOAD_DIR/avatars/ (<uuid hex>.<ext>).
-- NULL = sem foto, o front mostra as iniciais.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(64);
```

(O `app/migrations.py` aplica sozinho no boot; não adicionar ao `BASELINE`.)

- [ ] **Step 2: Modelo**

Em `backend/app/models/user.py`, importar `Optional` não é necessário (usar `str | None`). Depois de `initials`:

```python
    avatar: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
```

E junto das outras properties:

```python
    @property
    def avatar_url(self) -> str | None:
        # Relativo ao API_BASE do front (que já termina em /api).
        return f"/avatars/{self.avatar}" if self.avatar else None
```

- [ ] **Step 3: Schemas**

`backend/app/schemas/user.py`, em `UserOut`, depois de `initials: str`:

```python
    avatar_url: str | None = None
```

Mesma linha em `UserBasicOut` (`routers/auth.py`), `BoardMemberOut` e `BoardMemberBriefOut` (`schemas/board.py`), sempre logo depois de `initials: str`.

- [ ] **Step 4: Dicts manuais de `boards.py`**

Nos três dicts, acrescentar `avatar_url` ao lado de `initials`:

```python
            {"id": m.user.id, "name": m.user.name, "initials": m.user.initials, "avatar_url": m.user.avatar_url}
```
```python
            "id": current_user.id, "name": current_user.name, "initials": current_user.initials,
            "avatar_url": current_user.avatar_url,
```
```python
        {"id": u.id, "name": u.name, "email": u.email, "initials": u.initials,
         "avatar_url": u.avatar_url,
         "board_role": bm.role, "assigned_cards": n}
```

`CardOut.members` e `CommentOut.author` já serializam o objeto `User` via `UserOut` — não precisam de mudança (e o SSE herda).

- [ ] **Step 5: Verificar**

```bash
docker compose up -d --build && sleep 5
docker compose logs backend 2>&1 | grep -iE "012_user_avatar|error" | tail
./scripts/psql-dev.sh -c "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='avatar';"
set -a; source backend/.env.dev-users; set +a
TOKEN=$(curl -s localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"healthsafetyti@gmail.com\",\"password\":\"$TASKHS_ADMIN_PW\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -s localhost:8000/api/auth/me -H "Authorization: Bearer $TOKEN" | grep -o '"avatar_url":[^,]*'
curl -s localhost:8000/api/auth/users/basic -H "Authorization: Bearer $TOKEN" | grep -c avatar_url
curl -s localhost:8000/api/boards -H "Authorization: Bearer $TOKEN" | grep -c avatar_url
```

Expected: log mostra a 012 aplicada sem erro; psql devolve 1 linha `avatar`; `/me` traz `"avatar_url":null`; os dois `grep -c` ≥ 1. Abrir um quadro no navegador (`npm run dev`) e conferir que nada quebrou.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/012_user_avatar.sql backend/app/models/user.py backend/app/schemas/user.py backend/app/schemas/board.py backend/app/routers/auth.py backend/app/routers/boards.py
git commit -m "feat(perfil): coluna users.avatar e avatar_url nas respostas de usuario"
```

---

### Task 2: Endpoints do perfil e servidor da foto

**Files:**
- Modify: `backend/app/routers/auth.py` (3 endpoints novos em `/me`)
- Create: `backend/app/routers/avatars.py`
- Modify: `backend/app/main.py:13` (import) e `:79-90` (`include_router`)

**Interfaces:**
- Consumes: `User.avatar`, `UserOut` com `avatar_url` (Task 1).
- Produces: `PATCH /api/auth/me` `{name}` → `UserOut`; `POST /api/auth/me/avatar` (multipart, campo **`file`**) → `UserOut`; `DELETE /api/auth/me/avatar` → `UserOut`; `GET /api/avatars/{nome}` → imagem. Helpers `AVATAR_DIR` e `AVATAR_NAME_RE` em `app/routers/avatars.py`.

- [ ] **Step 1: Router `avatars.py`**

```python
"""Fotos de perfil. Servidas SEM autenticação, de propósito.

O avatar aparece dezenas de vezes por tela; com download autenticado (como os
anexos) cada um exigiria fetch + objectURL no front. O nome do arquivo é um
UUID v4 sem listagem — não dá para adivinhar a foto de alguém. Trocar a foto
gera nome novo, por isso o cache pode ser imutável.
"""
import os
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core.config import settings

AVATAR_DIR = os.path.join(settings.UPLOAD_DIR, "avatars")
# Validar ANTES de tocar no disco: é a barreira contra path traversal.
AVATAR_NAME_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|png|webp)$")

router = APIRouter(prefix="/avatars", tags=["avatars"])


@router.get("/{nome}")
async def get_avatar(nome: str):
    if not AVATAR_NAME_RE.fullmatch(nome):
        raise HTTPException(status_code=404, detail="Foto não encontrada")
    caminho = os.path.join(AVATAR_DIR, nome)
    if not os.path.isfile(caminho):
        raise HTTPException(status_code=404, detail="Foto não encontrada")
    return FileResponse(caminho, headers={"Cache-Control": "public, max-age=31536000, immutable"})
```

Em `main.py`: acrescentar `avatars` ao import da linha 13 e `app.include_router(avatars.router, prefix="/api")` junto dos outros.

- [ ] **Step 2: `PATCH /me` em `auth.py`**

Imports a acrescentar no topo: `import os`, `import uuid`, `from typing import Annotated`, `from fastapi import UploadFile, File` (junto ao import existente do fastapi), `from pydantic import StringConstraints`, `from app.routers.avatars import AVATAR_DIR`.

Logo depois do `GET /me`:

```python
def iniciais_do_nome(nome: str) -> str:
    """'Erick Santos' -> 'ES'; 'Erick' -> 'E'. Primeiro + último nome."""
    partes = nome.split()
    if len(partes) == 1:
        return partes[0][0].upper()
    return (partes[0][0] + partes[-1][0]).upper()


class ProfileUpdate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


@router.patch("/me", response_model=UserOut)
async def update_me(body: ProfileUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.name = body.name
    current_user.initials = iniciais_do_nome(body.name)
    await db.commit()
    await db.refresh(current_user)
    return current_user
```

- [ ] **Step 3: `POST` e `DELETE /me/avatar`**

```python
AVATAR_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
AVATAR_MAX = 2 * 1024 * 1024


def _apaga_avatar(nome: str | None) -> None:
    """Apaga o arquivo antigo. Falha aqui não pode desfazer a troca já gravada."""
    if not nome:
        return
    try:
        os.remove(os.path.join(AVATAR_DIR, nome))
    except OSError:
        logger.warning("não consegui apagar o avatar antigo %s", nome)


@router.post("/me/avatar", response_model=UserOut)
async def upload_my_avatar(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    ext = AVATAR_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(status_code=400, detail="Formato não aceito. Use JPG, PNG ou WEBP.")
    conteudo = await file.read(AVATAR_MAX + 1)
    if len(conteudo) > AVATAR_MAX:
        raise HTTPException(status_code=413, detail="Foto grande demais (máximo 2 MB).")
    os.makedirs(AVATAR_DIR, exist_ok=True)
    novo = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(AVATAR_DIR, novo), "wb") as out:
        out.write(conteudo)
    antigo = current_user.avatar
    current_user.avatar = novo
    try:
        await db.commit()
    except Exception:
        _apaga_avatar(novo)  # sem órfão no disco se o banco recusar
        raise
    _apaga_avatar(antigo)    # só depois do commit
    await db.refresh(current_user)
    return current_user


@router.delete("/me/avatar", response_model=UserOut)
async def delete_my_avatar(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    antigo = current_user.avatar
    current_user.avatar = None
    await db.commit()
    _apaga_avatar(antigo)
    await db.refresh(current_user)
    return current_user
```

**Atenção à ordem das rotas:** `PATCH /me` e `/me/avatar` não colidem com `/users/{user_id}`; nada a reordenar.

- [ ] **Step 4: Reconstruir**

```bash
docker compose up -d --build && sleep 5 && curl -s localhost:8000/api/health
```

- [ ] **Step 5: Verificar (e desfazer tudo no fim)**

```bash
set -a; source backend/.env.dev-users; set +a
TOKEN=$(curl -s localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"healthsafetyti@gmail.com\",\"password\":\"$TASKHS_ADMIN_PW\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
H="Authorization: Bearer $TOKEN"
ORIG=$(curl -s localhost:8000/api/auth/me -H "$H" | python3 -c 'import sys,json;print(json.load(sys.stdin)["name"])')
echo "nome original: $ORIG"
S=$(mktemp -d)   # pasta temporária para os arquivos de teste
# nome
curl -s -X PATCH localhost:8000/api/auth/me -H "$H" -H 'Content-Type: application/json' -d '{"name":"  Teste Perfil Silva  "}' | grep -oE '"(name|initials)":"[^"]*"'
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH localhost:8000/api/auth/me -H "$H" -H 'Content-Type: application/json' -d '{"name":"   "}'
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH localhost:8000/api/auth/me -H "$H" -H 'Content-Type: application/json' -d "{\"name\":\"$(printf 'a%.0s' {1..121})\"}"
# foto
python3 -c "import base64;open('$S/a.png','wb').write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='))"
head -c 3145728 /dev/zero > $S/big.png
echo "%PDF-1.4" > $S/a.pdf
U1=$(curl -s -X POST localhost:8000/api/auth/me/avatar -H "$H" -F "file=@$S/a.png;type=image/png" | python3 -c 'import sys,json;print(json.load(sys.stdin)["avatar_url"])'); echo $U1
curl -s -o /dev/null -w "%{http_code} %header{cache-control}\n" localhost:8000/api$U1
U2=$(curl -s -X POST localhost:8000/api/auth/me/avatar -H "$H" -F "file=@$S/a.png;type=image/png" | python3 -c 'import sys,json;print(json.load(sys.stdin)["avatar_url"])'); echo $U2
curl -s -o /dev/null -w "antigo: %{http_code}\n" localhost:8000/api$U1
curl -s -o /dev/null -w "pdf: %{http_code}\n" -X POST localhost:8000/api/auth/me/avatar -H "$H" -F "file=@$S/a.pdf;type=application/pdf"
curl -s -o /dev/null -w "svg: %{http_code}\n" -X POST localhost:8000/api/auth/me/avatar -H "$H" -F "file=@$S/a.pdf;type=image/svg+xml"
curl -s -o /dev/null -w "3MB: %{http_code}\n" -X POST localhost:8000/api/auth/me/avatar -H "$H" -F "file=@$S/big.png;type=image/png"
curl -s localhost:8000/api/auth/me -H "$H" | grep -o '"avatar_url":"[^"]*"'
curl -s -o /dev/null -w "traversal: %{http_code}\n" "localhost:8000/api/avatars/..%2F..%2Fetc%2Fpasswd"
curl -s -o /dev/null -w "invalido: %{http_code}\n" localhost:8000/api/avatars/foto.svg
docker compose exec -T backend ls /app/uploads/avatars | wc -l
# DESFAZER (obrigatório — banco de produção)
curl -s -X DELETE localhost:8000/api/auth/me/avatar -H "$H" | grep -o '"avatar_url":[^,]*'
curl -s -X PATCH localhost:8000/api/auth/me -H "$H" -H 'Content-Type: application/json' -d "{\"name\":\"$ORIG\"}" | grep -oE '"(name|initials)":"[^"]*"'
docker compose exec -T backend ls /app/uploads/avatars | wc -l
```

Expected: nome vira `Teste Perfil Silva` com iniciais `TS`; vazio → `422`; 121 chars → `422`; U1 → `200 public, max-age=31536000, immutable`; antigo → `404`; pdf → `400`; svg → `400`; 3MB → `413`; `/me` continua com U2 (erros não alteraram); traversal → `404`; invalido → `404`; 1 arquivo no diretório; depois de desfazer: `"avatar_url":null`, nome original de volta, **0** arquivos. **Atenção:** as iniciais do admin voltam recalculadas do nome original — conferir se batem com as de antes e, se não baterem, relatar (não corrigir no banco).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/auth.py backend/app/routers/avatars.py backend/app/main.py
git commit -m "feat(perfil): editar o proprio nome e foto; rota publica das fotos"
```

---

### Task 3: Componente `<Avatar>` em todos os pontos que desenham iniciais

**Files:**
- Modify: `frontend/src/types/index.ts` (`User`, `UserBasic`)
- Modify: `frontend/src/contexts/AuthContext.tsx` (tipo `User`)
- Modify: `frontend/src/lib/api.ts` (`avatarSrc`)
- Create: `frontend/src/components/Avatar.tsx`
- Modify: `frontend/src/layouts/MainLayout.tsx:339-341`
- Modify: `frontend/src/pages/BoardPage.tsx` (~1270, ~1292, ~1716, ~1758, ~2045, ~3554)
- Modify: `frontend/src/pages/BoardsPage.tsx:77-83`
- Modify: `frontend/src/pages/UsersPage.tsx:240-242`

**Interfaces:**
- Consumes: `avatar_url` nas respostas (Task 1) — relativo ao `API_BASE`.
- Produces: `avatarSrc(url: string): string` em `lib/api.ts`; `Avatar({ user, className, textClassName })` em `components/Avatar.tsx`, `user: { name: string; initials: string; avatar_url?: string | null }`.

- [ ] **Step 1: Tipos**

Em `types/index.ts`, acrescentar em `User` e em `UserBasic`, depois de `initials`:

```ts
  /** Relativo ao API_BASE ("/avatars/<nome>"); null = sem foto, mostra iniciais. */
  avatar_url?: string | null;
```

Mesma linha no `User` de `contexts/AuthContext.tsx`.

- [ ] **Step 2: `avatarSrc` em `lib/api.ts`**

Logo depois da linha do `API_BASE`:

```ts
/** URL absoluta da foto de perfil. O backend devolve avatar_url relativo ao API_BASE. */
export function avatarSrc(url: string): string {
  return `${API_BASE}${url}`;
}
```

- [ ] **Step 3: `components/Avatar.tsx`**

```tsx
import { useState } from "react";
import { cn } from "../lib/utils";
import { avatarSrc } from "../lib/api";

interface AvatarUser {
  name: string;
  initials: string;
  avatar_url?: string | null;
}

/** Foto de perfil, ou as iniciais quando não há foto (ou ela não carrega).
 *  O círculo (tamanho, fundo, borda) vem de `className` para cada lugar manter
 *  o visual que já tinha; `textClassName` estiliza as iniciais. */
export function Avatar({ user, className, textClassName }: { user: AvatarUser; className: string; textClassName?: string }) {
  // Guarda QUAL url falhou: se a pessoa troca a foto, a nova tenta carregar de novo.
  const [falhou, setFalhou] = useState<string | null>(null);
  const url = user.avatar_url && user.avatar_url !== falhou ? user.avatar_url : null;
  return (
    <div className={cn(className, "overflow-hidden")}>
      {url ? (
        <img src={avatarSrc(url)} alt={user.name} className="w-full h-full object-cover" onError={() => setFalhou(url)} />
      ) : (
        <span className={textClassName}>{user.initials}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Substituir os pontos**

Regra: o `div` externo vira `<Avatar>` com o **mesmo** `className`; o que estava no `span` interno (ou no próprio div, quando não havia span) vai para `textClassName`. Manter `key`/`title` onde existiam (passar `title` envolvendo não é preciso — `BoardsPage` usa `title`, então envolver: ver abaixo).

`MainLayout.tsx` (header):
```tsx
<Avatar user={user ?? { name: "", initials: "?" }} className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center text-white text-xs font-bold shadow-sm" />
```

`BoardPage.tsx`, membros do card (~1270):
```tsx
<Avatar user={m} className="w-6 h-6 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shrink-0" textClassName="text-[9px] font-bold text-white leading-none" />
```
Seletor de membro (~1292):
```tsx
<Avatar user={u} className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shrink-0" textClassName="text-[10px] font-bold text-white leading-none" />
```
Menção (~1716):
```tsx
<Avatar user={u} className="w-6 h-6 rounded-full bg-background-elevated border border-border flex items-center justify-center text-[9px] font-bold text-slate-300 shrink-0" />
```
Autor do comentário (~1758):
```tsx
<Avatar user={c.author} className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shrink-0 mt-0.5" textClassName="text-[9px] font-bold text-white leading-none" />
```
Miniatura do card no quadro (~2045):
```tsx
<Avatar user={card.members[0]} className="w-5 h-5 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shrink-0" textClassName="text-[8px] font-bold text-white leading-none" />
```
Membros do quadro no drawer (~3554):
```tsx
<Avatar user={m} className="w-7 h-7 rounded-full bg-background-surface border border-border flex items-center justify-center text-[10px] font-bold text-slate-300 shrink-0" />
```

`BoardsPage.tsx` `MemberAvatars` — o `title` e o `key` ficam num wrapper:
```tsx
{visiveis.map(m => (
  <div key={m.id} title={m.name}>
    <Avatar user={m} className="w-6 h-6 rounded-full bg-background-elevated border border-border flex items-center justify-center text-[9px] font-bold text-slate-300" />
  </div>
))}
```

`UsersPage.tsx` (~240):
```tsx
<Avatar user={u} className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0" textClassName="text-xs font-bold text-primary" />
```

Importar `Avatar` de `../components/Avatar` em cada arquivo. Conferir com `grep -n "initials}" frontend/src -r` que não sobrou círculo de iniciais fora do `Avatar` (o form de criação da `UsersPage` é campo de input, fica).

- [ ] **Step 5: Build e lint**

```bash
cd frontend && npm run build && npm run lint
```
Expected: build passa; lint sem erro novo nos arquivos tocados.

- [ ] **Step 6: Verificar no navegador**

Com backend e `npm run dev` de pé: quadro, card aberto, comentários, drawer de membros, `/boards`, `/usuarios` — visual idêntico ao de antes (todos sem foto). Para o fallback (Review Focus 3): subir uma foto pelo curl da Task 2, apagar o arquivo no container (`docker compose exec -T backend sh -c 'rm /app/uploads/avatars/*'`), recarregar — avatar mostra iniciais, sem ícone quebrado. **Desfazer:** `DELETE /api/auth/me/avatar`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(perfil): componente Avatar com foto ou iniciais em todas as telas"
```

---

### Task 4: Menu do usuário, modal "Meu perfil" e changelog

**Files:**
- Modify: `frontend/src/contexts/AuthContext.tsx` (`updateUser`)
- Modify: `frontend/src/lib/api.ts` (`upload` com nome do campo)
- Create: `frontend/src/components/ProfileModal.tsx`
- Modify: `frontend/src/layouts/MainLayout.tsx` (menu; tema e Sair saem do header)
- Modify: `frontend/src/data/changelog.ts`

**Interfaces:**
- Consumes: endpoints da Task 2; `Avatar`, `avatarSrc` (Task 3).
- Produces: `updateUser(u: User): void` no `AuthContext`; `api.upload(path, files, field = "files")`; `ProfileModal({ onClose })`.

- [ ] **Step 1: `updateUser` no `AuthContext`**

```tsx
  const updateUser = useCallback((u: User) => {
    localStorage.setItem("taskhs-user", JSON.stringify(u));
    setUser(u);
  }, []);
```
Adicionar `updateUser: (u: User) => void;` ao `AuthContextValue` e ao `value` do provider.

- [ ] **Step 2: Campo configurável no `api.upload`**

```ts
  upload: async <T>(path: string, files: File[], field = "files"): Promise<T> => {
    const fd = new FormData();
    for (const f of files) fd.append(field, f);
```
(resto igual; chamadas existentes não mudam.)

- [ ] **Step 3: `components/ProfileModal.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth, type User } from "../contexts/AuthContext";
import { Avatar } from "./Avatar";

const PAPEL: Record<User["role"], string> = { administrador: "Administrador", coordenador: "Coordenador", membro: "Membro" };

/** Recorta o quadrado central e reduz para 256x256 WebP. O backend valida de novo. */
async function prepararFoto(arquivo: File): Promise<File> {
  const bitmap = await createImageBitmap(arquivo);
  const lado = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - lado) / 2, (bitmap.height - lado) / 2, lado, lado, 0, 0, 256, 256);
  bitmap.close();
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/webp", 0.9));
  if (!blob) throw new Error("Não consegui processar a imagem.");
  return new File([blob], "avatar.webp", { type: "image/webp" });
}

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, updateUser } = useAuth();
  const [nome, setNome] = useState(user?.name ?? "");
  const [salvando, setSalvando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [erro, setErro] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!user) return null;

  async function trocarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    setErro(""); setEnviandoFoto(true);
    try {
      const pronta = await prepararFoto(arquivo);
      updateUser(await api.upload<User>("/auth/me/avatar", [pronta], "file"));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao enviar a foto.");
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function removerFoto() {
    setErro(""); setEnviandoFoto(true);
    try {
      updateUser(await api.del<User>("/auth/me/avatar"));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao remover a foto.");
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function salvar() {
    setErro(""); setSalvando(true);
    try {
      updateUser(await api.patch<User>("/auth/me", { name: nome.trim() }));
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const campo = "w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-slate-100 outline-none focus:border-primary";
  const nomeInvalido = nome.trim().length === 0 || nome.trim().length > 120;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-12" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-background-surface shadow-2xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-extrabold text-slate-100">Meu perfil</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-background-elevated transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center gap-4">
            <Avatar user={user} className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shrink-0" textClassName="text-2xl font-bold text-white" />
            <div className="flex flex-col gap-1.5 items-start">
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={trocarFoto} />
              <button onClick={() => inputRef.current?.click()} disabled={enviandoFoto} className="text-sm font-semibold text-primary hover:underline disabled:opacity-50">
                {enviandoFoto ? "Enviando..." : "Trocar foto"}
              </button>
              {user.avatar_url && (
                <button onClick={removerFoto} disabled={enviandoFoto} className="text-xs text-slate-400 hover:text-danger-400 disabled:opacity-50">Remover foto</button>
              )}
              <p className="text-[11px] text-slate-500">JPG, PNG ou WEBP, até 2 MB.</p>
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-slate-400">Nome</span>
            <input className={campo} value={nome} maxLength={120} onChange={e => setNome(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !nomeInvalido) salvar(); }} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-400">E-mail</span>
            <input className={campo + " opacity-60 cursor-not-allowed"} value={user.email} disabled />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-400">Perfil</span>
            <input className={campo + " opacity-60 cursor-not-allowed"} value={PAPEL[user.role]} disabled />
          </label>

          {erro && <p className="text-xs text-danger-400">{erro}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-background-elevated">Cancelar</button>
          <button onClick={salvar} disabled={salvando || nomeInvalido} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-50">
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Se `text-danger-400`/`bg-primary-600` não existirem no tema, usar as classes equivalentes já usadas no projeto (`grep -rn "danger-4\|primary-6" frontend/src | head`).

- [ ] **Step 4: Menu do usuário no `MainLayout`**

Estado e ref novos, junto dos existentes:
```tsx
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
```
Fechar ao clicar fora e no Esc (mesmo padrão do sino):
```tsx
  useEffect(() => {
    if (!showUserMenu) return;
    function onClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setShowUserMenu(false); }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [showUserMenu]);
```
- Remover o bloco `{/* Theme toggle */}` (botão solto) do header.
- Substituir o bloco `{/* User */}` inteiro por:

```tsx
            {/* User */}
            <div className="relative ml-2 pl-2 border-l border-border" ref={userMenuRef}>
              <button
                onClick={() => setShowUserMenu(v => !v)}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-background-elevated transition-colors duration-200"
              >
                <Avatar user={user ?? { name: "", initials: "?" }} className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center text-white text-xs font-bold shadow-sm" />
                <div className="hidden md:block text-left">
                  <p className="text-sm font-semibold text-slate-100 leading-tight">{user?.name ?? ""}</p>
                  <p className="text-xs text-slate-500 leading-tight">{user?.role === "administrador" ? "Administrador" : user?.role === "coordenador" ? "Coordenador" : "Membro"}</p>
                </div>
              </button>
              {showUserMenu && (
                <div className="absolute right-0 top-full mt-2 w-52 rounded-xl bg-background-surface border border-border shadow-2xl z-50 py-1.5">
                  <button onClick={() => { setShowUserMenu(false); setShowProfile(true); }} className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-slate-200 hover:bg-background-elevated">
                    <IconUser /> Meu perfil
                  </button>
                  <button onClick={toggleTheme} className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-slate-200 hover:bg-background-elevated">
                    {dark ? <IconSun /> : <IconMoon />} {dark ? "Modo claro" : "Modo escuro"}
                  </button>
                  <div className="my-1.5 border-t border-border" />
                  <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-slate-200 hover:bg-background-elevated hover:text-danger-400">
                    <IconLogout /> Sair
                  </button>
                </div>
              )}
            </div>
```
(O tema não fecha o menu — dá para alternar e ver o resultado.)

Ícone novo, junto dos outros `Icon*`:
```tsx
function IconUser() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}
```
No fim, ao lado do `ChangelogModal`:
```tsx
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
```
Imports: `Avatar` e `ProfileModal` de `../components/...`.

- [ ] **Step 5: Changelog**

No topo do array `CHANGELOG`:
```ts
  {
    version: "2.5.0",
    date: "2026-10-07",
    changes: [
      { kind: "novidade", text: "Meu perfil: clicando no seu nome, no canto superior direito, abre um menu com \"Meu perfil\". Lá dá para mudar o seu nome e colocar uma foto. A foto aparece no lugar das iniciais em todo o sistema — nos cards, nos comentários e na lista de membros." },
      { kind: "melhoria", text: "O botão de modo claro/escuro e o de sair foram para dentro desse mesmo menu do seu nome." },
    ],
  },
```

- [ ] **Step 6: Build e lint**

```bash
cd frontend && npm run build && npm run lint
```

- [ ] **Step 7: Verificar no navegador (e desfazer)**

1. Clicar no nome → menu com 3 itens; clicar fora e `Esc` fecham.
2. Alternar tema pelo menu (claro e escuro funcionam, preferência persiste no F5).
3. Meu perfil: e-mail e perfil desabilitados; apagar o nome → Salvar desabilitado; nome com espaços nas pontas → salva aparado, header e iniciais mudam sem F5.
4. Trocar foto (uma foto retangular grande, ex. 4000×3000) → "Enviando...", header mostra a foto recortada; trocar de novo → header atualiza; `docker compose exec -T backend ls /app/uploads/avatars | wc -l` = 1.
5. Abrir um quadro onde o admin é membro de um card e comentou → foto no card, no comentário, no drawer de membros, em `/boards` e em `/usuarios`.
6. Testar em modo claro também.
7. Remover foto → volta às iniciais.
8. **Desfazer:** nome original de volta pela própria modal; foto removida. Arquivos no diretório = 0.

- [ ] **Step 8: Commit**

```bash
git add frontend/src
git commit -m "feat(perfil): menu do usuario e modal Meu perfil (v2.5.0)"
```
