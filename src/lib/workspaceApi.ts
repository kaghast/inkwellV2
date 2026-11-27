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
  file_text_note?: string | null;
}

export interface Capture {
  capture_id: string;
  status: CaptureStatus;
  resolution: "accepted" | "saved_raw" | "rejected" | "logged" | null;
  source: string;
  raw_text: string;
  raw_url: string | null;
  file_id: string | null;
  file_text?: string | null;
  file_text_length?: number;
  file_text_method?: "text" | "docx" | "pptx" | "xlsx" | "ocr" | "transcript" | "none" | null;
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
  /** Built-in key (daily/meeting/project/research) or own template id */
  id: string;
  kind: "builtin" | "custom";
  name: string;
  description: string;
  fields: string[];
  note_type_id: string | null;
  title_template: string;
  content_template: string;
  hidden: boolean;
  customized: boolean;
}

export interface TemplateBody {
  name?: string;
  description?: string;
  note_type_id?: string | null;
  title_template?: string;
  content_template?: string;
  hidden?: boolean;
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
  logCapture: (id: string, kind: EntryKind) =>
    api.post(`/inbox/${id}/log`, { kind }).then((r) => r.data as { note_id: string; slug: string | null; line: string; date: string }),
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
  logToDay: (body: { text: string; kind?: "task" | "event" | "note"; date?: string }) =>
    api.post("/today/log", body).then((r) => r.data as { note_id: string; slug: string; line: string; content: string }),
  ensureDailyNote: (date?: string) => api.post("/today/daily-note", date ? { date } : {}).then((r) => r.data as { note_id: string; slug: string; created: boolean }),
  templates: (all = false) => api.get("/templates", { params: all ? { all: "1" } : {} }).then((r) => r.data as TemplateInfo[]),
  createTemplate: (body: TemplateBody) => api.post("/templates", body).then((r) => r.data as TemplateInfo),
  updateTemplate: (id: string, body: TemplateBody) => api.put(`/templates/${encodeURIComponent(id)}`, body).then((r) => r.data as TemplateInfo),
  deleteTemplate: (id: string) => api.delete(`/templates/${encodeURIComponent(id)}`).then((r) => r.data),
  applyTemplate: (key: string, body: Record<string, unknown>) =>
    api.post(`/templates/${key}/apply`, body).then((r) => r.data as { primary_id: string; slug: string; created: string[]; reused: string[]; relations: number }),
  home: () => api.get("/home").then((r) => r.data as HomeData),
};

// ---------------------------------------------------------------------------
// Phase 2: Ask Inkwell, AI actions, Graph 2.0
// ---------------------------------------------------------------------------
export interface AskFilters {
  type_id?: string;
  space_id?: string;
  tag?: string;
  date_from?: string;
  date_to?: string;
}

export interface AskSource {
  n: number;
  note_id: string;
  slug?: string | null;
  title: string;
  type_name: string;
  date: string;
  snippet: string;
  signals: { text: number; semantic: number; relation: number };
}

export interface AskResult {
  question: string;
  answer: string | null;
  mode: "answer" | "sources_only" | "no_sources";
  provider: string | null;
  semantic: boolean;
  citations: Array<{ n: number; note_id: string; slug?: string | null; title: string; snippet: string }>;
  sources: AskSource[];
  warning: string | null;
}

export type AiActionKey =
  | "summarize" | "rewrite" | "translate" | "explain" | "extract_tasks" | "generate_tags" | "outline"
  | "meeting_notes" | "project_summary" | "research_questions" | "research_insights"
  | "find_related" | "find_connections" | "compare" | "contradictions" | "read_files";

export interface AiUsageData {
  days: number;
  since: string;
  calls: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  by_task: Array<{ task: string; calls: number; failed: number; input_tokens: number; output_tokens: number }>;
  by_day: Array<{ day: string; calls: number; tokens: number }>;
  by_model: Array<{ provider: string; model: string | null; calls: number }>;
}

export interface AiActionResult {
  action: AiActionKey;
  label: string;
  output: "text" | "tasks" | "tags" | "related";
  text?: string;
  items?: string[];
  related?: Array<{ note_id: string; slug?: string | null; title: string; type_name: string; snippet: string; why: string }>;
  citations?: Array<{ n: number; note_id: string; slug?: string | null; title: string }>;
  provider: string | null;
  warning?: string | null;
}

export interface GraphRelation {
  relation_id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  label: string;
  origin: string;
}

export interface UnexpectedPair {
  a: { note_id: string; slug?: string | null; title: string; passage: string };
  b: { note_id: string; slug?: string | null; title: string; passage: string };
  basis: "semantic" | "terms";
  similarity: number;
  shared_terms: string[];
  explanation: string;
}

export const aiApi = {
  ask: (question: string, filters: AskFilters = {}) => api.post("/ask", { question, filters }).then((r) => r.data as AskResult),
  action: (noteId: string, action: AiActionKey, opts: { language?: string; other_id?: string } = {}) =>
    api.post(`/objects/${encodeURIComponent(noteId)}/ai`, { action, ...opts }).then((r) => r.data as AiActionResult),
  usage: (days = 30) => api.get("/ai/usage", { params: { days } }).then((r) => r.data as AiUsageData),
  append: (noteId: string, text: string, summary?: string) =>
    api.post(`/objects/${encodeURIComponent(noteId)}/append`, { text, summary }).then((r) => r.data as { note_id: string; content: string }),
  status: () => api.get("/home").then((r) => (r.data as HomeData).ai),
  graphRelations: () => api.get("/graph/relations").then((r) => r.data as { relations: GraphRelation[]; relation_types: RelationType[] }),
  unexpected: () =>
    api.post("/graph/unexpected").then((r) => r.data as { available: boolean; reason: string | null; pairs: UnexpectedPair[]; provider?: string; semantic?: boolean }),
  embeddings: () => api.get("/ai/embeddings").then((r) => r.data as { model: string | null; total: number; embedded: number }),
  reindex: () => api.post("/ai/embeddings/reindex").then((r) => r.data as { queued: number }),
};

// ---------------------------------------------------------------- journal (Phase 2.5)

export type EntryKind = "task" | "event" | "note";

export interface MonthDay {
  date: string;
  note_id: string | null;
  slug: string | null;
  events: string[];
  open: number;
  done: number;
  entries: number;
  locked: boolean;
}

export interface MonthViewData {
  month: string;
  monthly: { note_id: string; slug: string | null; title: string; content: string; locked: boolean } | null;
  days: MonthDay[];
}

export interface FutureMonth {
  month: string;
  note_id: string | null;
  slug: string | null;
  items: Array<{ kind: EntryKind; state: string | null; signifier: string | null; text: string; task_index: number | null }>;
}

export interface MigrationTask {
  note_id: string;
  note_title: string;
  page: "daily" | "monthly";
  date: string;
  task_index: number;
  text: string;
  signifier: string | null;
}

export interface CollectionSummary {
  note_id: string;
  slug: string | null;
  title: string;
  items: number;
  open: number;
  done: number;
  linked: number;
  locked: boolean;
  updated_at: string;
}

export interface CollectionDetail {
  note_id: string;
  slug: string | null;
  title: string;
  content: string;
  locked: boolean;
  archived: boolean;
  linked: Array<{ note_id: string; slug: string | null; title: string; note_type_id: string }>;
}

export interface JournalIndexData {
  months: Array<{ month: string; monthly_id: string | null; monthly_slug: string | null; days: number; open: number; entries: number }>;
  collections: CollectionSummary[];
  tags: Array<{ tag: string; count: number }>;
}

export const JOURNAL_CHANGED = "inkwell:journal-changed";
export const notifyJournalChanged = () => window.dispatchEvent(new Event(JOURNAL_CHANGED));

export const journalApi = {
  month: (month: string) => api.get("/journal/month", { params: { month } }).then((r) => r.data as MonthViewData),
  ensureMonth: (month: string) => api.post("/journal/month", { month }).then((r) => r.data as { note_id: string; slug: string; title: string; created: boolean }),
  future: (from: string, months = 12) => api.get("/journal/future", { params: { from, months } }).then((r) => r.data as { from: string; months: FutureMonth[] }),
  migration: (date: string) => api.get("/journal/migration", { params: { date } }).then((r) => r.data as { tasks: MigrationTask[] }),
  migrate: (body: { note_id: string; task_index: number; action: "today" | "month" | "cancel"; date?: string; month?: string }) =>
    api.post("/journal/migrate", body).then((r) => r.data as { action: string; target_id?: string; target_title?: string }),
  log: (body: { note_id: string; text: string; kind?: EntryKind; section?: string }) =>
    api.post("/journal/log", body).then((r) => r.data as { note_id: string; line: string; content: string }),
  collections: () => api.get("/journal/collections").then((r) => r.data as CollectionSummary[]),
  createCollection: (body: { title: string; description?: string }) =>
    api.post("/journal/collections", body).then((r) => r.data as { note_id: string; slug: string; title: string }),
  collection: (id: string) => api.get(`/journal/collections/${encodeURIComponent(id)}`).then((r) => r.data as CollectionDetail),
  index: () => api.get("/journal/index").then((r) => r.data as JournalIndexData),
  bullets: (f: BulletSearch) => api.get("/journal/bullets", { params: f }).then((r) => r.data as { items: BulletHit[]; truncated: boolean }),
  toCard: (note_id: string, index: number, content?: string) =>
    api.post("/journal/to-card", { note_id, index, content }).then((r) => r.data as { card_id: string; card_slug: string | null; card_title: string; note_id: string; content: string }),
};

export interface BulletSearch {
  kind?: "task" | "event" | "note";
  /** Comma-separated task states, e.g. "open" or "migrated,scheduled". */
  state?: string;
  signifier?: "priority" | "explore";
  q?: string;
  /** Lines carrying "#tag" (any line, not only list items). */
  tag?: string;
  /** Lines mentioning "@person". */
  person?: string;
  from?: string;
  to?: string;
}

export interface BulletHit {
  note_id: string;
  slug: string | null;
  title: string;
  date: string;
  note_type_id: string | null;
  line: number;
  text: string;
  kind: "task" | "event" | "note";
  state?: "open" | "done" | "migrated" | "scheduled" | "cancelled";
  taskIndex?: number;
  signifier?: "priority" | "explore";
  /** A plain paragraph line, not a list item. */
  plain?: boolean;
}

// ---------------------------------------------------------------- habits & review (Phase 2.5d/e)

export interface HabitRow {
  habit_id: string;
  name: string;
  /** The tag that marks this habit's lines in daily notes. */
  tag: string;
  color: string | null;
  archived: boolean;
  done_days: string[];
  month_count: number;
  current: number;
  longest: number;
}

export interface HabitMonthData {
  month: string;
  days: string[];
  habits: HabitRow[];
  ratings: Array<{ day: string; mood: number | null; energy: number | null }>;
}

export interface ReviewData {
  month: string;
  mode: "review" | "facts_only" | "empty";
  review: string | null;
  provider: string | null;
  warning: string | null;
  monthly_id: string | null;
  facts: {
    days_logged: number;
    entries: number;
    tasks: { done: number; open: number; migrated: number; scheduled: number; cancelled: number };
    events: number;
    postponed: Array<{ text: string; times: number }>;
    top_tags: Array<{ tag: string; count: number }>;
    habits: Array<{ name: string; done: number; days: number }>;
    mood_avg: number | null;
    energy_avg: number | null;
  };
  sources: Array<{ n: number; note_id: string; title: string; date: string }>;
  citations: Array<{ n: number; note_id: string; title: string; date: string }>;
}

export const habitApi = {
  month: (month: string, today: string, all = false) =>
    api.get("/journal/habits", { params: { month, today, ...(all ? { all: "1" } : {}) } }).then((r) => r.data as HabitMonthData),
  create: (name: string, today: string, tag?: string) =>
    api.post("/journal/habits", { name, today, ...(tag ? { tag } : {}) }).then((r) => r.data as { habit_id: string; name: string; tag: string }),
  update: (id: string, body: { name?: string; archived?: boolean; color?: string | null }) => api.put(`/journal/habits/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/journal/habits/${id}`).then((r) => r.data),
  setDay: (id: string, day: string, done: boolean, today: string) =>
    api.put(`/journal/habits/${id}/days/${day}`, { done, today }).then((r) => r.data as { habit_id: string; day: string; done: boolean; note_id: string }),
  rate: (day: string, body: { mood?: number | null; energy?: number | null }) => api.put(`/journal/ratings/${day}`, body).then((r) => r.data),
  review: (month: string, today: string) => api.post("/journal/review", { month, today }).then((r) => r.data as ReviewData),
};
