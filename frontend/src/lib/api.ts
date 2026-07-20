export const API_BASE: string = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api";

/** Erro de API que preserva o status HTTP — sem isto não dá para distinguir
 *  "não é membro" (403) de qualquer outra falha. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("taskhs-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Token expirado/inválido → limpa a sessão e volta pro login.
function onUnauthorized() {
  localStorage.removeItem("taskhs-token");
  localStorage.removeItem("taskhs-user");
  if (window.location.pathname !== "/login") window.location.assign("/login");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...authHeaders(), ...options.headers },
    ...options,
  });
  if (res.status === 401) {
    onUnauthorized();
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, err.detail ?? "Erro inesperado");
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  get:  <T>(path: string)                => request<T>(path),
  patch:<T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del:  <T>(path: string)                => request<T>(path, { method: "DELETE" }),
  upload: async <T>(path: string, files: File[]): Promise<T> => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { ...authHeaders() }, body: fd });
    if (res.status === 401) {
      onUnauthorized();
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(res.status, err.detail ?? "Erro no upload");
    }
    return res.json();
  },
  getBlob: async (path: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}${path}`, { headers: { ...authHeaders() } });
    if (res.status === 401) {
      onUnauthorized();
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    // Preserva o detail do backend (ex.: "Arquivo não encontrado no disco") — sem isso
    // a tela só conseguia dizer "falhou", sem dizer por quê.
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json())?.detail ?? ""; } catch { /* corpo não-JSON */ }
      throw new Error(detail || `Falha ao baixar arquivo (${res.status})`);
    }
    return res.blob();
  },
};
