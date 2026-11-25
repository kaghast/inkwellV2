// Global search across objects (title, content, tags, people, type, space)
// and Inbox captures. Postgres full text picks the candidates (generated
// `notes.search_tsv` column, GIN index, migration 011); the pure ranking in
// searchRank.ts then scores only those, so matches and snippets stay the same.
import { and, desc, eq, or, isNull, sql } from "drizzle-orm";
import { db, notes, noteTypes, captures, spaces } from "../../src/db/index";
import { fold, queryWords, rankDocuments, tsQueryFor, type SearchDoc } from "./searchRank";

/** Most full-text candidates ranked in Node per query. */
const CANDIDATES = 400;

/** Ids of object types visible to the user whose name contains one of the words. */
async function typeIdsMatching(userId: string, words: string[]): Promise<{ ids: string[]; plain: boolean }> {
  const rows = await db
    .select({ id: noteTypes.typeId, name: noteTypes.name })
    .from(noteTypes)
    .where(or(isNull(noteTypes.userId), eq(noteTypes.userId, userId)));
  const hit = (name: string) => words.some((w) => fold(name).includes(w));
  const ids = rows.filter((t: any) => hit(t.name)).map((t: any) => t.id);
  return { ids, plain: ids.includes("type_plain") || hit("Düz Metin") };
}
import { ensurePersonalWorkspace } from "./workspaces";

export async function search(userId: string, query: string, opts: { type_id?: string; space_id?: string; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit || 20, 1), 50);
  const conds: any[] = [eq(notes.userId, userId)];
  if (opts.type_id) {
    conds.push(opts.type_id === "type_plain" ? or(isNull(notes.noteTypeId), eq(notes.noteTypeId, "type_plain")) : eq(notes.noteTypeId, opts.type_id));
  }
  if (opts.space_id) conds.push(eq(notes.spaceId, opts.space_id));
  const words = queryWords(query);
  const tsq = tsQueryFor(words);
  if (!tsq) return { query, objects: [], inbox: [], spaces: [] };
  const tsQuery = sql`to_tsquery('simple', inkwell_fold(${tsq}))`;
  // A word can also match the object type's name ("toplantı" -> meetings)
  const types = await typeIdsMatching(userId, words);
  const match = [sql`"notes"."search_tsv" @@ ${tsQuery}`];
  if (types.ids.length) match.push(sql`${notes.noteTypeId} IN (${sql.join(types.ids.map((id) => sql`${id}`), sql`, `)})`);
  if (types.plain) match.push(isNull(notes.noteTypeId));
  conds.push(or(...match));
  const rows = await db
    .select({
      id: notes.noteId,
      slug: notes.slug,
      title: notes.title,
      content: notes.content,
      tags: notes.tags,
      people: notes.people,
      typeId: notes.noteTypeId,
      typeName: noteTypes.name,
      spaceId: notes.spaceId,
      isEncrypted: notes.isEncrypted,
      archived: notes.archived,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .leftJoin(noteTypes, eq(noteTypes.typeId, notes.noteTypeId))
    .where(and(...conds))
    .orderBy(sql`ts_rank("notes"."search_tsv", ${tsQuery}) DESC`, desc(notes.updatedAt))
    .limit(CANDIDATES);
  const docs: SearchDoc[] = rows.map((r: any) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    content: r.content,
    tags: r.tags || [],
    people: r.people || [],
    type_id: r.typeId || "type_plain",
    type_name: r.typeName || "Düz Metin",
    space_id: r.spaceId,
    is_encrypted: Boolean(r.isEncrypted),
    archived: Boolean(r.archived),
    updated_at: r.updatedAt.toISOString(),
  }));
  const objects = rankDocuments(query, docs, limit);

  const q = fold(query.trim());
  const capRows = await db
    .select({ id: captures.captureId, rawText: captures.rawText, rawUrl: captures.rawUrl, status: captures.status, title: captures.suggestion, createdAt: captures.createdAt })
    .from(captures)
    .where(and(eq(captures.userId, userId), or(eq(captures.status, "ready"), eq(captures.status, "new"), eq(captures.status, "failed"), eq(captures.status, "processing"))))
    .orderBy(desc(captures.createdAt))
    .limit(300);
  const inbox = capRows
    .filter((c: any) => q && fold(`${c.rawText} ${c.rawUrl || ""} ${c.title?.title || ""}`).includes(q))
    .slice(0, 5)
    .map((c: any) => ({ capture_id: c.id, title: c.title?.title || c.rawText.slice(0, 80) || c.rawUrl, status: c.status }));

  const ctx = await ensurePersonalWorkspace(userId);
  const spaceRows = await db.select({ id: spaces.spaceId, name: spaces.name }).from(spaces).where(eq(spaces.workspaceId, ctx.workspaceId));
  const spaceHits = spaceRows.filter((s: any) => q && fold(s.name).includes(q)).map((s: any) => ({ space_id: s.id, name: s.name }));

  return { query, objects, inbox, spaces: spaceHits };
}

export { rankDocuments };
export type { SearchDoc };
