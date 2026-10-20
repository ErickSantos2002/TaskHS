import { useState, useEffect, useCallback } from "react";
import { cn } from "../lib/utils";
import { api, ApiError } from "../lib/api";
import { BoardIcon } from "./BoardIcon";
import type { TrashCard, TrashList, TrashBoard } from "../types";

// Lixeira (v2.7.0). Excluir só marca deleted_at; restaurar é de qualquer membro
// do quadro, "Apagar de vez" só do administrador (o backend tranca também —
// aqui é só esconder o botão). Ver spec 2026-10-20-lixeira-design.md.

const ITrash = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);
const IX = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);
const ISpinner = () => (
  <svg className="w-5 h-5 animate-spin text-slate-500" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
  </svg>
);

export { ITrash as ILixeira };

function quando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

/** Linha da lixeira: título, detalhes e os dois botões. O "Apagar de vez" pede
 *  confirmação ali mesmo (sem window.confirm, que trava a automação do navegador
 *  e destoa do resto do app). */
function LinhaLixeira({
  titulo, cor, icone, detalhes, excluidoPor, excluidoEm, podeApagar, ocupado, onRestaurar, onApagar, avisoApagar,
}: {
  titulo: string;
  cor?: string;
  icone?: React.ReactNode;
  detalhes: string[];
  excluidoPor: string;
  excluidoEm: string;
  podeApagar: boolean;
  ocupado: boolean;
  onRestaurar: () => void;
  onApagar: () => void;
  avisoApagar: string;
}) {
  const [confirmando, setConfirmando] = useState(false);
  return (
    <div className="p-3 rounded-lg bg-background-elevated border border-border space-y-2">
      <div className="flex items-start gap-2 min-w-0">
        {icone ?? (cor && <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: cor }} />)}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-200 font-medium truncate">{titulo}</p>
          {detalhes.length > 0 && <p className="text-xs text-slate-500 mt-0.5">{detalhes.join(" · ")}</p>}
          <p className="text-xs text-slate-500 mt-0.5">
            excluído por <span className="text-slate-400 font-medium">{excluidoPor}</span> em {quando(excluidoEm)}
          </p>
        </div>
      </div>
      {confirmando ? (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-red-300">{avisoApagar} <span className="font-semibold">Não dá para desfazer.</span></p>
          <div className="flex gap-1.5">
            <button onClick={() => setConfirmando(false)} disabled={ocupado} className="flex-1 text-xs py-1.5 rounded-md border border-border text-slate-400 hover:bg-background transition-colors">Cancelar</button>
            <button onClick={onApagar} disabled={ocupado} className="flex-1 text-xs py-1.5 rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors font-semibold">
              {ocupado ? "Apagando…" : "Apagar de vez"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button onClick={onRestaurar} disabled={ocupado} className="text-xs px-2.5 py-1 rounded-md bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50 transition-colors font-semibold">
            {ocupado ? "…" : "Restaurar"}
          </button>
          {podeApagar && (
            <button onClick={() => setConfirmando(true)} disabled={ocupado} className="text-xs px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors font-semibold">
              Apagar de vez
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PainelLateral({ titulo, subtitulo, onClose, children }: {
  titulo: string; subtitulo: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-[420px] bg-background-surface border-l border-border flex flex-col h-full shadow-2xl">
        <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-slate-400"><ITrash /></span>
              <h2 className="text-sm font-semibold text-slate-200">{titulo}</h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">{subtitulo}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-background-elevated transition-colors"><IX /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Lixeira do quadro (cards e listas) ───────────────────────────────────────

export function BoardTrashPanel({ boardId, isAdmin, onClose, onChanged }: {
  boardId: number;
  isAdmin: boolean;
  onClose: () => void;
  /** Depois de restaurar: o SSE já atualiza, mas recarregar garante a tela certa
   *  mesmo se o stream estiver caído. */
  onChanged: () => void;
}) {
  const [aba, setAba] = useState<"cards" | "lists">("cards");
  const [cards, setCards] = useState<TrashCard[]>([]);
  const [lists, setLists] = useState<TrashList[]>([]);
  const [loading, setLoading] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    return api.get<{ cards: TrashCard[]; lists: TrashList[] }>(`/boards/${boardId}/trash`)
      .then(d => { setCards(d.cards); setLists(d.lists); })
      .catch(e => setErro(e instanceof ApiError ? e.message : "Não foi possível carregar a lixeira."))
      .finally(() => setLoading(false));
  }, [boardId]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function agir(chave: string, fn: () => Promise<unknown>, depois: () => void) {
    setOcupado(chave);
    setErro(null);
    try {
      await fn();
      depois();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível concluir. Tente de novo.");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <PainelLateral titulo="Lixeira do quadro" subtitulo="Tudo que foi excluído fica aqui até um administrador apagar de vez." onClose={onClose}>
      <div className="flex border-b border-border shrink-0">
        <button onClick={() => setAba("cards")} className={cn("flex-1 py-2.5 text-xs font-semibold transition-colors", aba === "cards" ? "text-primary border-b-2 border-primary" : "text-slate-500 hover:text-slate-300")}>
          Cards ({cards.length})
        </button>
        <button onClick={() => setAba("lists")} className={cn("flex-1 py-2.5 text-xs font-semibold transition-colors", aba === "lists" ? "text-primary border-b-2 border-primary" : "text-slate-500 hover:text-slate-300")}>
          Listas ({lists.length})
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {erro && <p className="text-xs text-danger">{erro}</p>}
        {loading && <div className="flex justify-center pt-8"><ISpinner /></div>}
        {!loading && aba === "cards" && (
          cards.length === 0
            ? <p className="text-xs text-slate-500 italic text-center pt-8">Nenhum card na lixeira.</p>
            : cards.map(c => (
              <LinhaLixeira
                key={c.id}
                titulo={c.title}
                detalhes={[
                  `Lista: ${c.list_title}`,
                  ...(c.comments ? [plural(c.comments, "comentário", "comentários")] : []),
                  ...(c.attachments ? [plural(c.attachments, "anexo", "anexos")] : []),
                  ...(c.checklists ? [plural(c.checklists, "checklist", "checklists")] : []),
                ]}
                excluidoPor={c.deleted_by_name}
                excluidoEm={c.deleted_at}
                podeApagar={isAdmin}
                ocupado={ocupado === `c${c.id}`}
                avisoApagar="O card, os comentários, checklists e anexos somem para sempre."
                onRestaurar={() => agir(`c${c.id}`, () => api.post(`/boards/${boardId}/trash/cards/${c.id}/restore`, {}), () => {
                  setCards(prev => prev.filter(x => x.id !== c.id));
                  onChanged();
                })}
                onApagar={() => agir(`c${c.id}`, () => api.del(`/boards/${boardId}/trash/cards/${c.id}`), () => {
                  setCards(prev => prev.filter(x => x.id !== c.id));
                })}
              />
            ))
        )}
        {!loading && aba === "lists" && (
          lists.length === 0
            ? <p className="text-xs text-slate-500 italic text-center pt-8">Nenhuma lista na lixeira.</p>
            : lists.map(l => (
              <LinhaLixeira
                key={l.id}
                titulo={l.title}
                cor={l.color}
                detalhes={[`${plural(l.cards, "card volta", "cards voltam")} junto`]}
                excluidoPor={l.deleted_by_name}
                excluidoEm={l.deleted_at}
                podeApagar={isAdmin}
                ocupado={ocupado === `l${l.id}`}
                avisoApagar="A lista e todos os cards dela somem para sempre."
                onRestaurar={() => agir(`l${l.id}`, () => api.post(`/boards/${boardId}/trash/lists/${l.id}/restore`, {}), () => {
                  // A lista volta e os cards dela que estavam na lixeira passam a
                  // aparecer na aba de cards: recarrega as duas.
                  carregar();
                  onChanged();
                })}
                onApagar={() => agir(`l${l.id}`, () => api.del(`/boards/${boardId}/trash/lists/${l.id}`), () => {
                  setLists(prev => prev.filter(x => x.id !== l.id));
                })}
              />
            ))
        )}
      </div>
    </PainelLateral>
  );
}

// ── Lixeira de quadros (só administrador) ────────────────────────────────────

export function BoardsTrashPanel({ onClose, onRestored }: {
  onClose: () => void;
  /** Quadro restaurado: a página de quadros recarrega a listagem. */
  onRestored: () => void;
}) {
  const [boards, setBoards] = useState<TrashBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.get<TrashBoard[]>("/trash/boards")
      .then(setBoards)
      .catch(e => setErro(e instanceof ApiError ? e.message : "Não foi possível carregar a lixeira."))
      .finally(() => setLoading(false));
  }, []);

  async function agir(id: number, fn: () => Promise<unknown>, depois: () => void) {
    setOcupado(id);
    setErro(null);
    try {
      await fn();
      setBoards(prev => prev.filter(b => b.id !== id));
      depois();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível concluir. Tente de novo.");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <PainelLateral titulo="Lixeira de quadros" subtitulo="Quadros excluídos. Só administradores veem esta lixeira." onClose={onClose}>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {erro && <p className="text-xs text-danger">{erro}</p>}
        {loading && <div className="flex justify-center pt-8"><ISpinner /></div>}
        {!loading && boards.length === 0 && (
          <p className="text-xs text-slate-500 italic text-center pt-8">Nenhum quadro na lixeira.</p>
        )}
        {!loading && boards.map(b => (
          <LinhaLixeira
            key={b.id}
            titulo={b.title}
            icone={
              <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: b.color }}>
                <BoardIcon name={b.icon} className="w-4 h-4" />
              </span>
            }
            detalhes={[`Dono: ${b.owner_name}`, plural(b.lists, "lista", "listas"), plural(b.cards, "card", "cards")]}
            excluidoPor={b.deleted_by_name}
            excluidoEm={b.deleted_at}
            podeApagar
            ocupado={ocupado === b.id}
            avisoApagar="O quadro, todas as listas, cards e anexos somem para sempre."
            onRestaurar={() => agir(b.id, () => api.post(`/trash/boards/${b.id}/restore`, {}), onRestored)}
            onApagar={() => agir(b.id, () => api.del(`/trash/boards/${b.id}`), () => {})}
          />
        ))}
      </div>
    </PainelLateral>
  );
}
