// Today: the day's daily note, objects, captures, open tasks and reminders.
// Everything returned is real data from that day; nothing is inferred.
import { and, eq, gte, lt, or, sql } from "drizzle-orm";
import { db, notes, reminders, noteTypes } from "../../src/db/index";
import { DAILY_TYPE_ID } from "../../src/lib/objectTypes";
import { openTasks } from "./dayTasks";
import { capturesForDay } from "./capture";
import { applyTemplate, findDailyNote } from "./templates";

function summarize(n: any) {
  return {
    note_id: n.noteId,
    slug: n.slug,
    title: n.title || "Adsız",
    note_type_id: n.noteTypeId || "type_plain",
    type_name: n.typeName || "Düz Metin",
    type_icon: n.typeIcon || "FileText",
    type_color: n.typeColor || "#64748b",
    date: n.date,
    is_encrypted: Boolean(n.isEncrypted),
    created_at: n.createdAt.toISOString(),
    updated_at: n.updatedAt.toISOString(),
    // timeslot blocks are parsed in the browser with src/lib/timeslot.ts
    content: n.isEncrypted ? "" : n.content,
  };
}

export async function today(userId: string, date: string) {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const rows = await db
    .select({
      noteId: notes.noteId,
      slug: notes.slug,
      title: notes.title,
      content: notes.content,
      noteTypeId: notes.noteTypeId,
      date: notes.date,
      isEncrypted: notes.isEncrypted,
      archived: notes.archived,
      period: notes.period,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
      typeName: noteTypes.name,
      typeIcon: noteTypes.icon,
      typeColor: noteTypes.color,
    })
    .from(notes)
    .leftJoin(noteTypes, eq(noteTypes.typeId, notes.noteTypeId))
    .where(
      and(
        eq(notes.userId, userId),
        or(
          and(sql`substr(${notes.date}, 1, 10) = ${date}`, eq(notes.period, "day")),
          and(gte(notes.createdAt, start), lt(notes.createdAt, end))
        )
      )
    );
  const own = rows.filter((r: any) => !r.archived);
  const daily = own.find((r: any) => r.noteTypeId === DAILY_TYPE_ID && r.date.slice(0, 10) === date) || null;
  const objects = own.filter((r: any) => r !== daily);
  const tasks = own.filter((r: any) => !r.isEncrypted).flatMap((r: any) => openTasks(r.noteId, r.title, r.content));
  const rem = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.userId, userId), gte(reminders.at, start), lt(reminders.at, end)));
  return {
    date,
    daily_note: daily ? summarize(daily) : null,
    objects: objects.map(summarize),
    tasks,
    reminders: rem.map((r: any) => ({ reminder_id: r.reminderId, note_id: r.noteId, at: r.at.toISOString(), text: r.text, fired: r.fired })),
    captures: await capturesForDay(userId, date),
  };
}

export async function ensureDailyNote(userId: string, date: string, todayIso: string) {
  const existing = await findDailyNote(userId, date);
  if (existing) return { note_id: existing.noteId, slug: existing.slug, created: false };
  const r = await applyTemplate(userId, "daily", { date }, todayIso);
  return { note_id: r.primary_id, slug: r.slug, created: r.created.length > 0 };
}

