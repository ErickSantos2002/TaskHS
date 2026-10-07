import { useState } from "react";
import { cn } from "../lib/utils";
import { avatarSrc } from "../lib/api";

interface AvatarUser {
  name: string;
  initials: string;
  avatar_url?: string | null;
}

/** Foto de perfil, ou as iniciais quando não há foto (ou ela não carrega).
 *  O círculo (tamanho, fundo, borda) vem de `className` para cada lugar manter
 *  o visual que já tinha; `textClassName` estiliza as iniciais. */
export function Avatar({ user, className, textClassName }: { user: AvatarUser; className: string; textClassName?: string }) {
  // Guarda QUAL url falhou: se a pessoa troca a foto, a nova tenta carregar de novo.
  const [falhou, setFalhou] = useState<string | null>(null);
  const url = user.avatar_url && user.avatar_url !== falhou ? user.avatar_url : null;
  return (
    <div className={cn(className, "overflow-hidden")}>
      {url ? (
        <img src={avatarSrc(url)} alt={user.name} className="w-full h-full object-cover" onError={() => setFalhou(url)} />
      ) : (
        <span className={textClassName}>{user.initials}</span>
      )}
    </div>
  );
}
