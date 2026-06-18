# Anexos de cards — Design

**Data:** 2026-06-18
**Status:** Aprovado
**Contexto:** TaskHS (clone de Trello da Health & Safety) precisa de anexos de arquivo nos cards para paridade com o Trello. Hoje existe o model `CardAttachment` (`id`, `card_id`, `filename`, `url`, `uploaded_at`), mas **não há endpoint de upload** e o modal do card **não exibe anexos**. Anexos só chegam hoje via import do Trello (como URL externa).

## Decisões (definidas com o Erick)

| Tema | Decisão |
|------|---------|
| Tipos de arquivo | Documentos + imagens: PDF, Word (`.doc/.docx`), Excel (`.xls/.xlsx`), imagens (`jpeg/png/gif/webp`) |
| Tamanho máximo | 10 MB por arquivo |
| Acesso ao arquivo | **Somente logado** — download por endpoint que exige token JWT |
| Exibição no card | Lista; imagens com **miniatura** clicável (abre em tamanho grande); documentos como linha (ícone + nome + tamanho + baixar) |
| Excluir anexo | Somente o autor do upload (`uploaded_by`) **ou** admin (`is_admin`) |
| Upload múltiplo | Permitido (vários arquivos de uma vez) |
| Contagem no rosto do card | Ícone de clipe 📎 + contagem, ao lado do contador de comentários |

## 1. Storage

- Arquivos gravados em disco em `UPLOAD_DIR` (nova env, default `/app/uploads`).
- Em produção (Easypanel): volume `taskhs-uploads` montado em `/app/uploads`.
- Em dev (docker compose): mapear volume equivalente para `/app/uploads`.
- Nome no disco: `<uuid4>.<ext>` (gerado), evitando colisão e *path traversal*. O nome original do arquivo é preservado no banco (`filename`).
- Diretório criado na inicialização se não existir.

## 2. Banco — alterar `card_attachments`

Colunas novas:
- `stored_name: str | None` — nome do arquivo no disco (uploads locais). `NULL` para anexos antigos vindos do Trello.
- `content_type: str | None` — MIME type.
- `size: int | None` — tamanho em bytes.
- `uploaded_by: int | None` — FK `users.id`, para a regra de exclusão. `NULL` para imports antigos.

`url` é mantido: para anexos importados do Trello (link externo). Para uploads locais, `url` fica `NULL` e o acesso é pelo endpoint de download.

**Migração:** o projeto não usa Alembic e o `create_all` não altera tabela existente. Como o banco não está em produção, aplicar `ALTER TABLE card_attachments ADD COLUMN ...` manualmente (script SQL idempotente com `IF NOT EXISTS`). Documentar no plano.

## 3. Backend — endpoints

Sob o router de cards (auth via `get_current_user` em todos):

### `POST /lists/{list_id}/cards/{card_id}/attachments`
- Recebe `multipart/form-data` com um ou mais arquivos (`UploadFile`).
- Para cada arquivo: valida content-type **e** extensão contra a allowlist; lê bytes e valida `size <= 10 MB`; gera `stored_name` UUID; grava em `UPLOAD_DIR`; cria registro com `uploaded_by = current_user.id`.
- Rejeições retornam 400 com detalhe (tipo não permitido / arquivo grande demais).
- Retorna a lista de `AttachmentOut` criados.

### `GET /lists/{list_id}/cards/{card_id}/attachments/{attachment_id}/download`
- Exige token (é o que garante "só logado").
- Para upload local: `FileResponse` do arquivo em disco, com `Content-Disposition` usando o `filename` original e o `content_type` salvo.
- Para anexo Trello (tem `url`, sem `stored_name`): redireciona para a URL externa (ou retorna a URL) — comportamento legado.
- 404 se registro ou arquivo não existir.

### `DELETE /lists/{list_id}/cards/{card_id}/attachments/{attachment_id}`
- Autorização: `attachment.uploaded_by == current_user.id` **ou** `current_user.is_admin`; senão 403.
- Remove o arquivo do disco (se `stored_name`) e o registro do banco.

## 4. Schemas

`AttachmentOut` (estende o atual): `id`, `filename`, `content_type`, `size`, `uploaded_by`, `uploaded_at`, e um flag derivado `is_image` (para o front decidir miniatura). `url` deixa de ser exposto diretamente para uploads locais; o front monta a rota de download a partir do `id`. `CardOut.attachments` passa a usar esse schema estendido.

## 5. Frontend — seção "Anexos" no `CardDetailModal`

Hoje o modal não tem seção de anexos; adicionar entre Checklists e a área de ações, ou após Descrição.

- **Upload:** botão com `<input type="file" multiple>`; aceita os tipos da allowlist; mostra spinner durante envio; em erro, exibe a mensagem do backend.
- **Lista de anexos:**
  - Imagens: **miniatura** — o front faz `fetch` do endpoint de download com o header `Authorization` (via helper novo no `api.ts` que retorna `Blob`), cria um `objectURL` e usa em `<img>`. Clicar abre um **lightbox** simples (overlay) com a imagem grande (mesmo `objectURL`).
  - Documentos: linha com ícone por tipo + nome + tamanho formatado + botão **baixar** (fetch blob → `objectURL` → download com nome original).
  - Botão **excluir**: visível só se `uploaded_by === usuário atual` ou usuário é admin (o backend reforça).
- **`api.ts`:** adicionar helpers `upload(path, files)` (sem `Content-Type` manual; o browser põe o boundary) e `getBlob(path)` (com `Authorization`).
- Atualizar o estado do card (`onCardUpdate`) ao adicionar/remover, e revogar `objectURL`s ao desmontar.

## 6. Rosto do card (`CardContent`)

Ao lado do contador de comentários, mostrar clipe 📎 + `card.attachments.length` quando houver anexos.

## 7. Config / infra

- `Settings.UPLOAD_DIR: str = "/app/uploads"` em `core/config.py`; `.env.example` ganha `UPLOAD_DIR`.
- `docker-compose.yml`: adicionar volume para persistir `/app/uploads` em dev.
- Criar `UPLOAD_DIR` no startup (`lifespan`) se não existir.

## 8. Fora de escopo (v1)

- Limpeza de arquivos órfãos quando um card é excluído/arquivado: os registros somem (cascade), mas os arquivos **permanecem no disco**. Aceitável para v1; cleanup pode ser adicionado depois.
- Antivírus / verificação de conteúdo além de tipo+tamanho.
- Renomear anexo, versionamento, pastas.

## 9. Critérios de aceite

1. Upimg de PDF/Word/Excel/imagem ≤10 MB cria o anexo e ele aparece na lista do card.
2. Arquivo >10 MB ou tipo fora da allowlist é rejeitado com mensagem clara.
3. Download exige estar logado (sem token → 401/403).
4. Imagem aparece como miniatura e abre em tamanho grande ao clicar.
5. Excluir anexo só funciona para o autor ou admin; remove arquivo do disco e registro.
6. O rosto do card mostra a contagem de anexos.
7. Anexos antigos importados do Trello (URL externa) continuam acessíveis.
