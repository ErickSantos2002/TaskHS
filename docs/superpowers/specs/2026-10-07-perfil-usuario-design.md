# Perfil do usuário (nome e foto) — design

**Data:** 2026-10-07
**Status:** entregue — v2.5.0 (merge a47322f); ajuste de enquadramento na v2.6.0 (927c2ed), que substituiu o recorte automático do centro; correção do Content-Type na v2.6.1 (576c2ca)

## Problema

Ninguém consegue mudar o próprio nome nem ter foto no TaskHS. O nome só muda
pelo admin (e hoje nem a tela de Usuários edita nome), e a única identidade
visual de uma pessoa são as iniciais num círculo — difícil de distinguir num
quadro com 26 pessoas. Além disso, o canto superior direito tem três controles
soltos (tema, usuário, sair) sem um lugar natural para "minha conta".

## Escopo

**Dentro:**

- Clicar no bloco do usuário (avatar + nome + papel) no canto superior direito
  abre um **menu suspenso** com: **Meu perfil**, **Modo claro/Modo escuro** e
  **Sair**. O botão de tema e o de sair saem do header.
- **Meu perfil** abre uma modal simples com foto, nome, e-mail e perfil (papel).
  Só **nome** e **foto** são editáveis; e-mail e perfil aparecem desabilitados.
- Foto: trocar e remover. Sem foto, o avatar continua mostrando as iniciais.
- **Iniciais recalculadas do nome** ao salvar: primeira letra do primeiro e do
  último nome ("Erick Santos" → "ES"; nome de uma palavra → 1 letra).
- A foto aparece **em todo lugar** onde hoje há iniciais: header, membros do
  card (miniatura e modal), autor de comentário, membros do quadro, seletores de
  pessoa, listagem de quadros, tela de Usuários.
- Migration `012_user_avatar.sql`.
- Entrada no changelog (minor — novidade).

**Fora (de propósito):**

- Admin editar nome/foto de outra pessoa.
- Editar e-mail, papel ou senha pelo perfil.
- Recorte manual da foto (o recorte é sempre o quadrado central).

## Decisões

### Armazenamento da foto: disco + URL pública com nome aleatório

Arquivo em `UPLOAD_DIR/avatars/<uuid>.webp` (mesmo volume `taskhs-uploads` dos
anexos), nome guardado em `users.avatar`. Servido por
`GET /api/avatars/{nome}` **sem autenticação**, com cache imutável.

Por quê: o avatar aparece dezenas de vezes por tela. Com URL pública um
`<img src>` resolve; com download autenticado (como os anexos) cada avatar
exigiria `fetch` + objectURL + revogação — complexidade em ~10 pontos de UI.
Base64 no banco inflaria todo JSON de card e quadro.

Trade-off aceito: quem tiver a URL vê a foto. O nome é UUID v4 (não
adivinhável) e não há listagem. Trocar a foto gera UUID novo, então cache velho
nunca aparece e o arquivo antigo é apagado do disco.

### Redimensionamento no navegador

A modal recorta o quadrado central e reduz para **256×256 WebP** via canvas
antes de enviar. Evita dependência nova no backend (Pillow) e mantém o arquivo
pequeno (~10–30 KB). O backend **não confia** nisso: valida tipo e tamanho por
conta própria.

## Backend

### Modelo e migration

- `backend/migrations/012_user_avatar.sql`:
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(64);`
  (aplicada sozinha no boot por `app/migrations.py`).
- `User.avatar: Mapped[str | None]` e property `User.avatar_url` →
  `"/avatars/<nome>"` (relativo ao `API_BASE` do front, que já termina em
  `/api`) ou `None`. O front monta `${API_BASE}${avatar_url}`.

### Schemas

Campo `avatar_url: str | None = None` em:

- `UserOut` — cobre `/auth/me`, login, `CardOut.members` e `CommentOut.author`
  (que já serializam o objeto `User` via `UserOut`), incluindo o SSE.
- `UserBasicOut` (`/auth/users/basic`, seletores).
- `BoardMemberOut` e `BoardMemberBriefOut` em `schemas/board.py`, e os três
  dicts montados à mão em `routers/boards.py` (linhas ~59, ~88, ~464).

### Endpoints (router `auth`, prefixo `/api/auth`)

- `PATCH /me` — corpo `{name}`. `strip()`, 1–120 caracteres (senão 422).
  Recalcula `initials`. Devolve `UserOut`.
- `POST /me/avatar` — multipart, campo `file`. Aceita `image/jpeg`,
  `image/png`, `image/webp`; máximo **2 MB** (lido em blocos, aborta ao
  passar). Grava `<uuid4>.<ext>` em `UPLOAD_DIR/avatars/`, atualiza
  `users.avatar`, faz commit e só **depois** apaga o arquivo antigo (falha ao
  apagar é só log). Devolve `UserOut`. 400 para tipo inválido, 413 para tamanho.
- `DELETE /me/avatar` — zera `users.avatar`, apaga o arquivo. Devolve `UserOut`.

### Servir a foto (router novo `avatars`, prefixo `/api/avatars`)

- `GET /{nome}` — sem auth. Nome validado por regex
  `^[0-9a-f]{32}\.(jpg|png|webp)$` antes de tocar no disco (bloqueia path
  traversal); fora do padrão ou inexistente → 404. `FileResponse` com
  `Cache-Control: public, max-age=31536000, immutable`.

### Auditoria / tempo real

As mudanças em `users` passam pelos hooks normais de sessão. Não há evento SSE
de usuário: quem está num quadro vê a foto nova no próximo snapshot/recarga.
Aceitável — troca de foto é rara.

## Frontend

- **`types/index.ts` e `AuthContext`:** `avatar_url?: string | null` no tipo do
  usuário e nos tipos de membro/autor. `AuthContext` ganha `updateUser(user)`
  que atualiza o estado e o `localStorage` (`taskhs-user`).
- **`lib/api.ts`:** helper `avatarSrc(url)` → `${API_BASE}${url}` (em produção
  o front está em outro domínio; funciona com qualquer `VITE_API_URL`).
- **`components/Avatar.tsx`:** `<Avatar user={{name, initials, avatar_url}}
  className=... />` — `<img>` redondo se houver foto (fallback para iniciais em
  `onError`), senão o círculo com iniciais. Tamanho e estilo do círculo vêm de
  `className`, para cada ponto de uso manter o visual atual.
- **Substituir** os pontos que hoje desenham iniciais: `MainLayout.tsx` (header),
  `BoardPage.tsx` (6 pontos), `BoardsPage.tsx`, `UsersPage.tsx`.
- **`MainLayout`:** o bloco do usuário vira botão; o menu suspenso fecha ao
  clicar fora e no `Esc` (mesmo padrão do sino). Itens: Meu perfil, tema
  (ícone sol/lua + "Modo claro"/"Modo escuro"), Sair.
- **`components/ProfileModal.tsx`:** avatar grande com "Trocar foto" (input file
  `accept="image/jpeg,image/png,image/webp"`) e "Remover foto"; campo Nome;
  E-mail e Perfil desabilitados; botões Cancelar/Salvar. A foto é enviada na
  hora em que é escolhida (com estado "Enviando..."); o nome só no Salvar.
  Erros do backend aparecem na modal. Cada resposta chama `updateUser`.

## Verificação

Sem suíte de testes — manual:

- curl: `PATCH /me` (nome válido, vazio → 422), `POST /me/avatar` (png ok,
  pdf → 400, >2 MB → 413), `GET /api/avatars/<nome>` sem token (200),
  `GET /api/avatars/../x` e nome inválido (404), `DELETE /me/avatar`.
- Navegador: menu do usuário, tema pelo menu, trocar nome (header e iniciais
  mudam na hora), trocar/remover foto, foto visível em card, comentário,
  membros do quadro, listagem de quadros e Usuários; modo claro e escuro.
- `npm run build` e `npm run lint`.
