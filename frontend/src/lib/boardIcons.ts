/** Catálogo de ícones do quadro.
 *
 *  O banco guarda só o NOME (ex.: "truck"); o desenho mora aqui. O mapa é
 *  explícito, e não um import dinâmico do lucide, por dois motivos: o Vite
 *  consegue tree-shakear (só estes entram no bundle, não a biblioteca inteira),
 *  e nome vindo do banco nunca vira componente arbitrário.
 *
 *  O backend valida só o formato do nome, não esta lista — então nome
 *  desconhecido é esperado e cai no genérico (ver components/BoardIcon).
 *
 *  Só constantes aqui: o componente fica em components/BoardIcon.tsx porque o
 *  lint (react-refresh) não deixa um arquivo exportar componente e constante.
 */
import {
  LayoutGrid, Folder, Users, BarChart3, Wrench, Truck, DollarSign, FlaskConical,
  Monitor, Package, Target, Shield, Phone, Settings, ClipboardList, Calendar,
  ShoppingCart, FileText, Briefcase, Bell, Star, Home, Map, Zap, Key, Lightbulb,
  Heart, Bookmark, Tag, Building2, HardHat, Stethoscope,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Ícone usado quando o quadro não escolheu nenhum (ou escolheu um que sumiu). */
export const GENERIC_BOARD_ICON: LucideIcon = LayoutGrid;

export const BOARD_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  users: Users,
  "bar-chart": BarChart3,
  wrench: Wrench,
  truck: Truck,
  money: DollarSign,
  flask: FlaskConical,
  monitor: Monitor,
  package: Package,
  target: Target,
  shield: Shield,
  phone: Phone,
  settings: Settings,
  clipboard: ClipboardList,
  calendar: Calendar,
  cart: ShoppingCart,
  file: FileText,
  briefcase: Briefcase,
  bell: Bell,
  star: Star,
  home: Home,
  map: Map,
  zap: Zap,
  key: Key,
  lightbulb: Lightbulb,
  heart: Heart,
  bookmark: Bookmark,
  tag: Tag,
  building: Building2,
  helmet: HardHat,
  stethoscope: Stethoscope,
};

/** Nomes na ordem em que aparecem no seletor. */
export const BOARD_ICON_NAMES = Object.keys(BOARD_ICONS);
