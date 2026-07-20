import { BOARD_ICONS, GENERIC_BOARD_ICON } from "../lib/boardIcons";

/** Desenha o ícone do quadro, caindo no genérico quando o nome é nulo ou
 *  desconhecido — o fallback mora aqui, num lugar só, para nenhuma tela
 *  precisar repetir a checagem. */
export function BoardIcon({
  name,
  className = "w-5 h-5",
}: {
  name?: string | null;
  className?: string;
}) {
  const Icon = (name && BOARD_ICONS[name]) || GENERIC_BOARD_ICON;
  return <Icon className={className} />;
}
