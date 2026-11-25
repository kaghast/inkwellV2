// Phase 2.5f: journal links to the rest of the app — bullet search across
// notes and turning a task bullet into a Kanban card. Note content stays the
// source of truth; writes go through createObject / rewriteObjectContent.
import { and, eq, sql } from "drizzle-orm";
import { db, notes } from "../../src/db/index";
import { CARD_TYPE_ID } from "../../src/lib/objectTypes";
import { linkTaskInMarkdown, taskText } from "../../src/lib/tasks";
import { createObject, rewriteObjectContent } from "./objects";
import { AccessError } from "./workspaces";
import { cardTitleFromTask, queryBullets, type BulletFilter } from "./bulletQuery";

/** Bullets in all of the user's readable notes (archived and locked notes are left out). */
export async function searchBullets(userId: string, f: BulletFilter & { from?: string; to?: string; limit?: number }) {
  const conds = [eq(notes.userId, userId), eq(notes.archived, false), sql`coalesce(${notes.isEncrypted}, false) = false`];
  if (f.from) conds.push(sql`substr(${notes.date}, 1, 10) >= ${f.from}`);
  if (f.to) conds.push(sql`substr(${notes.date}, 1, 10) <= ${f.to}`);
  const pages = await db
    .select({ noteId: notes.noteId, slug: notes.slug, title: notes.title, content: notes.content, date: notes.date, noteTypeId: notes.noteTypeId })
    .from(notes)
    .where(and(...conds));
  const limit = Math.min(500, Math.max(1, f.limit || 300));
  return queryBullets(pages as any, f, limit);
}

/**
 * Makes a Kanban card from the `index`-th open task of a note. The task stays
 * open and gets " → [[Card]]"; the card links back to the page. When the page
 * changed meanwhile the new card is archived again (nothing is deleted).
 */
export async function taskToCard(userId: string, noteId: string, index: number, expected?: string) {
  const src = (await db.select().from(notes).where(and(eq(notes.userId, userId), eq(notes.noteId, noteId))).limit(1))[0];
  if (!src) throw new AccessError(404, "Not bulunamadı");
  if (src.isEncrypted) throw new AccessError(400, "Parola kilitli notlardaki görevler karta çevrilemez");
  if (src.archived) throw new AccessError(403, "Arşivlenmiş notlar düzenlenemez");
  if (expected !== undefined && expected !== src.content) throw new AccessError(409, "Not başka bir yerde değişti, lütfen yenileyin");
  const t = taskText(src.content || "", index);
  if (!t || t.state !== "open") throw new AccessError(409, "Bu görev artık açık değil, sayfayı yenile");
  if (/→\s*\[\[[^\]]+\]\]\s*$/.test(t.text)) throw new AccessError(409, "Bu görev zaten başka bir sayfaya bağlı");

  let title = cardTitleFromTask(t.text) || "Defterden görev";
  // A card whose title another note already uses would make the link ambiguous
  const clash = await db
    .select({ id: notes.noteId })
    .from(notes)
    .where(and(eq(notes.userId, userId), sql`lower(${notes.title}) = lower(${title})`))
    .limit(1);
  if (clash.length) title = `${title} (kart)`.slice(0, 130);

  const card = await createObject(userId, {
    title,
    content: `${t.signifier === "priority" ? "Öncelikli. " : ""}Defterdeki görev: [[${src.title}]]`,
    note_type_id: CARD_TYPE_ID,
    source: { kind: "journal", from_note: src.noteId, task_index: index },
    version_summary: "Defterdeki görevden kart oluşturuldu (v1)",
  });
  try {
    const r = await rewriteObjectContent(
      userId,
      src.noteId,
      (old) => {
        const linked = linkTaskInMarkdown(old, index, title);
        if (!linked || linked.text !== t.text) throw new AccessError(409, "Not başka bir yerde değişti, lütfen yenileyin");
        return linked.content;
      },
      null
    );
    return { card_id: card.noteId, card_slug: card.slug, card_title: title, note_id: r.note_id, content: r.content };
  } catch (e) {
    await db.update(notes).set({ archived: true, updatedAt: new Date() }).where(eq(notes.noteId, card.noteId)).catch(() => undefined);
    throw e;
  }
}
