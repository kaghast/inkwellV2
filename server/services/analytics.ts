// First-party, privacy-respecting product analytics. Events never carry
// content (titles, text, urls); only ids of the user's own rows and counts.
import { and, eq, sql, gte } from "drizzle-orm";
import { db, analyticsEvents, notes, objectRelations, captures } from "../../src/db/index";
import { genId } from "./notesCore";
import { DAILY_TYPE_ID } from "../../src/lib/objectTypes";

export type ProductEvent =
  | "registered"
  | "workspace_created"
  | "first_object"
  | "first_capture"
  | "first_relation"
  | "first_ai_query"
  | "first_backlink"
  | "active_day"
  | "returned"
  | "shared";

const onceSeen = new Set<string>();

export async function recordEvent(
  userId: string,
  event: ProductEvent,
  props: Record<string, string | number | boolean> = {},
  opts: { once?: boolean; workspaceId?: string } = {}
) {
  try {
    const key = `${userId}:${event}`;
    if (opts.once) {
      if (onceSeen.has(key)) return;
      const existing = await db
        .select({ id: analyticsEvents.eventId })
        .from(analyticsEvents)
        .where(and(eq(analyticsEvents.userId, userId), eq(analyticsEvents.event, event)))
        .limit(1);
      onceSeen.add(key);
      if (existing.length > 0) return;
    }
    await db.insert(analyticsEvents).values({
      eventId: genId("evt"),
      userId,
      workspaceId: opts.workspaceId || null,
      event,
      props,
    });
  } catch (e) {
    // Analytics must never break a user action.
    console.warn("[Analytics] could not record event", event, (e as Error).message);
  }
}

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** Called on authenticated app loads: one active_day per day; `returned` once, on the first later day. */
export async function recordActiveDay(userId: string) {
  const today = dayKey();
  const key = `${userId}:active:${today}`;
  if (onceSeen.has(key)) return;
  onceSeen.add(key);
  try {
    const start = new Date(`${today}T00:00:00.000Z`);
    const todays = await db
      .select({ id: analyticsEvents.eventId })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.userId, userId), eq(analyticsEvents.event, "active_day"), gte(analyticsEvents.createdAt, start)))
      .limit(1);
    if (todays.length > 0) return;
    const earlier = await db
      .select({ id: analyticsEvents.eventId })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.userId, userId), eq(analyticsEvents.event, "active_day")))
      .limit(1);
    await recordEvent(userId, "active_day", { day: today });
    if (earlier.length > 0) await recordEvent(userId, "returned", {}, { once: true });
  } catch (e) {
    console.warn("[Analytics] active day failed", (e as Error).message);
  }
}

/** The user's own activation progress, computed from real data. */
export async function activationSummary(userId: string) {
  const [objs] = await db
    .select({ n: sql<number>`count(*)` })
    .from(notes)
    .where(and(eq(notes.userId, userId), sql`coalesce(${notes.noteTypeId}, '') <> ${DAILY_TYPE_ID}`));
  const rel = await db
    .select({ origin: objectRelations.origin, n: sql<number>`count(*)` })
    .from(objectRelations)
    .where(and(eq(objectRelations.userId, userId), eq(objectRelations.status, "active")))
    .groupBy(objectRelations.origin);
  const [caps] = await db.select({ n: sql<number>`count(*)` }).from(captures).where(eq(captures.userId, userId));
  const days = await db
    .select({ n: sql<number>`count(*)` })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.userId, userId), eq(analyticsEvents.event, "active_day")));
  const relations = rel.reduce((s: number, r: any) => s + Number(r.n), 0);
  const backlinks = Number(rel.find((r: any) => r.origin === "wikilink")?.n || 0);
  return {
    objects: Number(objs?.n || 0),
    relations,
    backlinks,
    captures: Number(caps?.n || 0),
    active_days: Number(days[0]?.n || 0),
    goals: { objects: 5, relations: 2, backlinks: 1, captures: 1, active_days: 2 },
  };
}
