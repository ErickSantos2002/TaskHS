import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import type { SearchResult } from "../types";

const MINIMO = 2;
const DEBOUNCE_MS = 250;

function IconSearch() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
    </svg>
  );
}

/** Destaca os termos no trecho. Sem HTML vindo do backend: o realce é feito
 *  aqui, quebrando a string em pedaços.
 *
 *  O realce é literal, sem normalizar acento: quem digita "calibracao" acha o
 *  card (isso é o backend), mas o "Calibração" do texto não fica em negrito.
 *  É cosmético e proposital — normalizar aqui exigiria mapear índice a índice
 *  entre o texto original e o normalizado. */
function Realce({ texto, termos }: { texto: string; termos: string[] }) {
  if (termos.length === 0) return <>{texto}</>;
  const escapados = termos.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const partes = texto.split(new RegExp(`(${escapados.join("|")})`, "gi"));
  const alvo = new Set(termos.map(t => t.toLowerCase()));
  return (
    <>
      {partes.map((p, i) =>
        alvo.has(p.toLowerCase())
          ? <mark key={i} className="bg-primary/25 text-primary font-semibold rounded-sm px-0.5">{p}</mark>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<SearchResult[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const caixaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Cada busca leva um número; resposta que não é da última é descartada.
  // Sem isto, a busca lenta de "VAM" chega depois e sobrescreve "VAM5D0008".
  const requisicaoRef = useRef(0);

  const termos = q.trim().split(/\s+/).filter(t => t.length >= MINIMO);

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < MINIMO) {
      setResultados([]); setBuscando(false); setErro(false);
      return;
    }
    setBuscando(true);
    const id = ++requisicaoRef.current;
    const timer = setTimeout(() => {
      api.get<SearchResult[]>(`/search?q=${encodeURIComponent(texto)}&limit=20`)
        .then(rs => {
          if (id !== requisicaoRef.current) return;   // resposta velha
          setResultados(rs); setErro(false); setMarcado(0);
        })
        .catch(() => { if (id === requisicaoRef.current) { setResultados([]); setErro(true); } })
        .finally(() => { if (id === requisicaoRef.current) setBuscando(false); });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  // Ctrl+K / ⌘+K foca a caixa de qualquer lugar do app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    function onClickFora(e: MouseEvent) {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false);
    }
    if (aberto) document.addEventListener("mousedown", onClickFora);
    return () => document.removeEventListener("mousedown", onClickFora);
  }, [aberto]);

  const abrir = useCallback((r: SearchResult) => {
    setAberto(false);
    setQ("");
    navigate(`/boards/${r.board_id}?card=${r.card_id}&list=${r.list_id}`);
  }, [navigate]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (aberto) setAberto(false); else setQ("");
      return;
    }
    if (!aberto || resultados.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setMarcado(m => (m + 1) % resultados.length); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setMarcado(m => (m - 1 + resultados.length) % resultados.length); }
    if (e.key === "Enter")     { e.preventDefault(); abrir(resultados[marcado]); }
  }

  const mostrarPainel = aberto && q.trim().length >= MINIMO;

  return (
    <div className="relative w-full max-w-md" ref={caixaRef}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"><IconSearch /></span>
      <input
        ref={inputRef}
        value={q}
        onChange={e => { setQ(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        onKeyDown={onKeyDown}
        type="text"
        placeholder="Buscar card em todos os quadros…"
        className="w-full pl-9 pr-14 py-2 text-sm rounded-lg border border-border bg-background-elevated text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors"
      />
      <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-500 border border-border rounded px-1.5 py-0.5 pointer-events-none">Ctrl K</kbd>

      {mostrarPainel && (
        <div className="absolute left-0 top-full mt-2 w-full rounded-xl bg-background-surface border border-border shadow-2xl z-50 overflow-hidden">
          {buscando && <p className="text-xs text-slate-500 px-4 py-3">Buscando…</p>}
          {!buscando && erro && <p className="text-xs text-red-400 px-4 py-3">Não foi possível buscar agora.</p>}
          {!buscando && !erro && resultados.length === 0 && (
            <p className="text-xs text-slate-500 px-4 py-3">Nenhum resultado para “{q.trim()}”.</p>
          )}
          <div className="max-h-96 overflow-y-auto">
            {resultados.map((r, i) => (
              <button
                key={r.card_id}
                onClick={() => abrir(r)}
                onMouseEnter={() => setMarcado(i)}
                className={cn(
                  "w-full text-left px-4 py-2.5 border-b border-border/50 last:border-b-0 transition-colors",
                  i === marcado ? "bg-background-elevated" : "hover:bg-background-elevated",
                )}
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-200 truncate flex-1">
                    <Realce texto={r.title} termos={termos} />
                  </p>
                  {r.archived && (
                    <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-500/20 text-slate-400">Arquivado</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                  <span style={r.board_color ? { color: r.board_color } : undefined}>{r.board_title}</span>
                  {" › "}{r.list_title}
                </p>
                {r.matched_field !== "titulo" && (
                  <p className="text-[11px] text-slate-400 mt-1 truncate">
                    <Realce texto={r.snippet} termos={termos} />
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
