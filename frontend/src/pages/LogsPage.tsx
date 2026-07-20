import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import { Pagination } from "../components/Pagination";
import type { AuditLog, User } from "../types";

const ACTIONS = ["criar", "editar", "mover", "excluir", "login", "login_falhou", "acesso_negado"];
const ENTITIES = [
  "quadro", "lista", "card", "etiqueta_quadro", "etiqueta_card", "membro_quadro", "membro_card",
  "comentario", "checklist", "item_checklist", "anexo", "lembrete", "automacao", "usuario", "sessao",
];

const ACTION_CLASS: Record<string, string> = {
  criar: "bg-emerald-500/15 text-emerald-400",
  editar: "bg-sky-500/15 text-sky-400",
  mover: "bg-violet-500/15 text-violet-400",
  excluir: "bg-red-500/15 text-red-400",
  login: "bg-slate-500/15 text-slate-400",
  login_falhou: "bg-amber-500/15 text-amber-400",
  acesso_negado: "bg-red-500/15 text-red-400",
};

const PAGE = 50;

export function LogsPage() {
  const { user: me } = useAuth();
  const navigate = useNavigate();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [fActor, setFActor] = useState("");
  const [fAction, setFAction] = useState("");
  const [fEntity, setFEntity] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fQ, setFQ] = useState("");

  const isAdmin = me?.role === "administrador";

  const [appliedBase, setAppliedBase] = useState("");   // filtros aplicados (sem limit/offset)

  const currentBase = useCallback(() => {
    const p = new URLSearchParams();
    if (fActor) p.set("actor_user_id", fActor);
    if (fAction) p.set("action", fAction);
    if (fEntity) p.set("entity_type", fEntity);
    if (fFrom) p.set("date_from", fFrom);
    if (fTo) p.set("date_to", fTo);
    if (fQ.trim()) p.set("q", fQ.trim());
    return p.toString();
  }, [fActor, fAction, fEntity, fFrom, fTo, fQ]);

  const load = useCallback(async (off: number, append: boolean, base: string) => {
    setLoading(true);
    try {
      const p = new URLSearchParams(base);
      p.set("limit", String(PAGE));
      p.set("offset", String(off));
      const data = await api.get<{ total: number; items: AuditLog[] }>(`/logs?${p.toString()}`);
      setTotal(data.total);
      setOffset(off);
      setLogs(prev => (append ? [...prev, ...data.items] : data.items));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) { navigate("/boards", { replace: true }); return; }
    api.get<User[]>("/auth/users").then(setUsers).catch(() => {});
    load(0, false, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  function aplicar() {
    const base = currentBase();
    setAppliedBase(base);
    setExpanded(null);
    load(0, false, base);
  }

  function limpar() {
    setFActor(""); setFAction(""); setFEntity(""); setFFrom(""); setFTo(""); setFQ("");
    setAppliedBase("");
    setExpanded(null);
    load(0, false, "");
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const currentPage = Math.floor(offset / PAGE) + 1;

  /** Troca de página busca no servidor e SUBSTITUI a lista (não acumula, como
   *  fazia o antigo "Carregar mais"). Volta o scroll ao topo, senão a pessoa
   *  cai no meio da página nova. */
  function irParaPagina(pagina: number) {
    const alvo = Math.min(Math.max(1, pagina), totalPages);
    if (alvo === currentPage) return;
    setExpanded(null);
    load((alvo - 1) * PAGE, false, appliedBase);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  const inputCls = "text-sm rounded-lg border border-slate-200 dark:border-border bg-transparent px-2.5 py-1.5 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/40";

  return (
    <div ref={scrollRef} className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      {/* Largura cheia, igual a Dashboard e Boards — sem max-w/mx-auto. */}
      <div className="w-full px-4 md:px-6 py-6 space-y-5">

        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">Logs</h1>
          <p className="text-sm text-slate-500 mt-0.5">Auditoria de tudo que acontece no sistema — {total} registro{total !== 1 ? "s" : ""}</p>
        </div>

        {/* Filtros */}
        <div className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-background-surface p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <select value={fActor} onChange={e => setFActor(e.target.value)} className={inputCls}>
              <option value="">Todas as pessoas</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select value={fAction} onChange={e => setFAction(e.target.value)} className={inputCls}>
              <option value="">Todas as ações</option>
              {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={fEntity} onChange={e => setFEntity(e.target.value)} className={inputCls}>
              <option value="">Todos os tipos</option>
              {ENTITIES.map(e2 => <option key={e2} value={e2}>{e2}</option>)}
            </select>
            <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} className={inputCls} />
            <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} className={inputCls} />
            <input
              value={fQ}
              onChange={e => setFQ(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") aplicar(); }}
              placeholder="Buscar no texto…"
              className={inputCls}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={aplicar} className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-600 transition-colors">Aplicar</button>
            <button onClick={limpar} className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-border text-slate-500 hover:bg-slate-50 dark:hover:bg-background-elevated transition-colors">Limpar</button>
          </div>
        </div>

        {/* Lista */}
        <div className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-background-surface divide-y divide-slate-100 dark:divide-border overflow-hidden">
          {logs.length === 0 && !loading && (
            <p className="text-sm text-slate-500 italic text-center py-10">Nenhum registro encontrado.</p>
          )}
          {logs.map(l => (
            <div key={l.id}>
              <button
                onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-background-elevated transition-colors flex items-start gap-3"
              >
                <span className="text-xs text-slate-400 shrink-0 w-32 pt-0.5">
                  {new Date(l.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className={cn("shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full h-fit", ACTION_CLASS[l.action] ?? "bg-slate-500/15 text-slate-400")}>
                  {l.action}
                </span>
                <span className="flex-1 min-w-0 text-sm text-slate-700 dark:text-slate-200">
                  <strong className="font-semibold text-slate-900 dark:text-white">{l.actor_name}</strong>{" "}
                  {l.summary}
                </span>
                <span className="shrink-0 text-[10px] text-slate-400 pt-1">{l.entity_type}</span>
              </button>
              {expanded === l.id && (
                <div className="px-4 pb-4 pt-1 bg-slate-50 dark:bg-background-elevated text-xs space-y-2">
                  <p className="text-slate-500">
                    {l.actor_type} · {l.actor_email ?? "—"} · {l.ip ?? "—"} · {l.path ?? "—"}
                  </p>

                  {/* Atalhos: não mostra link para a entidade que a própria linha excluiu (não existe mais). */}
                  {(() => {
                    const mostraQuadro = !!l.board_id && !(l.action === "excluir" && l.entity_type === "quadro");
                    const mostraCard = !!l.card_id && !!l.board_id && !(l.action === "excluir" && l.entity_type === "card");
                    if (!mostraQuadro && !mostraCard) return null;
                    const chip = "inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-2 py-0.5 font-semibold hover:bg-primary/20 transition-colors";
                    return (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">Abrir:</span>
                        {mostraQuadro && (
                          <Link to={`/boards/${l.board_id}`} className={chip}>Quadro #{l.board_id}</Link>
                        )}
                        {mostraCard && (
                          <Link to={`/boards/${l.board_id}?card=${l.card_id}`} className={chip}>Card #{l.card_id}</Link>
                        )}
                      </div>
                    );
                  })()}

                  {l.changes ? (
                    <table className="w-full">
                      <thead>
                        <tr className="text-slate-400">
                          <th className="text-left font-semibold py-1">Campo</th>
                          <th className="text-left font-semibold py-1">De</th>
                          <th className="text-left font-semibold py-1">Para</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-600 dark:text-slate-300">
                        {Object.entries(l.changes).map(([campo, v]) => {
                          // Tolera o formato antigo de exclusão (valor solto, sem de/para):
                          // registros gravados antes da correção mostram o valor em "De".
                          const par =
                            v !== null && typeof v === "object" && ("de" in v || "para" in v)
                              ? (v as { de: unknown; para: unknown })
                              : { de: v as unknown, para: null };
                          return (
                            <tr key={campo} className="border-t border-slate-200 dark:border-border">
                              <td className="py-1 pr-3 font-medium">{campo}</td>
                              <td className="py-1 pr-3 text-slate-400">{String(par.de ?? "—")}</td>
                              <td className="py-1">{String(par.para ?? "—")}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-slate-400 italic">Sem detalhes de alteração.</p>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Paginação servida pelo backend: as props saem do offset/total que a
              API devolve, não de um array completo em memória — são milhares de
              registros. Fica DENTRO do card da lista, como um rodapé dele. */}
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={total}
            startIndex={offset}
            endIndex={Math.min(offset + PAGE, total)}
            hasNextPage={currentPage < totalPages}
            hasPrevPage={currentPage > 1}
            goToPage={irParaPagina}
            goToNextPage={() => irParaPagina(currentPage + 1)}
            goToPrevPage={() => irParaPagina(currentPage - 1)}
            itemLabel="registros"
          />
        </div>
      </div>
    </div>
  );
}
