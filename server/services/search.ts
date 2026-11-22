// Global search across objects (title, content, tags, people, type, space)
// and Inbox captures. Phase 1 ranks in Node over the caller's own rows; Phase 2
// moves this to Postgres full text + pgvector (see TECHNICAL_ROADMAP.md).
import { and, desc, eq, or, isNull } from "drizzle-orm";
import { db, notes, noteTypes, captures, spaces } from "../../src/db/index";
import { fold, rankDocuments, type SearchDoc } from "./searchRank";
import { ensurePersonalWorkspace } from "./workspaces";

export async function search(userId: string, query: string, opts: { type_id?: string; space_id?: string; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit || 20, 1), 50);
  const conds: any[] = [eq(notes.userId, userId)];
  if (opts.type_id) {
    conds.push(opts.type_id === "type_plain" ? or(isNull(notes.noteTypeId), eq(notes.noteTypeId, "type_plain")) : eq(notes.noteTypeId, opts.type_id));
  }
  if (opts.space_id) conds.push(eq(notes.spaceId, opts.space_id));
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
    .where(and(...conds));
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
