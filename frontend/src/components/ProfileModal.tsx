import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth, type User } from "../contexts/AuthContext";
import { Avatar } from "./Avatar";

const PAPEL: Record<User["role"], string> = { administrador: "Administrador", coordenador: "Coordenador", membro: "Membro" };

/** Recorta o quadrado central e reduz para 256x256 WebP. O backend valida de novo. */
async function prepararFoto(arquivo: File): Promise<File> {
  const bitmap = await createImageBitmap(arquivo);
  const lado = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - lado) / 2, (bitmap.height - lado) / 2, lado, lado, 0, 0, 256, 256);
  bitmap.close();
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/webp", 0.9));
  if (!blob) throw new Error("Não consegui processar a imagem.");
  return new File([blob], "avatar.webp", { type: "image/webp" });
}

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, updateUser } = useAuth();
  const [nome, setNome] = useState(user?.name ?? "");
  const [salvando, setSalvando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [erro, setErro] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!user) return null;

  async function trocarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    setErro(""); setEnviandoFoto(true);
    try {
      const pronta = await prepararFoto(arquivo);
      updateUser(await api.upload<User>("/auth/me/avatar", [pronta], "file"));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao enviar a foto.");
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function removerFoto() {
    setErro(""); setEnviandoFoto(true);
    try {
      updateUser(await api.del<User>("/auth/me/avatar"));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao remover a foto.");
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function salvar() {
    setErro(""); setSalvando(true);
    try {
      updateUser(await api.patch<User>("/auth/me", { name: nome.trim() }));
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const campo = "w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-slate-100 outline-none focus:border-primary";
  const nomeInvalido = nome.trim().length === 0 || nome.trim().length > 120;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-12" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-background-surface shadow-2xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-extrabold text-slate-100">Meu perfil</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-background-elevated transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center gap-4">
            <Avatar user={user} className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shrink-0" textClassName="text-2xl font-bold text-white" />
            <div className="flex flex-col gap-1.5 items-start">
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={trocarFoto} />
              <button onClick={() => inputRef.current?.click()} disabled={enviandoFoto} className="text-sm font-semibold text-primary hover:underline disabled:opacity-50">
                {enviandoFoto ? "Enviando..." : "Trocar foto"}
              </button>
              {user.avatar_url && (
                <button onClick={removerFoto} disabled={enviandoFoto} className="text-xs text-slate-400 hover:text-danger-400 disabled:opacity-50">Remover foto</button>
              )}
              <p className="text-[11px] text-slate-500">JPG, PNG ou WEBP, até 2 MB.</p>
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-slate-400">Nome</span>
            <input className={campo} value={nome} maxLength={120} onChange={e => setNome(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !nomeInvalido) salvar(); }} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-400">E-mail</span>
            <input className={campo + " opacity-60 cursor-not-allowed"} value={user.email} disabled />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-400">Perfil</span>
            <input className={campo + " opacity-60 cursor-not-allowed"} value={PAPEL[user.role]} disabled />
          </label>

          {erro && <p className="text-xs text-danger-400">{erro}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-background-elevated">Cancelar</button>
          <button onClick={salvar} disabled={salvando || nomeInvalido} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-50">
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
