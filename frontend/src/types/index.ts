export type Priority = "critical" | "high" | "medium" | "low";

export interface User {
  id: number;
  name: string;
  email: string;
  initials: string;
  is_admin: boolean;
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
  created_at: string;
}

export interface Label {
  id: number;
  label: string;
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
  url: string;
  uploaded_at: string;
}

export interface Card {
  id: number;
  list_id: number;
  title: string;
  description: string | null;
  priority: Priority;
  position: number;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  labels: Label[];
  members: User[];
  comments: Comment[];
  attachments: Attachment[];
}
