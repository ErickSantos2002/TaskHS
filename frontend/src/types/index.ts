export type Priority = "critical" | "high" | "medium" | "low";

export interface User {
  id: number;
  name: string;
  email: string;
  initials: string;
  is_admin: boolean;
  role: "administrador" | "coordenador" | "membro";
  created_at: string;
}

export interface Board {
  id: number;
  title: string;
  description: string | null;
  color: string;
  owner_id: number;
  created_at: string;
}

/** Pessoa vista pelos seletores e pelos avatares da listagem.
 *  Vem de GET /auth/users/basic e de BoardListItem.members. */
export interface UserBasic {
  id: number;
  name: string;
  initials: string;
}

/** Membro de GET /boards/{id}/members — tem e-mail e papel no quadro, porque
 *  esse endpoint está atrás da tranca de membresia. NÃO é o que vem na
 *  listagem: lá os membros são `UserBasic`, sem e-mail, porque a listagem é
 *  visível a todo mundo. */
export interface BoardMemberOut extends UserBasic {
  email: string;
  board_role: "owner" | "admin" | "member" | "viewer";
}

/** Item de GET /boards. Tipo separado de `Board` porque só a listagem tem
 *  can_open — assim nenhuma tela pode ler o cadeado onde ele não existe. */
export interface BoardListItem extends Board {
  can_open: boolean;
  owner_name: string;
  members: UserBasic[];
}

export interface BoardList {
  id: number;
  board_id: number;
  title: string;
  description: string | null;
  color: string;
  position: number;
  archived: boolean;
  created_at: string;
}

export interface Label {
  id: number;
  label: string;
  color: string;
}

export interface BoardLabel {
  id: number;
  board_id: number;
  name: string;
  color: string;
}

export interface Comment {
  id: number;
  body: string;
  author: User;
  created_at: string;
}

export interface Attachment {
  id: number;
  filename: string;
  content_type: string | null;
  size: number | null;
  uploaded_by: number | null;
  uploaded_at: string;
  is_image: boolean;
}

export interface ChecklistItem {
  id: number;
  text: string;
  checked: boolean;
}

export interface Checklist {
  id: number;
  title: string;
  items: ChecklistItem[];
}

export interface Card {
  id: number;
  list_id: number;
  title: string;
  description: string | null;
  priority: Priority;
  position: number;
  due_date: string | null;
  due_date_completed: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
  labels: Label[];
  members: User[];
  comments: Comment[];
  attachments: Attachment[];
  checklists: Checklist[];
}

export interface Reminder {
  id: number;
  card_id: number;
  remind_at: string;
  fired: boolean;
  created_at: string;
}

export interface Automation {
  id: number;
  board_id: number;
  trigger_type: string;
  trigger_list_id: number;
  action_type: string;
  enabled: boolean;
  created_at: string;
}

export interface AuditLog {
  id: number;
  created_at: string;
  actor_type: string;
  actor_user_id: number | null;
  actor_name: string;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  entity_label: string | null;
  board_id: number | null;
  card_id: number | null;
  summary: string;
  changes: Record<string, { de: unknown; para: unknown }> | null;
  ip: string | null;
  path: string | null;
}
