# Card Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real file attachments (upload, authenticated download, delete) to cards in TaskHS, with image thumbnails in the card modal.

**Architecture:** Files are stored on disk under `UPLOAD_DIR` (default `/app/uploads`, an Easypanel volume in prod). The `card_attachments` table gains columns to track the on-disk name, mime type, size, and uploader. Three authenticated endpoints (upload / download / delete) live in the existing cards router. The React card modal gains an "Anexos" section that uploads via multipart and renders blobs fetched with the auth header.

**Tech Stack:** FastAPI + async SQLAlchemy 2.0 + asyncpg (backend), React 19 + Vite + Tailwind v4 (frontend), PostgreSQL 17 (remote).

## Global Constraints

- File types allowed (content-type → extension): `application/pdf`→`.pdf`, `image/jpeg`→`.jpg`, `image/png`→`.png`, `image/gif`→`.gif`, `image/webp`→`.webp`, `application/msword`→`.doc`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`→`.docx`, `application/vnd.ms-excel`→`.xls`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`→`.xlsx`.
- Max size per file: `10 * 1024 * 1024` bytes (10 MB).
- Delete authorization: `attachment.uploaded_by == current_user.id` OR `current_user.is_admin`.
- All endpoints require `get_current_user` (JWT bearer).
- DB has NO migrations (Alembic unused); schema changes are manual `ALTER TABLE`. `create_all` does not alter existing tables.
- No automated test harness exists; verification is via curl (backend) and browser/HMR (frontend). Do not add a pytest harness in this plan.
- Backend runs in Docker (`docker compose up -d --build`); after backend code changes, rebuild. Frontend runs via `npm run dev` with HMR.

**Test fixtures for curl steps** (run once at the start of any backend task; re-run if the shell resets):
```bash
cd /home/ericks/github/TaskHS
TOKEN=$(curl -s -X POST localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"healthsafetyti@gmail.com","password":"admin123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
echo "TOKEN length: ${#TOKEN}"   # expect a long non-zero number
# Pick a real list_id and card_id from board 20:
LID=$(curl -s localhost:8000/api/boards/20/lists -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')
CID=$(curl -s localhost:8000/api/lists/$LID/cards -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')
echo "LID=$LID CID=$CID"          # expect two integers
```

---

### Task 1: Storage config, model columns, and DB migration

**Files:**
- Modify: `backend/app/core/config.py` (add `UPLOAD_DIR`)
- Modify: `backend/.env.example` (document `UPLOAD_DIR`)
- Modify: `backend/app/models/card.py` (extend `CardAttachment`, make `url` nullable)
- Modify: `backend/app/main.py` (create `UPLOAD_DIR` on startup)
- Modify: `docker-compose.yml` (persist `/app/uploads`)
- Create: `backend/migrations/001_card_attachments.sql` (manual ALTER)

**Interfaces:**
- Produces: `settings.UPLOAD_DIR: str`; `CardAttachment` columns `stored_name: str|None`, `content_type: str|None`, `size: int|None`, `uploaded_by: int|None`, `url: str|None`.

- [ ] **Step 1: Add `UPLOAD_DIR` to settings**

In `backend/app/core/config.py`, add the field to `Settings`:
```python
class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    UPLOAD_DIR: str = "/app/uploads"

    model_config = {"env_file": ".env"}
```

- [ ] **Step 2: Document env in `.env.example`**

Append to `backend/.env.example`:
```
UPLOAD_DIR=/app/uploads
```

- [ ] **Step 3: Extend the `CardAttachment` model**

In `backend/app/models/card.py`, replace the `CardAttachment` class body with:
```python
class CardAttachment(Base):
    __tablename__ = "card_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"))
    filename: Mapped[str] = mapped_column(String(255))
    url: Mapped[str | None] = mapped_column(String(1000))
    stored_name: Mapped[str | None] = mapped_column(String(255))
    content_type: Mapped[str | None] = mapped_column(String(255))
    size: Mapped[int | None] = mapped_column(Integer)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    card: Mapped["Card"] = relationship("Card", back_populates="attachments")
```
Add `Integer` to the `sqlalchemy` import line at the top of the file (it currently imports `String, ForeignKey, Float, DateTime, Date, Text, Boolean, Enum as SAEnum` — add `Integer`).

- [ ] **Step 4: Create `UPLOAD_DIR` on startup**

In `backend/app/main.py`, update the `lifespan` to ensure the directory exists. Add `import os` at the top, then:
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
```
Add the import for settings if not present: `from app.core.config import settings`.

- [ ] **Step 5: Persist uploads volume in docker-compose**

Replace `docker-compose.yml` with:
```yaml
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    env_file:
      - ./backend/.env
    volumes:
      - taskhs-uploads:/app/uploads
    restart: unless-stopped

volumes:
  taskhs-uploads:
```

- [ ] **Step 6: Write the migration SQL**

Create `backend/migrations/001_card_attachments.sql`:
```sql
ALTER TABLE card_attachments ADD COLUMN IF NOT EXISTS stored_name VARCHAR(255);
ALTER TABLE card_attachments ADD COLUMN IF NOT EXISTS content_type VARCHAR(255);
ALTER TABLE card_attachments ADD COLUMN IF NOT EXISTS size INTEGER;
ALTER TABLE card_attachments ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(id);
ALTER TABLE card_attachments ALTER COLUMN url DROP NOT NULL;
```

- [ ] **Step 7: Apply the migration to the remote DB**

Run:
```bash
PGPASSWORD=administrador psql -h 62.72.11.28 -p 9874 -U administrador -d taskhs-banco \
  -f /home/ericks/github/TaskHS/backend/migrations/001_card_attachments.sql
```
Expected output: a series of `ALTER TABLE` lines, no errors.

- [ ] **Step 8: Rebuild backend and verify it boots + columns exist**

Run:
```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build 2>&1 | tail -3
sleep 3 && curl -s localhost:8000/api/health
PGPASSWORD=administrador psql -h 62.72.11.28 -p 9874 -U administrador -d taskhs-banco \
  -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='card_attachments' ORDER BY column_name;"
```
Expected: `{"status":"ok"}` and the column list includes `content_type, size, stored_name, uploaded_by`.

- [ ] **Step 9: Commit**

```bash
git add backend/app/core/config.py backend/.env.example backend/app/models/card.py backend/app/main.py docker-compose.yml backend/migrations/001_card_attachments.sql
git commit -m "feat(attachments): storage config, model columns, db migration"
```

---

### Task 2: Upload endpoint + extended AttachmentOut schema

**Files:**
- Modify: `backend/app/schemas/card.py` (extend `AttachmentOut`)
- Create: `backend/app/routers/attachments.py` (new router with upload endpoint)
- Modify: `backend/app/main.py` (register the router)
- Modify: `backend/app/routers/cards.py` (`_card_to_dict` attachments serialization)

**Interfaces:**
- Consumes: `settings.UPLOAD_DIR`, `CardAttachment` columns (Task 1), `get_current_user`.
- Produces: `POST /api/lists/{list_id}/cards/{card_id}/attachments` returning `list[AttachmentOut]`; `AttachmentOut` fields `id, filename, content_type, size, uploaded_by, uploaded_at, is_image`; module-level `ALLOWED_TYPES: dict[str,str]` and `MAX_SIZE: int` in `attachments.py`.

- [ ] **Step 1: Extend `AttachmentOut`**

In `backend/app/schemas/card.py`, replace the `AttachmentOut` class with:
```python
class AttachmentOut(BaseModel):
    id: int
    filename: str
    content_type: str | None = None
    size: int | None = None
    uploaded_by: int | None = None
    uploaded_at: datetime
    is_image: bool = False

    model_config = {"from_attributes": True}

    @field_validator("is_image", mode="before")
    @classmethod
    def derive_is_image(cls, v: Any, info: Any) -> Any:
        return v
```
Note: `is_image` is computed in serialization (Step 4), not from the ORM. Keep the validator as a passthrough so explicit values are honored. `field_validator` and `Any` are already imported in this file.

- [ ] **Step 2: Create the attachments router with the upload endpoint**

Create `backend/app/routers/attachments.py`:
```python
import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.core.config import settings
from app.models.card import Card, CardAttachment
from app.models.user import User
from app.schemas.card import AttachmentOut
from app.dependencies import get_current_user

router = APIRouter(prefix="/lists/{list_id}/cards/{card_id}/attachments", tags=["attachments"])

ALLOWED_TYPES: dict[str, str] = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
}
MAX_SIZE = 10 * 1024 * 1024


def attachment_to_dict(a: CardAttachment) -> dict:
    ct = a.content_type or ""
    return {
        "id": a.id,
        "filename": a.filename,
        "content_type": a.content_type,
        "size": a.size,
        "uploaded_by": a.uploaded_by,
        "uploaded_at": a.uploaded_at,
        "is_image": ct.startswith("image/"),
    }


async def _get_card_or_404(card_id: int, list_id: int, db: AsyncSession) -> Card:
    result = await db.execute(select(Card).where(Card.id == card_id, Card.list_id == list_id))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card não encontrado")
    return card


@router.post("", response_model=list[AttachmentOut], status_code=status.HTTP_201_CREATED)
async def upload_attachments(
    list_id: int, card_id: int,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_card_or_404(card_id, list_id, db)
    created: list[CardAttachment] = []
    for f in files:
        if f.content_type not in ALLOWED_TYPES:
            raise HTTPException(status_code=400, detail=f"Tipo não permitido: {f.filename} ({f.content_type})")
        content = await f.read()
        if len(content) > MAX_SIZE:
            raise HTTPException(status_code=400, detail=f"Arquivo grande demais (máx 10 MB): {f.filename}")
        ext = ALLOWED_TYPES[f.content_type]
        stored_name = f"{uuid.uuid4().hex}{ext}"
        with open(os.path.join(settings.UPLOAD_DIR, stored_name), "wb") as out:
            out.write(content)
        att = CardAttachment(
            card_id=card_id,
            filename=f.filename or stored_name,
            stored_name=stored_name,
            content_type=f.content_type,
            size=len(content),
            uploaded_by=current_user.id,
        )
        db.add(att)
        created.append(att)
    await db.commit()
    for att in created:
        await db.refresh(att)
    return [attachment_to_dict(a) for a in created]
```

- [ ] **Step 3: Register the router**

In `backend/app/main.py`, add `attachments` to the routers import line and include it:
```python
from app.routers import auth, boards, lists, cards, labels, notifications, attachments
```
```python
app.include_router(attachments.router, prefix="/api")
```

- [ ] **Step 4: Fix attachments serialization in `_card_to_dict`**

In `backend/app/routers/cards.py`, change the `attachments` line inside `_card_to_dict` so `is_image` and the new fields are populated. Replace:
```python
        "attachments": _to_list(card.attachments),
```
with:
```python
        "attachments": [
            {
                "id": a.id, "filename": a.filename, "content_type": a.content_type,
                "size": a.size, "uploaded_by": a.uploaded_by, "uploaded_at": a.uploaded_at,
                "is_image": (a.content_type or "").startswith("image/"),
            }
            for a in _to_list(card.attachments)
        ],
```

- [ ] **Step 5: Rebuild and verify upload (curl)**

Run the **Test fixtures** block above, then:
```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build 2>&1 | tail -2 && sleep 3
printf '%%PDF-1.4 fake pdf' > /tmp/test.pdf
curl -s -X POST "localhost:8000/api/lists/$LID/cards/$CID/attachments" \
  -H "Authorization: Bearer $TOKEN" -F "files=@/tmp/test.pdf;type=application/pdf"
```
Expected: a JSON array with one object containing `"filename":"test.pdf"`, `"content_type":"application/pdf"`, `"is_image":false`, a numeric `size`, and `uploaded_by` matching the admin's id.

- [ ] **Step 6: Verify rejection of a bad type**

```bash
printf 'hello' > /tmp/test.txt
curl -s -o /dev/null -w "%%{http_code}\n" -X POST "localhost:8000/api/lists/$LID/cards/$CID/attachments" \
  -H "Authorization: Bearer $TOKEN" -F "files=@/tmp/test.txt;type=text/plain"
```
Expected: `400`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/card.py backend/app/routers/attachments.py backend/app/main.py backend/app/routers/cards.py
git commit -m "feat(attachments): upload endpoint and extended schema"
```

---

### Task 3: Download endpoint (authenticated)

**Files:**
- Modify: `backend/app/routers/attachments.py` (add GET download)

**Interfaces:**
- Consumes: `CardAttachment`, `settings.UPLOAD_DIR`, `get_current_user`.
- Produces: `GET /api/lists/{list_id}/cards/{card_id}/attachments/{attachment_id}/download` → file bytes (local) or 307 redirect (Trello URL).

- [ ] **Step 1: Add the download endpoint**

In `backend/app/routers/attachments.py`, add imports at the top:
```python
from fastapi.responses import FileResponse, RedirectResponse
```
Then add:
```python
@router.get("/{attachment_id}/download")
async def download_attachment(
    list_id: int, card_id: int, attachment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(CardAttachment).where(CardAttachment.id == attachment_id, CardAttachment.card_id == card_id)
    )
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Anexo não encontrado")
    if att.stored_name:
        path = os.path.join(settings.UPLOAD_DIR, att.stored_name)
        if not os.path.isfile(path):
            raise HTTPException(status_code=404, detail="Arquivo não encontrado no disco")
        return FileResponse(path, filename=att.filename, media_type=att.content_type or "application/octet-stream")
    if att.url:
        return RedirectResponse(att.url)
    raise HTTPException(status_code=404, detail="Anexo sem arquivo")
```

- [ ] **Step 2: Rebuild and verify authenticated download works**

Run the **Test fixtures** block, then upload a PDF and capture its id:
```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build 2>&1 | tail -2 && sleep 3
printf '%%PDF-1.4 fake pdf' > /tmp/test.pdf
AID=$(curl -s -X POST "localhost:8000/api/lists/$LID/cards/$CID/attachments" \
  -H "Authorization: Bearer $TOKEN" -F "files=@/tmp/test.pdf;type=application/pdf" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')
curl -s "localhost:8000/api/lists/$LID/cards/$CID/attachments/$AID/download" \
  -H "Authorization: Bearer $TOKEN" | head -c 20; echo
```
Expected: prints `%PDF-1.4 fake pdf`.

- [ ] **Step 3: Verify download without token is rejected**

```bash
curl -s -o /dev/null -w "%%{http_code}\n" "localhost:8000/api/lists/$LID/cards/$CID/attachments/$AID/download"
```
Expected: `403` (no bearer credentials).

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/attachments.py
git commit -m "feat(attachments): authenticated download endpoint"
```

---

### Task 4: Delete endpoint (uploader or admin)

**Files:**
- Modify: `backend/app/routers/attachments.py` (add DELETE)

**Interfaces:**
- Consumes: `CardAttachment`, `settings.UPLOAD_DIR`, `get_current_user`.
- Produces: `DELETE /api/lists/{list_id}/cards/{card_id}/attachments/{attachment_id}` → 204.

- [ ] **Step 1: Add the delete endpoint**

In `backend/app/routers/attachments.py`, add:
```python
@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    list_id: int, card_id: int, attachment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(CardAttachment).where(CardAttachment.id == attachment_id, CardAttachment.card_id == card_id)
    )
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Anexo não encontrado")
    if att.uploaded_by != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Apenas o autor do anexo ou um administrador pode excluí-lo")
    if att.stored_name:
        path = os.path.join(settings.UPLOAD_DIR, att.stored_name)
        if os.path.isfile(path):
            os.remove(path)
    await db.delete(att)
    await db.commit()
```

- [ ] **Step 2: Rebuild and verify delete works for the uploader (admin)**

Run the **Test fixtures** block, then:
```bash
cd /home/ericks/github/TaskHS && docker compose up -d --build 2>&1 | tail -2 && sleep 3
printf '%%PDF-1.4 fake pdf' > /tmp/test.pdf
AID=$(curl -s -X POST "localhost:8000/api/lists/$LID/cards/$CID/attachments" \
  -H "Authorization: Bearer $TOKEN" -F "files=@/tmp/test.pdf;type=application/pdf" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')
curl -s -o /dev/null -w "%%{http_code}\n" -X DELETE \
  "localhost:8000/api/lists/$LID/cards/$CID/attachments/$AID" -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w "%%{http_code}\n" \
  "localhost:8000/api/lists/$LID/cards/$CID/attachments/$AID/download" -H "Authorization: Bearer $TOKEN"
```
Expected: first prints `204`, second prints `404` (gone).

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/attachments.py
git commit -m "feat(attachments): delete endpoint with uploader/admin authorization"
```

---

### Task 5: Frontend API helpers (upload + blob fetch)

**Files:**
- Modify: `frontend/src/lib/api.ts` (add `upload` and `getBlob`)
- Modify: `frontend/src/types/index.ts` (extend `Attachment`)

**Interfaces:**
- Produces: `api.upload<T>(path, files: File[]): Promise<T>`, `api.getBlob(path): Promise<Blob>`; `Attachment` type with `content_type, size, uploaded_by, is_image`.

- [ ] **Step 1: Extend the `Attachment` type**

In `frontend/src/types/index.ts`, replace the `Attachment` interface with:
```ts
export interface Attachment {
  id: number;
  filename: string;
  content_type: string | null;
  size: number | null;
  uploaded_by: number | null;
  uploaded_at: string;
  is_image: boolean;
}
```

- [ ] **Step 2: Add `upload` and `getBlob` to the api client**

In `frontend/src/lib/api.ts`, add these two functions to the exported `api` object (do NOT set `Content-Type` on upload — the browser sets the multipart boundary):
```ts
export const api = {
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  get:  <T>(path: string)                => request<T>(path),
  patch:<T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del:  <T>(path: string)                => request<T>(path, { method: "DELETE" }),
  upload: async <T>(path: string, files: File[]): Promise<T> => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { ...authHeaders() }, body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? "Erro no upload");
    }
    return res.json();
  },
  getBlob: async (path: string): Promise<Blob> => {
    const res = await fetch(`${BASE}${path}`, { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error("Falha ao baixar arquivo");
    return res.blob();
  },
};
```

- [ ] **Step 3: Verify it type-checks**

Run:
```bash
cd /home/ericks/github/TaskHS/frontend && npx tsc -b --noEmit 2>&1 | grep -E "api.ts|types/index.ts" || echo "no errors in changed files"
```
Expected: `no errors in changed files`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/types/index.ts
git commit -m "feat(attachments): frontend api helpers for upload and blob fetch"
```

---

### Task 6: "Anexos" section in the card modal

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx` (add an `Attachments` block inside `CardDetailModal`)

**Interfaces:**
- Consumes: `api.upload`, `api.getBlob`, `api.del`, `Attachment` type, `card.list_id`, `card.id`, `onCardUpdate`, `currentUser` (id + is_admin).
- Produces: rendered attachments UI; updates card via `onCardUpdate({ id, attachments })`.

- [ ] **Step 1: Pass the current user into `CardDetailModal`**

`CardDetailModal` needs the current user for the delete-button visibility. The board already reads `const { user: currentUser } = useAuth();` in `BoardPage`. Add a prop to the modal's signature and type (near the top of `CardDetailModal`):
```tsx
function CardDetailModal({ card, listTitle, lists, boardLabels, currentUser, onClose, onCardUpdate, onCardDelete, onCardCopy }: {
  card: Card;
  listTitle: string;
  lists: BoardList[];
  boardLabels: BoardLabel[];
  currentUser: { id: number; is_admin: boolean } | null;
  onClose: () => void;
  onCardUpdate: (updated: Partial<Card> & { id: number }) => void;
  onCardDelete: (cardId: number) => void;
  onCardCopy: (newCard: Card) => void;
}) {
```
And where the modal is rendered (search for `<CardDetailModal`), add the prop:
```tsx
          currentUser={currentUser}
```

- [ ] **Step 2: Add attachments state + handlers inside `CardDetailModal`**

After the existing checklist state declarations in `CardDetailModal`, add:
```tsx
  const [attachments, setAttachments] = useState<Attachment[]>(card.attachments ?? []);
  const [uploading, setUploading] = useState(false);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setAttachments(card.attachments ?? []); }, [card.id]);

  // load image thumbnails as blob object URLs
  useEffect(() => {
    let revoked = false;
    const created: string[] = [];
    (async () => {
      for (const a of attachments) {
        if (a.is_image && !thumbs[a.id]) {
          try {
            const blob = await api.getBlob(`/lists/${card.list_id}/cards/${card.id}/attachments/${a.id}/download`);
            if (revoked) return;
            const url = URL.createObjectURL(blob);
            created.push(url);
            setThumbs(prev => ({ ...prev, [a.id]: url }));
          } catch {}
        }
      }
    })();
    return () => { revoked = true; created.forEach(URL.revokeObjectURL); };
  }, [attachments, card.id, card.list_id]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const created = await api.upload<Attachment[]>(`/lists/${card.list_id}/cards/${card.id}/attachments`, Array.from(files));
      const updated = [...attachments, ...created];
      setAttachments(updated);
      onCardUpdate({ id: card.id, attachments: updated });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDownload(a: Attachment) {
    try {
      const blob = await api.getBlob(`/lists/${card.list_id}/cards/${card.id}/attachments/${a.id}/download`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = a.filename; link.click();
      URL.revokeObjectURL(url);
    } catch {}
  }

  async function handleDeleteAttachment(a: Attachment) {
    try {
      await api.del(`/lists/${card.list_id}/cards/${card.id}/attachments/${a.id}`);
      const updated = attachments.filter(x => x.id !== a.id);
      setAttachments(updated);
      onCardUpdate({ id: card.id, attachments: updated });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao excluir");
    }
  }

  function canDelete(a: Attachment): boolean {
    return !!currentUser && (a.uploaded_by === currentUser.id || currentUser.is_admin);
  }

  function formatSize(bytes: number | null): string {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
```
Ensure `Attachment` is in the `import type { ... } from "../types";` line at the top of the file. `useRef` and `useEffect` are already imported.

- [ ] **Step 3: Render the Anexos section**

In `CardDetailModal`'s JSX, add this block right after the Checklists `.map(...)` block and before the "Add checklist" button (left column):
```tsx
            {/* Anexos */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  <p className="text-sm font-semibold text-slate-300">Anexos {attachments.length > 0 && <span className="font-normal text-slate-500">({attachments.length})</span>}</p>
                </div>
                <button onClick={() => fileRef.current?.click()} disabled={uploading} className="text-xs text-slate-500 hover:text-primary transition-colors disabled:opacity-50">
                  {uploading ? "Enviando…" : "+ Adicionar"}
                </button>
              </div>
              <input
                ref={fileRef} type="file" multiple hidden
                accept=".pdf,.doc,.docx,.xls,.xlsx,image/jpeg,image/png,image/gif,image/webp,application/pdf"
                onChange={e => handleUpload(e.target.files)}
              />
              {attachments.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Nenhum anexo.</p>
              ) : (
                <div className="grid grid-cols-1 gap-1.5">
                  {attachments.map(a => (
                    <div key={a.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-background-elevated border border-border group/att">
                      {a.is_image && thumbs[a.id] ? (
                        <img src={thumbs[a.id]} alt={a.filename} onClick={() => setLightbox(thumbs[a.id])} className="w-10 h-10 rounded object-cover cursor-pointer shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-background flex items-center justify-center shrink-0 text-slate-400">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-200 truncate">{a.filename}</p>
                        <p className="text-[10px] text-slate-500">{formatSize(a.size)}</p>
                      </div>
                      <button onClick={() => handleDownload(a)} title="Baixar" className="p-1.5 rounded text-slate-500 hover:text-primary hover:bg-background transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      </button>
                      {canDelete(a) && (
                        <button onClick={() => handleDeleteAttachment(a)} title="Excluir" className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
```

- [ ] **Step 4: Render the lightbox overlay**

Just before the closing `</div>` of the modal's outermost container (the `fixed inset-0 z-50 ...` wrapper), add:
```tsx
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-8" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-lg shadow-2xl" />
        </div>
      )}
```

- [ ] **Step 5: Verify in the browser (HMR)**

The frontend dev server is running. In the browser (logged in), open a card on board "Serviço", and:
1. Click "+ Adicionar" in Anexos, pick a PDF and an image → both appear; the image shows a thumbnail.
2. Click the image thumbnail → opens large in the lightbox; click the overlay → closes.
3. Click the download icon on the PDF → file downloads with its original name.
4. Click the delete (×) on an attachment you uploaded → it disappears.

Confirm no errors in the Vite output:
```bash
tail -5 /tmp/claude-1000/-home-ericks-github-TaskHS/*/tasks/*.output
```
Expected: recent `hmr update` lines, no stack trace after them.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/BoardPage.tsx
git commit -m "feat(attachments): Anexos section in card modal with thumbnails and lightbox"
```

---

### Task 7: Attachment count on the card face

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx` (`CardContentBase` footer)

**Interfaces:**
- Consumes: `card.attachments` (already on `Card`).

- [ ] **Step 1: Add the paperclip + count next to the comments count**

In `CardContentBase`, in the footer's left group (where the comments count `{card.comments.length > 0 && (...)}` is rendered), add immediately after the comments span:
```tsx
          {card.attachments.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
              {card.attachments.length}
            </span>
          )}
```

- [ ] **Step 2: Verify in the browser (HMR)**

A card with an attachment now shows a paperclip + number on its face in the board view. Confirm visually.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/BoardPage.tsx
git commit -m "feat(attachments): show attachment count on card face"
```

---

## Self-Review

**Spec coverage:**
- Storage on disk / UPLOAD_DIR / volume → Task 1 ✓
- DB columns + manual migration → Task 1 ✓
- Upload endpoint with type+size validation → Task 2 ✓
- Authenticated download (+ Trello redirect) → Task 3 ✓
- Delete with uploader/admin rule → Task 4 ✓
- AttachmentOut extended + is_image → Task 2 ✓
- Frontend api helpers → Task 5 ✓
- Anexos UI: upload (multiple), thumbnails, lightbox, download, conditional delete → Task 6 ✓
- Card-face attachment count → Task 7 ✓
- Out of scope (orphan files, antivirus) → not implemented, as specified ✓

**Type consistency:** `attachment_to_dict` keys, `AttachmentOut` fields, `Attachment` TS interface, and `_card_to_dict` attachments dict all use the same field set (`id, filename, content_type, size, uploaded_by, uploaded_at, is_image`). Endpoint paths are identical across tasks (`/lists/{list_id}/cards/{card_id}/attachments...`). `api.upload`/`api.getBlob` signatures match their Task 6 call sites.

**Notes for the executor:** Backend tasks require a `docker compose up -d --build` before their curl verification (image must include new code). The frontend dev server hot-reloads automatically.
