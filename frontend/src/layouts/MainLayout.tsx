import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { cn } from "../lib/utils";
import { useAuth } from "../contexts/AuthContext";
import logo from "../assets/logo.png";

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
function IconSettings() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
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
  { label: "Dashboard",     icon: <IconDashboard />, to: "/dashboard" },
  { label: "Boards",        icon: <IconBoards />,    to: "/boards"    },
  { label: "Configurações", icon: <IconSettings />,  to: "/settings"  },
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
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-background">
      {/* ── Sidebar ── */}
      <aside
        className={cn(
          "flex flex-col shrink-0",
          "bg-white dark:bg-background-surface",
          "border-r border-slate-200 dark:border-border",
          "transition-[width] duration-300 ease-in-out overflow-hidden",
          collapsed ? "w-18" : "w-64",
        )}
      >
        {/* Logo */}
        <div className={cn(
          "flex h-16 shrink-0 items-center",
          collapsed ? "justify-center px-0" : "px-5",
        )}>
          {collapsed ? (
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 dark:bg-primary/15">
              <span className="text-sm font-bold text-primary">T</span>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 dark:bg-primary/15 flex items-center justify-center shrink-0">
                <img src={logo} alt="" className="w-5 h-5 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
              </div>
              <span className="font-extrabold text-slate-900 dark:text-slate-100 text-lg tracking-tight">TaskHS</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-0.5">
          {NAV_ITEMS.map(({ label, icon, to }) => {
            const active = location.pathname.startsWith(to);
            return (
            <Link
              key={label}
              to={to}
              title={collapsed ? label : undefined}
              className={cn(
                "relative group flex items-center w-full rounded-lg text-sm font-medium transition-all duration-150",
                collapsed ? "justify-center px-0 py-2.5 mx-1" : "gap-3 px-3 py-2",
                active
                  ? [
                      "bg-primary/10 dark:bg-primary/15 text-primary",
                      !collapsed && "border-l-2 border-primary pl-2.5",
                    ]
                  : [
                      !collapsed && "border-l-2 border-transparent pl-2.5",
                      "text-slate-500 dark:text-slate-400",
                      "hover:bg-slate-100 dark:hover:bg-background-elevated",
                      "hover:text-slate-900 dark:hover:text-slate-100",
                    ],
              )}
            >
              {icon}
              {!collapsed && <span className="truncate">{label}</span>}
              {collapsed && (
                <span className="pointer-events-none absolute left-full ml-3 z-50 whitespace-nowrap rounded-lg bg-slate-900 dark:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  {label}
                </span>
              )}
            </Link>
            );
          })}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div className="shrink-0 border-t border-slate-200 dark:border-border px-5 py-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400 dark:text-slate-600">TaskHS</p>
              <span className="rounded-full bg-slate-100 dark:bg-background-elevated px-2 py-0.5 text-[10px] font-medium text-slate-500">v0.1.0</span>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main ── */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        {/* Topbar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 dark:border-border bg-white dark:bg-background-surface px-4 md:px-6">
          <button
            className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-background-elevated hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            onClick={() => setCollapsed(v => !v)}
          >
            <IconMenu />
          </button>

          <div className="flex-1" />

          <div className="flex items-center gap-1">
            {/* Theme toggle */}
            <button
              className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-background-elevated hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
              onClick={toggleTheme}
              title={dark ? "Modo claro" : "Modo escuro"}
            >
              {dark ? <IconSun /> : <IconMoon />}
            </button>

            {/* Bell */}
            <button className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-background-elevated hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
              <IconBell />
            </button>

            {/* User */}
            <div className="flex items-center gap-1 ml-1">
              <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                  {user?.initials ?? "?"}
                </div>
                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium text-slate-100 leading-tight">{user?.name ?? ""}</p>
                  <p className="text-xs text-slate-500 leading-tight">{user?.is_admin ? "Administrador" : "Membro"}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                title="Sair"
                className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-background-elevated hover:text-danger transition-colors"
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
    </div>
  );
}
