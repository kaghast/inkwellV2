// Templates managed in Settings > Şablonlar.
// - Built-in templates (daily/meeting/project/research) create connected
//   objects; users can edit their title/content text, hide them, or reset.
// - Own templates create one object of a chosen type from title/content text.
import { and, eq, isNull } from "drizzle-orm";
import { db, userTemplates } from "../../src/db/index";
import { isJournalPageType } from "../../src/lib/objectTypes";
import { genId } from "./notesCore";
import { assignableTypeIds, createObject } from "./objects";
import { AccessError } from "./workspaces";
import { TEMPLATES, builtinDefaults, fillTemplate, type TemplateKey, type TemplateOverride } from "./templatePlans";

type Row = typeof userTemplates.$inferSelect;

export interface TemplateView {
  id: string; // built-in key or template id
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

const isBuiltin = (k: string): k is TemplateKey => TEMPLATES.some((t) => t.key === k);

async function rows(userId: string): Promise<Row[]> {
  return db.select().from(userTemplates).where(eq(userTemplates.userId, userId));
}

export async function listTemplates(userId: string, opts: { includeHidden?: boolean } = {}): Promise<TemplateView[]> {
  const all = await rows(userId);
  const builtins: TemplateView[] = TEMPLATES.map((t) => {
    const o = all.find((r) => r.builtinKey === t.key);
    const d = builtinDefaults(t.key);
    return {
      id: t.key,
      kind: "builtin",
      name: t.name,
      description: t.description,
      fields: [...t.fields],
      note_type_id: null,
      title_template: o?.titleTemplate ?? d.title_template,
      content_template: o?.contentTemplate ?? d.content_template,
      hidden: Boolean(o?.hidden),
      customized: Boolean(o && (o.titleTemplate != null || o.contentTemplate != null)),
    };
  });
  const custom: TemplateView[] = all
    .filter((r) => !r.builtinKey)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r) => ({
      id: r.templateId,
      kind: "custom",
      name: r.name,
      description: r.description || "",
      fields: ["title"],
      note_type_id: r.noteTypeId,
      title_template: r.titleTemplate || "",
      content_template: r.contentTemplate || "",
      hidden: r.hidden,
      customized: true,
    }));
  const out = [...builtins, ...custom];
  return opts.includeHidden ? out : out.filter((t) => !t.hidden);
}

/** The user's override for a built-in, or null. */
export async function builtinOverride(userId: string, key: TemplateKey): Promise<TemplateOverride | null> {
  const r = await db
    .select()
    .from(userTemplates)
    .where(and(eq(userTemplates.userId, userId), eq(userTemplates.builtinKey, key)))
    .limit(1);
  if (!r[0] || (r[0].titleTemplate == null && r[0].contentTemplate == null)) return null;
  return { title_template: r[0].titleTemplate, content_template: r[0].contentTemplate };
}

export interface TemplateInputBody {
  name?: string;
  description?: string;
  note_type_id?: string | null;
  title_template?: string;
  content_template?: string;
  hidden?: boolean;
}

async function checkType(userId: string, typeId?: string | null) {
  if (!typeId || typeId === "type_plain") return null;
  if (isJournalPageType(typeId)) throw new AccessError(400, "Günlük ve aylık kayıt tipleri şablonla oluşturulamaz");
  if (!(await assignableTypeIds(userId)).has(typeId)) throw new AccessError(400, "Geçersiz nesne tipi");
  return typeId;
}

export async function createTemplate(userId: string, body: TemplateInputBody) {
  if (!body.name?.trim()) throw new AccessError(400, "Şablon adı gerekli");
  const templateId = genId("tpl");
  await db.insert(userTemplates).values({
    templateId,
    userId,
    builtinKey: null,
    name: body.name.trim(),
    description: body.description?.trim() || null,
    noteTypeId: await checkType(userId, body.note_type_id),
    titleTemplate: body.title_template ?? "",
    contentTemplate: body.content_template ?? "",
  });
  return (await listTemplates(userId, { includeHidden: true })).find((t) => t.id === templateId)!;
}

export async function updateTemplate(userId: string, id: string, body: TemplateInputBody) {
  if (isBuiltin(id)) {
    const existing = await db
      .select()
      .from(userTemplates)
      .where(and(eq(userTemplates.userId, userId), eq(userTemplates.builtinKey, id)))
      .limit(1);
    const set = {
      ...(body.title_template !== undefined ? { titleTemplate: body.title_template } : {}),
      ...(body.content_template !== undefined ? { contentTemplate: body.content_template } : {}),
      ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
      updatedAt: new Date(),
    };
    if (existing[0]) await db.update(userTemplates).set(set).where(eq(userTemplates.templateId, existing[0].templateId));
    else
      await db.insert(userTemplates).values({
        templateId: genId("tpl"),
        userId,
        builtinKey: id,
        name: TEMPLATES.find((t) => t.key === id)!.name,
        titleTemplate: body.title_template ?? null,
        contentTemplate: body.content_template ?? null,
        hidden: Boolean(body.hidden),
      });
  } else {
    const r = await db
      .select({ id: userTemplates.templateId })
      .from(userTemplates)
      .where(and(eq(userTemplates.userId, userId), eq(userTemplates.templateId, id), isNull(userTemplates.builtinKey)))
      .limit(1);
    if (!r[0]) throw new AccessError(404, "Şablon bulunamadı");
    if (body.name !== undefined && !body.name.trim()) throw new AccessError(400, "Şablon adı gerekli");
    await db
      .update(userTemplates)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description.trim() || null } : {}),
        ...(body.note_type_id !== undefined ? { noteTypeId: await checkType(userId, body.note_type_id) } : {}),
        ...(body.title_template !== undefined ? { titleTemplate: body.title_template } : {}),
        ...(body.content_template !== undefined ? { contentTemplate: body.content_template } : {}),
        ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
        updatedAt: new Date(),
      })
      .where(eq(userTemplates.templateId, id));
  }
  return (await listTemplates(userId, { includeHidden: true })).find((t) => t.id === id)!;
}

/** Delete an own template, or reset a built-in to its defaults. */
export async function deleteTemplate(userId: string, id: string) {
  const where = isBuiltin(id)
    ? and(eq(userTemplates.userId, userId), eq(userTemplates.builtinKey, id))
    : and(eq(userTemplates.userId, userId), eq(userTemplates.templateId, id), isNull(userTemplates.builtinKey));
  const r = await db.delete(userTemplates).where(where).returning({ id: userTemplates.templateId });
  if (!isBuiltin(id) && r.length === 0) throw new AccessError(404, "Şablon bulunamadı");
  return { ok: true };
}

/** Create one object from an own template. */
export async function applyCustomTemplate(userId: string, id: string, input: { title?: string; date?: string; space_id?: string | null }, today: string) {
  const r = await db
    .select()
    .from(userTemplates)
    .where(and(eq(userTemplates.userId, userId), eq(userTemplates.templateId, id), isNull(userTemplates.builtinKey)))
    .limit(1);
  const t = r[0];
  if (!t) throw new AccessError(404, "Şablon bulunamadı");
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : today;
  const typed = input.title?.trim() || "";
  const title = typed || fillTemplate(t.titleTemplate || "", { date, title: "" }).trim() || t.name;
  const obj = await createObject(userId, {
    title,
    content: fillTemplate(t.contentTemplate || "", { date, title }),
    note_type_id: t.noteTypeId,
    date: `${date}T${new Date().toTimeString().slice(0, 8)}`,
    space_id: input.space_id,
    source: { kind: "template", template: id },
    version_summary: `Şablondan oluşturuldu: ${t.name} (v1)`,
  });
  return { primary_id: obj.noteId, slug: obj.slug, created: [obj.noteId], reused: [], relations: 0 };
}
