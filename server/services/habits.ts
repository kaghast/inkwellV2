// Habit tracker and daily mood/energy (Phase 2.5d). A habit is a row; a done
// day is a row in habit_logs. Unticking deletes that day's log row only.
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, habits, habitLogs, dayRatings } from "../../src/db/index";
import { habitStreaks, monthDays } from "../../src/lib/journal";
import { genId } from "./notesCore";
import { AccessError } from "./workspaces";

const COLORS = ["#0d9488", "#d97706", "#7c3aed", "#db2777", "#2563eb", "#16a34a", "#dc2626", "#0891b2"];

async function owned(userId: string, habitId: string) {
  const r = (await db.select().from(habits).where(and(eq(habits.habitId, habitId), eq(habits.userId, userId))).limit(1))[0];
  if (!r) throw new AccessError(404, "Alışkanlık bulunamadı");
  return r;
}

/** Habits with their done days in the month, streaks (as of `today`) and the month's mood/energy. */
export async function habitMonth(userId: string, month: string, today: string, includeArchived = false) {
  const list = await db
    .select()
    .from(habits)
    .where(includeArchived ? eq(habits.userId, userId) : and(eq(habits.userId, userId), eq(habits.archived, false)))
    .orderBy(asc(habits.position), asc(habits.createdAt));
  const ids = list.map((h: any) => h.habitId);
  // All logs are needed for streaks that cross month boundaries; personal scale keeps this small.
  const logs = ids.length
    ? await db.select({ habitId: habitLogs.habitId, day: habitLogs.day }).from(habitLogs).where(and(eq(habitLogs.userId, userId), inArray(habitLogs.habitId, ids)))
    : [];
  const byHabit = new Map<string, string[]>();
  for (const l of logs as any[]) {
    const a = byHabit.get(l.habitId) || [];
    a.push(l.day);
    byHabit.set(l.habitId, a);
  }
  const days = monthDays(month);
  const ratings = await db
    .select()
    .from(dayRatings)
    .where(and(eq(dayRatings.userId, userId), gte(dayRatings.day, days[0]), lte(dayRatings.day, days[days.length - 1])));
  return {
    month,
    days,
    habits: list.map((h: any) => {
      const all = byHabit.get(h.habitId) || [];
      const inMonth = all.filter((d) => d.startsWith(month)).sort();
      return {
        habit_id: h.habitId,
        name: h.name,
        color: h.color,
        archived: h.archived,
        done_days: inMonth,
        month_count: inMonth.length,
        ...habitStreaks(all, today),
      };
    }),
    ratings: (ratings as any[]).map((r) => ({ day: r.day, mood: r.mood, energy: r.energy })),
  };
}

export async function createHabit(userId: string, input: { name: string; color?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new AccessError(400, "Alışkanlık adı gerekli");
  const count = (await db.select({ id: habits.habitId }).from(habits).where(eq(habits.userId, userId))).length;
  if (count >= 30) throw new AccessError(400, "En fazla 30 alışkanlık takip edilebilir");
  const habitId = genId("habit");
  await db.insert(habits).values({ habitId, userId, name, color: input.color || COLORS[count % COLORS.length], position: count });
  return { habit_id: habitId, name };
}

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

/** Deletes the habit and its history (the UI asks first; archiving keeps both). */
export async function deleteHabit(userId: string, habitId: string) {
  await owned(userId, habitId);
  await db.delete(habitLogs).where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.userId, userId)));
  await db.delete(habits).where(and(eq(habits.habitId, habitId), eq(habits.userId, userId)));
  return { deleted: true };
}

export async function setHabitDay(userId: string, habitId: string, day: string, done: boolean) {
  await owned(userId, habitId);
  if (done) {
    const exists = await db.select({ d: habitLogs.day }).from(habitLogs).where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.day, day))).limit(1);
    if (!exists.length) await db.insert(habitLogs).values({ habitId, userId, day });
  } else {
    await db.delete(habitLogs).where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.userId, userId), eq(habitLogs.day, day)));
  }
  return { habit_id: habitId, day, done };
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
