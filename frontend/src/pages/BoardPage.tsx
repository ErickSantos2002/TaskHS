import { useState, useEffect, useRef, useCallback, memo, lazy, Suspense } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  DndContext, DragOverlay, closestCorners,
  PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "../lib/utils";
import { api, ApiError } from "../lib/api";
import { useBoardStream } from "../hooks/useBoardStream";
import { BoardIcon } from "../components/BoardIcon";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { carregarComRetry } from "../lib/carregarComRetry";
// Com retry: o visualizador é buscado no clique, e uma requisição que falha
// (rede oscilando, deploy reiniciando o container) não pode virar erro fatal.
const PdfViewer = lazy(() => carregarComRetry(() => import("../components/PdfViewer")));
import { BOARD_ICON_NAMES } from "../lib/boardIcons";
import type { Board, BoardList, Card, Comment, Activity, ActivityPage, Priority, Label, BoardLabel, Checklist, ChecklistItem, Attachment, Reminder, Automation, BoardMemberOut, UserBasic } from "../types";

// ── Priority config ────────────────────────────────────────────

const PRIORITY: Record<Priority, { label: string; border: string; dot: string; badge: string }> = {
  critical: { label: "Crítico", border: "border-l-red-500",                          dot: "#ef4444", badge: "bg-red-500/10 text-red-400"       },
  high:     { label: "Alto",    border: "border-l-amber-500",                         dot: "#f59e0b", badge: "bg-amber-500/10 text-amber-400"   },
  medium:   { label: "Médio",   border: "border-l-indigo-400",                        dot: "#818cf8", badge: "bg-indigo-500/10 text-indigo-400" },
  low:      { label: "Baixo",   border: "border-l-slate-600",                         dot: "#475569", badge: "bg-slate-700/50 text-slate-400"   },
};

const PRIORITY_ORDER: Priority[] = ["critical", "high", "medium", "low"];

// ── Helpers ────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00");
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

function isOverdue(dateStr: string): boolean {
  return new Date(dateStr + "T00:00:00") < new Date(new Date().toDateString());
}

// ── Icons ──────────────────────────────────────────────────────

const IPlus = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);
const IBack = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
);
const ICal = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);
const IChat = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);
const IGrip = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
    <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
    <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
  </svg>
);
const ISpinner = () => (
  <svg className="w-5 h-5 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);
const ICheck = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);
const IX = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);
const ITrash = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);
const IUserPlus = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
  </svg>
);
const ITag = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 8V5a2 2 0 012-2h2z" />
  </svg>
);
const IDots = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h.01M12 12h.01M19 12h.01" />
  </svg>
);
const ISearch = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);
const ICopy = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);
const IGear = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LABEL_COLORS = ["#ef4444","#f97316","#f59e0b","#22c55e","#0ea5e9","#8b5cf6","#ec4899","#64748b"];

const COR_PADRAO = "#0ea5e9";

/** Botão que abre o seletor de cores do sistema — a roda de cores, com qualquer
 *  cor, em vez de uma paleta de oito.
 *
 *  O <input type="color"> é o próprio gatilho: fica invisível cobrindo o botão,
 *  então o clique cai nele e o navegador abre o seletor nativo. Valor fora do
 *  formato #rrggbb cai no padrão — o input só aceita hexadecimal e, calado,
 *  transformaria a cor em preto. */
function SeletorDeCor({ cor, onChange }: { cor: string; onChange: (cor: string) => void }) {
  const valor = /^#[0-9a-fA-F]{6}$/.test(cor) ? cor : COR_PADRAO;
  return (
    <label
      title="Escolher cor"
      className="relative inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-background hover:bg-background-elevated cursor-pointer transition-colors"
    >
      <span className="w-4 h-4 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: valor }} />
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">{valor}</span>
      <input
        type="color"
        value={valor}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </label>
  );
}

// @[Nome da Pessoa](14) — tem que casar com o MENCAO_RE do backend (app/mentions.py).
// O {1,120} e o limite do User.name; o teto (em vez de +) evita a varredura quadratica.
// [0-9]+ e nao \d+: o \d do JS e ASCII, mas o do Python casa digito Unicode
// (ex.: arabe-indico ١٤) — as duas regex tem que ser equivalentes.
const MENCAO_RENDER = /@\[([^\]\n]{1,120})\]\(([0-9]+)\)/g;

/** O corpo do comentário com as menções destacadas.
 *  Mostra o nome guardado no token — o da época em que foi escrito. É o registro
 *  do que a pessoa disse, não uma versão reescrita depois. */
function CorpoComentario({ texto }: { texto: string }) {
  const partes: React.ReactNode[] = [];
  let ultimo = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(MENCAO_RENDER);   // instancia propria: lastIndex e mutavel
  while ((m = re.exec(texto)) !== null) {
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index));
    partes.push(
      <span key={`${m.index}-${m[2]}`} className="text-primary font-semibold bg-primary/10 rounded px-1">
        @{m[1]}
      </span>
    );
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return <>{partes}</>;
}

// URLs no texto das obs (que vem da integracao) viram um link curto "Abrir link"
// em vez do endereco cru — que pode ser enorme e ainda carregar um token na query.
const OBS_URL_RE = /(https?:\/\/[^\s]+)/g;

/** O texto de uma observacao com as URLs trocadas por um link "Abrir link" (nova aba). */
function ObsTexto({ texto }: { texto: string }) {
  const partes: React.ReactNode[] = [];
  let ultimo = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(OBS_URL_RE);   // instancia propria: lastIndex e mutavel
  while ((m = re.exec(texto)) !== null) {
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index));
    partes.push(
      <a
        key={m.index}
        href={m[1]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline font-medium break-words"
      >
        Abrir link
      </a>
    );
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return <>{partes}</>;
}

// ── CardDetailModal ────────────────────────────────────────────

function CardDetailModal({ card, boardId, listTitle, lists, boardLabels, currentUser, integrationEnabled, obsLabels, onClose, onCardUpdate, onCardDelete, onCardCopy, onRestore, isDone, onToggleDone }: {
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
  onRestore: (card: Card) => void;
  isDone: boolean;
  onToggleDone: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [labels, setLabels] = useState<Label[]>(card.labels);
  const [members, setMembers] = useState<UserBasic[]>(card.members);
  const [comments, setComments] = useState<Comment[]>(card.comments);
  const [commentBody, setCommentBody] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [allUsers, setAllUsers] = useState<UserBasic[]>([]);
  const [erroMembroCard, setErroMembroCard] = useState<string | null>(null);
  const [erroComentario, setErroComentario] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editandoBody, setEditandoBody] = useState("");
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);
  // Comentários editados cujo texto original está aberto (por id).
  const [originaisAbertos, setOriginaisAbertos] = useState<Set<number>>(new Set());
  const [abaCard, setAbaCard] = useState<"comentarios" | "atividade">("comentarios");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityCarregado, setActivityCarregado] = useState(false);
  const [erroActivity, setErroActivity] = useState<string | null>(null);
  // Quem criou / quem arquivou — derivado do log (endpoint /meta). Só a data de
  // criação vem do próprio card; estes dois campos o modelo não guarda.
  const [cardMeta, setCardMeta] = useState<{ created_by: string | null; created_by_type: string | null; archived_by: string | null; archived_at: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCopyForm, setShowCopyForm] = useState(false);
  const [copyTitle, setCopyTitle] = useState("");
  const [copyListId, setCopyListId] = useState<number>(card.list_id);
  const [copying, setCopying] = useState(false);
  const [checklists, setChecklists] = useState<Checklist[]>(card.checklists ?? []);
  const [addingChecklist, setAddingChecklist] = useState(false);
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [addingItemId, setAddingItemId] = useState<number | null>(null);
  const [newItemText, setNewItemText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>(card.attachments ?? []);
  const [uploading, setUploading] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Anexo cujo arquivo não veio: marca a linha em vermelho em vez de falhar em silêncio.
  const [attErros, setAttErros] = useState<Record<number, string>>({});
  const [pdfView, setPdfView] = useState<{ url: string; filename: string } | null>(null);
  const [abrindoPdf, setAbrindoPdf] = useState<number | null>(null);
  const [obsOpen, setObsOpen] = useState<number | null>(null);
  const obsValues = [card.obs1, card.obs2, card.obs3, card.obs4, card.obs5, card.obs6];
  const fileRef = useRef<HTMLInputElement>(null);
  const editingFieldRef = useRef<null | "title" | "description">(null);

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [remindAt, setRemindAt] = useState("");
  const [addingReminder, setAddingReminder] = useState(false);

  const [mencaoQuery, setMencaoQuery] = useState<string | null>(null);
  const comentarioRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.get<Reminder[]>(`/lists/${card.list_id}/cards/${card.id}/reminders`).then(setReminders).catch(() => {});
  }, [card.id, card.list_id]);

  // Criador/arquivador (derivados do log). card.archived nas deps: se o card for
  // arquivado com o modal aberto, refaz para trazer quem arquivou.
  useEffect(() => {
    let cancel = false;
    setCardMeta(null);
    api.get<typeof cardMeta>(`/lists/${card.list_id}/cards/${card.id}/meta`)
      .then(m => { if (!cancel) setCardMeta(m); }).catch(() => {});
    return () => { cancel = true; };
  }, [card.id, card.list_id, card.archived]);

  async function handleAddReminder() {
    if (!remindAt || addingReminder) return;
    setAddingReminder(true);
    try {
      const iso = new Date(remindAt).toISOString();
      const r = await api.post<Reminder>(`/lists/${card.list_id}/cards/${card.id}/reminders`, { remind_at: iso });
      setReminders(prev => [...prev, r].sort((a, b) => a.remind_at.localeCompare(b.remind_at)));
      setRemindAt("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao criar lembrete");
    } finally {
      setAddingReminder(false);
    }
  }

  async function handleDeleteReminder(id: number) {
    try {
      await api.del(`/lists/${card.list_id}/cards/${card.id}/reminders/${id}`);
      setReminders(prev => prev.filter(r => r.id !== id));
    } catch {}
  }

  useEffect(() => {
    editingFieldRef.current = null;
    setTitle(card.title);
    setDescription(card.description ?? "");
    setLabels(card.labels);
    setMembers(card.members);
    setComments(card.comments);
    setChecklists(card.checklists ?? []);
  }, [card.id]);

  useEffect(() => { setAttachments(card.attachments ?? []); }, [card.id]);

  // Card trocou: zera a aba de atividade (busca de novo ao abrir a aba).
  useEffect(() => {
    setAbaCard("comentarios");
    setActivity([]);
    setActivityTotal(0);
    setActivityCarregado(false);
    setErroActivity(null);
  }, [card.id]);

  useEffect(() => {
    // Campos de conteudo do card aberto atualizados ao vivo. O campo que a
    // pessoa esta editando naquele instante fica intocado ate ela sair (blur).
    if (editingFieldRef.current !== "title") setTitle(card.title);
    if (editingFieldRef.current !== "description") setDescription(card.description ?? "");
    setLabels(card.labels);
    setMembers(card.members);
    setComments(card.comments);
    setChecklists(card.checklists ?? []);
    setAttachments(card.attachments ?? []);
  }, [card]);

  // load image thumbnails as blob object URLs
  const thumbUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const a of attachments) {
        if (a.is_image && !thumbs[a.id]) {
          try {
            const blob = await api.getBlob(`/lists/${card.list_id}/cards/${card.id}/attachments/${a.id}/download`);
            if (cancelled) return;
            const url = URL.createObjectURL(blob);
            thumbUrlsRef.current.push(url);
            setThumbs(prev => ({ ...prev, [a.id]: url }));
          } catch (e) {
            if (cancelled) return;
            setAttErros(prev => ({ ...prev, [a.id]: e instanceof Error ? e.message : "Falha ao carregar" }));
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [attachments, card.id, card.list_id]);

  useEffect(() => {
    return () => { thumbUrlsRef.current.forEach(URL.revokeObjectURL); };
  }, []);

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

  // Arrastar arquivo do sistema para o cartão anexa. Contador de enter/leave: o
  // dragenter dispara em cada filho, então um leave solto esconderia o overlay cedo.
  const dragDepth = useRef(0);
  // Só reage a arquivos de verdade (dataTransfer com Files), não ao drag do dnd-kit.
  const ehArrastoDeArquivo = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  function onCardDragEnter(e: React.DragEvent) {
    if (!ehArrastoDeArquivo(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setArrastando(true);
  }
  function onCardDragOver(e: React.DragEvent) {
    if (!ehArrastoDeArquivo(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
  function onCardDragLeave(e: React.DragEvent) {
    if (!ehArrastoDeArquivo(e)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) { dragDepth.current = 0; setArrastando(false); }
  }
  function onCardDrop(e: React.DragEvent) {
    if (!ehArrastoDeArquivo(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setArrastando(false);
    handleUpload(e.dataTransfer.files);
  }

  async function handleDownload(a: Attachment) {
    try {
      const blob = await api.getBlob(`/lists/${card.list_id}/cards/${card.id}/attachments/${a.id}/download`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = a.filename; link.click();
      URL.revokeObjectURL(url);
      setAttErros(prev => { const p = { ...prev }; delete p[a.id]; return p; });
    } catch (e) {
      setAttErros(prev => ({ ...prev, [a.id]: e instanceof Error ? e.message : "Falha ao baixar" }));
    }
  }

  const isPdf = (a: Attachment) =>
    a.content_type === "application/pdf" || a.filename.toLowerCase().endsWith(".pdf");

  async function handleAbrirPdf(a: Attachment) {
    setAbrindoPdf(a.id);
    try {
      const blob = await api.getBlob(`/lists/${card.list_id}/cards/${card.id}/attachments/${a.id}/download`);
      setPdfView({ url: URL.createObjectURL(blob), filename: a.filename });
      setAttErros(prev => { const p = { ...prev }; delete p[a.id]; return p; });
    } catch (e) {
      setAttErros(prev => ({ ...prev, [a.id]: e instanceof Error ? e.message : "Falha ao abrir" }));
    } finally {
      setAbrindoPdf(null);
    }
  }

  function fecharPdf() {
    setPdfView(null);
  }

  // Dono do objectURL do PDF: revoga ao trocar de anexo, ao fechar e ao desmontar o modal.
  useEffect(() => {
    if (!pdfView) return;
    const url = pdfView.url;
    return () => { URL.revokeObjectURL(url); };
  }, [pdfView]);

  // ESC fecha uma camada por vez, de cima para baixo: primeiro as sobreposicoes
  // internas (PDF, lightbox, obs); depois, se houver campo em edicao, so tira o
  // foco dele (o blur e quem salva titulo/descricao); por fim fecha o card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (pdfView) { setPdfView(null); return; }
      if (lightbox) { setLightbox(null); return; }
      if (obsOpen !== null) { setObsOpen(null); return; }
      const ativo = document.activeElement as HTMLElement | null;
      if (ativo && ["INPUT", "TEXTAREA", "SELECT"].includes(ativo.tagName)) { ativo.blur(); return; }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pdfView, lightbox, obsOpen, onClose]);

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
    return !!currentUser && (a.uploaded_by === currentUser.id || currentUser.role === "administrador" || currentUser.role === "coordenador");
  }

  function formatSize(bytes: number | null): string {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  useEffect(() => {
    if ((showMemberPicker || mencaoQuery !== null) && allUsers.length === 0) {
      // Membros do QUADRO, nao as 27 pessoas da empresa: so eles podem ser
      // atribuidos (o backend recusa o resto com 403) e so eles podem ser
      // mencionados (o backend ignora os demais).
      api.get<BoardMemberOut[]>(`/boards/${boardId}/members`).then(setAllUsers).catch(() => {});
    }
  }, [showMemberPicker, mencaoQuery, boardId]);

  async function patchCard(fields: Record<string, unknown>) {
    try {
      const updated = await api.patch<Card>(`/lists/${card.list_id}/cards/${card.id}`, fields);
      onCardUpdate({ ...updated, id: card.id });
    } catch {}
  }

  function handleTitleBlur() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === card.title) return;
    patchCard({ title: trimmed });
  }

  function handleDescriptionBlur() {
    editingFieldRef.current = null;
    const trimmed = description.trim();
    if (trimmed === (card.description ?? "")) return;
    patchCard({ description: trimmed || null });
  }

  async function handleAddComment() {
    const body = commentBody.trim();
    if (!body || submittingComment) return;
    setSubmittingComment(true);
    setErroComentario(null);
    try {
      const comment = await api.post<Comment>(`/lists/${card.list_id}/cards/${card.id}/comments`, { body });
      const updated = [...comments, comment];
      setComments(updated);
      setCommentBody("");
      setMencaoQuery(null);
      onCardUpdate({ id: card.id, comments: updated });
    } catch (e) {
      // Sem isto o envio falha em silencio: o botao volta ao normal, o texto fica na
      // caixa, e a pessoa nao sabe por que.
      setErroComentario(e instanceof ApiError ? e.message : "Não foi possível enviar o comentário.");
    } finally {
      setSubmittingComment(false);
    }
  }

  async function carregarAtividade(reset: boolean) {
    setActivityLoading(true);
    setErroActivity(null);
    try {
      const off = reset ? 0 : activity.length;
      const page = await api.get<ActivityPage>(`/lists/${card.list_id}/cards/${card.id}/activity?limit=30&offset=${off}`);
      setActivity(prev => (reset ? page.items : [...prev, ...page.items]));
      setActivityTotal(page.total);
      setActivityCarregado(true);
    } catch (e) {
      setErroActivity(e instanceof ApiError ? e.message : "Não foi possível carregar a atividade.");
    } finally {
      setActivityLoading(false);
    }
  }

  function abrirAbaAtividade() {
    setAbaCard("atividade");
    if (!activityCarregado) carregarAtividade(true);
  }

  // Cor do ponto por ação, para bater o olho no tipo de evento.
  const corAtividade = (action: string) =>
    action === "criar" ? "#22c55e" : action === "excluir" ? "#ef4444" : action === "mover" ? "#3b82f6" : "#f59e0b";

  const isElevado = currentUser?.role === "administrador" || currentUser?.role === "coordenador";
  const podeEditarComentario = (c: Comment) => !!currentUser && c.author.id === currentUser.id && !c.deleted_at;
  const podeExcluirComentario = (c: Comment) => !!currentUser && (c.author.id === currentUser.id || isElevado) && !c.deleted_at;

  function trocaComentario(atualizado: Comment) {
    setComments(prev => {
      const updated = prev.map(c => (c.id === atualizado.id ? atualizado : c));
      onCardUpdate({ id: card.id, comments: updated });
      return updated;
    });
  }

  async function handleEditComment(c: Comment) {
    const novo = editandoBody.trim();
    if (!novo) return;
    if (novo === c.body) { setEditandoId(null); return; }
    setErroEdicao(null);
    try {
      const atualizado = await api.patch<Comment>(`/lists/${card.list_id}/cards/${card.id}/comments/${c.id}`, { body: novo });
      trocaComentario(atualizado);
      setEditandoId(null);
    } catch (e) {
      setErroEdicao(e instanceof ApiError ? e.message : "Não foi possível editar o comentário.");
    }
  }

  async function handleDeleteComment(c: Comment) {
    if (!confirm("Excluir este comentário? Ele ficará marcado como excluído.")) return;
    try {
      const atualizado = await api.del<Comment>(`/lists/${card.list_id}/cards/${card.id}/comments/${c.id}`);
      trocaComentario(atualizado);
    } catch (e) {
      setErroComentario(e instanceof ApiError ? e.message : "Não foi possível excluir o comentário.");
    }
  }

  // O @ vale enquanto nao houver espaco depois dele — "@adri" abre o seletor,
  // "@adri " (com espaco) fecha. `[^\s@[\]]*` tambem impede casar dentro de um
  // token ja inserido, @[Nome](14).
  // O @ so abre o seletor no inicio do texto ou depois de um espaco: sem isso, o "@"
  // de um e-mail (fulano@empresa.com) abriria a lista, e um Enter para enviar viraria
  // uma mencao acidental no meio do endereco.
  const MENCAO_DIGITANDO = /(?:^|\s)@([^\s@[\]]*)$/;

  // O token e delimitado por ] — um nome com "]" ou quebra de linha geraria um token
  // que o backend nao reconhece, e a mencao sumiria em silencio (aparece na tela e
  // ninguem e notificado). Ver a regex em backend/app/mentions.py.
  function nomeParaToken(nome: string): string {
    return nome.replace(/[\]\n]/g, " ").slice(0, 120);
  }

  function recalcMencao(el: HTMLTextAreaElement) {
    const caret = el.selectionStart ?? el.value.length;
    const m = MENCAO_DIGITANDO.exec(el.value.slice(0, caret));
    setMencaoQuery(m ? m[1] : null);
  }

  function onChangeComentario(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setCommentBody(e.target.value);
    recalcMencao(e.target);
  }

  function inserirMencao(p: UserBasic) {
    const el = comentarioRef.current;
    const caret = el?.selectionStart ?? commentBody.length;
    const trecho = commentBody.slice(0, caret);
    if (!MENCAO_DIGITANDO.test(trecho)) { setMencaoQuery(null); return; }   // o caret saiu de perto do @
    const antes = trecho.replace(MENCAO_DIGITANDO, (m) => {
      const prefixo = m.startsWith("@") ? "" : m[0];   // o espaco (ou nada, se for inicio)
      return `${prefixo}@[${nomeParaToken(p.name)}](${p.id}) `;
    });
    const depois = commentBody.slice(caret);
    setCommentBody(antes + depois);
    setMencaoQuery(null);
    // devolve o foco e poe o cursor logo depois do token inserido
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(antes.length, antes.length);
    });
  }

  const mencaoCandidatos =
    mencaoQuery === null
      ? []
      : allUsers
          .filter(u => u.id !== currentUser?.id)   // mencionar a si mesmo nao notifica ninguem
          .filter(u => u.name.toLowerCase().includes(mencaoQuery.toLowerCase()))
          .slice(0, 6);

  async function handleToggleLabel(bl: BoardLabel) {
    const has = labels.some(l => l.id === bl.id);
    try {
      if (has) {
        await api.del(`/lists/${card.list_id}/cards/${card.id}/labels/${bl.id}`);
        const updated = labels.filter(l => l.id !== bl.id);
        setLabels(updated);
        onCardUpdate({ id: card.id, labels: updated });
      } else {
        await api.post(`/lists/${card.list_id}/cards/${card.id}/labels`, { label_id: bl.id });
        const updated = [...labels, { id: bl.id, label: bl.name, color: bl.color }];
        setLabels(updated);
        onCardUpdate({ id: card.id, labels: updated });
      }
    } catch {}
  }

  async function handleAddMember(user: UserBasic) {
    setErroMembroCard(null);
    try {
      await api.post(`/lists/${card.list_id}/cards/${card.id}/members/${user.id}`, {});
      const updated = [...members, user];
      setMembers(updated);
      onCardUpdate({ id: card.id, members: updated });
      setShowMemberPicker(false);
    } catch (e) {
      // O backend recusa quem nao e membro do quadro. Sem isto, o clique nao faz
      // nada e a pessoa nao sabe por que.
      setErroMembroCard(e instanceof ApiError ? e.message : "Não foi possível adicionar.");
    }
  }

  async function handleRemoveMember(userId: number) {
    try {
      await api.del(`/lists/${card.list_id}/cards/${card.id}/members/${userId}`);
      const updated = members.filter(m => m.id !== userId);
      setMembers(updated);
      onCardUpdate({ id: card.id, members: updated });
    } catch {}
  }

  async function handleDeleteCard() {
    setDeleting(true);
    try {
      await api.del(`/lists/${card.list_id}/cards/${card.id}`);
      onCardDelete(card.id);
      onClose();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleCopyCard() {
    if (copying) return;
    setCopying(true);
    try {
      const newCard = await api.post<Card>(`/lists/${card.list_id}/cards/${card.id}/copy`, {
        title: copyTitle.trim() || card.title,
        target_list_id: copyListId,
      });
      onCardCopy(newCard);
      setShowCopyForm(false);
    } catch {} finally {
      setCopying(false);
    }
  }

  async function handleAddChecklist() {
    const title = newChecklistTitle.trim();
    if (!title) return;
    try {
      const cl = await api.post<Checklist>(`/lists/${card.list_id}/cards/${card.id}/checklists`, { title });
      const updated = [...checklists, cl];
      setChecklists(updated);
      onCardUpdate({ id: card.id, checklists: updated });
      setNewChecklistTitle("");
      setAddingChecklist(false);
    } catch {}
  }

  async function handleDeleteChecklist(clId: number) {
    try {
      await api.del(`/lists/${card.list_id}/cards/${card.id}/checklists/${clId}`);
      const updated = checklists.filter(c => c.id !== clId);
      setChecklists(updated);
      onCardUpdate({ id: card.id, checklists: updated });
    } catch {}
  }

  async function handleAddItem(clId: number) {
    const text = newItemText.trim();
    if (!text) return;
    try {
      const item = await api.post<ChecklistItem>(`/lists/${card.list_id}/cards/${card.id}/checklists/${clId}/items`, { text });
      const updated = checklists.map(cl => cl.id === clId ? { ...cl, items: [...cl.items, item] } : cl);
      setChecklists(updated);
      onCardUpdate({ id: card.id, checklists: updated });
      setNewItemText("");
      setAddingItemId(null);
    } catch {}
  }

  async function handleToggleItem(clId: number, item: ChecklistItem) {
    try {
      const updatedItem = await api.patch<ChecklistItem>(`/lists/${card.list_id}/cards/${card.id}/checklists/${clId}/items/${item.id}`, { checked: !item.checked });
      const updated = checklists.map(cl => cl.id === clId ? { ...cl, items: cl.items.map(i => i.id === item.id ? updatedItem : i) } : cl);
      setChecklists(updated);
      onCardUpdate({ id: card.id, checklists: updated });
    } catch {}
  }

  async function handleDeleteItem(clId: number, itemId: number) {
    try {
      await api.del(`/lists/${card.list_id}/cards/${card.id}/checklists/${clId}/items/${itemId}`);
      const updated = checklists.map(cl => cl.id === clId ? { ...cl, items: cl.items.filter(i => i.id !== itemId) } : cl);
      setChecklists(updated);
      onCardUpdate({ id: card.id, checklists: updated });
    } catch {}
  }

  const PRIO_BTNS: { value: Priority; label: string; dot: string }[] = [
    { value: "low",      label: "Baixo",   dot: "#475569" },
    { value: "medium",   label: "Médio",   dot: "#818cf8" },
    { value: "high",     label: "Alto",    dot: "#f59e0b" },
    { value: "critical", label: "Crítico", dot: "#ef4444" },
  ];

  const dueDateOverdue = card.due_date && isOverdue(card.due_date);
  const availableUsers = allUsers.filter(u => !members.some(m => m.id === u.id));

  return (
    <div
      // z-[60] (acima dos painéis z-50, ex.: Arquivados): assim o card abre POR
      // CIMA do painel de arquivados e, ao fechar, volta pra ele — sem precisar
      // fechar o painel. Os overlays internos (lightbox/pdf) são descendentes e
      // seguem stackando acima deste.
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-8"
      /* Clicar fora NÃO fecha (evita perder trabalho por clique acidental) — só o X ou Esc. */
    >
      <div
        className="relative w-full max-w-[900px] rounded-2xl bg-background-surface border border-border shadow-2xl mb-12 overflow-hidden flex flex-col"
        onDragEnter={onCardDragEnter}
        onDragOver={onCardDragOver}
        onDragLeave={onCardDragLeave}
        onDrop={onCardDrop}
      >
        {arrastando && (
          <div className="absolute inset-0 z-[70] flex items-center justify-center bg-primary/20 backdrop-blur-sm border-2 border-dashed border-primary rounded-2xl pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-primary">
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.9A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              <p className="text-sm font-semibold">Solte para anexar ao cartão</p>
            </div>
          </div>
        )}
        {/* Card arquivado (chegou aqui pela busca global, que os inclui): sem
            este aviso, a pessoa edita um card que não aparece no quadro e não
            entende por quê. */}
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
        {/* Priority color bar */}
        <div className="h-1.5 shrink-0" style={{ backgroundColor: PRIORITY[card.priority].dot }} />

        {/* Header */}
        <div className="flex items-start gap-3 px-6 pt-4 pb-4 border-b border-border shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 mb-1.5">
              em lista <span className="font-semibold text-slate-400">{listTitle}</span>
            </p>
            <textarea
              value={title}
              onChange={e => setTitle(e.target.value)}
              onFocus={() => (editingFieldRef.current = "title")}
              onBlur={() => { editingFieldRef.current = null; handleTitleBlur(); }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleTitleBlur(); } }}
              rows={2}
              className="w-full text-xl font-bold text-slate-100 bg-transparent resize-none focus:outline-none leading-snug"
            />
            {/* Metadados do card: criação (data e autor) e, se arquivado, quem
                arquivou. Autor/arquivador vêm do endpoint /meta (derivado do log). */}
            <p className="text-[11px] text-slate-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span>Criado em {new Date(card.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              {cardMeta?.created_by && <span className="text-slate-600">·</span>}
              {cardMeta?.created_by && <span>por <span className="text-slate-400 font-medium">{cardMeta.created_by_type === "integracao" ? "Integração (gestor)" : cardMeta.created_by}</span></span>}
              {card.archived && cardMeta?.archived_by && <span className="text-slate-600">·</span>}
              {card.archived && cardMeta?.archived_by && (
                <span>arquivado por <span className="text-slate-400 font-medium">{cardMeta.archived_by}</span>{cardMeta.archived_at && ` em ${new Date(cardMeta.archived_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}`}</span>
              )}
            </p>
            {/* Concluído PESSOAL: marcação privada, só o próprio usuário vê. */}
            <button
              onClick={onToggleDone}
              title="Marcação pessoal — ninguém mais vê"
              className={cn(
                "mt-2.5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                isDone ? "bg-primary/15 border-primary/40 text-primary" : "border-border text-slate-400 hover:text-slate-200 hover:border-slate-500",
              )}
            >
              <span className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0", isDone ? "bg-primary border-primary" : "border-slate-500")}>
                {isDone && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
              </span>
              {isDone ? "Concluído (só você vê)" : "Marcar como concluído"}
            </button>
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-background-elevated transition-colors mt-1">
            <IX />
          </button>
        </div>

        {/* Two-column body */}
        <div className="flex min-h-0">

          {/* LEFT: main content */}
          <div className="flex-1 min-w-0 p-6 space-y-6 overflow-y-auto max-h-[75vh]">

            {/* Priority + Due date */}
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Prioridade</p>
                <div className="flex gap-1.5 flex-wrap">
                  {PRIO_BTNS.map(pb => (
                    <button
                      key={pb.value}
                      onClick={() => patchCard({ priority: pb.value })}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all",
                        card.priority === pb.value ? "border-current" : "border-transparent opacity-40 hover:opacity-70 bg-background-elevated text-slate-400"
                      )}
                      style={card.priority === pb.value ? { color: pb.dot, backgroundColor: `${pb.dot}18` } : {}}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pb.dot }} />
                      {pb.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Data de entrega</p>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    defaultValue={card.due_date ?? ""}
                    onChange={e => patchCard({ due_date: e.target.value || null, due_date_completed: false })}
                    className={cn(
                      "text-sm rounded-lg border px-3 py-1.5 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors text-slate-200",
                      card.due_date_completed ? "border-primary/60 text-primary" : dueDateOverdue ? "border-red-400 text-red-400" : "border-border"
                    )}
                  />
                  {card.due_date && (
                    <button
                      onClick={() => patchCard({ due_date_completed: !card.due_date_completed })}
                      title={card.due_date_completed ? "Marcar como pendente" : "Marcar como concluído"}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all",
                        card.due_date_completed
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-slate-400 hover:border-primary/50 hover:text-primary"
                      )}
                    >
                      <ICheck />
                      {card.due_date_completed ? "Concluído" : "Concluir"}
                    </button>
                  )}
                </div>
              </div>
            </div>

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

            {/* Description */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h10" />
                </svg>
                <p className="text-sm font-semibold text-slate-300">Descrição</p>
              </div>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                onFocus={() => (editingFieldRef.current = "description")}
                onBlur={handleDescriptionBlur}
                rows={4}
                placeholder="Adicionar uma descrição mais detalhada…"
                className="w-full text-sm text-slate-200 bg-background-elevated border border-border rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-slate-500 leading-relaxed"
              />
            </div>

            {/* Members */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                <p className="text-sm font-semibold text-slate-300">Membros</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {members.map(m => (
                  <div key={m.id} className="flex items-center gap-1.5 pl-1 pr-1 py-1 rounded-full bg-background-elevated border border-border">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-bold text-white leading-none">{m.initials}</span>
                    </div>
                    <span className="text-xs text-slate-300 pr-0.5">{m.name}</span>
                    <button onClick={() => handleRemoveMember(m.id)} className="w-4 h-4 rounded-full flex items-center justify-center text-slate-500 hover:text-red-400 transition-colors">
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
                <div className="relative">
                  <button onClick={() => { setErroMembroCard(null); setShowMemberPicker(p => !p); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border-2 border-dashed border-border text-slate-500 hover:border-primary hover:text-primary transition-colors text-xs">
                    <IUserPlus /><span>Adicionar</span>
                  </button>
                  {showMemberPicker && (
                    <div className="absolute top-full left-0 mt-1 z-20 w-52 rounded-xl bg-background-surface border border-border shadow-xl overflow-hidden">
                      {erroMembroCard && (
                        <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2">{erroMembroCard}</p>
                      )}
                      {availableUsers.length === 0 ? (
                        <p className="text-xs text-slate-500 p-3 text-center">{allUsers.length === 0 ? "Carregando…" : "Todos já adicionados"}</p>
                      ) : availableUsers.map(u => (
                        <button key={u.id} onClick={() => handleAddMember(u)} className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-background-elevated transition-colors text-left">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-bold text-white leading-none">{u.initials}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-200 truncate">{u.name}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Labels */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ITag />
                  <p className="text-sm font-semibold text-slate-300">Etiquetas</p>
                </div>
                <button onClick={() => setShowLabelPicker(p => !p)} className="text-xs text-slate-500 hover:text-primary transition-colors">
                  {showLabelPicker ? "Fechar" : "Editar"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {labels.map(l => (
                  <span key={l.id} className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: `${l.color}25`, color: l.color }}>
                    {l.label}
                  </span>
                ))}
                {labels.length === 0 && !showLabelPicker && (
                  <button onClick={() => setShowLabelPicker(true)} className="text-xs text-slate-500 hover:text-primary transition-colors">Nenhuma etiqueta</button>
                )}
              </div>
              {showLabelPicker && (
                <div className="mt-2 p-2 rounded-lg border border-border bg-background-elevated space-y-1">
                  {boardLabels.length === 0 && (
                    <p className="text-xs text-slate-500 italic text-center py-2">Nenhuma etiqueta cadastrada no board.</p>
                  )}
                  {boardLabels.map(bl => {
                    const active = labels.some(l => l.id === bl.id);
                    return (
                      <button
                        key={bl.id}
                        onClick={() => handleToggleLabel(bl)}
                        className={cn("w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-colors text-left", active ? "bg-background" : "hover:bg-background")}
                      >
                        <span className="w-3 h-3 rounded-full shrink-0 flex items-center justify-center border-2" style={{ borderColor: bl.color, backgroundColor: active ? bl.color : "transparent" }}>
                          {active && <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                        </span>
                        <span className="text-xs font-medium text-slate-200">{bl.name}</span>
                        <span className="ml-auto w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: bl.color }} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Checklists */}
            {checklists.map(cl => {
              const total = cl.items.length;
              const done = cl.items.filter(i => i.checked).length;
              const pct = total === 0 ? 0 : Math.round((done / total) * 100);
              return (
                <div key={cl.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    <p className="text-sm font-semibold text-slate-300 flex-1">{cl.title}</p>
                    <button onClick={() => handleDeleteChecklist(cl.id)} className="text-xs text-slate-500 hover:text-red-400 transition-colors px-2 py-0.5 rounded hover:bg-red-500/10">
                      Excluir
                    </button>
                  </div>

                  {/* Progress bar */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs text-slate-500 w-8 text-right shrink-0">{pct}%</span>
                    <div className="flex-1 h-2 bg-background-elevated rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${pct}%`, backgroundColor: pct === 100 ? "#10b981" : "#818cf8" }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 shrink-0">{done}/{total}</span>
                  </div>

                  {/* Items */}
                  <div className="space-y-1 mb-2">
                    {cl.items.map(item => (
                      <div
                        key={item.id}
                        onClick={() => handleToggleItem(cl.id, item)}
                        className="flex items-center gap-2.5 group/item px-1 py-1 rounded-lg hover:bg-background-elevated transition-colors cursor-pointer"
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-all pointer-events-none",
                          item.checked ? "bg-primary border-primary" : "border-border"
                        )}>
                          {item.checked && <ICheck />}
                        </div>
                        <span className={cn("text-sm flex-1 leading-snug select-none", item.checked ? "line-through text-slate-500" : "text-slate-200")}>
                          {item.text}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteItem(cl.id, item.id); }}
                          className="opacity-0 group-hover/item:opacity-100 w-5 h-5 flex items-center justify-center text-slate-500 hover:text-red-400 transition-all shrink-0"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add item */}
                  {addingItemId === cl.id ? (
                    <div className="flex gap-2 items-center ml-6">
                      <input
                        autoFocus
                        value={newItemText}
                        onChange={e => setNewItemText(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddItem(cl.id); } if (e.key === "Escape") { setAddingItemId(null); setNewItemText(""); } }}
                        placeholder="Adicionar item…"
                        className="flex-1 text-sm bg-background-elevated border border-border rounded-lg px-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                      <button onClick={() => handleAddItem(cl.id)} className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"><ICheck /></button>
                      <button onClick={() => { setAddingItemId(null); setNewItemText(""); }} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"><IX /></button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingItemId(cl.id)}
                      className="ml-6 text-xs text-slate-500 hover:text-primary transition-colors flex items-center gap-1"
                    >
                      <IPlus /><span>Adicionar item</span>
                    </button>
                  )}
                </div>
              );
            })}

            {/* Anexos */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  <p className="text-sm font-semibold text-slate-300">Anexos {attachments.length > 0 && <span className="font-normal text-slate-500">({attachments.length})</span>}</p>
                </div>
                <button onClick={() => fileRef.current?.click()} disabled={uploading} title="Ou arraste um arquivo para o cartão" className="text-xs text-slate-500 hover:text-primary transition-colors disabled:opacity-50">
                  {uploading ? "Enviando…" : "+ Adicionar"}
                </button>
              </div>
              <input
                ref={fileRef} type="file" multiple hidden
                accept=".pdf,.doc,.docx,.xls,.xlsx,.xml,image/jpeg,image/png,image/gif,image/webp,application/pdf,text/xml,application/xml"
                onChange={e => handleUpload(e.target.files)}
              />
              {attachments.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Nenhum anexo.</p>
              ) : (
                <div className="grid grid-cols-1 gap-1.5">
                  {attachments.map(a => (
                    <div key={a.id} className={cn(
                      "flex items-center gap-2.5 p-2 rounded-lg bg-background-elevated border group/att",
                      attErros[a.id] ? "border-red-500/50 bg-red-500/5" : "border-border",
                    )}>
                      {a.is_image && thumbs[a.id] ? (
                        <img src={thumbs[a.id]} alt={a.filename} onClick={() => setLightbox(thumbs[a.id])} className="w-10 h-10 rounded object-cover cursor-pointer shrink-0" />
                      ) : attErros[a.id] ? (
                        <div className="w-10 h-10 rounded bg-red-500/10 flex items-center justify-center shrink-0 text-red-400" title="Arquivo indisponível">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded bg-background flex items-center justify-center shrink-0 text-slate-400">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-200 truncate">{a.filename}</p>
                        {attErros[a.id] ? (
                          <p className="text-[10px] text-red-400 truncate" title={attErros[a.id]}>{attErros[a.id]}</p>
                        ) : (
                          <p className="text-[10px] text-slate-500">{formatSize(a.size)}</p>
                        )}
                      </div>
                      {isPdf(a) && (
                        <button onClick={() => handleAbrirPdf(a)} disabled={abrindoPdf === a.id} title="Visualizar" className="p-1.5 rounded text-slate-500 hover:text-primary hover:bg-background transition-colors disabled:opacity-50">
                          {abrindoPdf === a.id ? (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                          )}
                        </button>
                      )}
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

            {/* Lembretes */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-semibold text-slate-300">Meus lembretes {reminders.length > 0 && <span className="font-normal text-slate-500">({reminders.length})</span>}</p>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="datetime-local"
                  value={remindAt}
                  onChange={e => setRemindAt(e.target.value)}
                  className="text-sm rounded-lg border border-border px-3 py-1.5 bg-transparent text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  onClick={handleAddReminder}
                  disabled={!remindAt || addingReminder}
                  className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-600 disabled:opacity-40 transition-all"
                >
                  {addingReminder ? "…" : "Adicionar"}
                </button>
              </div>
              {reminders.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Nenhum lembrete pessoal.</p>
              ) : (
                <div className="space-y-1">
                  {reminders.map(r => (
                    <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg bg-background-elevated border border-border">
                      <span className="text-xs text-slate-200 flex-1">
                        {new Date(r.remind_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        {r.fired && <span className="ml-2 text-[10px] text-slate-500">(enviado)</span>}
                      </span>
                      <button onClick={() => handleDeleteReminder(r.id)} title="Excluir" className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add checklist */}
            {addingChecklist ? (
              <div className="flex gap-2 items-center p-3 rounded-xl border border-border bg-background-elevated">
                <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <input
                  autoFocus
                  value={newChecklistTitle}
                  onChange={e => setNewChecklistTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddChecklist(); } if (e.key === "Escape") { setAddingChecklist(false); setNewChecklistTitle(""); } }}
                  placeholder="Título do checklist…"
                  className="flex-1 text-sm bg-transparent focus:outline-none text-slate-200 placeholder-slate-500"
                />
                <button onClick={handleAddChecklist} className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"><ICheck /></button>
                <button onClick={() => { setAddingChecklist(false); setNewChecklistTitle(""); }} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"><IX /></button>
              </div>
            ) : (
              <button
                onClick={() => setAddingChecklist(true)}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-primary transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <span>Adicionar checklist</span>
              </button>
            )}

            {/* Archive */}
            <div className="pt-2">
              <button
                onClick={async () => {
                  try {
                    await api.post(`/lists/${card.list_id}/cards/${card.id}/archive`, {});
                    onCardDelete(card.id);
                    onClose();
                  } catch {}
                }}
                className="flex items-center gap-2 text-xs text-slate-500 hover:text-amber-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                <span>Arquivar card</span>
              </button>
            </div>

            {/* Copy */}
            <div className="pt-2">
              {showCopyForm ? (
                <div className="flex flex-col gap-2 p-3 rounded-lg bg-background-elevated border border-border">
                  <p className="text-xs font-semibold text-slate-300">Copiar card</p>
                  <input
                    value={copyTitle}
                    onChange={e => setCopyTitle(e.target.value)}
                    placeholder={card.title}
                    className="text-xs bg-background rounded-md border border-border px-2 py-1.5 text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <select
                    value={copyListId}
                    onChange={e => setCopyListId(Number(e.target.value))}
                    className="text-xs bg-background rounded-md border border-border px-2 py-1.5 text-slate-200 focus:outline-none"
                  >
                    {lists.map(l => (
                      <option key={l.id} value={l.id}>{l.title}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={handleCopyCard} disabled={copying} className="flex-1 text-xs py-1.5 rounded-md bg-primary text-white hover:bg-primary-600 disabled:opacity-50 transition-colors font-semibold">
                      {copying ? "Copiando…" : "Copiar"}
                    </button>
                    <button onClick={() => setShowCopyForm(false)} className="text-xs px-3 py-1.5 rounded-md border border-border text-slate-400 hover:bg-background transition-colors">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setCopyTitle(card.title); setCopyListId(card.list_id); setShowCopyForm(true); }}
                  className="flex items-center gap-2 text-xs text-slate-500 hover:text-primary transition-colors"
                >
                  <ICopy /><span>Copiar card</span>
                </button>
              )}
            </div>

            {/* Delete */}
            <div className="pt-2 border-t border-border">
              {confirmDelete ? (
                <div className="flex items-center gap-3">
                  <p className="text-xs text-slate-500 flex-1">Tem certeza? Esta ação não pode ser desfeita.</p>
                  <button onClick={() => setConfirmDelete(false)} className="text-xs px-3 py-1.5 rounded-lg border border-border text-slate-400 hover:bg-background-elevated transition-colors">Cancelar</button>
                  <button onClick={handleDeleteCard} disabled={deleting} className="text-xs px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors font-semibold">
                    {deleting ? "Excluindo…" : "Confirmar"}
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-2 text-xs text-slate-500 hover:text-red-400 transition-colors">
                  <ITrash /><span>Excluir card</span>
                </button>
              )}
            </div>
          </div>

          {/* RIGHT: activity & comments */}
          <div className="w-[300px] shrink-0 border-l border-border bg-background-elevated/20 flex flex-col p-5 max-h-[75vh]">
            <div className="flex items-center gap-1 mb-4 shrink-0 border-b border-border">
              <button
                onClick={() => setAbaCard("comentarios")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors",
                  abaCard === "comentarios" ? "border-primary text-slate-200" : "border-transparent text-slate-500 hover:text-slate-300",
                )}
              >
                <IChat />
                Comentários
                {comments.length > 0 && <span className="font-normal text-slate-500">({comments.length})</span>}
              </button>
              <button
                onClick={abrirAbaAtividade}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors",
                  abaCard === "atividade" ? "border-primary text-slate-200" : "border-transparent text-slate-500 hover:text-slate-300",
                )}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Atividade
              </button>
            </div>

            {abaCard === "comentarios" && <>
            {/* Comment input */}
            <div className="shrink-0 mb-4 relative">
              <textarea
                ref={comentarioRef}
                value={commentBody}
                onChange={onChangeComentario}
                onSelect={e => recalcMencao(e.currentTarget)}
                onKeyDown={e => {
                  // Enquanto o seletor de mencao esta aberto, Esc fecha e Enter
                  // escolhe o primeiro — sem isso o Enter enviaria o comentario
                  // no meio da escolha.
                  if (mencaoQuery !== null && mencaoCandidatos.length > 0) {
                    if (e.key === "Escape") { e.preventDefault(); setMencaoQuery(null); return; }
                    // Shift+Enter e quebra de linha, sempre — nao rouba pro seletor.
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); inserirMencao(mencaoCandidatos[0]); return; }
                  }
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); }
                }}
                placeholder="Escrever um comentário…  (@ para marcar alguém)"
                rows={3}
                maxLength={20000}
                className="w-full text-sm text-slate-200 bg-background-elevated border border-border rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-slate-500 leading-relaxed"
              />
              {erroComentario && (
                <p className="mt-1.5 text-xs text-red-400 bg-red-500/10 rounded-lg px-2.5 py-1.5">{erroComentario}</p>
              )}
              {mencaoQuery !== null && mencaoCandidatos.length > 0 && (
                <div className="absolute bottom-full left-0 mb-1 z-20 w-56 rounded-xl bg-background-surface border border-border shadow-xl overflow-hidden">
                  {mencaoCandidatos.map(u => (
                    <button
                      key={u.id}
                      onClick={() => inserirMencao(u)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-background-elevated transition-colors text-left"
                    >
                      <div className="w-6 h-6 rounded-full bg-background-elevated border border-border flex items-center justify-center text-[9px] font-bold text-slate-300 shrink-0">
                        {u.initials}
                      </div>
                      <span className="text-xs text-slate-200 truncate">{u.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {commentBody.trim() && (
                <button
                  onClick={handleAddComment}
                  disabled={submittingComment}
                  className="mt-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-600 disabled:opacity-40 transition-all"
                >
                  {submittingComment ? "Enviando…" : "Enviar"}
                </button>
              )}
            </div>

            {/* Comments list */}
            <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
              {comments.length === 0 && (
                <p className="text-xs text-slate-500 italic text-center pt-4">Nenhum comentário ainda.</p>
              )}
              {/* Mais recente em cima, mais antigo embaixo. Ordena EXPLÍCITO por
                  data (não confia no .reverse() da ordem do banco, que não tem
                  order_by garantido). */}
              {[...comments].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map(c => (
                <div key={c.id} className="flex gap-2.5 group/coment">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[9px] font-bold text-white leading-none">{c.author.initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-200">{c.author.name}</span>
                      <span className="text-[10px] text-slate-500 truncate">{new Date(c.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                      {!c.deleted_at && c.edited_at && (
                        <button
                          onClick={() => setOriginaisAbertos(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors shrink-0"
                          title={originaisAbertos.has(c.id) ? "Ocultar versão original" : "Ver versão original"}
                        >
                          (editado)
                        </button>
                      )}
                      {editandoId !== c.id && (
                        <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/coment:opacity-100 transition-opacity">
                          {podeEditarComentario(c) && (
                            <button onClick={() => { setEditandoId(c.id); setEditandoBody(c.body); setErroEdicao(null); }} title="Editar" className="p-1 rounded text-slate-500 hover:text-primary hover:bg-background-elevated transition-colors">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                          )}
                          {podeExcluirComentario(c) && (
                            <button onClick={() => handleDeleteComment(c)} title="Excluir" className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                    {c.deleted_at ? (
                      <p className="text-xs text-slate-500 italic bg-background-elevated/50 rounded-lg px-2.5 py-2">Comentário excluído</p>
                    ) : editandoId === c.id ? (
                      <div className="space-y-1.5">
                        <textarea
                          value={editandoBody}
                          onChange={e => setEditandoBody(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditComment(c); } if (e.key === "Escape") setEditandoId(null); }}
                          rows={3}
                          autoFocus
                          className="w-full text-xs text-slate-200 leading-relaxed bg-background-elevated rounded-lg px-2.5 py-2 border border-border focus:border-primary focus:outline-none resize-y"
                        />
                        {erroEdicao && <p className="text-[11px] text-red-400">{erroEdicao}</p>}
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleEditComment(c)} className="text-[11px] font-medium px-2.5 py-1 rounded bg-primary text-white hover:bg-primary-600 transition-colors">Salvar</button>
                          <button onClick={() => setEditandoId(null)} className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors">Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap bg-background-elevated rounded-lg px-2.5 py-2"><CorpoComentario texto={c.body} /></p>
                        {c.edited_at && originaisAbertos.has(c.id) && c.original_body != null && (
                          <div className="mt-1 border-l-2 border-border pl-2">
                            <p className="text-[10px] text-slate-500 mb-0.5">Versão original:</p>
                            <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap"><CorpoComentario texto={c.original_body} /></p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            </>}

            {abaCard === "atividade" && (
              <div className="flex-1 overflow-y-auto min-h-0">
                {erroActivity && (
                  <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-2.5 py-1.5 mb-3">{erroActivity}</p>
                )}
                {!activityCarregado && activityLoading && (
                  <p className="text-xs text-slate-500 italic text-center pt-4">Carregando…</p>
                )}
                {activityCarregado && activity.length === 0 && (
                  <p className="text-xs text-slate-500 italic text-center pt-4">Nenhuma atividade registrada.</p>
                )}
                <div className="space-y-3">
                  {activity.map(a => (
                    <div key={a.id} className="flex gap-2.5">
                      <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: corAtividade(a.action) }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-300 leading-relaxed break-words">
                          <span className="font-semibold text-slate-200">{a.actor_name}</span> {a.summary}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{new Date(a.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {activity.length < activityTotal && (
                  <button
                    onClick={() => carregarAtividade(false)}
                    disabled={activityLoading}
                    className="mt-3 w-full text-xs text-slate-400 hover:text-primary border border-border rounded-lg py-1.5 transition-colors disabled:opacity-50"
                  >
                    {activityLoading ? "Carregando…" : `Ver mais (${activityTotal - activity.length} restantes)`}
                  </button>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-8" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-lg shadow-2xl" />
        </div>
      )}
      {pdfView && (
        <div className="fixed inset-0 z-[60] flex flex-col p-4 md:p-8" onClick={fecharPdf}>
          <div className="absolute inset-0 bg-black/80" />
          <div className="relative flex flex-col w-full h-full max-w-5xl mx-auto bg-background-surface border border-border rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
              <p className="text-sm font-medium text-slate-200 truncate flex-1">{pdfView.filename}</p>
              <a href={pdfView.url} download={pdfView.filename} title="Baixar" className="p-1.5 rounded text-slate-400 hover:text-primary hover:bg-background transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              </a>
              <button onClick={fecharPdf} title="Fechar" className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-background transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {/* pdf.js com camada de texto: seleção/cópia funcionam em qualquer navegador. */}
            {/* Boundary aqui dentro: se o visualizador não carregar, quebra só
                este painel — o quadro atrás continua de pé. */}
            <ErrorBoundary area="visualizador de PDF" variante="painel">
              <Suspense fallback={<div className="flex-1 flex items-center justify-center text-slate-400 text-sm" style={{ background: "#525659" }}>Carregando PDF…</div>}>
                <PdfViewer url={pdfView.url} />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      )}
      {obsOpen !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setObsOpen(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-background-surface border border-border rounded-xl shadow-2xl w-full max-w-md max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h3 className="text-sm font-semibold text-slate-200">{obsLabels[obsOpen]}</h3>
              <button onClick={() => setObsOpen(null)} className="p-1 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-background-elevated transition-colors"><IX /></button>
            </div>
            <div className="p-4 overflow-y-auto text-sm text-slate-200 whitespace-pre-wrap leading-relaxed break-words">
              <ObsTexto texto={obsValues[obsOpen] ?? ""} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CardContent ────────────────────────────────────────────────

function CardContentBase({ card, isDragging = false, isDone = false, onToggleDone }: { card: Card; isDragging?: boolean; isDone?: boolean; onToggleDone?: () => void }) {
  const p = PRIORITY[card.priority];
  const due = card.due_date;
  const overdue = due && isOverdue(due);
  const dueToday = due && isToday(due);

  return (
    <div className={cn(
      "w-full text-left rounded-lg border border-border/60 border-l-4 p-3 transition-all duration-150",
      "bg-background-surface",
      isDragging ? "opacity-95" : "hover:border-border hover:shadow-md hover:shadow-black/20",
      p.border,
    )}>
      {/* Labels row */}
      {card.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {card.labels.slice(0, 3).map(l => (
            <span key={l.id} className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${l.color}25`, color: l.color }}>
              {l.label}
            </span>
          ))}
        </div>
      )}

      {/* Title — com a bolinha de "concluído" PESSOAL à esquerda. É <span> (não
          <button>) porque o card inteiro já é um <button>: nested button é HTML
          inválido. stopPropagation impede que marcar abra o card. */}
      <div className="flex items-start gap-1.5 mb-1.5">
        {onToggleDone && (
          <span
            role="button"
            tabIndex={-1}
            onClick={e => { e.stopPropagation(); e.preventDefault(); onToggleDone(); }}
            title={isDone ? "Concluído (só você vê) — clique para desmarcar" : "Marcar como concluído (só você vê)"}
            className={cn(
              "mt-0.5 shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all",
              // Sempre visível com borda verde (não some quando o mouse sai);
              // no hover fica mais forte com um leve preenchimento.
              isDone ? "bg-primary border-primary" : "border-primary/60 hover:border-primary hover:bg-primary/15",
            )}
          >
            {isDone && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
          </span>
        )}
        <p className="text-sm font-medium text-slate-100 line-clamp-2 leading-snug">
          {card.title}
        </p>
      </div>

      {/* Description */}
      {card.description && (
        <p className="text-xs text-slate-500 mb-2 leading-relaxed line-clamp-2">{card.description}</p>
      )}

      {/* Checklist progress */}
      {card.checklists?.length > 0 && (() => {
        const total = card.checklists.reduce((s, cl) => s + cl.items.length, 0);
        const done = card.checklists.reduce((s, cl) => s + cl.items.filter(i => i.checked).length, 0);
        const pct = total === 0 ? 0 : Math.round((done / total) * 100);
        return (
          <div className="flex items-center gap-1.5 mb-2">
            <span className={cn("text-[10px] font-medium w-7 text-right shrink-0", pct === 100 ? "text-primary" : "text-slate-500")}>{pct}%</span>
            <div className="flex-1 h-1.5 bg-background-elevated rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: pct === 100 ? "#10b981" : "#818cf8" }} />
            </div>
            <span className="text-[10px] text-slate-500 shrink-0">{done}/{total}</span>
          </div>
        );
      })()}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 mt-2">
        <div className="flex items-center gap-2">
          {due && (
            <span className={cn(
              "flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded",
              card.due_date_completed
                ? "bg-primary/15 text-primary"
                : overdue ? "bg-red-500/15 text-red-400"
                : dueToday ? "bg-warning/15 text-warning"
                : "text-slate-500"
            )}>
              {card.due_date_completed ? <ICheck /> : <ICal />}
              {new Date(due + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
            </span>
          )}
          {card.comments.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-slate-500"><IChat />{card.comments.length}</span>
          )}
          {card.attachments.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
              {card.attachments.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.dot }} title={p.label} />
          {card.members[0] && (
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shrink-0">
              <span className="text-[8px] font-bold text-white leading-none">{card.members[0].initials}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const CardContent = memo(CardContentBase);

// ── KanbanCard ─────────────────────────────────────────────────

function KanbanCardBase({ card, onCardClick, isDone, listId, onToggleDone }: { card: Card; onCardClick: (card: Card) => void; isDone: boolean; listId: number; onToggleDone: (cardId: number, listId: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("relative group/card", isDragging && "opacity-40")}>
      <div
        {...attributes} {...listeners}
        data-dnd-draggable
        className="absolute top-1.5 right-1.5 z-10 p-1 rounded-md text-slate-500 opacity-0 group-hover/card:opacity-100 hover:bg-background-elevated hover:text-slate-200 cursor-grab active:cursor-grabbing touch-none transition-opacity"
        title="Arrastar para mover"
      >
        <IGrip />
      </div>
      {/* data-pan-surface: arrastar em cima do card panora o quadro (o grip acima é quem move o card) */}
      <button type="button" data-pan-surface className="w-full text-left" onClick={() => onCardClick(card)}>
        <CardContent card={card} isDone={isDone} onToggleDone={() => onToggleDone(card.id, listId)} />
      </button>
    </div>
  );
}

const KanbanCard = memo(KanbanCardBase);

// ── DroppableColumn ────────────────────────────────────────────

function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn("flex-1 overflow-y-auto p-2 space-y-2 min-h-[60px] rounded-lg transition-colors duration-150", isOver && "bg-primary/5")}>
      {children}
    </div>
  );
}

// ── AddCardForm ────────────────────────────────────────────────

function AddCardForm({ listId, onAdded, onCancel }: { listId: number; onAdded: (card: Card) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      const card = await api.post<Card>(`/lists/${listId}/cards`, { title: title.trim(), priority });
      onAdded(card);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg bg-background-surface border border-primary/30 shadow-sm p-2.5 space-y-2 mx-2 mb-2">
      <textarea
        ref={ref} value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent); } if (e.key === "Escape") onCancel(); }}
        placeholder="Título do card…" rows={2}
        className="w-full text-sm text-slate-100 bg-transparent resize-none focus:outline-none placeholder-slate-500 leading-snug"
      />
      <div className="flex items-center gap-1.5">
        {(["low", "medium", "high", "critical"] as Priority[]).map(p => (
          <button key={p} type="button" onClick={() => setPriority(p)} className={cn("w-2.5 h-2.5 rounded-full border-2 transition-transform", priority === p ? "scale-125 border-white/60" : "opacity-40")} style={{ backgroundColor: PRIORITY[p].dot }} title={PRIORITY[p].label} />
        ))}
        <div className="flex-1" />
        <button type="button" onClick={onCancel} className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors"><IX /></button>
        <button type="submit" disabled={loading || !title.trim()} className="p-1 rounded text-primary hover:text-primary-400 disabled:opacity-40 transition-colors"><ICheck /></button>
      </div>
    </form>
  );
}

// ── AddListForm ────────────────────────────────────────────────

function AddListForm({ boardId, position, onAdded, onCancel }: { boardId: number; position: number; onAdded: (l: BoardList) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      const list = await api.post<BoardList>(`/boards/${boardId}/lists`, { title: title.trim(), position });
      onAdded(list);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-[272px] shrink-0 rounded-xl bg-background-surface/90 backdrop-blur-sm border border-border shadow-sm p-3 self-start space-y-2">
      <input
        ref={ref} value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => e.key === "Escape" && onCancel()}
        placeholder="Nome da lista…"
        className="w-full text-sm font-medium text-slate-100 bg-transparent focus:outline-none placeholder-slate-500"
      />
      <div className="flex gap-1.5">
        <button type="button" onClick={onCancel} className="flex-1 py-1.5 rounded-lg border border-border text-xs font-medium text-slate-400 hover:bg-background-elevated transition-colors">Cancelar</button>
        <button type="submit" disabled={loading || !title.trim()} className="flex-1 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-600 disabled:opacity-50 transition-all">{loading ? "…" : "Criar"}</button>
      </div>
    </form>
  );
}

// ── KanbanColumn ───────────────────────────────────────────────

function KanbanColumn({ list, cards, isElevated, myDone, onToggleDone, canMoveLeft, canMoveRight, onMoveList, onCardAdded, onCardClick, onListUpdate, onListDelete }: {
  list: BoardList;
  cards: Card[];
  isElevated: boolean;
  myDone: Set<number>;
  onToggleDone: (cardId: number, listId: number) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMoveList: (dir: "left" | "right") => void;
  onCardAdded: (c: Card) => void;
  onCardClick: (card: Card) => void;
  onListUpdate: (updated: BoardList) => void;
  onListDelete: (listId: number) => void;
}) {
  const [addingCard, setAddingCard] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(list.title);
  const [showMenu, setShowMenu] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (isRenaming) renameRef.current?.select(); }, [isRenaming]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
        setConfirmDelete(false);
        setShowColorPicker(false);
      }
    }
    if (showMenu) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showMenu]);

  async function handleRename() {
    const trimmed = renameValue.trim();
    setIsRenaming(false);
    if (!trimmed || trimmed === list.title) return;
    try {
      const updated = await api.patch<BoardList>(`/boards/${list.board_id}/lists/${list.id}`, { title: trimmed });
      onListUpdate(updated);
    } catch {
      setRenameValue(list.title);
    }
  }

  async function handleColorChange(color: string) {
    setShowColorPicker(false);
    setShowMenu(false);
    if (color === list.color) return;
    try {
      const updated = await api.patch<BoardList>(`/boards/${list.board_id}/lists/${list.id}`, { color });
      onListUpdate(updated);
    } catch {}
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.del(`/boards/${list.board_id}/lists/${list.id}`);
      onListDelete(list.id);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleArchiveList() {
    try {
      await api.post(`/boards/${list.board_id}/lists/${list.id}/archive`, {});
      onListDelete(list.id);
    } catch {}
  }

  return (
    // max-h-full: a coluna cresce até o fim da área do quadro e para ali — daí o scroll
    // passa a acontecer DENTRO da lista (na área de cards), e não na página.
    // A cor da lista tinge a coluna inteira, não só o título. O cálculo do fundo
    // (claro/escuro) fica no CSS — aqui só entra a cor, via --list-color.
    <div
      className="list-column flex flex-col w-[272px] shrink-0 max-h-full rounded-xl overflow-hidden"
      style={{ "--list-color": list.color } as React.CSSProperties}
    >
      {/* Column header */}
      <div className="list-column-header px-3 py-2.5 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ backgroundColor: list.color }} />
            {isRenaming ? (
              <input
                ref={renameRef}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={handleRename}
                onKeyDown={e => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") { setRenameValue(list.title); setIsRenaming(false); } }}
                className="flex-1 text-sm font-semibold bg-background-elevated border border-primary/40 rounded px-2 py-0.5 text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary/60"
              />
            ) : isElevated ? (
              <button
                onClick={() => setIsRenaming(true)}
                className="text-sm font-semibold break-words leading-snug text-slate-100 hover:text-primary transition-colors text-left"
                title="Clique para renomear"
              >
                {list.title}
              </button>
            ) : (
              <span className="text-sm font-semibold break-words leading-snug text-left text-slate-100">
                {list.title}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${list.color}20`, color: list.color }}>
              {cards.length}
            </span>
            {/* Menu da lista (renomear/cor/arquivar/excluir): só elevado. */}
            {isElevated && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(p => !p)}
                className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors"
              >
                <IDots />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-xl bg-background-surface border border-border shadow-xl overflow-hidden">
                  <button onClick={() => { setIsRenaming(true); setShowMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-background-elevated transition-colors text-left">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    Renomear
                  </button>
                  <div className="border-t border-border">
                    <button onClick={() => setShowColorPicker(p => !p)} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-background-elevated transition-colors text-left">
                      <span className="w-4 h-4 rounded-full border-2 border-white/20 shrink-0" style={{ backgroundColor: list.color }} />
                      Mudar cor
                    </button>
                    {showColorPicker && (
                      <div className="px-3 pb-2.5 flex gap-1.5 flex-wrap">
                        {LABEL_COLORS.map(c => (
                          <button key={c} onClick={() => handleColorChange(c)} className={cn("w-5 h-5 rounded-full border-2 transition-transform", list.color === c ? "scale-125 border-white/80" : "border-transparent")} style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Reordenar a lista (só elevado — o menu inteiro já é). Linhas
                      normais, como os outros itens; desabilitado na ponta. */}
                  <div className="border-t border-border">
                    <button
                      onClick={() => { onMoveList("left"); setShowMenu(false); }}
                      disabled={!canMoveLeft}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-background-elevated disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors text-left"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                      Mover para a esquerda
                    </button>
                    <button
                      onClick={() => { onMoveList("right"); setShowMenu(false); }}
                      disabled={!canMoveRight}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-background-elevated disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors text-left"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      Mover para a direita
                    </button>
                  </div>
                  <button onClick={() => { handleArchiveList(); setShowMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-background-elevated transition-colors text-left border-t border-border">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                    Arquivar lista
                  </button>
                  {confirmDelete ? (
                    <div className="px-3 py-2.5 border-t border-border space-y-2">
                      <p className="text-xs text-slate-400">Excluir lista e todos os cards?</p>
                      <div className="flex gap-1.5">
                        <button onClick={() => setConfirmDelete(false)} className="flex-1 py-1 text-xs rounded-lg border border-border text-slate-400 hover:bg-background-elevated transition-colors">Não</button>
                        <button onClick={handleDelete} disabled={deleting} className="flex-1 py-1 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors font-semibold">
                          {deleting ? "…" : "Sim"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left border-t border-border">
                      <ITrash />Excluir lista
                    </button>
                  )}
                </div>
              )}
            </div>
            )}
          </div>
        </div>
        {list.description && <p className="text-[11px] text-slate-500 mt-1 pl-4.5">{list.description}</p>}
      </div>

      {/* Cards */}
      <SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
        <DroppableColumn id={`list-${list.id}`}>
          {cards.length === 0 && !addingCard && (
            <div className="flex flex-col items-center justify-center py-6 mx-1 rounded-lg border border-dashed border-white/10">
              <p className="text-xs text-slate-600">Nenhum card</p>
            </div>
          )}
          {cards.map(card => <KanbanCard key={card.id} card={card} onCardClick={onCardClick} isDone={myDone.has(card.id)} listId={list.id} onToggleDone={onToggleDone} />)}
        </DroppableColumn>
      </SortableContext>

      {/* Add card form inside scroll area */}
      {addingCard && (
        <AddCardForm
          listId={list.id}
          onAdded={card => { onCardAdded(card); setAddingCard(false); }}
          onCancel={() => setAddingCard(false)}
        />
      )}

      {/* Add card button — always visible at bottom */}
      {!addingCard && (
        <button
          onClick={() => setAddingCard(true)}
          className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-all duration-150 shrink-0 border-t border-white/5"
        >
          <IPlus />Adicionar card
        </button>
      )}
    </div>
  );
}

// ── AutomationsModal ───────────────────────────────────────────

function AutomationsModal({ boardId, lists, onClose }: {
  boardId: number;
  lists: { id: number; title: string }[];
  onClose: () => void;
}) {
  const [rules, setRules] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [newListId, setNewListId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRules(await api.get<Automation[]>(`/boards/${boardId}/automations`));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [boardId]);

  const listTitle = (id: number) => lists.find(l => l.id === id)?.title ?? `Lista #${id}`;

  const addRule = async () => {
    if (newListId === "") return;
    setSaving(true);
    try {
      await api.post(`/boards/${boardId}/automations`, { trigger_list_id: newListId });
      setNewListId("");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (r: Automation) => {
    await api.patch(`/boards/${boardId}/automations/${r.id}`, { enabled: !r.enabled });
    await load();
  };

  const remove = async (r: Automation) => {
    await api.del(`/boards/${boardId}/automations/${r.id}`);
    await load();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-12">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-background-surface shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-100">Automações</h2>
              <p className="text-xs text-slate-500 mt-0.5">Regras que rodam sozinhas neste quadro</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-background-elevated transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[65vh] overflow-y-auto px-6 py-5 space-y-5">
          {/* Builder */}
          <div className="rounded-xl border border-border bg-background-elevated p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Nova regra</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="shrink-0 w-14 text-[11px] font-bold uppercase tracking-wide text-primary">Quando</span>
                <span className="text-sm text-slate-300">um card for movido para</span>
                <select
                  value={newListId}
                  onChange={e => setNewListId(e.target.value === "" ? "" : Number(e.target.value))}
                  className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors"
                >
                  <option value="">selecione a lista…</option>
                  {lists.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <span className="shrink-0 w-14 text-[11px] font-bold uppercase tracking-wide text-slate-400">Então</span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-sm text-slate-200">
                  <svg className="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  marcar a data de entrega como concluída
                </span>
              </div>
            </div>
            <button
              onClick={addRule}
              disabled={newListId === "" || saving}
              className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              {saving ? "Adicionando…" : "Adicionar regra"}
            </button>
          </div>

          {/* List */}
          {loading ? (
            <p className="text-sm text-slate-500 text-center py-4">Carregando…</p>
          ) : rules.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-8 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-background-elevated text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <p className="text-sm font-medium text-slate-400">Nenhuma automação ainda</p>
              <p className="text-xs text-slate-600">Crie uma regra acima para automatizar este quadro.</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {rules.map(r => (
                <li key={r.id} className={cn("flex items-center gap-3 rounded-xl border border-border p-3.5 transition-opacity", !r.enabled && "opacity-55")}>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm text-slate-200 leading-snug">
                      {/* slate-100 (invertido no tema claro), não branco fixo. */}
                      Quando movido para <strong className="font-semibold text-slate-100">{listTitle(r.trigger_list_id)}</strong>
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-slate-400">
                      <svg className="w-3 h-3 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      marcar a data como concluída
                    </p>
                  </div>
                  <button
                    onClick={() => toggle(r)}
                    role="switch"
                    aria-checked={r.enabled}
                    title={r.enabled ? "Desligar" : "Ligar"}
                    className={cn("relative shrink-0 h-5 w-9 rounded-full transition-colors", r.enabled ? "bg-primary" : "bg-slate-600")}
                  >
                    <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", r.enabled ? "translate-x-[18px]" : "translate-x-0.5")} />
                  </button>
                  <button onClick={() => remove(r)} title="Excluir" aria-label="Excluir regra" className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── BoardPage ──────────────────────────────────────────────────

export function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentUser } = useAuth();
  // Elevado = administrador ou coordenador. Membro comum não mexe na ESTRUTURA do quadro
  // (criar/renomear/cor/arquivar/excluir lista, gerenciar etiquetas) — só no conteúdo dos
  // cards. A trava real é no backend (get_elevated_user); aqui é só esconder os botões.
  const isElevated = currentUser?.role === "administrador" || currentUser?.role === "coordenador";
  const boardId = Number(id);

  const [board, setBoard] = useState<Board | null>(null);
  const [lists, setLists] = useState<BoardList[]>([]);
  const [cardsByList, setCardsByList] = useState<Record<number, Card[]>>({});
  const [loading, setLoading] = useState(true);
  const [semAcesso, setSemAcesso] = useState(false);
  const [addingList, setAddingList] = useState(false);
  const [search, setSearch] = useState("");
  const [filterPriority, setFilterPriority] = useState<Priority | null>(null);
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const currentListIdRef = useRef<number | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  // "Concluído" PESSOAL: ids dos cards que EU marquei neste quadro. Camada
  // própria (não vem no card nem no SSE) — cada um só enxerga a sua.
  const [myDone, setMyDone] = useState<Set<number>>(new Set());
  const [boardLabels, setBoardLabels] = useState<BoardLabel[]>([]);
  const [showLabelManager, setShowLabelManager] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#0ea5e9");
  const [editingLabel, setEditingLabel] = useState<BoardLabel | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedCards, setArchivedCards] = useState<(Card & { list_title: string })[]>([]);
  const [archivedLists, setArchivedLists] = useState<BoardList[]>([]);
  const [archivedTab, setArchivedTab] = useState<"cards" | "lists">("cards");
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [showEditBoard, setShowEditBoard] = useState(false);
  const [showAutomations, setShowAutomations] = useState(false);
  const [editBoardTitle, setEditBoardTitle] = useState("");
  const [editBoardDescription, setEditBoardDescription] = useState("");
  const [editBoardColor, setEditBoardColor] = useState("#0ea5e9");
  const [editBoardIcon, setEditBoardIcon] = useState<string | null>(null);
  const [editIntegrationEnabled, setEditIntegrationEnabled] = useState(false);
  const [editObsLabels, setEditObsLabels] = useState<string[]>(["", "", "", "", "", ""]);
  const [savingBoard, setSavingBoard] = useState(false);
  const [confirmDeleteBoard, setConfirmDeleteBoard] = useState(false);
  const [deletingBoard, setDeletingBoard] = useState(false);
  const [boardMembers, setBoardMembers] = useState<BoardMemberOut[]>([]);
  const [todosUsuarios, setTodosUsuarios] = useState<UserBasic[]>([]);
  const [membrosLoading, setMembrosLoading] = useState(false);
  const [membrosFalhou, setMembrosFalhou] = useState(false);
  const [erroMembro, setErroMembro] = useState<string | null>(null);
  const [mutandoMembro, setMutandoMembro] = useState(false);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState<BoardMemberOut | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollDrag = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false });
  // Ligado quando o pan andou de verdade: engole o clique seguinte para não abrir o card sem querer.
  const suppressClick = useRef(false);
  const PAN_CLICK_SLOP = 5; // px: abaixo disso ainda conta como clique, não como arrasto

  function onBoardMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    // O card é opt-in (data-pan-surface); o resto dos botões/campos segue fora do pan.
    if (!target.closest("[data-pan-surface]") && target.closest("button, input, textarea, [data-dnd-draggable]")) return;
    if (e.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    scrollDrag.current = { active: true, startX: e.clientX, scrollLeft: el.scrollLeft, moved: false };
    el.style.cursor = "grabbing";
    el.style.userSelect = "none";
  }

  function onBoardMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!scrollDrag.current.active) return;
    const el = scrollRef.current;
    if (!el) return;
    const dx = e.clientX - scrollDrag.current.startX;
    if (Math.abs(dx) > PAN_CLICK_SLOP) scrollDrag.current.moved = true;
    el.scrollLeft = scrollDrag.current.scrollLeft - dx;
  }

  function onBoardMouseUp() {
    if (scrollDrag.current.active && scrollDrag.current.moved) suppressClick.current = true;
    scrollDrag.current.active = false;
    const el = scrollRef.current;
    if (el) { el.style.cursor = ""; el.style.userSelect = ""; }
  }

  function onBoardClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  const resync = useCallback(async () => {
    const snap = await api.get<{
      board: Board; lists: BoardList[]; labels: BoardLabel[];
      cards_by_list: Record<number, Card[]>;
    }>(`/boards/${boardId}/snapshot`);
    setBoard(snap.board);
    setLists(snap.lists);
    setBoardLabels(snap.labels);
    setCardsByList(snap.cards_by_list);
    // Camada pessoal de "concluído": buscada à parte do snapshot, só a minha.
    api.get<{ card_ids: number[] }>(`/boards/${boardId}/done`)
      .then(r => setMyDone(new Set(r.card_ids))).catch(() => {});
  }, [boardId]);

  // Alterna "concluído" pessoal. useCallback([]) — estável, para o memo dos cards
  // não quebrar no arrastar. Otimista; reverte se o request falhar. list_id vem de
  // quem chama (a coluna sabe), evitando lookup dependente de estado.
  const toggleDone = useCallback((cardId: number, listId: number) => {
    setMyDone(prev => {
      const jaEra = prev.has(cardId);
      const next = new Set(prev);
      if (jaEra) next.delete(cardId); else next.add(cardId);
      const req = jaEra
        ? api.del(`/lists/${listId}/cards/${cardId}/done`)
        : api.post(`/lists/${listId}/cards/${cardId}/done`, {});
      req.catch(() => setMyDone(cur => {
        const r = new Set(cur);
        if (jaEra) r.add(cardId); else r.delete(cardId);
        return r;
      }));
      return next;
    });
  }, []);

  useEffect(() => {
    if (!boardId) return;
    resync().catch(e => {
      // 403 = não é membro, tem tela própria. Qualquer outra falha (500, rede)
      // cai na tela genérica — mas precisa deixar rastro, senão vira "o quadro
      // sumiu" sem diagnóstico.
      if (e instanceof ApiError && e.status === 403) setSemAcesso(true);
      else console.error("Falha ao carregar o quadro", e);
    }).finally(() => setLoading(false));
  }, [boardId, resync]);

  const applyStreamEvent = useCallback((evt: any) => {
    if (evt.type === "card" && evt.action === "upsert") {
      const card: Card = evt.card;
      if (card.archived) {
        // arquivado some da cara do quadro (o /snapshot já filtra archived==False;
        // sem isto o card reaparecia ao vivo em todo mundo que estava com o board aberto).
        // O modal aberto NÃO é fechado — card arquivado ainda é visualizável.
        setCardsByList(prev => {
          const next: Record<number, Card[]> = {};
          for (const [lid, cards] of Object.entries(prev)) {
            next[Number(lid)] = cards.filter(c => c.id !== card.id);
          }
          return next;
        });
        return;
      }
      setCardsByList(prev => {
        const next: Record<number, Card[]> = {};
        for (const [lid, cards] of Object.entries(prev)) {
          next[Number(lid)] = cards.filter(c => c.id !== card.id);
        }
        const bucket = next[card.list_id] ?? [];
        next[card.list_id] = [...bucket, card].sort((a, b) => a.position - b.position);
        return next;
      });
      setSelectedCard(sc => (sc && sc.id === card.id ? card : sc));
    } else if (evt.type === "card" && evt.action === "delete") {
      setCardsByList(prev => {
        const next: Record<number, Card[]> = {};
        for (const [lid, cards] of Object.entries(prev)) next[Number(lid)] = cards.filter(c => c.id !== evt.id);
        return next;
      });
      setSelectedCard(sc => (sc && sc.id === evt.id ? null : sc));
    } else if (evt.type === "list" && evt.action === "upsert") {
      const lst: BoardList = evt.list;
      if (lst.archived) {
        // mesma lógica do card: lista arquivada some da cara do quadro ao vivo.
        setLists(prev => prev.filter(l => l.id !== lst.id));
        setCardsByList(prev => { const { [lst.id]: _drop, ...rest } = prev; return rest; });
        return;
      }
      setLists(prev => {
        const rest = prev.filter(l => l.id !== lst.id);
        return [...rest, lst].sort((a, b) => a.position - b.position);
      });
      setCardsByList(prev => (prev[lst.id] ? prev : { ...prev, [lst.id]: [] }));
    } else if (evt.type === "list" && evt.action === "delete") {
      setLists(prev => prev.filter(l => l.id !== evt.id));
      setCardsByList(prev => { const { [evt.id]: _drop, ...rest } = prev; return rest; });
    } else if (evt.type === "board_labels") {
      setBoardLabels(evt.labels);
    } else if (evt.type === "board" && evt.action === "upsert") {
      setBoard(evt.board);
    } else if (evt.type === "board" && evt.action === "reload") {
      resync().catch(() => {});
    }
  }, [resync]);

  useBoardStream(boardId, applyStreamEvent, () => { resync().catch(() => {}); });

  useEffect(() => {
    if (!showEditBoard || !boardId) return;
    setMembrosLoading(true);
    setMembrosFalhou(false);
    setErroMembro(null);
    setConfirmandoRemocao(null);
    // Os dois juntos de propósito: com só um deles, a tela ofereceria adicionar
    // quem já é membro — e o backend recusaria com 409.
    Promise.all([
      api.get<BoardMemberOut[]>(`/boards/${boardId}/members`),
      api.get<UserBasic[]>("/auth/users/basic"),
    ]).then(([ms, us]) => {
      setBoardMembers(ms);
      setTodosUsuarios(us);
    }).catch(e => {
      console.error("Falha ao carregar os membros do quadro", e);
      setBoardMembers([]);
      setTodosUsuarios([]);
      setMembrosFalhou(true);
    }).finally(() => setMembrosLoading(false));
  }, [showEditBoard, boardId]);

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

  function fecharCard() {
    setSelectedCard(null);
    if (searchParams.get("card") || searchParams.get("list")) {
      const p = new URLSearchParams(searchParams);
      p.delete("card");
      p.delete("list");
      setSearchParams(p, { replace: true });
    }
  }

  function findListOfCard(cardId: number): number | undefined {
    for (const [listId, cards] of Object.entries(cardsByList)) {
      if (cards.some(c => c.id === cardId)) return Number(listId);
    }
  }

  function findCard(cardId: number): Card | undefined {
    for (const cards of Object.values(cardsByList)) {
      const card = cards.find(c => c.id === cardId);
      if (card) return card;
    }
  }

  function resolveListId(overId: string | number): number | undefined {
    const str = String(overId);
    if (str.startsWith("list-")) return Number(str.replace("list-", ""));
    return findListOfCard(Number(overId));
  }

  function handleCardUpdate(updated: Partial<Card> & { id: number }) {
    setCardsByList(prev => {
      const next = { ...prev };
      for (const listId of Object.keys(next)) {
        const idx = next[Number(listId)].findIndex(c => c.id === updated.id);
        if (idx !== -1) {
          next[Number(listId)] = next[Number(listId)].map(c => c.id === updated.id ? { ...c, ...updated } : c);
          break;
        }
      }
      return next;
    });
    setSelectedCard(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
  }

  function handleCardDelete(cardId: number) {
    setCardsByList(prev => {
      const next = { ...prev };
      for (const listId of Object.keys(next)) {
        const filtered = next[Number(listId)].filter(c => c.id !== cardId);
        if (filtered.length !== next[Number(listId)].length) { next[Number(listId)] = filtered; break; }
      }
      return next;
    });
  }

  function handleListUpdate(updated: BoardList) {
    setLists(prev => prev.map(l => l.id === updated.id ? updated : l));
  }

  async function handleCreateBoardLabel() {
    const name = newLabelName.trim();
    if (!name) return;
    try {
      const label = await api.post<BoardLabel>(`/boards/${boardId}/labels`, { name, color: newLabelColor });
      setBoardLabels(prev => [...prev, label]);
      setNewLabelName("");
      setNewLabelColor("#0ea5e9");
    } catch {}
  }

  async function handleUpdateBoardLabel(id: number, name: string, color: string) {
    try {
      const label = await api.patch<BoardLabel>(`/boards/${boardId}/labels/${id}`, { name, color });
      setBoardLabels(prev => prev.map(l => l.id === id ? label : l));
      setEditingLabel(null);
    } catch {}
  }

  async function handleDeleteBoardLabel(id: number) {
    try {
      await api.del(`/boards/${boardId}/labels/${id}`);
      setBoardLabels(prev => prev.filter(l => l.id !== id));
      setCardsByList(prev => {
        const next = { ...prev };
        for (const listId of Object.keys(next)) {
          next[Number(listId)] = next[Number(listId)].map(c => ({
            ...c,
            labels: c.labels.filter(l => l.id !== id),
          }));
        }
        return next;
      });
    } catch {}
  }

  async function fetchArchived() {
    setLoadingArchived(true);
    try {
      const data = await api.get<{ cards: (Card & { list_title: string })[]; lists: BoardList[] }>(`/boards/${boardId}/archived`);
      setArchivedCards(data.cards);
      setArchivedLists(data.lists);
    } finally {
      setLoadingArchived(false);
    }
  }

  async function handleRestoreCard(card: Card & { list_title: string }) {
    try {
      const restored = await api.post<Card>(`/lists/${card.list_id}/cards/${card.id}/restore`, {});
      setArchivedCards(prev => prev.filter(c => c.id !== card.id));
      setCardsByList(prev => ({
        ...prev,
        [restored.list_id]: [...(prev[restored.list_id] ?? []), restored],
      }));
    } catch {}
  }

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

  async function handleDeleteArchivedCard(card: Card) {
    try {
      await api.del(`/lists/${card.list_id}/cards/${card.id}`);
      setArchivedCards(prev => prev.filter(c => c.id !== card.id));
    } catch {}
  }

  async function handleRestoreList(lst: BoardList) {
    try {
      const restored = await api.post<BoardList>(`/boards/${boardId}/lists/${lst.id}/restore`, {});
      setArchivedLists(prev => prev.filter(l => l.id !== lst.id));
      setLists(prev => [...prev, restored]);
      const cards = await api.get<Card[]>(`/lists/${restored.id}/cards`);
      setCardsByList(prev => ({ ...prev, [restored.id]: cards }));
    } catch {}
  }

  async function handleDeleteArchivedList(lst: BoardList) {
    try {
      await api.del(`/boards/${boardId}/lists/${lst.id}`);
      setArchivedLists(prev => prev.filter(l => l.id !== lst.id));
    } catch {}
  }

  function openEditBoard() {
    if (!board) return;
    setEditBoardTitle(board.title);
    setEditBoardDescription(board.description ?? "");
    setEditBoardColor(board.color);
    setEditBoardIcon(board.icon);
    setEditIntegrationEnabled(board.integration_enabled);
    setEditObsLabels([0, 1, 2, 3, 4, 5].map(i => board.obs_labels[i] ?? ""));
    setConfirmDeleteBoard(false);
    // Não depender só do efeito de carregamento: zera erro e a lista de membros
    // (que pode ser de OUTRO quadro, com e-mails) antes mesmo do refetch rodar.
    setErroMembro(null);
    setBoardMembers([]);
    setTodosUsuarios([]);
    setMembrosFalhou(false);
    setConfirmandoRemocao(null);
    setShowEditBoard(true);
  }

  async function handleSaveBoard() {
    if (!editBoardTitle.trim()) return;
    setSavingBoard(true);
    try {
      const updated = await api.patch<Board>(`/boards/${boardId}`, {
        title: editBoardTitle.trim(),
        description: editBoardDescription.trim() || null,
        color: editBoardColor,
        icon: editBoardIcon,
        integration_enabled: editIntegrationEnabled,
        obs_labels: editObsLabels.map(s => s.trim()),
      });
      setBoard(updated);
      setShowEditBoard(false);
    } catch {} finally {
      setSavingBoard(false);
    }
  }

  async function handleDeleteBoard() {
    setDeletingBoard(true);
    try {
      await api.del(`/boards/${boardId}`);
      navigate("/boards");
    } catch {} finally {
      setDeletingBoard(false);
    }
  }

  async function handleAddBoardMember(userId: number) {
    setMutandoMembro(true);
    setErroMembro(null);
    try {
      await api.post(`/boards/${boardId}/members`, { user_id: userId, role: "member" });
    } catch (e) {
      setErroMembro(e instanceof ApiError ? e.message : "Não foi possível adicionar.");
      setMutandoMembro(false);
      return;
    }
    // A partir daqui a pessoa JÁ foi adicionada — se o refetch falhar, a mensagem
    // não pode dizer que a adição falhou.
    try {
      setBoardMembers(await api.get<BoardMemberOut[]>(`/boards/${boardId}/members`));
    } catch (e) {
      console.error("Falha ao recarregar os membros", e);
      setErroMembro("Membro adicionado, mas a lista não recarregou. Reabra as configurações.");
    } finally {
      setMutandoMembro(false);
    }
  }

  async function handleRemoveBoardMember(userId: number) {
    setMutandoMembro(true);
    setErroMembro(null);
    try {
      await api.del(`/boards/${boardId}/members/${userId}`);
      setBoardMembers(prev => prev.filter(m => m.id !== userId));
    } catch (e) {
      setErroMembro(e instanceof ApiError ? e.message : "Não foi possível remover.");
    } finally {
      setMutandoMembro(false);
    }
  }

  function handleCardCopy(newCard: Card) {
    setCardsByList(prev => ({
      ...prev,
      [newCard.list_id]: [...(prev[newCard.list_id] ?? []), newCard],
    }));
  }

  function handleListDelete(listId: number) {
    setLists(prev => prev.filter(l => l.id !== listId));
    setCardsByList(prev => { const next = { ...prev }; delete next[listId]; return next; });
  }

  // Reordena a lista trocando a POSIÇÃO com a vizinha (List.position é int, então
  // trocar os valores dá uma reordenação limpa, sem gaps). Otimista; reverte se o
  // PATCH falhar. O backend (update_list) já exige elevado — o botão também só
  // aparece para elevado, mas a tranca real está lá.
  async function handleMoveList(list: BoardList, dir: "left" | "right") {
    const idx = lists.findIndex(l => l.id === list.id);
    const swapIdx = dir === "left" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= lists.length) return;
    const neighbor = lists[swapIdx];
    const posList = list.position, posNeighbor = neighbor.position;
    const aplicar = (pList: number, pNeighbor: number) => setLists(prev => prev
      .map(l => l.id === list.id ? { ...l, position: pList } : l.id === neighbor.id ? { ...l, position: pNeighbor } : l)
      .sort((a, b) => a.position - b.position));
    aplicar(posNeighbor, posList);
    try {
      await Promise.all([
        api.patch(`/boards/${boardId}/lists/${list.id}`, { position: posNeighbor }),
        api.patch(`/boards/${boardId}/lists/${neighbor.id}`, { position: posList }),
      ]);
    } catch {
      aplicar(posList, posNeighbor);
    }
  }

  function onDragCancel() {
    setActiveCard(null);
    setActiveListId(null);
    document.body.style.cursor = "";
  }

  function onDragStart({ active }: DragStartEvent) {
    const cardId = active.id as number;
    const listId = findListOfCard(cardId) ?? null;
    setActiveCard(findCard(cardId) ?? null);
    setActiveListId(listId);
    currentListIdRef.current = listId;
    document.body.style.cursor = "none";
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const activeId     = active.id as number;
    const overId       = over.id;
    const sourceListId = currentListIdRef.current;
    const destListId   = resolveListId(overId);
    if (!sourceListId || !destListId) return;

    if (sourceListId === destListId) {
      if (String(overId).startsWith("list-")) return;
      setCardsByList(prev => {
        const cards     = prev[sourceListId] ?? [];
        const activeIdx = cards.findIndex(c => c.id === activeId);
        const overIdx   = cards.findIndex(c => c.id === Number(overId));
        if (activeIdx === -1 || overIdx === -1 || activeIdx === overIdx) return prev;
        return { ...prev, [sourceListId]: arrayMove(cards, activeIdx, overIdx) };
      });
      return;
    }

    currentListIdRef.current = destListId;
    setCardsByList(prev => {
      const source = [...(prev[sourceListId] ?? [])];
      const dest   = [...(prev[destListId]   ?? [])];
      const idx    = source.findIndex(c => c.id === activeId);
      if (idx === -1) return prev;
      const [moved] = source.splice(idx, 1);
      let insertIdx: number;
      if (String(overId).startsWith("list-")) {
        insertIdx = dest.length;
      } else {
        const overIdx = dest.findIndex(c => c.id === Number(overId));
        const activeCenter = active.rect.current.translated ? active.rect.current.translated.top + active.rect.current.translated.height / 2 : 0;
        const overCenter = over.rect.top + over.rect.height / 2;
        const after = activeCenter > overCenter;
        insertIdx = overIdx === -1 ? dest.length : (after ? overIdx + 1 : overIdx);
      }
      dest.splice(insertIdx, 0, moved);
      return { ...prev, [sourceListId]: source, [destListId]: dest };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const sourceListId = activeListId;
    setActiveCard(null);
    setActiveListId(null);
    document.body.style.cursor = "";
    if (!over || !sourceListId) return;
    const activeId   = active.id as number;
    const destListId = resolveListId(over.id);
    if (!destListId) return;
    const finalCards = cardsByList[destListId] ?? [];
    const newIndex   = finalCards.findIndex(c => c.id === activeId);
    const prev       = finalCards[newIndex - 1];
    const next       = finalCards[newIndex + 1];
    let newPosition: number;
    if (!prev && !next)  newPosition = 65536;
    else if (!prev)      newPosition = next.position / 2;
    else if (!next)      newPosition = prev.position + 65536;
    else                 newPosition = (prev.position + next.position) / 2;
    api.patch(`/lists/${sourceListId}/cards/${activeId}`, { list_id: destListId, position: newPosition }).catch(() => {});
  }

  // ── Stats ────────────────────────────────────────────────────

  const allCards = Object.values(cardsByList).flat();
  const totalCards = allCards.length;
  const overdueCount = allCards.filter(c => c.due_date && !c.due_date_completed && isOverdue(c.due_date)).length;
  const dueTodayCount = allCards.filter(c => c.due_date && !c.due_date_completed && isToday(c.due_date)).length;

  // ── Filtered cards per list ──────────────────────────────────

  function filteredCards(listId: number): Card[] {
    const cards = cardsByList[listId] ?? [];
    return cards.filter(c => {
      const matchSearch = !search.trim() || c.title.toLowerCase().includes(search.toLowerCase()) || c.description?.toLowerCase().includes(search.toLowerCase());
      const matchPriority = !filterPriority || c.priority === filterPriority;
      return matchSearch && matchPriority;
    });
  }

  if (loading) return <div className="flex flex-col flex-1 items-center justify-center"><ISpinner /></div>;

  if (semAcesso) return (
    <div className="flex flex-col flex-1 items-center justify-center gap-3 px-6 text-center">
      <div className="w-12 h-12 rounded-xl bg-background-elevated border border-border flex items-center justify-center text-slate-500">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <p className="text-slate-300 font-semibold">Você não é membro deste quadro</p>
      <p className="text-sm text-slate-500 max-w-sm">Peça para o dono do quadro te adicionar como membro.</p>
      <button onClick={() => navigate("/boards")} className="text-sm text-primary hover:underline mt-1">Voltar para os quadros</button>
    </div>
  );

  if (!board) return (
    <div className="flex flex-col flex-1 items-center justify-center gap-2">
      <p className="text-slate-500">Board não encontrado.</p>
      <button onClick={() => navigate("/boards")} className="text-sm text-primary hover:underline">Voltar</button>
    </div>
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div className="flex flex-col flex-1 min-h-0">

        {/* Topbar */}
        <div className="shrink-0 px-4 md:px-6 pt-4 md:pt-6 pb-3">
          <div className="rounded-2xl border border-border/40 bg-background-surface px-5 py-3 space-y-3">
            {/* Title row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button onClick={() => navigate("/boards")} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-background-elevated transition-colors shrink-0">
                  <IBack />
                </button>
                <div className="shrink-0" style={{ color: board.color }}>
                  <BoardIcon name={board.icon} className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-extrabold text-slate-100 truncate">{board.title}</h1>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-500">{totalCards} card{totalCards !== 1 ? "s" : ""} · {lists.length} lista{lists.length !== 1 ? "s" : ""}</span>
                    {overdueCount > 0 && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {overdueCount} vencido{overdueCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {dueTodayCount > 0 && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-warning/15 text-warning">
                        <ICal />{dueTodayCount} hoje
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"><ISearch /></span>
                  <input
                    value={search} onChange={e => setSearch(e.target.value)}
                    type="text" placeholder="Buscar card…"
                    className="pl-9 pr-3 py-2 text-sm w-44 rounded-lg border border-border bg-background-elevated text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors"
                  />
                </div>
                {/* Gerenciar etiquetas (criar/editar/excluir): só elevado. Atribuir uma
                    etiqueta existente a um card segue livre (é no modal do card). */}
                {isElevated && (
                  <button
                    onClick={() => setShowLabelManager(true)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border border-border text-slate-300 hover:bg-background-elevated active:scale-95 transition-all duration-150"
                  >
                    <ITag />Etiquetas
                  </button>
                )}
                <button
                  onClick={() => { setShowArchived(true); setArchivedTab("cards"); fetchArchived(); }}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border border-border text-slate-300 hover:bg-background-elevated active:scale-95 transition-all duration-150"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                  Arquivados
                </button>
                {(currentUser?.id === board.owner_id || currentUser?.role === "administrador" || currentUser?.role === "coordenador") && (
                  <button
                    onClick={openEditBoard}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border border-border text-slate-300 hover:bg-background-elevated active:scale-95 transition-all duration-150"
                    title="Configurações do board"
                  >
                    <IGear />Configurações
                  </button>
                )}
                {(currentUser?.id === board.owner_id || currentUser?.role === "administrador" || currentUser?.role === "coordenador") && (
                  <button
                    onClick={() => setShowAutomations(true)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border border-border text-slate-300 hover:bg-background-elevated active:scale-95 transition-all duration-150"
                    title="Automações do board"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    Automações
                  </button>
                )}
                {/* Nova Lista: só elevado (membro não cria lista). */}
                {isElevated && (
                  <button
                    onClick={() => setAddingList(true)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 active:scale-95 transition-all duration-150"
                  >
                    <IPlus />Nova Lista
                  </button>
                )}
              </div>
            </div>

            {/* Priority filter chips */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500 font-medium">Filtrar:</span>
              <button
                onClick={() => setFilterPriority(null)}
                className={cn("text-xs px-2.5 py-1 rounded-full font-medium transition-all", !filterPriority ? "bg-primary/15 text-primary" : "text-slate-500 hover:text-slate-300 hover:bg-background-elevated")}
              >
                Todos
              </button>
              {PRIORITY_ORDER.map(p => (
                <button
                  key={p}
                  onClick={() => setFilterPriority(prev => prev === p ? null : p)}
                  className={cn("flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border transition-all", filterPriority === p ? "border-current" : "border-transparent hover:bg-background-elevated text-slate-500 hover:text-slate-300")}
                  style={filterPriority === p ? { color: PRIORITY[p].dot, backgroundColor: `${PRIORITY[p].dot}18` } : {}}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: PRIORITY[p].dot }} />
                  {PRIORITY[p].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Board canvas */}
        <div className="flex-1 overflow-hidden px-4 md:px-6 pb-4 md:pb-6">
          <div
            className="h-full rounded-2xl border border-border/30 overflow-hidden relative"
            style={{ background: `linear-gradient(160deg, ${hexToRgba(board.color, 0.14)} 0%, ${hexToRgba(board.color, 0.04)} 35%, #0a1525 70%)` }}
          >
            <div
              ref={scrollRef}
              className="h-full overflow-x-auto"
              onMouseDown={onBoardMouseDown}
              onMouseMove={onBoardMouseMove}
              onMouseUp={onBoardMouseUp}
              onMouseLeave={onBoardMouseUp}
              onClickCapture={onBoardClickCapture}
            >
              {/* items-stretch: as listas ocupam toda a altura até o rodapé (altura fixa).
                  O botão/form de "Adicionar lista" tem self-start, então continua curto. */}
              <div className="inline-flex gap-3 h-full p-3 items-stretch">
                {lists.map((list, idx) => (
                  <KanbanColumn
                    key={list.id}
                    list={list}
                    cards={filteredCards(list.id)}
                    isElevated={isElevated}
                    myDone={myDone}
                    onToggleDone={toggleDone}
                    canMoveLeft={idx > 0}
                    canMoveRight={idx < lists.length - 1}
                    onMoveList={dir => handleMoveList(list, dir)}
                    onCardAdded={card => setCardsByList(prev => ({ ...prev, [list.id]: [...(prev[list.id] ?? []), card] }))}
                    onCardClick={setSelectedCard}
                    onListUpdate={handleListUpdate}
                    onListDelete={handleListDelete}
                  />
                ))}
                {/* Adicionar lista: só elevado (as listas são etapas do fluxo). */}
                {isElevated && (addingList ? (
                  <AddListForm
                    boardId={boardId}
                    position={lists.length}
                    onAdded={list => { setLists(p => [...p, list]); setCardsByList(p => ({ ...p, [list.id]: [] })); setAddingList(false); }}
                    onCancel={() => setAddingList(false)}
                  />
                ) : (
                  <button
                    onClick={() => setAddingList(true)}
                    className="flex items-center gap-2 px-4 py-3 rounded-xl w-[272px] shrink-0 h-fit text-sm font-medium text-slate-400 hover:text-primary border-2 border-dashed border-white/10 hover:border-primary/40 bg-black/20 hover:bg-black/30 transition-all duration-150 self-start backdrop-blur-sm"
                  >
                    <IPlus />Adicionar lista
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {selectedCard && (
        <CardDetailModal
          card={selectedCard}
          boardId={boardId}
          listTitle={lists.find(l => l.id === selectedCard.list_id)?.title ?? "lista arquivada"}
          lists={lists}
          boardLabels={boardLabels}
          currentUser={currentUser}
          integrationEnabled={board?.integration_enabled ?? false}
          obsLabels={board?.obs_labels ?? []}
          onClose={fecharCard}
          onCardUpdate={handleCardUpdate}
          onCardDelete={handleCardDelete}
          onCardCopy={handleCardCopy}
          onRestore={handleRestoreFromModal}
          isDone={myDone.has(selectedCard.id)}
          onToggleDone={() => toggleDone(selectedCard.id, selectedCard.list_id)}
        />
      )}

      {/* Edit Board Panel */}
      {showEditBoard && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" />
          <div className="w-[380px] bg-background-surface border-l border-border flex flex-col h-full shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <IGear />
                <h2 className="text-sm font-semibold text-slate-200">Configurações do board</h2>
              </div>
              <button onClick={() => setShowEditBoard(false)} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-background-elevated transition-colors"><IX /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">Nome do board</label>
                <input
                  autoFocus
                  value={editBoardTitle}
                  onChange={e => setEditBoardTitle(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSaveBoard()}
                  placeholder="Nome do board…"
                  className="w-full text-sm bg-background-elevated rounded-lg border border-border px-3 py-2.5 text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder-slate-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">Descrição (opcional)</label>
                <textarea
                  value={editBoardDescription}
                  onChange={e => setEditBoardDescription(e.target.value)}
                  placeholder="Descrição do board…"
                  rows={3}
                  className="w-full text-sm bg-background-elevated rounded-lg border border-border px-3 py-2.5 text-slate-200 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder-slate-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">Cor</label>
                <div className="flex gap-2 flex-wrap">
                  {LABEL_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setEditBoardColor(c)}
                      className={cn("w-7 h-7 rounded-full border-2 transition-transform", editBoardColor === c ? "scale-125 border-white/80" : "border-transparent")}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">Ícone</label>
                <div className="grid grid-cols-8 gap-1.5">
                  {/* "Sem ícone" primeiro: é o estado atual de todo quadro antigo,
                      então precisa estar visível para dar como voltar atrás. */}
                  <button
                    type="button"
                    onClick={() => setEditBoardIcon(null)}
                    title="Sem ícone"
                    className={cn(
                      "aspect-square rounded-lg border flex items-center justify-center text-slate-500 transition-colors",
                      editBoardIcon === null
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-background-elevated",
                    )}
                  >
                    <IX />
                  </button>
                  {BOARD_ICON_NAMES.map(nome => (
                    <button
                      key={nome}
                      type="button"
                      onClick={() => setEditBoardIcon(nome)}
                      title={nome}
                      className={cn(
                        "aspect-square rounded-lg border flex items-center justify-center transition-colors",
                        editBoardIcon === nome
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-background-elevated",
                      )}
                      style={editBoardIcon === nome ? { color: editBoardColor } : undefined}
                    >
                      <BoardIcon name={nome} className="w-4 h-4" />
                    </button>
                  ))}
                </div>
              </div>
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
              <button
                onClick={handleSaveBoard}
                disabled={savingBoard || !editBoardTitle.trim()}
                className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-600 disabled:opacity-40 transition-colors"
              >
                {savingBoard ? "Salvando…" : "Salvar alterações"}
              </button>

              {/* ── Membros do quadro ── */}
              <div className="pt-4 border-t border-border space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-400">Membros do quadro</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Só os membros abrem este quadro. Administradores e coordenadores entram em todos.
                  </p>
                </div>

                {membrosLoading ? (
                  <p className="text-xs text-slate-500">Carregando…</p>
                ) : membrosFalhou ? (
                  <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                    Não foi possível carregar os membros do quadro. Feche e reabra as configurações para tentar de novo.
                  </p>
                ) : (
                  <>
                    {erroMembro && (
                      <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{erroMembro}</p>
                    )}

                    <div className="space-y-1.5">
                      {boardMembers.map(m => {
                        const ehDono = m.board_role === "owner";
                        return (
                          <div key={m.id} className="flex items-center gap-2.5 rounded-lg bg-background-elevated px-3 py-2">
                            <div className="w-7 h-7 rounded-full bg-background-surface border border-border flex items-center justify-center text-[10px] font-bold text-slate-300 shrink-0">
                              {m.initials}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-200 truncate">{m.name}</p>
                              <p className="text-[10px] text-slate-500 truncate">{m.email}</p>
                            </div>
                            {ehDono ? (
                              <span className="text-[10px] font-semibold text-slate-500 shrink-0">dono</span>
                            ) : (
                              <button
                                onClick={() => (m.assigned_cards > 0 ? setConfirmandoRemocao(m) : handleRemoveBoardMember(m.id))}
                                disabled={mutandoMembro}
                                title={`Remover ${m.name}`}
                                className="p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0 disabled:opacity-50 disabled:pointer-events-none"
                              >
                                <IX />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {confirmandoRemocao && (
                      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 space-y-2">
                        <p className="text-xs text-slate-200">
                          <strong className="font-semibold">{confirmandoRemocao.name}</strong> está em{" "}
                          {confirmandoRemocao.assigned_cards} card{confirmandoRemocao.assigned_cards !== 1 ? "s" : ""} deste quadro.
                          Remover do quadro também tira essa pessoa desses cards e apaga os lembretes
                          pessoais que ela criou aqui.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setConfirmandoRemocao(null)}
                            className="flex-1 py-1.5 rounded-lg border border-border text-xs font-medium text-slate-400 hover:bg-background-elevated transition-colors"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => { const alvo = confirmandoRemocao; setConfirmandoRemocao(null); handleRemoveBoardMember(alvo.id); }}
                            disabled={mutandoMembro}
                            className="flex-1 py-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors"
                          >
                            {mutandoMembro ? "Removendo…" : "Remover mesmo assim"}
                          </button>
                        </div>
                      </div>
                    )}

                    {(() => {
                      // O /auth/users/basic ja devolve so usuarios ativos, ordenados por nome.
                      const disponiveis = todosUsuarios.filter(
                        u => !boardMembers.some(m => m.id === u.id)
                      );
                      if (disponiveis.length === 0) {
                        return <p className="text-[11px] text-slate-500 italic">Todo mundo já está neste quadro.</p>;
                      }
                      return (
                        <select
                          value=""
                          disabled={mutandoMembro}
                          onChange={e => { if (e.target.value) handleAddBoardMember(Number(e.target.value)); }}
                          className="w-full text-sm bg-background-elevated rounded-lg border border-border px-3 py-2.5 text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                        >
                          <option value="">{mutandoMembro ? "Aguarde…" : "Adicionar membro…"}</option>
                          {disponiveis.map(u => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
            <div className="border-t border-border p-5 shrink-0">
              <p className="text-xs font-semibold text-slate-400 mb-3">Zona de perigo</p>
              {confirmDeleteBoard ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400">Tem certeza? Todas as listas e cards serão excluídos permanentemente.</p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmDeleteBoard(false)} className="flex-1 py-2 rounded-lg border border-border text-xs font-medium text-slate-400 hover:bg-background-elevated transition-colors">Cancelar</button>
                    <button onClick={handleDeleteBoard} disabled={deletingBoard} className="flex-1 py-2 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors">
                      {deletingBoard ? "Excluindo…" : "Confirmar exclusão"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteBoard(true)}
                  className="w-full py-2.5 rounded-lg border border-red-500/40 text-red-400 text-sm font-semibold hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
                >
                  <ITrash />Excluir este board
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showAutomations && (
        <AutomationsModal
          boardId={board.id}
          lists={lists.map(l => ({ id: l.id, title: l.title }))}
          onClose={() => setShowAutomations(false)}
        />
      )}

      {/* Label Manager Panel */}
      {showLabelManager && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" />
          <div className="w-[380px] bg-background-surface border-l border-border flex flex-col h-full shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <ITag />
                <h2 className="text-sm font-semibold text-slate-200">Etiquetas do board</h2>
              </div>
              <button onClick={() => { setShowLabelManager(false); setEditingLabel(null); }} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-background-elevated transition-colors"><IX /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {boardLabels.length === 0 && (
                <p className="text-xs text-slate-500 italic text-center py-4">Nenhuma etiqueta cadastrada.</p>
              )}
              {boardLabels.map(bl => (
                <div key={bl.id}>
                  {editingLabel?.id === bl.id ? (
                    <div className="flex flex-col gap-2 p-3 rounded-lg bg-background-elevated border border-primary/30">
                      <input
                        autoFocus
                        value={editingLabel.name}
                        onChange={e => setEditingLabel({ ...editingLabel, name: e.target.value })}
                        className="text-sm bg-background rounded-md border border-border px-2 py-1.5 text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                      {/* div em volta: o pai é flex-col, e sem ela o seletor
                          esticaria na largura toda. */}
                      <div>
                        <SeletorDeCor cor={editingLabel.color} onChange={c => setEditingLabel({ ...editingLabel, color: c })} />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdateBoardLabel(bl.id, editingLabel.name, editingLabel.color)} className="flex-1 text-xs py-1.5 rounded-md bg-primary text-white hover:bg-primary-600 transition-colors font-semibold">Salvar</button>
                        <button onClick={() => setEditingLabel(null)} className="text-xs px-3 py-1.5 rounded-md border border-border text-slate-400 hover:bg-background transition-colors">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-background-elevated border border-border group">
                      <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: bl.color }} />
                      <span className="flex-1 text-sm text-slate-200">{bl.name}</span>
                      <button onClick={() => setEditingLabel(bl)} className="p-1 rounded text-slate-500 hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-all">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                      <button onClick={() => handleDeleteBoardLabel(bl.id)} className="p-1 rounded text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                        <ITrash />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="border-t border-border p-4 space-y-2 shrink-0">
              <p className="text-xs font-semibold text-slate-400">Nova etiqueta</p>
              <input
                value={newLabelName}
                onChange={e => setNewLabelName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreateBoardLabel(); }}
                placeholder="Nome da etiqueta…"
                className="w-full text-sm bg-background-elevated rounded-lg border border-border px-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder-slate-500"
              />
              <SeletorDeCor cor={newLabelColor} onChange={setNewLabelColor} />
              <button
                onClick={handleCreateBoardLabel}
                disabled={!newLabelName.trim()}
                className="w-full py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-600 disabled:opacity-40 transition-colors"
              >
                Criar etiqueta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archived Panel */}
      {showArchived && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" />
          <div className="w-[420px] bg-background-surface border-l border-border flex flex-col h-full shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                <h2 className="text-sm font-semibold text-slate-200">Itens arquivados</h2>
              </div>
              <button onClick={() => setShowArchived(false)} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-background-elevated transition-colors">
                <IX />
              </button>
            </div>
            <div className="flex border-b border-border shrink-0">
              <button onClick={() => setArchivedTab("cards")} className={cn("flex-1 py-2.5 text-xs font-semibold transition-colors", archivedTab === "cards" ? "text-primary border-b-2 border-primary" : "text-slate-500 hover:text-slate-300")}>
                Cards ({archivedCards.length})
              </button>
              <button onClick={() => setArchivedTab("lists")} className={cn("flex-1 py-2.5 text-xs font-semibold transition-colors", archivedTab === "lists" ? "text-primary border-b-2 border-primary" : "text-slate-500 hover:text-slate-300")}>
                Listas ({archivedLists.length})
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loadingArchived && <div className="flex justify-center pt-8"><ISpinner /></div>}
              {!loadingArchived && archivedTab === "cards" && (
                archivedCards.length === 0
                  ? <p className="text-xs text-slate-500 italic text-center pt-8">Nenhum card arquivado.</p>
                  : archivedCards.map(c => (
                    <div key={c.id} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-background-elevated border border-border">
                      {/* Título clicável abre o card (só leitura do conteúdo). O modal
                          é z-[60] e abre POR CIMA deste painel (z-50), então o painel
                          fica atrás e reaparece ao fechar o card. O card vindo de
                          /archived já é completo (labels, comentários, checklists,
                          anexos), então abre direto. <span>, não <p>: conteúdo de
                          <button> não pode ter <p> (HTML inválido). */}
                      <button
                        type="button"
                        onClick={() => setSelectedCard(c)}
                        title="Abrir card"
                        className="min-w-0 flex-1 text-left group"
                      >
                        <span className="block text-sm text-slate-200 font-medium truncate group-hover:text-primary transition-colors">{c.title}</span>
                        <span className="block text-xs text-slate-500 mt-0.5">Lista: {c.list_title}</span>
                      </button>
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => handleRestoreCard(c)} className="text-xs px-2.5 py-1 rounded-md bg-primary/15 text-primary hover:bg-primary/25 transition-colors font-semibold">Restaurar</button>
                        <button onClick={() => handleDeleteArchivedCard(c)} className="text-xs px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-semibold">Excluir</button>
                      </div>
                    </div>
                  ))
              )}
              {!loadingArchived && archivedTab === "lists" && (
                archivedLists.length === 0
                  ? <p className="text-xs text-slate-500 italic text-center pt-8">Nenhuma lista arquivada.</p>
                  : archivedLists.map(l => (
                    <div key={l.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-background-elevated border border-border">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                        <p className="text-sm text-slate-200 font-medium truncate">{l.title}</p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => handleRestoreList(l)} className="text-xs px-2.5 py-1 rounded-md bg-primary/15 text-primary hover:bg-primary/25 transition-colors font-semibold">Restaurar</button>
                        <button onClick={() => handleDeleteArchivedList(l)} className="text-xs px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-semibold">Excluir</button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
        {activeCard && (
          <div className="w-[272px] rotate-2 shadow-lg">
            <CardContent card={activeCard} isDragging />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
