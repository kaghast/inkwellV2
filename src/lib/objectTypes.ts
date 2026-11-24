// Object Types 2.0: the built-in object types. They are ordinary `note_types`
// rows (user_id NULL, is_default true) so the existing property editor and
// renderer (CustomFieldsRenderer) handle every one of them; adding a type is a
// data change, never a code change. Users add their own types the same way.
//
// Field ids are stable because objects store property values by field id.

import type { NoteTypeField } from "../types";

export interface SystemObjectType {
  type_id: string;
  /** Short machine key used by capture type detection. */
  key: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  fields: NoteTypeField[];
}

const status = (id: string, name: string, options: string[]): NoteTypeField => ({ id, name, type: "dropdown", options });
const text = (id: string, name: string, placeholder?: string): NoteTypeField => ({ id, name, type: "text", placeholder });
const num = (id: string, name: string): NoteTypeField => ({ id, name, type: "number" });
const when = (id: string, name: string): NoteTypeField => ({ id, name, type: "datetime" });
const rating = (id = "rating", name = "Puan"): NoteTypeField => status(id, name, ["1", "2", "3", "4", "5"]);

/** Legacy ids kept exactly as they were. */
export const PLAIN_TYPE_ID = "type_plain";
export const CARD_TYPE_ID = "type_card";
export const DAILY_TYPE_ID = "type_daily";
export const MONTHLY_TYPE_ID = "type_monthly";
export const COLLECTION_TYPE_ID = "type_collection";
/** Journal pages the app creates itself (one per day / month); never picked by capture or templates. */
export const JOURNAL_PAGE_TYPE_IDS = [DAILY_TYPE_ID, MONTHLY_TYPE_ID];
export function isJournalPageType(typeId: string | null | undefined): boolean {
  return !!typeId && JOURNAL_PAGE_TYPE_IDS.includes(typeId);
}

export const SYSTEM_OBJECT_TYPES: SystemObjectType[] = [
  { type_id: PLAIN_TYPE_ID, key: "note", name: "Düz Metin", description: "Standart sade metin ve Markdown notları", color: "#64748b", icon: "FileText", fields: [] },
  { type_id: CARD_TYPE_ID, key: "task", name: "Kart", description: "Kanban panosu ve görevler için kart", color: "#8b5cf6", icon: "Kanban", fields: [] },
  { type_id: DAILY_TYPE_ID, key: "daily", name: "Günlük Not", description: "Her gün için otomatik günlük not", color: "#f59e0b", icon: "Sun", fields: [] },
  { type_id: MONTHLY_TYPE_ID, key: "monthly", name: "Aylık Kayıt", description: "Her ay için bir sayfa: hedefler, görevler, notlar", color: "#d97706", icon: "CalendarDays", fields: [] },
  { type_id: COLLECTION_TYPE_ID, key: "collection", name: "Koleksiyon", description: "Bir konu etrafındaki liste: okunacaklar, fikirler, alışveriş…", color: "#0d9488", icon: "Library", fields: [] },
  {
    type_id: "type_idea", key: "idea", name: "Fikir", description: "Ham fikirler ve ilhamlar", color: "#eab308", icon: "Lightbulb",
    fields: [status("stage", "Aşama", ["Ham", "Geliştiriliyor", "Hazır", "Bırakıldı"])],
  },
  {
    type_id: "type_project", key: "project", name: "Proje", description: "Hedefi, durumu ve görevleri olan proje", color: "#0ea5e9", icon: "FolderKanban",
    fields: [
      status("status", "Durum", ["Planlanıyor", "Devam ediyor", "Beklemede", "Tamamlandı"]),
      text("goal", "Hedef"),
      when("start", "Başlangıç"),
      when("due", "Bitiş"),
    ],
  },
  {
    type_id: "type_person", key: "person", name: "Kişi", description: "Tanıdığın veya birlikte çalıştığın kişiler", color: "#ec4899", icon: "User",
    fields: [text("role", "Rol"), text("organization", "Kurum"), text("email", "E-posta"), text("phone", "Telefon")],
  },
  {
    type_id: "type_meeting", key: "meeting", name: "Toplantı", description: "Toplantı notları, kararlar ve aksiyonlar", color: "#14b8a6", icon: "Users",
    fields: [when("when", "Zaman"), text("place", "Yer"), status("kind", "Tür", ["Yüz yüze", "Çevrim içi", "Telefon"])],
  },
  {
    type_id: "type_event", key: "event", name: "Etkinlik", description: "Belirli bir zamanda olan etkinlik", color: "#f97316", icon: "CalendarDays",
    fields: [when("when", "Zaman"), text("place", "Yer")],
  },
  {
    type_id: "type_book", key: "book", name: "Kitap", description: "Okunan veya okunacak kitaplar", color: "#a16207", icon: "BookOpen",
    fields: [text("author", "Yazar"), num("year", "Yıl"), text("isbn", "ISBN"), status("reading_status", "Okuma durumu", ["Okunacak", "Okunuyor", "Okundu"]), rating()],
  },
  {
    type_id: "type_paper", key: "paper", name: "Araştırma Makalesi", description: "Akademik makale: yazarlar, yıl, DOI, yöntem, bulgular", color: "#6366f1", icon: "GraduationCap",
    fields: [
      text("authors", "Yazarlar"),
      num("year", "Yıl"),
      text("doi", "DOI", "10.xxxx/…"),
      text("journal", "Dergi"),
      text("method", "Yöntem"),
      text("findings", "Bulgular"),
      text("pdf", "PDF bağlantısı"),
      status("reading_status", "Okuma durumu", ["Okunacak", "Okunuyor", "Okundu"]),
      rating(),
    ],
  },
  {
    type_id: "type_article", key: "article", name: "Makale / Web", description: "Web makalesi veya kaydedilen bağlantı", color: "#3b82f6", icon: "Newspaper",
    fields: [text("url", "Adres"), text("author", "Yazar"), text("site", "Site"), status("reading_status", "Okuma durumu", ["Okunacak", "Okundu"])],
  },
  {
    type_id: "type_quote", key: "quote", name: "Alıntı", description: "Bir kaynaktan alıntı", color: "#84cc16", icon: "Quote",
    fields: [text("author", "Söyleyen"), text("source", "Kaynak")],
  },
  {
    type_id: "type_reference", key: "reference", name: "Referans", description: "Başvuru bilgisi, doküman veya kaynak", color: "#64748b", icon: "Bookmark",
    fields: [text("url", "Adres"), text("source", "Kaynak")],
  },
  {
    type_id: "type_location", key: "location", name: "Konum", description: "Bir yer; diğer nesneler buraya bağlanabilir", color: "#ef4444", icon: "MapPin",
    fields: [text("address", "Adres")],
  },
  {
    type_id: "type_file", key: "file", name: "Dosya", description: "Yüklenen dosya ve notları", color: "#78716c", icon: "Paperclip",
    fields: [text("file_name", "Dosya adı"), text("file_type", "Dosya türü")],
  },
];

export const SYSTEM_TYPE_BY_KEY: Record<string, SystemObjectType> = Object.fromEntries(
  SYSTEM_OBJECT_TYPES.map((t) => [t.key, t])
);
export const SYSTEM_TYPE_BY_ID: Record<string, SystemObjectType> = Object.fromEntries(
  SYSTEM_OBJECT_TYPES.map((t) => [t.type_id, t])
);

export function isSystemTypeId(typeId: string | null | undefined): boolean {
  return !!typeId && (typeId === "default" || typeId in SYSTEM_TYPE_BY_ID);
}

// ---------------------------------------------------------------------------
// Relation types
// ---------------------------------------------------------------------------
export interface SystemRelationType {
  type_key: string;
  label: string;
  inverse_label: string;
  symmetric: boolean;
}

export const SYSTEM_RELATION_TYPES: SystemRelationType[] = [
  { type_key: "links_to", label: "bağlantı veriyor", inverse_label: "bağlantı alıyor", symmetric: false },
  { type_key: "related_to", label: "ilişkili", inverse_label: "ilişkili", symmetric: true },
  { type_key: "works_on", label: "üzerinde çalışıyor", inverse_label: "üzerinde çalışan", symmetric: false },
  { type_key: "attended", label: "katıldı", inverse_label: "katılımcı", symmetric: false },
  { type_key: "cites", label: "atıf yapıyor", inverse_label: "atıf alıyor", symmetric: false },
  { type_key: "part_of", label: "parçası", inverse_label: "içeriyor", symmetric: false },
  { type_key: "mentions", label: "bahsediyor", inverse_label: "bahsedildiği yer", symmetric: false },
  { type_key: "about", label: "hakkında", inverse_label: "hakkındaki", symmetric: false },
  { type_key: "located_at", label: "konumu", inverse_label: "burada olan", symmetric: false },
  { type_key: "derived_from", label: "türetildiği kaynak", inverse_label: "türetilen", symmetric: false },
  { type_key: "captured_on", label: "o gün yakalanan", inverse_label: "yakalandığı gün", symmetric: false },
];
