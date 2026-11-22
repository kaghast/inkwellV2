// Typed client for the Phase 1 API (capture, inbox, relations, spaces,
// search, Today, templates, home). UI components never call axios directly.
import api from "@/lib/api";

export type CaptureStatus = "new" | "processing" | "ready" | "processed" | "failed";

export interface CaptureSuggestion {
  provider?: string;
  type_id?: string;
  type_confidence?: number;
  title?: string;
  summary?: string;
  tags?: string[];
  people?: string[];
  organizations?: string[];
  locations?: string[];
  dates?: string[];
  tasks?: string[];
  url?: string | null;
  site?: string | null;
  author?: string | null;
  related?: Array<{ object_id: string; title: string; reason: string }>;
}

export interface Capture {
  capture_id: string;
  status: CaptureStatus;
  resolution: "accepted" | "saved_raw" | "rejected" | null;
  source: string;
  raw_text: string;
  raw_url: string | null;
  file_id: string | null;
  space_id: string | null;
  suggestion: CaptureSuggestion;
  provider: string | null;
  error: string | null;
  attempts: number;
  object_id: string | null;
  captured_on: string;
  created_at: string;
  updated_at: string;
}

export interface InboxCounts {
  new: number;
  processing: number;
  ready: number;
  processed: number;
  failed: number;
  open: number;
  needs_review: number;
}

export interface Space {
  space_id: string;
  workspace_id: string;
  name: string;
  description: string;
  color: string | null;
  icon: string | null;
  is_default: boolean;
  archived: boolean;
  object_count: number;
}

export interface RelationType {
  type_key: string;
  label: string;
  inverse_label: string;
  symmetric: boolean;
  is_system: boolean;
}

export interface RelatedObject {
  note_id: string;
  slug: string | null;
  title: string;
  note_type_id: string;
  type_name: string;
  type_icon: string;
  type_color: string;
  archived: boolean;
}

export interface Relation {
  relation_id: string;
  relation_type: string;
  label: string;
  direction: "outgoing" | "incoming";
  origin: "wikilink" | "manual" | "template" | "capture" | "ai";
  status: "active" | "suggested";
  note: string | null;
  object: RelatedObject;
}

export interface SearchHit {
  id: string;
  slug?: string | null;
  title: string;
  type_id: string;
  type_name: string;
  space_id: string | null;
  snippet: string;
  matched: string[];
}

export interface SearchResult {
  query: string;
  objects: SearchHit[];
  inbox: Array<{ capture_id: string; title: string; status: CaptureStatus }>;
  spaces: Array<{ space_id: string; name: string }>;
}

export interface DayObject {
  note_id: string;
  slug: string | null;
  title: string;
  note_type_id: string;
  type_name: string;
  type_icon: string;
  type_color: string;
  date: string;
  is_encrypted: boolean;
  created_at: string;
  updated_at: string;
  content: string;
}

export interface TodayData {
  date: string;
  daily_note: DayObject | null;
  objects: DayObject[];
  tasks: Array<{ note_id: string; note_title: string; task_index: number; text: string }>;
  reminders: Array<{ reminder_id: string; note_id: string; at: string; text: string; fired: boolean }>;
  captures: Capture[];
}

export interface HomeData {
  inbox: InboxCounts;
  activation: {
    objects: number;
    relations: number;
    backlinks: number;
    captures: number;
    active_days: number;
    goals: Record<"objects" | "relations" | "backlinks" | "captures" | "active_days", number>;
  };
  suggestions: Array<{
    relation_id: string;
    relation_type: string;
    reason: string | null;
    source: { note_id: string; title: string; slug?: string };
    target: { note_id: string; title: string; slug?: string };
  }>;
  recent: Array<{ note_id: string; slug: string | null; title: string; note_type_id: string; space_id: string | null; updated_at: string }>;
  ai: { provider: string; label: string; is_model: boolean };
}

export interface TemplateInfo {
  key: "daily" | "meeting" | "project" | "research";
  name: string;
  description: string;
  fields: string[];
}

export const INBOX_CHANGED = "inkwell:inbox-changed";
export const notifyInboxChanged = () => window.dispatchEvent(new Event(INBOX_CHANGED));

export const objectPath = (o: { slug?: string | null; note_id?: string; id?: string }) => `/note/${o.slug || o.note_id || o.id}`;

export const wsApi = {
  capture: (body: { text?: string; url?: string; file_id?: string; source?: string; mode?: "inbox" | "direct"; type_id?: string; space_id?: string | null; captured_on?: string }) =>
    api.post("/capture", body).then((r) => r.data as { capture?: Capture; object_id?: string; slug?: string }),
  inbox: (scope: "open" | "processed" | "all" = "open") =>
    api.get("/inbox", { params: { scope } }).then((r) => r.data as { items: Capture[]; counts: InboxCounts }),
  inboxCounts: () => api.get("/inbox/counts").then((r) => r.data as InboxCounts),
  accept: (id: string, overrides: Record<string, unknown> = {}) =>
    api.post(`/inbox/${id}/accept`, overrides).then((r) => r.data as { object_id: string; slug: string }),
  acceptBatch: (ids: string[]) =>
    api.post("/inbox/accept-batch", { ids }).then((r) => r.data as { results: Array<{ capture_id: string; ok: boolean; error?: string }> }),
  saveRaw: (id: string) => api.post(`/inbox/${id}/save-raw`).then((r) => r.data as { object_id: string; slug: string }),
  reject: (id: string) => api.post(`/inbox/${id}/reject`).then((r) => r.data),
  retry: (id: string) => api.post(`/inbox/${id}/retry`).then((r) => r.data),

  relationTypes: () => api.get("/relation-types").then((r) => r.data as RelationType[]),
  createRelationType: (body: { label: string; inverse_label?: string; symmetric?: boolean }) =>
    api.post("/relation-types", body).then((r) => r.data as RelationType),
  relations: (id: string) =>
    api.get(`/objects/${encodeURIComponent(id)}/relations`).then((r) => r.data as { object_id: string; outgoing: Relation[]; incoming: Relation[]; backlinks: Relation[] }),
  addRelation: (body: { source_id: string; target_id: string; relation_type: string; note?: string }) => api.post("/relations", body).then((r) => r.data),
  removeRelation: (id: string) => api.delete(`/relations/${id}`).then((r) => r.data),
  acceptRelation: (id: string) => api.post(`/relations/${id}/accept`).then((r) => r.data),

  spaces: () => api.get("/spaces").then((r) => r.data as Space[]),
  createSpace: (body: { name: string; description?: string; color?: string }) => api.post("/spaces", body).then((r) => r.data as Space),
  updateSpace: (id: string, body: Partial<Pick<Space, "name" | "description" | "color" | "archived">>) =>
    api.put(`/spaces/${id}`, body).then((r) => r.data as Space),
  moveToSpace: (objectId: string, spaceId: string) => api.patch(`/objects/${encodeURIComponent(objectId)}/space`, { space_id: spaceId }).then((r) => r.data),

  search: (q: string, params: { type_id?: string; space_id?: string; limit?: number } = {}) =>
    api.get("/search", { params: { q, ...params } }).then((r) => r.data as SearchResult),
  today: (date?: string) => api.get("/today", { params: date ? { date } : {} }).then((r) => r.data as TodayData),
  ensureDailyNote: (date?: string) => api.post("/today/daily-note", date ? { date } : {}).then((r) => r.data as { note_id: string; slug: string; created: boolean }),
  templates: () => api.get("/templates").then((r) => r.data as TemplateInfo[]),
  applyTemplate: (key: string, body: Record<string, unknown>) =>
    api.post(`/templates/${key}/apply`, body).then((r) => r.data as { primary_id: string; slug: string; created: string[]; reused: string[]; relations: number }),
  home: () => api.get("/home").then((r) => r.data as HomeData),
};
