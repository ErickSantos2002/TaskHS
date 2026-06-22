import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { cn } from "../lib/utils";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import logo from "../assets/logo.png";
import { APP_VERSION } from "../data/changelog";
import { ChangelogModal } from "../components/ChangelogModal";

interface AppNotification {
  id: number;
  type: string;
  message: string;
  card_id: number | null;
  board_id: number | null;
  read: boolean;
  created_at: string;
}

// ── Icons ─────────────────────────────────────────────────────

function IconDashboard() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}
function IconBoards() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}
function IconMenu() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
function IconSun() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 7a5 5 0 100 10A5 5 0 0012 7z" />
    </svg>
  );
}
function IconMoon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}
function IconBell() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

// ── Nav items ─────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: "Dashboard", icon: <IconDashboard />, to: "/",        adminOnly: false },
  { label: "Boards",    icon: <IconBoards />,    to: "/boards",  adminOnly: false },
  { label: "Usuários",  icon: <IconUsers />,     to: "/usuarios", adminOnly: true },
];

// ── Layout ────────────────────────────────────────────────────

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [dark, setDark] = useState(() => localStorage.getItem("taskhs-theme") !== "light");
  const [collapsed, setCollapsed] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  const unread = notifications.filter(n => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.get<AppNotification[]>("/notifications");
      setNotifications(data);
    } catch {}
  }, [user]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    }
    if (showNotifications) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showNotifications]);

  async function handleMarkRead(id: number) {
    try {
      await api.post(`/notifications/${id}/read`, {});
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch {}
  }

  async function handleMarkAllRead() {
    try {
      await api.post("/notifications/read-all", {});
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  }

  function handleNotificationClick(n: AppNotification) {
    handleMarkRead(n.id);
    if (n.board_id) navigate(`/boards/${n.board_id}`);
    setShowNotifications(false);
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    localStorage.setItem("taskhs-theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Sidebar ── */}
      <aside
        className={cn(
          "flex flex-col shrink-0",
          "bg-background-sidebar",
          "border-r border-border",
          "transition-[width] duration-300 ease-in-out overflow-hidden",
          collapsed ? "w-18" : "w-64",
        )}
      >
        {/* Logo */}
        <div className={cn(
          "flex h-16 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-0" : "px-5",
        )}>
          {collapsed ? (
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/15">
              <span className="text-sm font-bold text-primary">T</span>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <img src={logo} alt="" className="w-5 h-5 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
              </div>
              <span className="font-bold text-slate-100 text-base tracking-tight">TaskHS</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-0.5">
          {NAV_ITEMS.filter(item => !item.adminOnly || user?.is_admin).map(({ label, icon, to }) => {
            const active = to === "/" ? location.pathname === "/" || location.pathname === "/dashboard" : location.pathname.startsWith(to);
            return (
            <Link
              key={label}
              to={to}
              title={collapsed ? label : undefined}
              className={cn(
                "relative group flex items-center w-full rounded-lg text-sm font-medium transition-all duration-200",
                collapsed ? "justify-center px-0 py-2.5 mx-1" : "gap-3 px-3 py-2",
                active
                  ? [
                      "bg-primary/10 text-primary font-semibold",
                      !collapsed && "shadow-[inset_2px_0_0_#10b981] pl-2.5",
                    ]
                  : [
                      !collapsed && "pl-2.5",
                      "text-slate-400 dark:text-slate-500",
                      "hover:bg-background-elevated hover:text-slate-100",
                    ],
              )}
            >
              {icon}
              {!collapsed && <span className="truncate">{label}</span>}
              {collapsed && (
                <span className="pointer-events-none absolute left-full ml-3 z-50 whitespace-nowrap rounded-lg bg-background-surface border border-border px-2.5 py-1.5 text-xs font-medium text-slate-200 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  {label}
                </span>
              )}
            </Link>
            );
          })}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div className="shrink-0 border-t border-border px-5 py-4">
            <button
              onClick={() => setShowChangelog(true)}
              title="Ver novidades"
              className="group w-full flex flex-col items-start gap-1 -mx-1 rounded-lg px-2 py-1.5 text-left hover:bg-background-elevated transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white">TaskHS</span>
                <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold group-hover:bg-primary/20 transition-colors">v{APP_VERSION}</span>
              </div>
              <span className="text-[10px] text-slate-500">© 2026 Health &amp; Safety Tech</span>
            </button>
          </div>
        )}
      </aside>

      {/* ── Main ── */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        {/* Topbar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-background-sidebar px-4 md:px-6">
          <button
            className="rounded-lg p-2 text-slate-400 hover:bg-background-elevated hover:text-slate-100 transition-colors duration-200"
            onClick={() => setCollapsed(v => !v)}
          >
            <IconMenu />
          </button>

          <div className="flex-1" />

          <div className="flex items-center gap-1">
            {/* Theme toggle */}
            <button
              className="rounded-lg p-2 text-slate-400 hover:bg-background-elevated hover:text-slate-100 transition-colors duration-200"
              onClick={toggleTheme}
              title={dark ? "Modo claro" : "Modo escuro"}
            >
              {dark ? <IconSun /> : <IconMoon />}
            </button>

            {/* Bell */}
            <div className="relative" ref={bellRef}>
              <button
                onClick={() => setShowNotifications(v => !v)}
                className="relative rounded-lg p-2 text-slate-400 hover:bg-background-elevated hover:text-slate-100 transition-colors duration-200"
              >
                <IconBell />
                {unread > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
              {showNotifications && (
                <div className="absolute right-0 top-full mt-2 w-80 rounded-xl bg-background-surface border border-border shadow-2xl z-50 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <p className="text-sm font-semibold text-slate-200">Notificações</p>
                    {unread > 0 && (
                      <button onClick={handleMarkAllRead} className="text-xs text-primary hover:underline">Marcar todas como lidas</button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 && (
                      <p className="text-xs text-slate-500 italic text-center py-8">Nenhuma notificação.</p>
                    )}
                    {notifications.map(n => (
                      <button
                        key={n.id}
                        onClick={() => handleNotificationClick(n)}
                        className={cn(
                          "w-full text-left px-4 py-3 border-b border-border/50 hover:bg-background-elevated transition-colors flex gap-3 items-start",
                          !n.read && "bg-primary/5"
                        )}
                      >
                        <span className={cn("w-2 h-2 rounded-full shrink-0 mt-1.5", n.read ? "bg-slate-600" : "bg-primary")} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-slate-200 leading-relaxed">{n.message}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {new Date(n.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* User */}
            <div className="flex items-center gap-1 ml-2 pl-2 border-l border-border">
              <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                  {user?.initials ?? "?"}
                </div>
                <div className="hidden md:block text-left">
                  <p className="text-sm font-semibold text-slate-100 leading-tight">{user?.name ?? ""}</p>
                  <p className="text-xs text-slate-500 leading-tight">{user?.is_admin ? "Administrador" : "Membro"}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                title="Sair"
                className="rounded-lg p-2 text-slate-400 hover:bg-background-elevated hover:text-danger-400 transition-colors duration-200"
              >
                <IconLogout />
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex flex-col flex-1 overflow-hidden">
          {children}
        </main>
      </div>
      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
    </div>
  );
}
