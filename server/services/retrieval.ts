// Hybrid retrieval over the caller's own objects. Scoping (owner, filters,
// locked notes) happens in SQL; ranking happens in retrievalRank.ts.
// Password-locked notes are never retrieved, so they never reach a model.
import { and, eq, gte, lte, or, isNull, sql } from "drizzle-orm";
import { db, notes, noteTypes, objectRelations } from "../../src/db/index";
import { DAILY_TYPE_ID } from "../../src/lib/objectTypes";
import { embedderFor } from "./embeddings";
import { rankChunks, type RankedChunk, type RetrievalDoc } from "./retrievalRank";

export interface RetrievalFilters {
  type_id?: string;
  space_id?: string;
  tag?: string;
  date_from?: string; // YYYY-MM-DD
  date_to?: string;
  include_archived?: boolean;
}

function parseVector(raw: unknown): number[] | null {
  if (!raw) return null;
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number") ? v : null;
  } catch {
    return null;
  }
}

export async function loadDocs(userId: string, f: RetrievalFilters = {}, embedModel: string | null = null) {
  const conds: any[] = [eq(notes.userId, userId), eq(notes.isEncrypted, false)];
  if (!f.include_archived) conds.push(eq(notes.archived, false));
  if (f.type_id) {
    conds.push(f.type_id === "type_plain" ? or(isNull(notes.noteTypeId), eq(notes.noteTypeId, "type_plain")) : eq(notes.noteTypeId, f.type_id));
  }
  if (f.space_id) conds.push(eq(notes.spaceId, f.space_id));
  if (f.date_from) conds.push(gte(sql`substr(${notes.date}, 1, 10)`, f.date_from));
  if (f.date_to) conds.push(lte(sql`substr(${notes.date}, 1, 10)`, f.date_to));
  if (f.tag) conds.push(sql`${notes.tags} @> ${JSON.stringify([f.tag.toLowerCase().replace(/^#/, "")])}::jsonb`);
  const rows = await db
    .select({
      id: notes.noteId,
      slug: notes.slug,
      title: notes.title,
      content: notes.content,
      date: notes.date,
      tags: notes.tags,
      typeId: notes.noteTypeId,
      typeName: noteTypes.name,
      embedding: notes.embedding,
      embeddingModel: notes.embeddingModel,
    })
    .from(notes)
    .leftJoin(noteTypes, eq(noteTypes.typeId, notes.noteTypeId))
    .where(and(...conds));
  return rows.map(
    (r: any): RetrievalDoc & { typeId: string | null } => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      content: r.content,
      date: r.date,
      tags: r.tags || [],
      type_name: r.typeName || "Düz Metin",
      typeId: r.typeId,
      vector: embedModel && r.embeddingModel === embedModel ? parseVector(r.embedding) : null,
    })
  );
}

/** note id -> ids it is related to (any active relation, either direction). */
export async function neighborMap(userId: string): Promise<Map<string, Set<string>>> {
  const rels = await db
    .select({ s: objectRelations.sourceId, t: objectRelations.targetId })
    .from(objectRelations)
    .where(and(eq(objectRelations.userId, userId), eq(objectRelations.status, "active")));
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => (m.get(a) || m.set(a, new Set()).get(a)!).add(b);
  for (const r of rels as any[]) {
    add(r.s, r.t);
    add(r.t, r.s);
  }
  return m;
}

export interface RetrievalResult {
  chunks: RankedChunk[];
  semantic: boolean;
  embed_model: string | null;
}

export async function retrieve(userId: string, query: string, f: RetrievalFilters = {}, opts: { limit?: number; excludeIds?: Set<string> } = {}): Promise<RetrievalResult> {
  const emb = await embedderFor(userId);
  let queryVector: number[] | null = null;
  if (emb) {
    try {
      queryVector = await emb.provider.embed(query);
    } catch (e) {
      console.warn("[Retrieval] query embedding failed:", (e as Error).message);
    }
  }
  const docs = (await loadDocs(userId, f, emb?.model || null)).filter((d) => d.typeId !== DAILY_TYPE_ID || (d.content || "").trim().length > 80);
  const chunks = rankChunks(query, docs, { queryVector, neighbors: await neighborMap(userId), limit: opts.limit ?? 8, excludeIds: opts.excludeIds });
  return { chunks, semantic: Boolean(queryVector), embed_model: emb?.model || null };
}
