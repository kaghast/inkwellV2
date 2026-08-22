export interface User {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  auth_provider?: "email" | "google";
  created_at?: string;
}

export type GroupType = "tags" | "people" | "locations" | "categories";

export interface ItemGroup {
  group_id: string;
  user_id?: string;
  name: string;
  type: GroupType;
  color?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Category {
  category_id: string;
  user_id?: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  group_id?: string | null;
  created_at?: string;
}

export interface Tag {
  tag_id: string;
  user_id?: string;
  name: string;
  group_id?: string | null;
  created_at?: string;
}

export interface Person {
  person_id: string;
  user_id?: string;
  name: string;
  group_id?: string | null;
  created_at?: string;
}

export interface LocationItem {
  location_id: string;
  user_id?: string;
  name: string;
  lat: number;
  lng: number;
  group_id?: string | null;
  created_at?: string;
}

export interface KanbanColumn {
  column_id: string;
  user_id?: string;
  name: string;
  color?: string | null;
  order_index: number;
  created_at?: string;
  updated_at?: string;
}

export type NoteParameterType =
  | "dropdown"
  | "boolean"
  | "number"
  | "text"
  | "datetime"
  | "calculation"
  | "datetime_range";

export type CalculationOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "time_diff_auto"
  | "time_diff_hours"
  | "time_diff_days"
  | "time_diff_minutes";

export interface CalculationConfig {
  fieldAId: string;
  fieldBId: string;
  operator: CalculationOperator;
  unit?: string;
  decimalPlaces?: number;
}

export interface NoteTypeField {
  id: string; // unique field id e.g. "field_1"
  name: string; // Label e.g. "Başlangıç Tarihi", "Öncelik", "Maliyet", "Süre Hesapla"
  type: NoteParameterType;
  options?: string[]; // For dropdown options
  calcConfig?: CalculationConfig; // For calculation type
  required?: boolean;
  placeholder?: string;
}

export interface NoteType {
  type_id: string;
  user_id?: string | null;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  is_default: boolean;
  fields: NoteTypeField[];
  created_at?: string;
  updated_at?: string;
}

export interface Note {
  note_id: string;
  user_id: string;
  slug?: string | null;
  title: string;
  content: string;
  date: string; // ISO Datetime string e.g. YYYY-MM-DDTHH:mm:ss or YYYY-MM-DD
  tags: string[];
  people: string[];
  category_id?: string | null;
  location_id?: string | null;
  note_type_id?: string | null;
  custom_fields?: Record<string, any>;
  pinned: boolean;
  archived?: boolean;
  is_encrypted?: boolean;
  password_hash?: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoteVersion {
  version_id: string;
  note_id: string;
  user_id: string;
  version_number: number;
  title: string;
  content: string;
  date: string;
  tags: string[];
  people: string[];
  custom_fields?: Record<string, any>;
  change_summary?: string | null;
  is_encrypted?: boolean;
  password_hash?: string | null;
  created_at: string;
}

export interface CalendarCounts {
  [date: string]: number;
}
