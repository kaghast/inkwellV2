// Typed, bidirectional object relations. [[wikilinks]] are kept in sync as
// `links_to` relations with origin "wikilink"; backlinks are the incoming side.
import { and, eq, or, inArray, isNull, sql } from "drizzle-orm";
import { db, notes, objectRelations, relationTypes, noteTypes } from "../../src/db/index";
import { extractWikilinkTargets, resolveWikilinks } from "../../src/lib/wikilinks";
import { genId, slugify } from "./notesCore";
import { recordEvent } from "./analytics";
import { AccessError } from "./workspaces";

export type RelationOrigin = "wikilink" | "manual" | "template" | "capture" | "ai";

async function ownedNote(userId: string, idOrSlug: string) {
  const r = await db
    .select({ noteId: notes.noteId, workspaceId: notes.workspaceId })
    .from(notes)
    .where(and(eq(notes.userId, userId), or(eq(notes.noteId, idOrSlug), eq(notes.slug, idOrSlug))))
    .limit(1);
  return r[0] || null;
}

/** Reconcile the wikilink relations of one object with its current content. */
export async function syncWikilinkRelations(userId: string, noteId: string) {
  try {
    const self = await db
      .select({ noteId: notes.noteId, content: notes.content, workspaceId: notes.workspaceId })
      .from(notes)
      .where(and(eq(notes.noteId, noteId), eq(notes.userId, userId)))
      .limit(1);
    if (self.length === 0) return;
    const targets = extractWikilinkTargets(self[0].content);
    let wanted: string[] = [];
    if (targets.length > 0) {
      const lowered = targets.map((t) => t.toLowerCase());
      const candidates = await db
        .select({ id: notes.noteId, title: notes.title, slug: notes.slug })
        .from(notes)
        .where(
          and(
            eq(notes.userId, userId),
            or(
              inArray(sql`lower(trim(${notes.title}))`, lowered),
              inArray(sql`lower(${notes.slug})`, lowered),
              inArray(notes.noteId, targets)
            )
          )
        );
      wanted = resolveWikilinks(targets, candidates, noteId);
    }
    const existing = await db
      .select({ relationId: objectRelations.relationId, targetId: objectRelations.targetId })
      .from(objectRelations)
      .where(
        and(
          eq(objectRelations.sourceId, noteId),
          eq(objectRelations.origin, "wikilink"),
          eq(objectRelations.relationType, "links_to")
        )
      );
    const have = new Set(existing.map((e: any) => e.targetId));
    const stale = existing.filter((e: any) => !wanted.includes(e.targetId)).map((e: any) => e.relationId);
    if (stale.length) await db.delete(objectRelations).where(inArray(objectRelations.relationId, stale));
    const added = wanted.filter((t) => !have.has(t));
    for (const targetId of added) {
      await db
        .insert(objectRelations)
        .values({
          relationId: genId("rel"),
          userId,
          workspaceId: self[0].workspaceId,
          sourceId: noteId,
          targetId,
          relationType: "links_to",
          origin: "wikilink",
          status: "active",
        })
        .onConflictDoNothing();
    }
    if (added.length) await recordEvent(userId, "first_backlink", {}, { once: true });
  } catch (e) {
    console.warn("[Relations] wikilink sync failed for", noteId, (e as Error).message);
  }
}

/** Migration 005: build wikilink relations for every existing note. */
export async function backfillWikilinkRelations() {
  const all = await db.select({ noteId: notes.noteId, userId: notes.userId, content: notes.content }).from(notes);
  let n = 0;
  for (const row of all) {
    if (row.content && row.content.includes("[[")) {
      await syncWikilinkRelations(row.userId, row.noteId);
      n++;
    }
  }
  if (n) console.log(`[Relations] synced wikilinks for ${n} notes`);
}

export async function listRelationTypes(userId: string) {
  const rows = await db
    .select()
    .from(relationTypes)
    .where(or(isNull(relationTypes.userId), eq(relationTypes.userId, userId)));
  return rows.map((r: typeof relationTypes.$inferSelect) => ({
    type_key: r.typeKey,
    label: r.label,
    inverse_label: r.inverseLabel,
    symmetric: r.symmetric,
    is_system: r.userId === null,
  }));
}

export async function createRelationType(userId: string, input: { label: string; inverse_label?: string; symmetric?: boolean }) {
  const base = slugify(input.label).slice(0, 40) || "iliski";
  const typeKey = `u_${base}_${genId("rt").slice(3, 9)}`;
  const symmetric = Boolean(input.symmetric);
  await db.insert(relationTypes).values({
    typeKey,
    userId,
    label: input.label,
    inverseLabel: symmetric ? input.label : input.inverse_label || input.label,
    symmetric,
  });
  return (await listRelationTypes(userId)).find((t: any) => t.type_key === typeKey);
}

async function assertRelationType(userId: string, typeKey: string) {
  const r = await db
    .select({ k: relationTypes.typeKey })
    .from(relationTypes)
    .where(and(eq(relationTypes.typeKey, typeKey), or(isNull(relationTypes.userId), eq(relationTypes.userId, userId))))
    .limit(1);
  if (r.length === 0) throw new AccessError(400, "Geçersiz ilişki tipi");
}

export async function createRelation(
  userId: string,
  input: { source_id: string; target_id: string; relation_type?: string; note?: string | null; origin?: RelationOrigin; status?: "active" | "suggested" }
) {
  const relationType = input.relation_type || "related_to";
  if (relationType === "links_to" && (input.origin || "manual") !== "wikilink") {
    // links_to is reserved for [[wikilinks]] so it always mirrors the text
    throw new AccessError(400, "Bu ilişki tipi yalnızca [[bağlantı]] ile oluşur");
  }
  await assertRelationType(userId, relationType);
  const source = await ownedNote(userId, input.source_id);
  const target = await ownedNote(userId, input.target_id);
  if (!source || !target) throw new AccessError(404, "Nesne bulunamadı");
  if (source.noteId === target.noteId) throw new AccessError(400, "Bir nesne kendisiyle ilişkilendirilemez");

  // Symmetric types are stored once; reuse the reverse row if it exists.
  const existing = await db
    .select()
    .from(objectRelations)
    .where(
      and(
        eq(objectRelations.relationType, relationType),
        or(
          and(eq(objectRelations.sourceId, source.noteId), eq(objectRelations.targetId, target.noteId)),
          and(eq(objectRelations.sourceId, target.noteId), eq(objectRelations.targetId, source.noteId))
        )
      )
    );
  const symmetric = (await listRelationTypes(userId)).find((t: any) => t.type_key === relationType)?.symmetric;
  const same = existing.find((e: any) => e.sourceId === source.noteId) || (symmetric ? existing[0] : undefined);
  if (same) {
    if (same.status === "suggested" && input.status !== "suggested") {
      await db.update(objectRelations).set({ status: "active", origin: input.origin || same.origin }).where(eq(objectRelations.relationId, same.relationId));
    }
    return { relation_id: same.relationId, created: false };
  }
  const relationId = genId("rel");
  await db.insert(objectRelations).values({
    relationId,
    userId,
    workspaceId: source.workspaceId,
    sourceId: source.noteId,
    targetId: target.noteId,
    relationType,
    origin: input.origin || "manual",
    status: input.status || "active",
    note: input.note ? String(input.note).slice(0, 500) : null,
  });
  if ((input.status || "active") === "active") await recordEvent(userId, "first_relation", { origin: input.origin || "manual" }, { once: true });
  return { relation_id: relationId, created: true };
}

async function ownedRelation(userId: string, relationId: string) {
  const r = await db
    .select()
    .from(objectRelations)
    .where(and(eq(objectRelations.relationId, relationId), eq(objectRelations.userId, userId)))
    .limit(1);
  if (r.length === 0) throw new AccessError(404, "İlişki bulunamadı");
  return r[0];
}

export async function deleteRelation(userId: string, relationId: string) {
  const rel = await ownedRelation(userId, relationId);
  if (rel.origin === "wikilink") {
    throw new AccessError(400, "Bu ilişki metindeki [[bağlantı]] ile oluşuyor; kaldırmak için metni düzenle");
  }
  await db.delete(objectRelations).where(eq(objectRelations.relationId, relationId));
}

export async function acceptRelation(userId: string, relationId: string) {
  await ownedRelation(userId, relationId);
  await db.update(objectRelations).set({ status: "active" }).where(eq(objectRelations.relationId, relationId));
  await recordEvent(userId, "first_relation", { origin: "suggestion" }, { once: true });
}

/** Outgoing and incoming relations of one object, with the other side summarised. */
export async function relationsForObject(userId: string, idOrSlug: string) {
  const self = await ownedNote(userId, idOrSlug);
  if (!self) throw new AccessError(404, "Nesne bulunamadı");
  const id = self.noteId;
  const rels = await db
    .select()
    .from(objectRelations)
    .where(and(eq(objectRelations.userId, userId), or(eq(objectRelations.sourceId, id), eq(objectRelations.targetId, id))));
  const otherIds = Array.from(new Set(rels.map((r: any) => (r.sourceId === id ? r.targetId : r.sourceId)))) as string[];
  const others = otherIds.length
    ? await db
        .select({
          noteId: notes.noteId,
          slug: notes.slug,
          title: notes.title,
          noteTypeId: notes.noteTypeId,
          date: notes.date,
          archived: notes.archived,
          typeName: noteTypes.name,
          typeIcon: noteTypes.icon,
          typeColor: noteTypes.color,
        })
        .from(notes)
        .leftJoin(noteTypes, eq(noteTypes.typeId, notes.noteTypeId))
        .where(and(eq(notes.userId, userId), inArray(notes.noteId, otherIds)))
    : [];
  const byId = new Map<string, any>(others.map((o: any) => [o.noteId, o]));
  const types = new Map<string, any>((await listRelationTypes(userId)).map((t: any) => [t.type_key, t]));
  const shape = (r: any, direction: "outgoing" | "incoming") => {
    const other = byId.get(direction === "outgoing" ? r.targetId : r.sourceId);
    if (!other) return null;
    const t = types.get(r.relationType);
    return {
      relation_id: r.relationId,
      relation_type: r.relationType,
      label: t ? (direction === "outgoing" || t.symmetric ? t.label : t.inverse_label) : r.relationType,
      direction,
      origin: r.origin,
      status: r.status,
      note: r.note,
      created_at: r.createdAt.toISOString(),
      object: {
        note_id: other.noteId,
        slug: other.slug,
        title: other.title || "Adsız",
        note_type_id: other.noteTypeId || "type_plain",
        type_name: other.typeName || "Düz Metin",
        type_icon: other.typeIcon || "FileText",
        type_color: other.typeColor || "#64748b",
        date: other.date,
        archived: other.archived,
      },
    };
  };
  const outgoing = rels.filter((r: any) => r.sourceId === id).map((r: any) => shape(r, "outgoing")).filter(Boolean);
  const incoming = rels.filter((r: any) => r.targetId === id).map((r: any) => shape(r, "incoming")).filter(Boolean);
  return { object_id: id, outgoing, incoming, backlinks: incoming.filter((r: any) => r.status === "active") };
}

/** Pending relation suggestions (from capture/AI) for Home. */
export async function pendingSuggestions(userId: string, limit = 8) {
  const rows = await db
    .select({
      relationId: objectRelations.relationId,
      sourceId: objectRelations.sourceId,
      targetId: objectRelations.targetId,
      note: objectRelations.note,
      relationType: objectRelations.relationType,
    })
    .from(objectRelations)
    .where(and(eq(objectRelations.userId, userId), eq(objectRelations.status, "suggested")))
    .limit(limit);
  const ids = Array.from(new Set(rows.flatMap((r: any) => [r.sourceId, r.targetId]))) as string[];
  const titles = ids.length
    ? await db.select({ id: notes.noteId, title: notes.title, slug: notes.slug }).from(notes).where(inArray(notes.noteId, ids))
    : [];
  const t = new Map<string, any>(titles.map((x: any) => [x.id, x]));
  return rows.map((r: any) => ({
    relation_id: r.relationId,
    relation_type: r.relationType,
    reason: r.note,
    source: { note_id: r.sourceId, title: t.get(r.sourceId)?.title || "Adsız", slug: t.get(r.sourceId)?.slug },
    target: { note_id: r.targetId, title: t.get(r.targetId)?.title || "Adsız", slug: t.get(r.targetId)?.slug },
  }));
}
