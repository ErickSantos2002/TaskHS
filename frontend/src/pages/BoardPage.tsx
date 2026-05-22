import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
import { api } from "../lib/api";
import type { Board, BoardList, Card, Comment, Priority, Label, BoardLabel, User, Checklist, ChecklistItem } from "../types";

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
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16" />
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
const ISend = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
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

const LABEL_COLORS = ["#ef4444","#f97316","#f59e0b","#22c55e","#0ea5e9","#8b5cf6","#ec4899","#64748b"];

// ── CardDetailModal ────────────────────────────────────────────

function CardDetailModal({ card, listTitle, lists, boardLabels, onClose, onCardUpdate, onCardDelete, onCardCopy }: {
  card: Card;
  listTitle: string;
  lists: BoardList[];
  boardLabels: BoardLabel[];
  onClose: () => void;
  onCardUpdate: (updated: Partial<Card> & { id: number }) => void;
  onCardDelete: (cardId: number) => void;
  onCardCopy: (newCard: Card) => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [labels, setLabels] = useState<Label[]>(card.labels);
  const [members, setMembers] = useState<User[]>(card.members);
  const [comments, setComments] = useState<Comment[]>(card.comments);
  const [commentBody, setCommentBody] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
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

  useEffect(() => {
    setTitle(card.title);
    setDescription(card.description ?? "");
    setLabels(card.labels);
    setMembers(card.members);
    setComments(card.comments);
    setChecklists(card.checklists ?? []);
  }, [card.id]);

  useEffect(() => {
    if (showMemberPicker && allUsers.length === 0) {
      api.get<User[]>("/auth/users").then(setAllUsers).catch(() => {});
    }
  }, [showMemberPicker]);

  async function patchCard(fields: Record<string, unknown>) {
    try {
      const updated = await api.patch<Card>(`/lists/${card.list_id}/cards/${card.id}`, fields);
      onCardUpdate({ id: card.id, ...updated });
    } catch {}
  }

  function handleTitleBlur() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === card.title) return;
    patchCard({ title: trimmed });
  }

  function handleDescriptionBlur() {
    const trimmed = description.trim();
    if (trimmed === (card.description ?? "")) return;
    patchCard({ description: trimmed || null });
  }

  async function handleAddComment() {
    const body = commentBody.trim();
    if (!body || submittingComment) return;
    setSubmittingComment(true);
    try {
      const comment = await api.post<Comment>(`/lists/${card.list_id}/cards/${card.id}/comments`, { body });
      const updated = [...comments, comment];
      setComments(updated);
      setCommentBody("");
      onCardUpdate({ id: card.id, comments: updated });
    } finally {
      setSubmittingComment(false);
    }
  }

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

  async function handleAddMember(user: User) {
    try {
      await api.post(`/lists/${card.list_id}/cards/${card.id}/members/${user.id}`, {});
      const updated = [...members, user];
      setMembers(updated);
      onCardUpdate({ id: card.id, members: updated });
      setShowMemberPicker(false);
    } catch {}
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-8"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-[900px] rounded-2xl bg-background-surface border border-border shadow-2xl mb-12 overflow-hidden flex flex-col">
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
              onBlur={handleTitleBlur}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleTitleBlur(); } }}
              rows={2}
              className="w-full text-xl font-bold text-slate-100 bg-transparent resize-none focus:outline-none leading-snug"
            />
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
                  <button onClick={() => setShowMemberPicker(p => !p)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border-2 border-dashed border-border text-slate-500 hover:border-primary hover:text-primary transition-colors text-xs">
                    <IUserPlus /><span>Adicionar</span>
                  </button>
                  {showMemberPicker && (
                    <div className="absolute top-full left-0 mt-1 z-20 w-52 rounded-xl bg-background-surface border border-border shadow-xl overflow-hidden">
                      {availableUsers.length === 0 ? (
                        <p className="text-xs text-slate-500 p-3 text-center">{allUsers.length === 0 ? "Carregando…" : "Todos já adicionados"}</p>
                      ) : availableUsers.map(u => (
                        <button key={u.id} onClick={() => handleAddMember(u)} className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-background-elevated transition-colors text-left">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-bold text-white leading-none">{u.initials}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-200 truncate">{u.name}</p>
                            <p className="text-[10px] text-slate-500 truncate">{u.email}</p>
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
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <IChat />
              <p className="text-sm font-semibold text-slate-300">
                Comentários e atividade
                {comments.length > 0 && <span className="font-normal text-slate-500 ml-1">({comments.length})</span>}
              </p>
            </div>

            {/* Comment input */}
            <div className="shrink-0 mb-4">
              <textarea
                value={commentBody}
                onChange={e => setCommentBody(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
                placeholder="Escrever um comentário…"
                rows={3}
                className="w-full text-sm text-slate-200 bg-background-elevated border border-border rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-slate-500 leading-relaxed"
              />
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
              {comments.map(c => (
                <div key={c.id} className="flex gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[9px] font-bold text-white leading-none">{c.author.initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-200">{c.author.name}</span>
                      <span className="text-[10px] text-slate-500 truncate">{new Date(c.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap bg-background-elevated rounded-lg px-2.5 py-2">{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── CardContent ────────────────────────────────────────────────

function CardContent({ card, isDragging = false }: { card: Card; isDragging?: boolean }) {
  const p = PRIORITY[card.priority];
  const due = card.due_date;
  const overdue = due && isOverdue(due);
  const dueToday = due && isToday(due);

  return (
    <div className={cn(
      "w-full text-left rounded-lg border border-border/60 border-l-4 p-3 transition-all duration-150",
      "bg-background-surface",
      isDragging ? "shadow-2xl rotate-1 opacity-95 scale-105" : "hover:border-border hover:shadow-md hover:shadow-black/20",
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

      {/* Title */}
      <p className="text-sm font-medium text-slate-100 line-clamp-2 leading-snug mb-1.5">
        {card.title}
      </p>

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

// ── KanbanCard ─────────────────────────────────────────────────

function KanbanCard({ card, onClick }: { card: Card; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("relative group/card", isDragging && "opacity-40")}>
      <div
        {...attributes} {...listeners}
        onPointerDown={e => e.stopPropagation()}
        className="absolute top-2 right-2 z-10 p-1 rounded opacity-0 group-hover/card:opacity-100 cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 hover:bg-background-elevated transition-all"
        title="Arrastar"
      >
        <IGrip />
      </div>
      <button type="button" className="w-full text-left" onClick={onClick}>
        <CardContent card={card} />
      </button>
    </div>
  );
}

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

function KanbanColumn({ list, cards, onCardAdded, onCardClick, onListUpdate, onListDelete }: {
  list: BoardList;
  cards: Card[];
  onCardAdded: (c: Card) => void;
  onCardClick: (card: Card) => void;
  onListUpdate: (updated: BoardList) => void;
  onListDelete: (listId: number) => void;
}) {
  const [addingCard, setAddingCard] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(list.title);
  const [showMenu, setShowMenu] = useState(false);
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
    <div className="flex flex-col w-[272px] shrink-0 rounded-xl overflow-hidden" style={{ backgroundColor: "rgba(13, 22, 36, 0.85)" }}>
      {/* Column header */}
      <div className="px-3 py-2.5 shrink-0 border-b border-white/5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: list.color }} />
            {isRenaming ? (
              <input
                ref={renameRef}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={handleRename}
                onKeyDown={e => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") { setRenameValue(list.title); setIsRenaming(false); } }}
                className="flex-1 text-sm font-semibold bg-background-elevated border border-primary/40 rounded px-2 py-0.5 text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary/60"
              />
            ) : (
              <button
                onClick={() => setIsRenaming(true)}
                className="text-sm font-semibold truncate text-slate-100 hover:text-primary transition-colors text-left"
                style={{ color: list.color }}
                title="Clique para renomear"
              >
                {list.title}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${list.color}20`, color: list.color }}>
              {cards.length}
            </span>
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
          {cards.map(card => <KanbanCard key={card.id} card={card} onClick={() => onCardClick(card)} />)}
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

// ── BoardPage ──────────────────────────────────────────────────

export function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const boardId = Number(id);

  const [board, setBoard] = useState<Board | null>(null);
  const [lists, setLists] = useState<BoardList[]>([]);
  const [cardsByList, setCardsByList] = useState<Record<number, Card[]>>({});
  const [loading, setLoading] = useState(true);
  const [addingList, setAddingList] = useState(false);
  const [search, setSearch] = useState("");
  const [filterPriority, setFilterPriority] = useState<Priority | null>(null);
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const currentListIdRef = useRef<number | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    if (!boardId) return;
    Promise.all([
      api.get<Board>(`/boards/${boardId}`),
      api.get<BoardList[]>(`/boards/${boardId}/lists`),
      api.get<BoardLabel[]>(`/boards/${boardId}/labels`),
    ]).then(async ([b, ls, lbls]) => {
      setBoard(b);
      setLists(ls);
      setBoardLabels(lbls);
      const entries = await Promise.all(
        ls.map(l => api.get<Card[]>(`/lists/${l.id}/cards`).then(cards => [l.id, cards] as [number, Card[]]))
      );
      setCardsByList(Object.fromEntries(entries));
    }).finally(() => setLoading(false));
  }, [boardId]);

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

  function onDragStart({ active }: DragStartEvent) {
    const cardId = active.id as number;
    const listId = findListOfCard(cardId) ?? null;
    setActiveCard(findCard(cardId) ?? null);
    setActiveListId(listId);
    currentListIdRef.current = listId;
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

  if (!board) return (
    <div className="flex flex-col flex-1 items-center justify-center gap-2">
      <p className="text-slate-500">Board não encontrado.</p>
      <button onClick={() => navigate("/boards")} className="text-sm text-primary hover:underline">Voltar</button>
    </div>
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
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
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: board.color }} />
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
                <button
                  onClick={() => setShowLabelManager(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border border-border text-slate-300 hover:bg-background-elevated active:scale-95 transition-all duration-150"
                >
                  <ITag />Etiquetas
                </button>
                <button
                  onClick={() => { setShowArchived(true); setArchivedTab("cards"); fetchArchived(); }}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border border-border text-slate-300 hover:bg-background-elevated active:scale-95 transition-all duration-150"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                  Arquivados
                </button>
                <button
                  onClick={() => setAddingList(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 active:scale-95 transition-all duration-150"
                >
                  <IPlus />Nova Lista
                </button>
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
            <div className="h-full overflow-x-auto">
              <div className="inline-flex gap-3 h-full p-3 items-start">
                {lists.map(list => (
                  <KanbanColumn
                    key={list.id}
                    list={list}
                    cards={filteredCards(list.id)}
                    onCardAdded={card => setCardsByList(prev => ({ ...prev, [list.id]: [...(prev[list.id] ?? []), card] }))}
                    onCardClick={card => setSelectedCard(card)}
                    onListUpdate={handleListUpdate}
                    onListDelete={handleListDelete}
                  />
                ))}
                {addingList ? (
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
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {selectedCard && (
        <CardDetailModal
          card={selectedCard}
          listTitle={lists.find(l => l.id === selectedCard.list_id)?.title ?? ""}
          lists={lists}
          boardLabels={boardLabels}
          onClose={() => setSelectedCard(null)}
          onCardUpdate={handleCardUpdate}
          onCardDelete={handleCardDelete}
          onCardCopy={handleCardCopy}
        />
      )}

      {/* Label Manager Panel */}
      {showLabelManager && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => { setShowLabelManager(false); setEditingLabel(null); }} />
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
                      <div className="flex gap-1.5 flex-wrap">
                        {LABEL_COLORS.map(c => (
                          <button key={c} onClick={() => setEditingLabel({ ...editingLabel, color: c })} className={cn("w-5 h-5 rounded-full border-2 transition-transform", editingLabel.color === c ? "scale-125 border-white/80" : "border-transparent")} style={{ backgroundColor: c }} />
                        ))}
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
              <div className="flex gap-1.5 flex-wrap">
                {LABEL_COLORS.map(c => (
                  <button key={c} onClick={() => setNewLabelColor(c)} className={cn("w-5 h-5 rounded-full border-2 transition-transform", newLabelColor === c ? "scale-125 border-white/80" : "border-transparent")} style={{ backgroundColor: c }} />
                ))}
              </div>
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
          <div className="flex-1 bg-black/40" onClick={() => setShowArchived(false)} />
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
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-200 font-medium truncate">{c.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">Lista: {c.list_title}</p>
                      </div>
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
          <div className="w-[272px] rotate-2 shadow-2xl">
            <CardContent card={activeCard} isDragging />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
