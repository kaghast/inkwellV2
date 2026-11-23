// Creating objects from services (capture, templates, Today). Mirrors the
// legacy POST /api/notes path: tags/people extraction, slug, embedding,
// reminders, v1 version, wikilink relations, space assignment.
import { and, eq, or, isNull, inArray } from "drizzle-orm";
import { db, notes, noteTypes } from "../../src/db/index";
import { CARD_TYPE_ID, PLAIN_TYPE_ID } from "../../src/lib/objectTypes";
import {
  genId, extractTags, extractPeople, ensureTags, ensurePeople, syncReminders, saveNoteVersion,
  normalizeDateToIso, generateSlugForNote,
} from "./notesCore";
import { resolveTargetSpace, AccessError } from "./workspaces";
import { syncWikilinkRelations } from "./relations";
import { recordEvent } from "./analytics";
import { scheduleEmbedding } from "./embeddings";

export interface NewObjectInput {
  title: string;
  content?: string;
  note_type_id?: string | null;
  custom_fields?: Record<string, any>;
  date?: string;
  space_id?: string | null;
  area_ids?: string[];
  source?: Record<string, any>;
  ai_meta?: Record<string, any>;
  ai_summary?: string | null;
  version_summary?: string;
}

/** The type ids the user may assign: system types and the user's own. */
export async function assignableTypeIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: noteTypes.typeId })
    .from(noteTypes)
    .where(or(isNull(noteTypes.userId), eq(noteTypes.userId, userId)));
  return new Set(rows.map((r: any) => r.id));
}

export async function createObject(userId: string, input: NewObjectInput) {
  const content = input.content || "";
  const title = (input.title || "").trim().slice(0, 300);
  const tagsArr = extractTags(content);
  const peopleArr = extractPeople(content);
  await ensureTags(userId, tagsArr);
  await ensurePeople(userId, peopleArr);

  let typeId = input.note_type_id && input.note_type_id !== PLAIN_TYPE_ID && input.note_type_id !== "default" ? input.note_type_id : null;
  if (typeId && !(await assignableTypeIds(userId)).has(typeId)) throw new AccessError(400, "Geçersiz nesne tipi");
  const customFields = { ...(input.custom_fields || {}) };
  if (typeId === CARD_TYPE_ID && !customFields.kanban_column) customFields.kanban_column = "todo";

  const target = await resolveTargetSpace(userId, input.space_id);
  const noteId = genId("note");
  const date = normalizeDateToIso(input.date);

  const values: any = {
    noteId,
    userId,
    slug: generateSlugForNote(title, date, noteId),
    title,
    content,
    date,
    tags: tagsArr,
    people: peopleArr,
    noteTypeId: typeId,
    customFields,
    areaIds: Array.isArray(input.area_ids) ? input.area_ids : [],
    period: "day",
    workspaceId: target.workspaceId,
    spaceId: target.spaceId,
    source: input.source || {},
    aiMeta: input.ai_meta || {},
    aiSummary: input.ai_summary || null,
  };
  await db.insert(notes).values(values);
  await syncReminders(userId, noteId, content);
  const inserted = (await db.select().from(notes).where(eq(notes.noteId, noteId)).limit(1))[0];
  await saveNoteVersion(userId, noteId, inserted, input.version_summary || "Not oluşturuldu (v1)");
  await syncWikilinkRelations(userId, noteId);
  scheduleEmbedding(userId, noteId);
  await recordEvent(userId, "first_object", { via: input.source?.kind || "service" }, { once: true });
  return inserted as typeof notes.$inferSelect;
}

/** Delete objects created during a failed multi-step operation (compensation). */
export async function deleteObjects(userId: string, ids: string[]) {
  if (!ids.length) return;
  await db.delete(notes).where(and(eq(notes.userId, userId), inArray(notes.noteId, ids)));
}

/** Find an object of a type by exact (case-insensitive) title. */
export async function findByTitle(userId: string, typeId: string, title: string) {
  const all = await db
    .select({ noteId: notes.noteId, title: notes.title })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.noteTypeId, typeId)));
  const t = title.trim().toLocaleLowerCase("tr-TR");
  return all.find((n: any) => n.title.trim().toLocaleLowerCase("tr-TR") === t) || null;
}

export function serializeObjectSummary(n: typeof notes.$inferSelect) {
  return {
    note_id: n.noteId,
    slug: n.slug,
    title: n.title,
    note_type_id: n.noteTypeId || PLAIN_TYPE_ID,
    space_id: n.spaceId,
    date: n.date,
    created_at: n.createdAt.toISOString(),
    updated_at: n.updatedAt.toISOString(),
  };
}

/**
 * Append generated text (AI action results) to an object as a new version.
 * Inserted before the embedded comments block so comments stay last.
 */
export async function appendToObject(userId: string, idOrSlug: string, text: string, summary: string) {
  const found = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), or(eq(notes.noteId, idOrSlug), eq(notes.slug, idOrSlug))))
    .limit(1);
  const n = found[0];
  if (!n) throw new AccessError(404, "Nesne bulunamadı");
  if (n.archived) throw new AccessError(403, "Arşivlenmiş notlar düzenlenemez");
  if (n.isEncrypted) throw new AccessError(400, "Parola kilitli notlara eklenemez");
  const addition = text.trim();
  if (!addition) throw new AccessError(400, "Eklenecek içerik boş");
  const marker = n.content.search(/<!--\s*inkwell:comments:start\s*-->/i);
  const content =
    marker >= 0
      ? `${n.content.slice(0, marker).trimEnd()}\n\n${addition}\n\n${n.content.slice(marker)}`
      : `${n.content.trimEnd()}${n.content.trim() ? "\n\n" : ""}${addition}`;
  const tagsArr = extractTags(content);
  const peopleArr = extractPeople(content);
  await ensureTags(userId, tagsArr);
  await ensurePeople(userId, peopleArr);
  // Optimistic check: do not overwrite an edit made meanwhile
  const updated = await db
    .update(notes)
    .set({ content, tags: tagsArr, people: peopleArr, updatedAt: new Date() })
    .where(and(eq(notes.noteId, n.noteId), eq(notes.content, n.content)))
    .returning({ id: notes.noteId });
  if (updated.length === 0) throw new AccessError(409, "Not başka bir yerde değişti, lütfen yenileyin");
  await syncReminders(userId, n.noteId, content);
  const row = (await db.select().from(notes).where(eq(notes.noteId, n.noteId)).limit(1))[0];
  await saveNoteVersion(userId, n.noteId, row, summary);
  await syncWikilinkRelations(userId, n.noteId);
  scheduleEmbedding(userId, n.noteId);
  return { note_id: n.noteId, content };
}
