# Perfil Coordenador (papéis de usuário) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir o perfil **Coordenador** via um enum `role` (`administrador`/`coordenador`/`membro`), dando ao Coordenador os mesmos poderes do Administrador exceto administrar Administradores (e a futura página de logs).

**Architecture:** Substitui o booleano `User.is_admin` por `User.role` (fonte da verdade); `is_admin` vira propriedade derivada. Dois níveis: "elevado" (admin ou coord) gateia tudo que hoje é `is_admin`; "administrador estrito" fica para gestão de admins e logs. Migração SQL manual com backfill.

**Tech Stack:** FastAPI async, SQLAlchemy 2.0, Pydantic v2; React 19 + Vite + Tailwind.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-26-perfil-coordenador-design.md` — seguir à risca.
- **Sem suíte de testes** (CLAUDE.md). Verificação = curl + `npm run build` + navegador. NÃO criar pytest/vitest.
- **Backend em Docker** (`taskhs-backend-1`). Como a **porta 8000 pode estar ocupada por outro projeto (AgendaHS)**, use um container efêmero para rodar comandos: `docker compose run --rm --no-deps -v "/home/ericks/github/TaskHS/backend:/app" backend <cmd>` (não publica porta). Para subir o servidor de verdade e testar via HTTP, primeiro garanta a 8000 livre (`docker stop` do que estiver nela) e então `docker compose up -d --build`.
- **`create_all` NÃO altera tabelas existentes** → a coluna `role` exige **migração SQL manual** aplicada no banco (via `docker compose run` python).
- **Banco remoto de produção** — há **27 usuários reais** (1 admin + 26 membros criados). A migração faz backfill preservando o admin. Limpar dados de teste criados na verificação.
- **`role` é a fonte da verdade;** `is_admin` = `role == administrador` (propriedade). "elevado" = `role in (administrador, coordenador)`.
- **Regras coord×admin** (verbatim do spec): coordenador não cria/promove a Administrador, nem edita/exclui um Administrador.
- **Login admin p/ testes:** `healthsafetyti@gmail.com` / `admin123` (token em `access_token`).
- **Convenção de changelog (CLAUDE.md):** fecha com entrada nova (`v1.2.0`).
- **Tudo em pt-BR.** Commits terminam com `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Enum `Role` + model + migração + schemas + dependency

**Files:**
- Modify: `backend/app/models/user.py`
- Create: `backend/migrations/003_user_role.sql`
- Modify: `backend/app/schemas/user.py`
- Modify: `backend/app/routers/auth.py` (só adicionar `get_elevated_user` + import `Role`)

**Interfaces:**
- Produces: `Role` enum; `User.role`, `User.is_admin` (property), `User.is_elevated` (property); schemas com `role`; dependency `get_elevated_user`.

- [ ] **Step 1: Model com `role` + propriedades**

Reescrever `backend/app/models/user.py`:
```python
from datetime import datetime, timezone
import enum
from sqlalchemy import String, Boolean, DateTime, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Role(str, enum.Enum):
    administrador = "administrador"
    coordenador = "coordenador"
    membro = "membro"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    initials: Mapped[str] = mapped_column(String(4))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    role: Mapped[Role] = mapped_column(SAEnum(Role, native_enum=False, length=20), default=Role.membro)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    @property
    def is_admin(self) -> bool:
        return self.role == Role.administrador

    @property
    def is_elevated(self) -> bool:
        return self.role in (Role.administrador, Role.coordenador)

    boards: Mapped[list["Board"]] = relationship("Board", back_populates="owner", foreign_keys="Board.owner_id")
    board_memberships: Mapped[list["BoardMember"]] = relationship("BoardMember", back_populates="user")
    card_memberships: Mapped[list["CardMember"]] = relationship("CardMember", back_populates="user")
    comments: Mapped[list["CardComment"]] = relationship("CardComment", back_populates="author")
```

- [ ] **Step 2: Migração SQL**

`backend/migrations/003_user_role.sql`:
```sql
-- Papéis de usuário: substitui o booleano is_admin por role.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'membro';
UPDATE users SET role = CASE WHEN is_admin THEN 'administrador' ELSE 'membro' END;
ALTER TABLE users DROP COLUMN IF EXISTS is_admin;
```

- [ ] **Step 3: Schemas com `role`**

Reescrever `backend/app/schemas/user.py`:
```python
from datetime import datetime
from pydantic import BaseModel, EmailStr
from app.models.user import Role


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    initials: str


class UserOut(BaseModel):
    id: int
    name: str
    email: str
    initials: str
    is_active: bool
    role: Role
    is_admin: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserAdminCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    initials: str
    role: Role = Role.membro


class UserAdminUpdate(BaseModel):
    role: Role


class LoginIn(BaseModel):
    email: EmailStr
    password: str
```

- [ ] **Step 4: Dependency `get_elevated_user`**

Em `backend/app/routers/auth.py`, importar `Role` e adicionar a dependency logo após `get_admin_user`. Ajustar os imports do topo (linha do `from app.models.user import User`):
```python
from app.models.user import User, Role
```
E adicionar após a função `get_admin_user`:
```python
async def get_elevated_user(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_elevated:
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores e coordenadores")
    return current_user
```
(`get_admin_user` permanece como está — a checagem `not current_user.is_admin` agora significa "não é administrador estrito", via a propriedade.)

- [ ] **Step 5: Rebuildar (efêmero) e aplicar a migração**

Aplicar a migração no banco via container efêmero (não depende da porta 8000):
```bash
docker compose run --rm --no-deps -v "/home/ericks/github/TaskHS/backend:/app" backend python -c "
import asyncio
from sqlalchemy import text
from app.database import engine
async def main():
    async with engine.begin() as conn:
        await conn.execute(text(\"ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'membro'\"))
        await conn.execute(text(\"UPDATE users SET role = CASE WHEN is_admin THEN 'administrador' ELSE 'membro' END\"))
        await conn.execute(text('ALTER TABLE users DROP COLUMN IF EXISTS is_admin'))
    print('migracao aplicada')
asyncio.run(main())
"
```
Expected: `migracao aplicada`.

- [ ] **Step 6: Verificar o backfill**

```bash
docker compose run --rm --no-deps -v "/home/ericks/github/TaskHS/backend:/app" backend python -c "
import asyncio
from sqlalchemy import text
from app.database import AsyncSessionLocal
async def main():
    async with AsyncSessionLocal() as db:
        r = await db.execute(text('select role, count(*) from users group by role order by role'))
        print(dict(r.fetchall()))
        cols = await db.execute(text(\"select count(*) from information_schema.columns where table_name='users' and column_name='is_admin'\"))
        print('coluna is_admin ainda existe?', cols.scalar())
asyncio.run(main())
"
```
Expected: mostra os papéis (ex.: `{'administrador': 1, 'membro': 26}`) e `coluna is_admin ainda existe? 0`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/user.py backend/migrations/003_user_role.sql backend/app/schemas/user.py backend/app/routers/auth.py
git commit -m "feat(usuarios): enum Role + migracao + schemas + dependency elevated

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Gates elevados + regras de gestão de usuários

**Files:**
- Modify: `backend/app/routers/auth.py` (list/create/update/delete de usuários)
- Modify: `backend/app/routers/boards.py` (2 gates)
- Modify: `backend/app/routers/automations.py` (1 gate)
- Modify: `backend/app/routers/attachments.py` (1 gate)

**Interfaces:**
- Consumes: `get_elevated_user`, `Role`, `User.is_elevated` (Task 1).

- [ ] **Step 1: Trocar gates `is_admin` → `is_elevated`**

Em `backend/app/routers/boards.py`, nas duas linhas de update/delete do board (hoje `if board.owner_id != current_user.id and not current_user.is_admin:`), trocar `not current_user.is_admin` por `not current_user.is_elevated`:
```python
    if board.owner_id != current_user.id and not current_user.is_elevated:
```
(São duas ocorrências — `update_board` e `delete_board`.)

Em `backend/app/routers/automations.py`, na função `_require_owner_or_admin` (hoje `if board.owner_id != user.id and not user.is_admin:`):
```python
    if board.owner_id != user.id and not user.is_elevated:
```

Em `backend/app/routers/attachments.py`, no delete de anexo (hoje `if att.uploaded_by != current_user.id and not current_user.is_admin:`):
```python
    if att.uploaded_by != current_user.id and not current_user.is_elevated:
```

- [ ] **Step 2: `list_users` restrito a elevado**

Em `backend/app/routers/auth.py`, importar `get_elevated_user` já existe no arquivo (Task 1 a definiu). Trocar a dependency do `GET /users` de `get_current_user` para `get_elevated_user`:
```python
@router.get("/users", response_model=list[UserOut])
async def list_users(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_elevated_user)):
    result = await db.execute(select(User).order_by(User.name))
    return result.scalars().all()
```

- [ ] **Step 3: `admin_create_user` com regra de papel**

Substituir a função inteira por:
```python
@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def admin_create_user(body: UserAdminCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_elevated_user)):
    if current_user.role != Role.administrador and body.role == Role.administrador:
        raise HTTPException(status_code=403, detail="Apenas administradores podem criar administradores")
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email já cadastrado")
    user = User(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        initials=body.initials[:4].upper(),
        role=body.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
```

- [ ] **Step 4: `admin_update_user` com regras**

Substituir a função inteira por:
```python
@router.patch("/users/{user_id}", response_model=UserOut)
async def admin_update_user(user_id: int, body: UserAdminUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_elevated_user)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if current_user.role != Role.administrador and (user.role == Role.administrador or body.role == Role.administrador):
        raise HTTPException(status_code=403, detail="Apenas administradores podem gerenciar administradores")
    user.role = body.role
    await db.commit()
    await db.refresh(user)
    return user
```
(Com esta versão, o `update as sql_update` do import do topo de `auth.py` fica sem uso — pode removê-lo do `from sqlalchemy import ...` para não deixar import morto.)

- [ ] **Step 5: `admin_delete_user` com regra**

Substituir a função inteira por:
```python
@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_user(user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_elevated_user)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Não é possível excluir sua própria conta")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if user.role == Role.administrador and current_user.role != Role.administrador:
        raise HTTPException(status_code=403, detail="Apenas administradores podem excluir administradores")
    await db.execute(sql_delete(User).where(User.id == user_id))
    await db.commit()
```

- [ ] **Step 6: Subir o servidor e verificar via curl**

Garantir a porta 8000 livre (parar o que estiver nela) e subir:
```bash
docker ps --format '{{.Names}} {{.Ports}}' | grep 8000   # ver quem ocupa
# se for outro projeto, pare-o: docker stop <nome>
docker compose up -d --build
until curl -s http://localhost:8000/api/health | grep -q ok; do sleep 1; done
ADM=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
```
Cenários (criar um coordenador de teste, logar como ele, checar limites):
```bash
# (a) admin cria um COORDENADOR de teste
curl -s -X POST http://localhost:8000/api/auth/users -H "Authorization: Bearer $ADM" -H 'Content-Type: application/json' -d '{"name":"Coord Teste","email":"coordteste@example.com","password":"teste123","initials":"CT","role":"coordenador"}' | python3 -c 'import sys,json;u=json.load(sys.stdin);print("criado role=",u["role"],"is_admin=",u["is_admin"])'
COORD=$(curl -s -X POST http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"coordteste@example.com","password":"teste123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
# (b) coordenador LISTA usuários -> 200
curl -s -o /dev/null -w 'list users como coord: %{http_code}\n' http://localhost:8000/api/auth/users -H "Authorization: Bearer $COORD"
# (c) coordenador cria MEMBRO -> 201 ; cria ADMIN -> 403
curl -s -o /dev/null -w 'coord cria membro: %{http_code}\n' -X POST http://localhost:8000/api/auth/users -H "Authorization: Bearer $COORD" -H 'Content-Type: application/json' -d '{"name":"Membro X","email":"membrox@example.com","password":"teste123","initials":"MX","role":"membro"}'
curl -s -o /dev/null -w 'coord cria admin: %{http_code}\n' -X POST http://localhost:8000/api/auth/users -H "Authorization: Bearer $COORD" -H 'Content-Type: application/json' -d '{"name":"Admin Y","email":"adminy@example.com","password":"teste123","initials":"AY","role":"administrador"}'
# (d) coordenador tenta promover o admin conhecido (id 1) a admin/mexer nele -> 403
curl -s -o /dev/null -w 'coord edita admin(id1): %{http_code}\n' -X PATCH http://localhost:8000/api/auth/users/1 -H "Authorization: Bearer $COORD" -H 'Content-Type: application/json' -d '{"role":"coordenador"}'
# (e) coordenador tenta excluir o admin(id1) -> 403
curl -s -o /dev/null -w 'coord exclui admin(id1): %{http_code}\n' -X DELETE http://localhost:8000/api/auth/users/1 -H "Authorization: Bearer $COORD"
# (f) coordenador edita o MEMBRO que criou para coordenador -> 200 (descobrir id do membrox)
```
Expected: (a) `role= coordenador is_admin= False`; (b) `200`; (c) `201` e `403`; (d) `403`; (e) `403`.
Limpeza: excluir (como admin) os usuários de teste criados: `coordteste@example.com`, `membrox@example.com` (e qualquer outro). Ex.: listar, achar ids, `DELETE /api/auth/users/<id>` com `$ADM`. Confirmar que sumiram.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/auth.py backend/app/routers/boards.py backend/app/routers/automations.py backend/app/routers/attachments.py
git commit -m "feat(usuarios): gates elevados + regras coordenador x administrador

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Frontend — tipos, contexto, menu, gates de board

**Files:**
- Modify: `frontend/src/types/index.ts` (User.role)
- Modify: `frontend/src/contexts/AuthContext.tsx` (role no user)
- Modify: `frontend/src/layouts/MainLayout.tsx` (nav elevado + rótulo do papel)
- Modify: `frontend/src/pages/BoardPage.tsx` (gates elevado)

**Interfaces:**
- Produces: `User.role` no tipo; gate "elevado" no front.

- [ ] **Step 1: Tipo `User` com `role`**

Em `frontend/src/types/index.ts`, na interface `User`, adicionar o campo `role` (manter `is_admin`):
```ts
  role: "administrador" | "coordenador" | "membro";
```

- [ ] **Step 2: `role` no AuthContext**

Em `frontend/src/contexts/AuthContext.tsx`, no tipo do usuário (onde há `is_admin: boolean;`), adicionar:
```ts
  role: "administrador" | "coordenador" | "membro";
```

- [ ] **Step 3: Menu lateral + rótulo do papel**

Em `frontend/src/layouts/MainLayout.tsx`:
- Trocar o predicado do filtro do nav (hoje `!item.adminOnly || user?.is_admin`) para usar "elevado":
```tsx
          {NAV_ITEMS.filter(item => !item.adminOnly || user?.role === "administrador" || user?.role === "coordenador").map(({ label, icon, to }) => {
```
- Trocar o rótulo do rodapé (hoje `{user?.is_admin ? "Administrador" : "Membro"}`) por um mapa dos 3 papéis:
```tsx
                  <p className="text-xs text-slate-500 leading-tight">{user?.role === "administrador" ? "Administrador" : user?.role === "coordenador" ? "Coordenador" : "Membro"}</p>
```

- [ ] **Step 4: Gates de board/anexo por "elevado"**

Em `frontend/src/pages/BoardPage.tsx`:
- No tipo do `currentUser` do `CardDetailModal` (hoje `currentUser: { id: number; is_admin: boolean } | null;`), adicionar `role`:
```tsx
  currentUser: { id: number; is_admin: boolean; role: "administrador" | "coordenador" | "membro" } | null;
```
- No gate de exclusão de anexo (hoje `return !!currentUser && (a.uploaded_by === currentUser.id || currentUser.is_admin);`):
```tsx
    return !!currentUser && (a.uploaded_by === currentUser.id || currentUser.role === "administrador" || currentUser.role === "coordenador");
```
- Nos **dois** gates de botões do cabeçalho do board (hoje `{(currentUser?.id === board.owner_id || currentUser?.is_admin) && (`):
```tsx
                {(currentUser?.id === board.owner_id || currentUser?.role === "administrador" || currentUser?.role === "coordenador") && (
```

- [ ] **Step 5: Build**

Run (de `frontend/`): `npm run build`
Expected: PASSA (tsc + vite, sem erros).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/contexts/AuthContext.tsx frontend/src/layouts/MainLayout.tsx frontend/src/pages/BoardPage.tsx
git commit -m "feat(usuarios): frontend usa role (elevado) em menu e gates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — página Usuários (seletor de papel) + changelog

**Files:**
- Modify: `frontend/src/pages/UsersPage.tsx` (modal + lista)
- Modify: `frontend/src/data/changelog.ts` (v1.2.0)

**Interfaces:**
- Consumes: `User.role` (Task 3); API `/auth/users` com `role` (Task 2).

- [ ] **Step 1: Reescrever `UsersPage.tsx`**

Substituir o conteúdo de `frontend/src/pages/UsersPage.tsx` por (mantém os ícones e o visual; troca o toggle admin por seletor de papel e aplica as regras):
```tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import type { User } from "../types";

type Role = "administrador" | "coordenador" | "membro";

const ROLE_LABEL: Record<Role, string> = {
  administrador: "Administrador",
  coordenador: "Coordenador",
  membro: "Membro",
};

// ── Icons ─────────────────────────────────────────────────────
const IPlus = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);
const ITrash = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);
const ISpinner = () => (
  <svg className="w-5 h-5 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);
const IX = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// ── New User Modal ─────────────────────────────────────────────
function NewUserModal({ canAssignAdmin, onClose, onCreated }: { canAssignAdmin: boolean; onClose: () => void; onCreated: (u: User) => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", initials: "", role: "membro" as Role });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.password.trim() || !form.initials.trim()) {
      setError("Preencha todos os campos.");
      return;
    }
    setLoading(true);
    try {
      const user = await api.post<User>("/auth/users", form);
      onCreated(user);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao criar usuário.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-background-surface border border-slate-200 dark:border-border shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 dark:border-border">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Novo usuário</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-background-elevated transition-colors">
            <IX />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Nome completo</label>
              <input
                value={form.name}
                onChange={e => set("name", e.target.value)}
                placeholder="Ex: João Silva"
                className="w-full text-sm rounded-lg border border-slate-200 dark:border-border bg-transparent px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-slate-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Iniciais</label>
              <input
                value={form.initials}
                onChange={e => set("initials", e.target.value.toUpperCase().slice(0, 4))}
                placeholder="JS"
                maxLength={4}
                className="w-full text-sm rounded-lg border border-slate-200 dark:border-border bg-transparent px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-slate-400 uppercase"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => set("email", e.target.value)}
              placeholder="joao@empresa.com"
              className="w-full text-sm rounded-lg border border-slate-200 dark:border-border bg-transparent px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-slate-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Senha</label>
            <input
              type="password"
              value={form.password}
              onChange={e => set("password", e.target.value)}
              placeholder="Mínimo 6 caracteres"
              className="w-full text-sm rounded-lg border border-slate-200 dark:border-border bg-transparent px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-slate-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Perfil</label>
            <select
              value={form.role}
              onChange={e => set("role", e.target.value)}
              className="w-full text-sm rounded-lg border border-slate-200 dark:border-border bg-transparent px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="membro">Membro</option>
              <option value="coordenador">Coordenador</option>
              {canAssignAdmin && <option value="administrador">Administrador</option>}
            </select>
          </div>

          {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-200 dark:border-border text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-background-elevated transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-600 disabled:opacity-50 transition-all"
            >
              {loading ? "Criando…" : "Criar usuário"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── UsersPage ──────────────────────────────────────────────────
export function UsersPage() {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const iAmAdmin = me?.role === "administrador";
  const iAmElevated = me?.role === "administrador" || me?.role === "coordenador";

  useEffect(() => {
    if (!iAmElevated) { navigate("/boards", { replace: true }); return; }
    api.get<User[]>("/auth/users").then(setUsers).finally(() => setLoading(false));
  }, [me]);

  // um coordenador não gerencia administradores
  function canManage(u: User): boolean {
    if (u.id === me?.id) return false;
    if (u.role === "administrador" && !iAmAdmin) return false;
    return true;
  }

  async function handleChangeRole(user: User, role: Role) {
    try {
      const updated = await api.patch<User>(`/auth/users/${user.id}`, { role });
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
    } catch {}
  }

  async function handleDelete(userId: number) {
    setDeletingId(userId);
    try {
      await api.del(`/auth/users/${userId}`);
      setUsers(prev => prev.filter(u => u.id !== userId));
    } catch {}
    setDeletingId(null);
    setConfirmDeleteId(null);
  }

  if (loading) {
    return <div className="flex flex-1 items-center justify-center"><ISpinner /></div>;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-4xl w-full mx-auto px-4 md:px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">Usuários</h1>
            <p className="text-sm text-slate-500 mt-0.5">{users.length} usuário{users.length !== 1 ? "s" : ""} cadastrado{users.length !== 1 ? "s" : ""}</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-600 active:scale-95 transition-all"
          >
            <IPlus />Novo usuário
          </button>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-background-surface overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-border bg-slate-50 dark:bg-background-elevated">
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Usuário</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Email</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Perfil</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Membro desde</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-border">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-background-elevated transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary">{u.initials}</span>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800 dark:text-slate-100">{u.name}</p>
                        {u.id === me?.id && <span className="text-[10px] text-primary font-medium">você</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-slate-500 dark:text-slate-400">{u.email}</td>
                  <td className="px-5 py-4">
                    {canManage(u) ? (
                      <select
                        value={u.role}
                        onChange={e => handleChangeRole(u, e.target.value as Role)}
                        className="text-xs font-semibold rounded-lg border border-slate-200 dark:border-border bg-transparent px-2 py-1 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
                      >
                        <option value="membro">Membro</option>
                        <option value="coordenador">Coordenador</option>
                        {iAmAdmin && <option value="administrador">Administrador</option>}
                      </select>
                    ) : (
                      <span className={cn(
                        "inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full",
                        u.role === "membro" ? "bg-slate-100 dark:bg-background-elevated text-slate-500" : "bg-primary/10 text-primary"
                      )}>
                        {ROLE_LABEL[u.role]}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-slate-400 text-xs">
                    {new Date(u.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1">
                      {canManage(u) && (
                        confirmDeleteId === u.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs px-2 py-1 rounded-lg border border-slate-200 dark:border-border text-slate-500 hover:bg-slate-50 dark:hover:bg-background-elevated transition-colors"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => handleDelete(u.id)}
                              disabled={deletingId === u.id}
                              className="text-xs px-2 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors font-semibold"
                            >
                              {deletingId === u.id ? "…" : "Confirmar"}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(u.id)}
                            title="Excluir usuário"
                            className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                          >
                            <ITrash />
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <NewUserModal
          canAssignAdmin={iAmAdmin}
          onClose={() => setShowModal(false)}
          onCreated={u => setUsers(prev => [...prev, u].sort((a, b) => a.name.localeCompare(b.name)))}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Entrada de changelog v1.2.0**

Em `frontend/src/data/changelog.ts`, adicionar como **primeiro** item do array `CHANGELOG`:
```ts
  {
    version: "1.2.0",
    date: "2026-06-26",
    changes: [
      { kind: "novidade", text: "Novo perfil Coordenador: faz tudo que o Administrador faz, exceto gerenciar Administradores (e áreas exclusivas de Administrador)." },
    ],
  },
```

- [ ] **Step 3: Build + verificação no navegador**

Run (de `frontend/`): `npm run build`
Expected: PASSA.
Com o dev server e logado como **administrador**: a página Usuários mostra o **seletor de papel** (com opção Administrador); dá pra criar Coordenador; o rodapé mostra o papel. Logando como um **coordenador** (ex.: o `coordteste` se ainda existir, ou criar um): vê o menu "Usuários"; na tela, os usuários Administrador aparecem como **badge** (sem seletor/excluir) e o seletor dos demais **não** tem a opção Administrador.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/UsersPage.tsx frontend/src/data/changelog.ts
git commit -m "feat(usuarios): tela de Usuarios com seletor de papel + changelog v1.2.0

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notas finais

- Após as 4 tasks: revisão final de branch → **finishing-a-development-branch** (merge na `main` + push).
- **Deploy:** rodar a migração `003_user_role.sql` no banco de produção (hoje dev=prod, então já foi aplicada na Task 1 — confirmar). Nada de env nova.
- **Página de logs** (segunda) usará `get_admin_user` (administrador estrito) — já pronto.
