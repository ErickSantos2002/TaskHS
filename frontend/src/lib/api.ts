const BASE = "http://localhost:8000/api";

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("taskhs-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...authHeaders(), ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Erro inesperado");
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
