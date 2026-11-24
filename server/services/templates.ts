// Templates that create connected objects, not just text. Each template
// returns a plan of objects + relations; applyTemplate creates them and rolls
// back (deletes what it created) if any step fails.
import { DAILY_TYPE_ID } from "../../src/lib/objectTypes";
import { TEMPLATES, planTemplate, withOverride, type TemplateInput, type TemplateKey } from "./templatePlans";
import { applyCustomTemplate, builtinOverride } from "./userTemplates";
import { createObject, deleteObjects, findByTitle } from "./objects";
import { createRelation } from "./relations";
import { AccessError } from "./workspaces";
import { and, eq, sql } from "drizzle-orm";
import { db, notes } from "../../src/db/index";

export async function findDailyNote(userId: string, date: string) {
  const r = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.noteTypeId, DAILY_TYPE_ID), sql`substr(${notes.date}, 1, 10) = ${date}`))
    .limit(1);
  return r[0] || null;
}

export async function applyTemplate(userId: string, key: string, input: TemplateInput, today: string) {
  if (!TEMPLATES.some((t) => t.key === key)) return applyCustomTemplate(userId, key, input, today);
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : today;
  const plan = withOverride(planTemplate(key as TemplateKey, input, today), await builtinOverride(userId, key as TemplateKey), {
    date,
    typedTitle: key === "daily" ? undefined : input.title,
  });

  if (key === "daily") {
    const existing = await findDailyNote(userId, date);
    if (existing) return { primary_id: existing.noteId, slug: existing.slug, created: [], reused: [existing.noteId], relations: 0 };
  }

  const ids = new Map<string, string>();
  const created: string[] = [];
  const reused: string[] = [];
  try {
    for (const o of plan.objects) {
      if (o.reuse && o.type_id) {
        const found = await findByTitle(userId, o.type_id, o.title);
        if (found) {
          ids.set(o.ref, found.noteId);
          reused.push(found.noteId);
          continue;
        }
      }
      const obj = await createObject(userId, {
        title: o.title,
        content: o.content,
        note_type_id: o.type_id,
        custom_fields: o.custom_fields,
        date: `${date}T${new Date().toTimeString().slice(0, 8)}`,
        space_id: input.space_id,
        source: { kind: "template", template: key },
        version_summary: `Şablondan oluşturuldu: ${key} (v1)`,
      });
      ids.set(o.ref, obj.noteId);
      created.push(obj.noteId);
    }
    let relations = 0;
    for (const r of plan.relations) {
      const res = await createRelation(userId, { source_id: ids.get(r.from)!, target_id: ids.get(r.to)!, relation_type: r.type, origin: "template" });
      if (res.created) relations++;
    }
    const primaryId = ids.get(plan.primary)!;
    const primary = await db.select({ slug: notes.slug }).from(notes).where(eq(notes.noteId, primaryId)).limit(1);
    return { primary_id: primaryId, slug: primary[0]?.slug, created, reused, relations };
  } catch (e) {
    await deleteObjects(userId, created).catch(() => undefined);
    throw e;
  }
}

export { TEMPLATES, planTemplate };
export type { TemplateInput };
