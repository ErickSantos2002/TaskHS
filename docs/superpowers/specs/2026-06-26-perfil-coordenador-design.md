# Perfil Coordenador (papéis de usuário) — Design

**Data:** 2026-06-26
**Status:** Aprovado
**Contexto:** Hoje o TaskHS tem só dois níveis de usuário via o booleano `User.is_admin`: **admin** (gerencia usuários, edita/exclui qualquer quadro, automações, exclui anexos de outros, vê a página Usuários) e **membro** (o resto). Precisamos de um terceiro perfil, **Coordenador**, com os mesmos poderes do Administrador **exceto** o que for exclusivo de Administrador — em particular a **página de logs** (a ser feita depois; fora deste escopo), que só o Administrador verá. Regra decidida: o Coordenador **não** administra Administradores (não cria/promove a Administrador, não edita/exclui um Administrador).

## Decisões (com o Erick)

| Tema | Decisão |
|------|---------|
| Representação | **Enum `role`** no usuário: `administrador` / `coordenador` / `membro` (substitui o `is_admin` booleano). |
| Poderes do Coordenador | Iguais ao Administrador em **tudo que hoje é `is_admin`** (quadros, automações, anexos, gerenciar usuários), **exceto** administrar Administradores e a futura página de logs. |
| Coordenador × Administrador | Coordenador gerencia **Membros e Coordenadores**; **não** pode definir/promover papel `administrador`, nem editar/excluir um usuário que seja Administrador. |
| Token | Sem mudança — o papel é lido do banco a cada request (mudança de papel vale no próximo request). |
| Escopo | Só o **perfil Coordenador**. A **página de logs** é tarefa futura (só deixamos o gate "administrador estrito" pronto). |

## 1. Banco — coluna `role`

Novo enum Python `Role` em `backend/app/models/user.py`:
```python
class Role(str, enum.Enum):
    administrador = "administrador"
    coordenador = "coordenador"
    membro = "membro"
```
No `User`:
- Adicionar `role: Mapped[Role] = mapped_column(SAEnum(Role, native_enum=False, length=20), default=Role.membro)`.
- **Remover** a coluna mapeada `is_admin`; expor propriedades derivadas (só Python, não colunas):
  ```python
  @property
  def is_admin(self) -> bool:
      return self.role == Role.administrador

  @property
  def is_elevated(self) -> bool:
      return self.role in (Role.administrador, Role.coordenador)
  ```
  (`is_admin` como propriedade mantém a serialização atual funcionando.)

`create_all` **não altera** a tabela `users` existente → **migração SQL manual** `backend/migrations/003_user_role.sql`:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'membro';
UPDATE users SET role = CASE WHEN is_admin THEN 'administrador' ELSE 'membro' END;
ALTER TABLE users DROP COLUMN IF EXISTS is_admin;
```
Aplicada via `docker compose exec ... python` (como as migrações anteriores). O backfill preserva os admins atuais; os demais viram `membro`.

## 2. Backend — dois níveis de permissão

Em `backend/app/routers/auth.py` (ou `dependencies.py`):
- **`get_admin_user`** (já existe): passa a significar **administrador estrito** — `if current_user.role != Role.administrador: 403`. (Usa a propriedade `is_admin`, então o corpo atual `if not current_user.is_admin` continua correto.) Reservado para gestão de Administradores e para a futura página de logs.
- **`get_elevated_user`** (novo): `if not current_user.is_elevated: 403` (administrador **ou** coordenador).

**Troca dos gates de `is_admin` por `is_elevated`** (Coordenador ganha o mesmo acesso):
- `boards.py:222` e `:234` (editar/excluir board): `board.owner_id != user.id and not user.is_elevated`.
- `automations.py:23` (CRUD de automação): `... and not user.is_elevated`.
- `attachments.py:120` (excluir anexo): `att.uploaded_by != user.id and not user.is_elevated`.
- `auth.py` `GET /users` (listar) e `POST/PATCH/DELETE /users` (gerenciar): dependency passa de `get_admin_user` para `get_elevated_user`, **com as regras de papel abaixo**.

**Regras de gestão de usuários** (dentro de `admin_create_user` / `admin_update_user` / `admin_delete_user`), comparando o papel de quem age (`current_user.role`) com o alvo:
- **Criar** (`POST /users`): elevado pode criar. Se `current_user` é **coordenador** e o `role` do corpo é `administrador` → **403**.
- **Atualizar papel** (`PATCH /users/{id}`):
  - Se o **alvo** é `administrador` e `current_user` **não** é `administrador` → **403** (coordenador não toca em admin).
  - Se `current_user` é **coordenador** e o `role` novo é `administrador` → **403**.
  - Administrador pode qualquer papel.
- **Excluir** (`DELETE /users/{id}`): se o **alvo** é `administrador` e `current_user` **não** é `administrador` → **403**.

## 3. Backend — schemas (`backend/app/schemas/user.py`)

- `UserOut`: adicionar `role: Role`; **manter** `is_admin: bool` (agora derivado) para compatibilidade da resposta.
- `UserAdminCreate`: trocar `is_admin: bool = False` por `role: Role = Role.membro`.
- `UserAdminUpdate`: trocar `is_admin: bool` por `role: Role`.
- `UserCreate` (register público): inalterado (novo cadastro nasce `membro`).

## 4. Frontend

- **Tipos** (`src/types/index.ts`): `User` ganha `role: "administrador" | "coordenador" | "membro"`; manter `is_admin` (o backend ainda envia). `AuthContext` idem.
- **Helper de nível:** "elevado" = `role === "administrador" || role === "coordenador"`.
- **Menu lateral** (`MainLayout.tsx`): item "Usuários" (`adminOnly`) passa a aparecer para **elevado** (admin ou coordenador). Rótulo do rodapé (`is_admin ? "Administrador" : "Membro"`) passa a mapear os 3 papéis: `administrador → "Administrador"`, `coordenador → "Coordenador"`, `membro → "Membro"`.
- **Gates de quadro/anexo** (`BoardPage.tsx`): `currentUser?.id === board.owner_id || <elevado>` (em vez de `is_admin`); exclusão de anexo idem.
- **Página Usuários** (`UsersPage.tsx`):
  - Acesso: **elevado** (não só admin).
  - O toggle "admin on/off" (criar e na lista) vira um **seletor de papel** (Membro / Coordenador / Administrador). A opção **Administrador** só aparece se o **usuário logado** for Administrador.
  - Na lista, cada usuário mostra o **badge do papel** (Administrador / Coordenador / Membro).
  - Para um Coordenador logado: linhas de usuários **Administrador** ficam **sem** ações de editar papel/excluir (o backend também barra com 403 — defesa em profundidade).

## 5. Fora de escopo (agora)

- A **página de logs** em si (tarefa futura; só o gate `get_admin_user` estrito fica pronto).
- Trava de "não pode existir zero administrador" / impedir autodemote — não no v1.
- Papéis por quadro (o `BoardRole` de board é outra coisa, não muda).

## 6. Critérios de aceite

1. Migração aplicada: os admins atuais viram `administrador`; os demais `membro`; coluna `is_admin` removida do banco; login e listagem de usuários seguem funcionando.
2. Um usuário **coordenador** consegue: editar/excluir qualquer quadro, CRUD de automações, excluir anexo de outro, abrir a página Usuários, criar/editar/excluir Membros e Coordenadores.
3. Um **coordenador** **não** consegue (403): criar usuário com papel Administrador, promover alguém a Administrador, editar ou excluir um usuário Administrador.
4. Um **administrador** consegue tudo do coordenador **mais** gerenciar Administradores.
5. Frontend: coordenador vê o menu "Usuários"; a tela mostra seletor de papel sem a opção "Administrador" quando o logado é coordenador; badges de papel corretos; para coordenador, admins aparecem sem ações de papel/excluir.
6. `UserOut` traz `role` e ainda traz `is_admin` (derivado). `npm run build` passa. Changelog v1.2.0.
