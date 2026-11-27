// Habit tracker and daily mood/energy. A habit is a tag: its done days are
// the daily-note lines carrying that tag ("- [x] Okuma #okuma"), so the note
// stays the source of truth and the tracker is a line filter over daily
// notes. The habits table only holds the definition (name, tag, colour,
// order). Ticking a cell rewrites the day's daily note like any other edit.
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, habits, habitLogs, dayRatings, notes } from "../../src/db/index";
import { DAILY_TYPE_ID } from "../../src/lib/objectTypes";
import { habitStreaks, monthDays } from "../../src/lib/journal";
import { addHabitLines, habitTagFromName, listLines, normTag, setHabitInMarkdown } from "../../src/lib/tasks";
import { genId } from "./notesCore";
import { rewriteObjectContent } from "./objects";
import { ensureDailyNote } from "./today";
import { findDailyNote } from "./templates";
import { AccessError } from "./workspaces";

const COLORS = ["#0d9488", "#d97706", "#7c3aed", "#db2777", "#2563eb", "#16a34a", "#dc2626", "#0891b2"];
const TAG_OK = /^[a-z0-9_\-ğüşıöç]{1,40}$/u;

type HabitDef = { habitId: string; name: string; tag: string; color: string | null; archived: boolean; position: number };

async function owned(userId: string, habitId: string): Promise<HabitDef> {
  const r = (await db.select().from(habits).where(and(eq(habits.habitId, habitId), eq(habits.userId, userId))).limit(1))[0] as any;
  if (!r) throw new AccessError(404, "Alışkanlık bulunamadı");
  return (await withTags(userId, [r]))[0];
}

/** Gives habits created before tags existed a tag of their own (stored once). */
async function withTags(userId: string, list: any[]): Promise<HabitDef[]> {
  const missing = list.filter((h) => !h.tag);
  if (missing.length) {
    const taken = new Set(
      ((await db.select({ tag: habits.tag }).from(habits).where(eq(habits.userId, userId))) as any[]).map((r) => r.tag).filter(Boolean)
    );
    for (const h of missing) {
      const base = habitTagFromName(h.name) || "aliskanlik";
      let tag = base;
      for (let n = 2; taken.has(tag); n++) tag = `${base}-${n}`;
      taken.add(tag);
      await db.update(habits).set({ tag }).where(and(eq(habits.habitId, h.habitId), eq(habits.userId, userId)));
      h.tag = tag;
    }
  }
  return list as HabitDef[];
}

async function dailyPages(userId: string) {
  return (await db
    .select({ noteId: notes.noteId, date: notes.date, content: notes.content, isEncrypted: notes.isEncrypted })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.noteTypeId, DAILY_TYPE_ID), eq(notes.archived, false)))) as Array<{
    noteId: string;
    date: string;
    content: string | null;
    isEncrypted: boolean | null;
  }>;
}

/**
 * Moves done days stored the old way (habit_logs rows) into the daily notes as
 * ticked lines, creating a day's note when needed. A row is deleted only once
 * its line is written; days whose note is locked keep their rows.
 */
async function migrateLegacyLogs(userId: string, defs: HabitDef[], todayIso: string) {
  const logs = (await db.select({ habitId: habitLogs.habitId, day: habitLogs.day }).from(habitLogs).where(eq(habitLogs.userId, userId))) as Array<{ habitId: string; day: string }>;
  if (!logs.length) return;
  const byId = new Map(defs.map((d) => [d.habitId, d]));
  const byDay = new Map<string, HabitDef[]>();
  for (const l of logs) {
    const h = byId.get(l.habitId);
    if (!h) continue;
    byDay.set(l.day, [...(byDay.get(l.day) || []), h]);
  }
  for (const [day, list] of byDay) {
    try {
      const daily = await ensureDailyNote(userId, day, todayIso);
      await rewriteObjectContent(
        userId,
        daily.note_id,
        (old) => list.reduce((md, h) => setHabitInMarkdown(md, h, true) ?? md, old),
        null
      );
      await db.delete(habitLogs).where(and(eq(habitLogs.userId, userId), eq(habitLogs.day, day), inArray(habitLogs.habitId, list.map((h) => h.habitId))));
    } catch {
      // Locked or archived note: the row stays and is still counted below
    }
  }
}

/** Habits with their done days in the month, streaks (as of `today`) and the month's mood/energy. */
export async function habitMonth(userId: string, month: string, today: string, includeArchived = false) {
  const all = await withTags(
    userId,
    await db.select().from(habits).where(eq(habits.userId, userId)).orderBy(asc(habits.position), asc(habits.createdAt))
  );
  await migrateLegacyLogs(userId, all, today);
  const list = includeArchived ? all : all.filter((h) => !h.archived);

  // Done days come from the daily notes' lines
  const doneByTag = new Map<string, Set<string>>(list.map((h) => [normTag(h.tag), new Set<string>()]));
  for (const p of await dailyPages(userId)) {
    if (p.isEncrypted || !p.content) continue;
    const day = (p.date || "").slice(0, 10);
    for (const l of listLines(p.content)) {
      const done = l.kind !== "task" || l.state === "done";
      if (!done) continue;
      for (const t of l.tags) doneByTag.get(t)?.add(day);
    }
  }
  // Rows that could not be moved (their note is locked) still count
  const left = list.length
    ? ((await db.select({ habitId: habitLogs.habitId, day: habitLogs.day }).from(habitLogs).where(and(eq(habitLogs.userId, userId), inArray(habitLogs.habitId, list.map((h) => h.habitId))))) as any[])
    : [];
  const tagOf = new Map(list.map((h) => [h.habitId, normTag(h.tag)]));
  for (const l of left) doneByTag.get(tagOf.get(l.habitId)!)?.add(l.day);

  const days = monthDays(month);
  const ratings = await db
    .select()
    .from(dayRatings)
    .where(and(eq(dayRatings.userId, userId), gte(dayRatings.day, days[0]), lte(dayRatings.day, days[days.length - 1])));
  return {
    month,
    days,
    habits: list.map((h) => {
      const doneDays = [...(doneByTag.get(normTag(h.tag)) || [])];
      const inMonth = doneDays.filter((d) => d.startsWith(month)).sort();
      return {
        habit_id: h.habitId,
        name: h.name,
        tag: h.tag,
        color: h.color,
        archived: h.archived,
        done_days: inMonth,
        month_count: inMonth.length,
        ...habitStreaks(doneDays, today),
      };
    }),
    ratings: (ratings as any[]).map((r) => ({ day: r.day, mood: r.mood, energy: r.energy })),
  };
}

/** A new habit; when today's daily note exists its line is added there at once. */
export async function createHabit(userId: string, input: { name: string; color?: string | null; tag?: string | null; today?: string }) {
  const name = input.name.trim();
  if (!name) throw new AccessError(400, "Alışkanlık adı gerekli");
  const existing = await withTags(userId, await db.select().from(habits).where(eq(habits.userId, userId)));
  if (existing.length >= 30) throw new AccessError(400, "En fazla 30 alışkanlık takip edilebilir");
  const tag = input.tag ? normTag(input.tag) : habitTagFromName(name);
  if (!tag || !TAG_OK.test(tag)) throw new AccessError(400, "Etiket yalnızca harf, rakam, - ve _ içerebilir");
  if (existing.some((h) => normTag(h.tag) === tag)) throw new AccessError(400, `#${tag} etiketiyle bir alışkanlık zaten var`);
  const habitId = genId("habit");
  await db.insert(habits).values({ habitId, userId, name, tag, color: input.color || COLORS[existing.length % COLORS.length], position: existing.length });
  if (input.today) {
    const daily = await findDailyNote(userId, input.today);
    if (daily && !daily.isEncrypted && !daily.archived) {
      await rewriteObjectContent(userId, daily.noteId, (old) => addHabitLines(old, [{ name, tag }]), null).catch(() => undefined);
    }
  }
  return { habit_id: habitId, name, tag };
}

/** Name, colour, order or archive. The tag stays: past notes carry it. */
export async function updateHabit(userId: string, habitId: string, input: { name?: string; color?: string | null; archived?: boolean; position?: number }) {
  await owned(userId, habitId);
  const values: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new AccessError(400, "Alışkanlık adı gerekli");
    values.name = input.name.trim();
  }
  if (input.color !== undefined) values.color = input.color;
  if (input.archived !== undefined) values.archived = input.archived;
  if (input.position !== undefined) values.position = input.position;
  if (Object.keys(values).length) await db.update(habits).set(values).where(and(eq(habits.habitId, habitId), eq(habits.userId, userId)));
  return { habit_id: habitId, ...values };
}

/** Removes the habit from the tracker. Its lines stay in the notes; they are notes. */
export async function deleteHabit(userId: string, habitId: string) {
  await owned(userId, habitId);
  await db.delete(habitLogs).where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.userId, userId)));
  await db.delete(habits).where(and(eq(habits.habitId, habitId), eq(habits.userId, userId)));
  return { deleted: true };
}

/**
 * Ticks or unticks the habit's line in that day's daily note (the note and the
 * line are created when missing). A day the user marked done with a free
 * line ("- 30 sayfa okudum #okuma") is not rewritten; it is edited in the note.
 */
export async function setHabitDay(userId: string, habitId: string, day: string, done: boolean, todayIso: string) {
  const h = await owned(userId, habitId);
  const found = await findDailyNote(userId, day);
  if (!found && !done) return { habit_id: habitId, day, done, note_id: null };
  if (found?.isEncrypted) throw new AccessError(400, "Bu günün notu parola kilitli; alışkanlığı notun içinden işaretle");
  const noteId = found ? found.noteId : (await ensureDailyNote(userId, day, todayIso)).note_id;
  await rewriteObjectContent(
    userId,
    noteId,
    (old) => {
      const next = setHabitInMarkdown(old, h, done);
      if (next === null) throw new AccessError(409, `Bu günün notunda #${h.tag} içeren bir satır var; işareti nottan kaldır`);
      return next;
    },
    null
  );
  // A done day kept the old way is cleared too, so unticking really unticks
  if (!done) await db.delete(habitLogs).where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.userId, userId), eq(habitLogs.day, day)));
  return { habit_id: habitId, day, done, note_id: noteId };
}

/** Mood/energy for a day; null clears a value. */
export async function setDayRating(userId: string, day: string, input: { mood?: number | null; energy?: number | null }) {
  const cur = (await db.select().from(dayRatings).where(and(eq(dayRatings.userId, userId), eq(dayRatings.day, day))).limit(1))[0] as any;
  const mood = input.mood !== undefined ? input.mood : cur?.mood ?? null;
  const energy = input.energy !== undefined ? input.energy : cur?.energy ?? null;
  if (cur) await db.update(dayRatings).set({ mood, energy, updatedAt: new Date() }).where(and(eq(dayRatings.userId, userId), eq(dayRatings.day, day)));
  else await db.insert(dayRatings).values({ userId, day, mood, energy });
  return { day, mood, energy };
}

export async function dayRatingsBetween(userId: string, from: string, to: string) {
  return (await db
    .select()
    .from(dayRatings)
    .where(and(eq(dayRatings.userId, userId), gte(dayRatings.day, from), lte(dayRatings.day, to)))) as Array<{ day: string; mood: number | null; energy: number | null }>;
}
