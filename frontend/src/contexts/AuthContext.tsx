import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { api } from "../lib/api";

interface User {
  id: number;
  name: string;
  email: string;
  initials: string;
  is_admin: boolean;
}

interface AuthContextValue {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// true se o JWT não existe ou já passou do exp.
function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const token = localStorage.getItem("taskhs-token");
    if (isTokenExpired(token)) {
      localStorage.removeItem("taskhs-token");
      localStorage.removeItem("taskhs-user");
      return null;
    }
    const raw = localStorage.getItem("taskhs-user");
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ access_token: string; user: User }>("/auth/login", { email, password });
    localStorage.setItem("taskhs-token", data.access_token);
    localStorage.setItem("taskhs-user", JSON.stringify(data.user));
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("taskhs-token");
    localStorage.removeItem("taskhs-user");
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
