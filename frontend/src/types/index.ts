export type Priority = "critical" | "high" | "medium" | "low";

export interface User {
  id: number;
  name: string;
  email: string;
  initials: string;
  is_admin: boolean;
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
