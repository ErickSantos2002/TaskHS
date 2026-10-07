import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth, type User } from "../contexts/AuthContext";
import { Avatar } from "./Avatar";
import { AvatarCropper } from "./AvatarCropper";
import type { Area } from "react-easy-crop";

const PAPEL: Record<User["role"], string> = { administrador: "Administrador", coordenador: "Coordenador", membro: "Membro" };

/** Recorta a área escolhida no AvatarCropper e reduz para 256x256 WebP. O backend valida de novo. */
async function prepararFoto(arquivo: File, area: Area): Promise<File> {
  const bitmap = await createImageBitmap(arquivo);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.getContext("2d")!.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, 256, 256);
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
  // Foto escolhida esperando o ajuste (arquivo original + objectURL para o cropper).
  const [recorte, setRecorte] = useState<{ arquivo: File; src: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Esc no ajuste só desiste da foto; fora dele fecha a modal.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (recorte) { if (!enviandoFoto) setRecorte(null); } else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, recorte, enviandoFoto]);

  // Libera o objectURL quando a foto em ajuste muda ou a modal fecha.
  useEffect(() => {
    if (!recorte) return;
    return () => URL.revokeObjectURL(recorte.src);
  }, [recorte]);

  if (!user) return null;

  function escolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    setErro("");
    setRecorte({ arquivo, src: URL.createObjectURL(arquivo) });
  }

  async function enviarFoto(area: Area) {
    if (!recorte) return;
    setErro(""); setEnviandoFoto(true);
    try {
      const pronta = await prepararFoto(recorte.arquivo, area);
      updateUser(await api.upload<User>("/auth/me/avatar", [pronta], "file"));
      setRecorte(null);
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
          <h2 className="text-lg font-extrabold text-slate-100">{recorte ? "Ajustar foto" : "Meu perfil"}</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-background-elevated transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {recorte ? (
          <div className="px-6 py-5 space-y-3">
            <AvatarCropper src={recorte.src} enviando={enviandoFoto} onCancel={() => setRecorte(null)} onConfirm={enviarFoto} />
            {erro && <p className="text-xs text-danger-400">{erro}</p>}
          </div>
        ) : (<>
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center gap-4">
            <Avatar user={user} className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shrink-0" textClassName="text-2xl font-bold text-white" />
            <div className="flex flex-col gap-1.5 items-start">
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={escolherFoto} />
              <button onClick={() => inputRef.current?.click()} disabled={enviandoFoto} className="text-sm font-semibold text-primary hover:underline disabled:opacity-50">
                {enviandoFoto ? "Enviando..." : "Trocar foto"}
              </button>
              {user.avatar_url && (
                <button onClick={removerFoto} disabled={enviandoFoto} className="text-xs text-slate-400 hover:text-danger-400 disabled:opacity-50">Remover foto</button>
              )}
              <p className="text-[11px] text-slate-500">JPG, PNG ou WEBP. Você ajusta o enquadramento antes de salvar.</p>
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
        </>)}
      </div>
    </div>
  );
}
