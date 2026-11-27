// Journal (bullet journal, Phase 2.5b/c): monthly log, future log, migration,
// collections and the index. Note content stays the source of truth: every
// read here parses markdown bullets, every write goes through
// rewriteObjectContent / createObject like any other edit.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, notes, objectRelations } from "../../src/db/index";
import { COLLECTION_TYPE_ID, DAILY_TYPE_ID, MONTHLY_TYPE_ID } from "../../src/lib/objectTypes";
import {
  closeTaskInMarkdown, countTasks, ensureSection, formatLogEntry, insertLogLine, listBullets, parseLogEntry, removeLastLine, type BulletKind,
} from "../../src/lib/tasks";
import { addMonths, collectionContent, dailyTitle, monthDays, monthLabel, monthOf, monthlyContent, monthlyTitle } from "../../src/lib/journal";
import { createObject, rewriteObjectContent } from "./objects";
import { ensureDailyNote } from "./today";
import { AccessError } from "./workspaces";
import { activeProvider } from "../ai";
import { checkCitations } from "./retrievalRank";
import { friendlyAiError } from "./aiSettings";
import { habitMonth } from "./habits";
import { REVIEW_SYSTEM, buildReviewPrompt, reviewFacts, reviewSources, type ReviewPage } from "./reviewFacts";

type NoteRow = typeof notes.$inferSelect;

const pageCols = {
  noteId: notes.noteId,
  slug: notes.slug,
  title: notes.title,
  content: notes.content,
  date: notes.date,
  noteTypeId: notes.noteTypeId,
  isEncrypted: notes.isEncrypted,
};
type Page = { noteId: string; slug: string | null; title: string; content: string; date: string; noteTypeId: string | null; isEncrypted: boolean | null };

const readable = (p: Page) => (p.isEncrypted ? "" : p.content || "");

// ------------------------------------------------------------------ monthly

export async function findMonthlyNote(userId: string, ym: string) {
  const r = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.noteTypeId, MONTHLY_TYPE_ID), sql`substr(${notes.date}, 1, 7) = ${ym}`))
    .limit(1);
  return (r[0] as NoteRow | undefined) || null;
}

export async function ensureMonthlyNote(userId: string, ym: string) {
  const existing = await findMonthlyNote(userId, ym);
  if (existing) return { note_id: existing.noteId, slug: existing.slug, title: existing.title, created: false };
  const obj = await createObject(userId, {
    title: monthlyTitle(ym),
    content: monthlyContent(),
    note_type_id: MONTHLY_TYPE_ID,
    date: `${ym}-01T00:00:00`,
    period: "month",
    source: { kind: "journal", page: "monthly" },
    version_summary: "Aylık kayıt oluşturuldu (v1)",
  });
  return { note_id: obj.noteId, slug: obj.slug, title: monthlyTitle(ym), created: true };
}

/** Pages (daily or monthly notes) of the user, optionally limited by a date prefix range. */
async function pages(userId: string, typeId: string, where?: ReturnType<typeof sql>) {
  const rows = await db
    .select(pageCols)
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.noteTypeId, typeId), eq(notes.archived, false), ...(where ? [where] : [])));
  return rows as Page[];
}

/**
 * The month spread: the monthly log itself, and a calendar list built from
 * that month's daily notes (their events and task counts).
 */
export async function monthView(userId: string, ym: string) {
  const monthly = await findMonthlyNote(userId, ym);
  const dailies = await pages(userId, DAILY_TYPE_ID, sql`substr(${notes.date}, 1, 7) = ${ym}`);
  const byDay = new Map(dailies.map((d) => [d.date.slice(0, 10), d]));
  const days = monthDays(ym).map((day) => {
    const d = byDay.get(day);
    if (!d) return { date: day, note_id: null, slug: null, events: [] as string[], open: 0, done: 0, entries: 0, locked: false };
    const content = readable(d);
    const bullets = listBullets(content).filter((b) => !b.habit);
    const tasks = countTasks(content);
    return {
      date: day,
      note_id: d.noteId,
      slug: d.slug,
      events: bullets.filter((b) => b.kind === "event").map((b) => b.text),
      open: tasks.total - tasks.done,
      done: tasks.done,
      entries: bullets.length,
      locked: Boolean(d.isEncrypted),
    };
  });
  return {
    month: ym,
    monthly: monthly
      ? { note_id: monthly.noteId, slug: monthly.slug, title: monthly.title, content: monthly.isEncrypted ? "" : monthly.content, locked: Boolean(monthly.isEncrypted) }
      : null,
    days,
  };
}

/** The future log: task and event bullets of the next `count` monthly logs. */
export async function futureLog(userId: string, from: string, count = 12) {
  const months = Array.from({ length: Math.min(Math.max(count, 1), 24) }, (_, i) => addMonths(from, i));
  const rows = await pages(userId, MONTHLY_TYPE_ID, sql`substr(${notes.date}, 1, 7) between ${months[0]} and ${months[months.length - 1]}`);
  const byMonth = new Map(rows.map((r) => [r.date.slice(0, 7), r]));
  return {
    from,
    months: months.map((ym) => {
      const r = byMonth.get(ym);
      const items = r ? listBullets(readable(r)).filter((b) => b.kind !== "note") : [];
      return {
        month: ym,
        note_id: r?.noteId || null,
        slug: r?.slug || null,
        items: items.map((b) => ({ kind: b.kind, state: b.state || null, signifier: b.signifier || null, text: b.text, task_index: b.taskIndex ?? null })),
      };
    }),
  };
}

// ---------------------------------------------------------------- migration

/**
 * Open tasks left behind: in daily notes before `date` (last 92 days) and in
 * monthly logs before the month of `date`. Nothing is inferred; these are the
 * "- [ ]" lines still unticked.
 */
export async function migrationCandidates(userId: string, date: string) {
  const since = new Date(`${date}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 92);
  const sinceDay = since.toISOString().slice(0, 10);
  const ym = monthOf(date);
  const dailies = await pages(userId, DAILY_TYPE_ID, sql`substr(${notes.date}, 1, 10) >= ${sinceDay} and substr(${notes.date}, 1, 10) < ${date}`);
  const monthlies = await pages(userId, MONTHLY_TYPE_ID, sql`substr(${notes.date}, 1, 7) < ${ym}`);
  const out: Array<{ note_id: string; note_title: string; page: "daily" | "monthly"; date: string; task_index: number; text: string; signifier: string | null }> = [];
  for (const [page, list] of [["daily", dailies], ["monthly", monthlies]] as const) {
    for (const p of list) {
      for (const b of listBullets(readable(p))) {
        if (b.kind !== "task" || b.state !== "open" || b.habit) continue;
        out.push({
          note_id: p.noteId,
          note_title: p.title,
          page,
          date: page === "daily" ? p.date.slice(0, 10) : p.date.slice(0, 7),
          task_index: b.taskIndex!,
          text: b.text,
          signifier: b.signifier || null,
        });
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.task_index - b.task_index).slice(0, 200);
}

export interface MigrateInput {
  note_id: string;
  task_index: number;
  action: "today" | "month" | "cancel";
  /** "YYYY-MM-DD": the day "today" means (the client's local day). */
  date: string;
  /** "YYYY-MM" for action "month". */
  month?: string;
}

/**
 * Moves an open task. "today" copies it into that day's log and marks the
 * original "[>]"; "month" copies it into the month's log and marks it "[<]";
 * "cancel" marks it "[-]". The original line records where it went with a
 * [[wikilink]]; nothing is deleted. The copy is written first, so a failed
 * source update can be undone instead of leaving the task in two places.
 */
export async function migrateTask(userId: string, input: MigrateInput) {
  if (input.action === "cancel") {
    let changed = false;
    await rewriteObjectContent(
      userId,
      input.note_id,
      (old) => {
        const r = closeTaskInMarkdown(old, input.task_index, "cancelled");
        if (!r) throw new AccessError(409, "Bu görev artık açık değil, sayfayı yenile");
        changed = true;
        return r.content;
      },
      null
    );
    return { action: "cancel", changed };
  }

  if (input.action === "month" && !input.month) throw new AccessError(400, "Ay seçilmedi");
  // Read the entry first so it can be copied
  const src = (await db.select().from(notes).where(and(eq(notes.userId, userId), eq(notes.noteId, input.note_id))).limit(1))[0];
  if (!src) throw new AccessError(404, "Not bulunamadı");
  if (src.isEncrypted) throw new AccessError(400, "Parola kilitli notlardaki görevler taşınamaz");
  const preview = closeTaskInMarkdown(src.content || "", input.task_index, "migrated");
  if (!preview) throw new AccessError(409, "Bu görev artık açık değil, sayfayı yenile");

  let target: { note_id: string; title: string };
  let sections: string[];
  if (input.action === "today") {
    const d = await ensureDailyNote(userId, input.date, input.date);
    // A customised daily template may title the note differently; link to the real title
    const t = (await db.select({ title: notes.title }).from(notes).where(eq(notes.noteId, d.note_id)).limit(1))[0];
    target = { note_id: d.note_id, title: t?.title || dailyTitle(input.date) };
    sections = ["Kayıt", "Plan"];
  } else {
    if (!input.month) throw new AccessError(400, "Ay seçilmedi");
    const m = await ensureMonthlyNote(userId, input.month);
    target = { note_id: m.note_id, title: m.title };
    sections = ["Görevler"];
  }
  if (target.note_id === src.noteId) throw new AccessError(400, "Görev zaten bu sayfada");

  const line = `- [ ] ${preview.entry}`;
  await rewriteObjectContent(userId, target.note_id, (old) => insertLogLine(old, line, sections), null);
  try {
    await rewriteObjectContent(
      userId,
      src.noteId,
      (old) => {
        const r = closeTaskInMarkdown(old, input.task_index, input.action === "today" ? "migrated" : "scheduled", target.title);
        if (!r || r.entry !== preview.entry) throw new AccessError(409, "Not başka bir yerde değişti, lütfen yenileyin");
        return r.content;
      },
      null
    );
  } catch (e) {
    await rewriteObjectContent(userId, target.note_id, (old) => removeLastLine(old, line), null).catch(() => undefined);
    throw e;
  }
  return { action: input.action, target_id: target.note_id, target_title: target.title, line };
}

/** Adds one journal entry to any page the user owns (monthly log, collection). */
export async function logToPage(userId: string, noteId: string, input: { text: string; kind?: BulletKind; section?: string }) {
  const entry = parseLogEntry(input.text, input.kind || "task");
  if (!entry.text) throw new AccessError(400, "Boş kayıt eklenemez");
  const line = formatLogEntry(entry);
  const sections = input.section ? [input.section] : ["Görevler", "Liste", "Kayıt"];
  // A named section that the page does not have yet (e.g. an older month page) is added first
  const r = await rewriteObjectContent(userId, noteId, (old) => insertLogLine(input.section ? ensureSection(old, input.section) : old, line, sections), null);
  return { note_id: r.note_id, line, content: r.content };
}

// -------------------------------------------------------------- collections

export async function listCollections(userId: string) {
  const rows = (await db
    .select({ ...pageCols, updatedAt: notes.updatedAt })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.noteTypeId, COLLECTION_TYPE_ID), eq(notes.archived, false)))) as Array<Page & { updatedAt: Date }>;
  const ids = rows.map((r) => r.noteId);
  const rel = ids.length
    ? await db
        .select({ target: objectRelations.targetId, n: sql<number>`count(*)::int` })
        .from(objectRelations)
        .where(and(eq(objectRelations.userId, userId), inArray(objectRelations.targetId, ids), eq(objectRelations.relationType, "part_of"), eq(objectRelations.status, "active")))
        .groupBy(objectRelations.targetId)
    : [];
  const relCount = new Map(rel.map((r: any) => [r.target, Number(r.n)]));
  return rows
    .map((r) => {
      const content = readable(r);
      const tasks = countTasks(content);
      return {
        note_id: r.noteId,
        slug: r.slug,
        title: r.title,
        items: listBullets(content).length,
        open: tasks.total - tasks.done,
        done: tasks.done,
        linked: relCount.get(r.noteId) || 0,
        locked: Boolean(r.isEncrypted),
        updated_at: r.updatedAt.toISOString(),
      };
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function createCollection(userId: string, input: { title: string; description?: string }) {
  const title = input.title.trim();
  if (!title) throw new AccessError(400, "Koleksiyon adı gerekli");
  const obj = await createObject(userId, {
    title,
    content: collectionContent(input.description),
    note_type_id: COLLECTION_TYPE_ID,
    source: { kind: "journal", page: "collection" },
    version_summary: "Koleksiyon oluşturuldu (v1)",
  });
  return { note_id: obj.noteId, slug: obj.slug, title };
}

/** A collection and the notes linked to it with "part_of". */
export async function collectionDetail(userId: string, id: string) {
  const r = (await db
    .select({ ...pageCols, archived: notes.archived })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.noteId, id), eq(notes.noteTypeId, COLLECTION_TYPE_ID)))
    .limit(1))[0] as (Page & { archived: boolean | null }) | undefined;
  if (!r) throw new AccessError(404, "Koleksiyon bulunamadı");
  const linked = await db
    .select({ noteId: notes.noteId, slug: notes.slug, title: notes.title, noteTypeId: notes.noteTypeId })
    .from(objectRelations)
    .innerJoin(notes, eq(notes.noteId, objectRelations.sourceId))
    .where(and(eq(objectRelations.userId, userId), eq(objectRelations.targetId, id), eq(objectRelations.relationType, "part_of"), eq(objectRelations.status, "active"), eq(notes.archived, false)));
  return {
    note_id: r.noteId,
    slug: r.slug,
    title: r.title,
    content: readable(r),
    locked: Boolean(r.isEncrypted),
    archived: Boolean(r.archived),
    linked: linked.map((l: any) => ({ note_id: l.noteId, slug: l.slug, title: l.title || "Adsız", note_type_id: l.noteTypeId || "type_plain" })),
  };
}

// -------------------------------------------------------------------- index

/**
 * The journal index, built from what exists: months that have a monthly log
 * or daily notes, collections, and the most used tags.
 */
export async function journalIndex(userId: string) {
  const dailies = await db
    .select({ date: notes.date, content: notes.content, isEncrypted: notes.isEncrypted })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.noteTypeId, DAILY_TYPE_ID), eq(notes.archived, false)));
  const monthlies = await pages(userId, MONTHLY_TYPE_ID);
  const months = new Map<string, { month: string; monthly_id: string | null; monthly_slug: string | null; days: number; open: number; entries: number }>();
  const get = (ym: string) => {
    let m = months.get(ym);
    if (!m) months.set(ym, (m = { month: ym, monthly_id: null, monthly_slug: null, days: 0, open: 0, entries: 0 }));
    return m;
  };
  for (const d of dailies as any[]) {
    const m = get(d.date.slice(0, 7));
    const content = d.isEncrypted ? "" : d.content || "";
    const bullets = listBullets(content).filter((b) => !b.habit);
    if (bullets.length === 0 && !d.isEncrypted) continue; // an empty auto-created day is not an entry
    m.days++;
    m.entries += bullets.length;
    m.open += bullets.filter((b) => b.kind === "task" && b.state === "open").length;
  }
  for (const p of monthlies) {
    const m = get(p.date.slice(0, 7));
    m.monthly_id = p.noteId;
    m.monthly_slug = p.slug;
    m.open += listBullets(readable(p)).filter((b) => b.kind === "task" && b.state === "open" && !b.habit).length;
  }
  const tagRows = await db
    .select({ tags: notes.tags })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.archived, false)));
  const tagCount = new Map<string, number>();
  for (const r of tagRows as any[]) for (const t of r.tags || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  return {
    months: [...months.values()].filter((m) => m.days > 0 || m.monthly_id).sort((a, b) => b.month.localeCompare(a.month)),
    collections: await listCollections(userId),
    tags: [...tagCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40).map(([tag, count]) => ({ tag, count })),
  };
}

// ------------------------------------------------------------ monthly review

/**
 * AI monthly review (Phase 2.5e). The counts are computed from the month's
 * daily notes, monthly log, habits and mood; the model only writes the
 * narrative from numbered sources, and its [n] citations are validated.
 * Without a model the counts are returned on their own. Locked notes are
 * never read or sent.
 */
export async function monthlyReview(userId: string, month: string, today: string) {
  const dailies = await pages(userId, DAILY_TYPE_ID, sql`substr(${notes.date}, 1, 7) = ${month}`);
  const monthly = (await pages(userId, MONTHLY_TYPE_ID, sql`substr(${notes.date}, 1, 7) = ${month}`))[0];
  const all = [...dailies, ...(monthly ? [monthly] : [])].filter((p) => !p.isEncrypted);
  const reviewPages: ReviewPage[] = all.map((p) => ({
    note_id: p.noteId,
    title: p.title,
    date: p.noteTypeId === MONTHLY_TYPE_ID ? p.date.slice(0, 7) : p.date.slice(0, 10),
    content: p.content || "",
  }));
  const hm = await habitMonth(userId, month, today);
  const elapsed = month < today.slice(0, 7) ? hm.days.length : month === today.slice(0, 7) ? Number(today.slice(8, 10)) : 0;
  const habitStats = hm.habits.map((h) => ({ name: h.name, done: h.month_count, days: elapsed }));
  const facts = reviewFacts(reviewPages, habitStats, hm.ratings);
  const sources = reviewSources(reviewPages);
  const base = {
    month,
    facts,
    sources: sources.map((s) => ({ n: s.n, note_id: s.note_id, title: s.title, date: s.date })),
    monthly_id: monthly?.noteId || null,
  };
  if (sources.length === 0) {
    return { ...base, mode: "empty" as const, review: null, citations: [], provider: null, warning: "Bu ay için değerlendirilecek kayıt yok." };
  }
  const { provider } = await activeProvider(userId);
  if (!provider.isModel) {
    return {
      ...base,
      mode: "facts_only" as const,
      review: null,
      citations: [],
      provider: null,
      warning: "Yapay zeka etkin değil; yalnızca sayılar gösteriliyor. Ayarlar > Yapay Zeka'dan etkinleştirebilirsin.",
    };
  }
  let raw: string;
  try {
    raw = await provider.generate({ task: "review", system: REVIEW_SYSTEM, prompt: buildReviewPrompt(monthLabel(month), facts, sources), maxTokens: 1200 });
  } catch (e) {
    return { ...base, mode: "facts_only" as const, review: null, citations: [], provider: provider.label, warning: `Yapay zeka yanıt veremedi: ${friendlyAiError(e)}` };
  }
  const check = checkCitations(raw, sources.length);
  const citations = check.used.map((n) => ({ n, note_id: sources[n - 1].note_id, title: sources[n - 1].title, date: sources[n - 1].date }));
  let warning: string | null = null;
  if (check.removed.length) warning = "Değerlendirmede kayıtlarına dayanmayan kaynak numaraları vardı; bunlar kaldırıldı.";
  else if (citations.length === 0) warning = "Bu değerlendirme hiçbir kayda dayandırılmadı; dikkatle değerlendir.";
  return { ...base, mode: "review" as const, review: check.answer, citations, provider: provider.label, warning };
}
