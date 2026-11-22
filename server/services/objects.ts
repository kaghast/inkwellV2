// Creating objects from services (capture, templates, Today). Mirrors the
// legacy POST /api/notes path: tags/people extraction, slug, embedding,
// reminders, v1 version, wikilink relations, space assignment.
import { and, eq, or, isNull, inArray } from "drizzle-orm";
import { db, notes, noteTypes } from "../../src/db/index";
import { generateTextEmbedding } from "../../src/lib/embeddings";
import { CARD_TYPE_ID, PLAIN_TYPE_ID } from "../../src/lib/objectTypes";
import {
  genId, extractTags, extractPeople, ensureTags, ensurePeople, syncReminders, saveNoteVersion,
  normalizeDateToIso, generateSlugForNote,
} from "./notesCore";
import { resolveTargetSpace, AccessError } from "./workspaces";
import { syncWikilinkRelations } from "./relations";
import { recordEvent } from "./analytics";

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
  const embedding = await generateTextEmbedding(`${title}\n${content}`);

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
  if (embedding) values.embedding = embedding;
  await db.insert(notes).values(values);
  await syncReminders(userId, noteId, content);
  const inserted = (await db.select().from(notes).where(eq(notes.noteId, noteId)).limit(1))[0];
  await saveNoteVersion(userId, noteId, inserted, input.version_summary || "Not oluşturuldu (v1)");
  await syncWikilinkRelations(userId, noteId);
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
