// Universal capture and the Inbox.
// raw input → context (link/file) → parse → type detection → metadata →
// relation suggestions → Inbox (ready) → user review → object + relations.
// The raw text is stored before any processing, so nothing is lost when AI
// is down, and "save without AI" is always possible.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, captures, files, noteTypes, notes, people as peopleTable, type CaptureSuggestion } from "../../src/db/index";
import { DAILY_TYPE_ID, PLAIN_TYPE_ID, SYSTEM_OBJECT_TYPES, SYSTEM_TYPE_BY_ID, isJournalPageType } from "../../src/lib/objectTypes";
import { extractWithFallback } from "../ai";
import type { TypeOption } from "../ai/types";
import { enqueue, registerQueue } from "../jobs/queue";
import { genId, todayIso } from "./notesCore";
import { createObject } from "./objects";
import { createRelation } from "./relations";
import { recordEvent } from "./analytics";
import { AccessError, resolveTargetSpace } from "./workspaces";
import { suggestRelated } from "./suggest";
import { buildCaptureContent } from "./captureContent";

export type CaptureStatus = "new" | "processing" | "ready" | "processed" | "failed";
export const OPEN_STATUSES: CaptureStatus[] = ["new", "processing", "ready", "failed"];
const QUEUE = "capture";
const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,:;"'!?]/i;

type LinkPreviewFn = (url: string) => Promise<{ title?: string; description?: string; site?: string; url?: string } | null>;
let linkPreview: LinkPreviewFn = async () => null;

/** Wire dependencies that live in server.ts (SSRF-safe link preview). */
export function configureCapture(deps: { linkPreview: LinkPreviewFn }) {
  linkPreview = deps.linkPreview;
}

type CaptureRow = typeof captures.$inferSelect;

export function serializeCapture(c: CaptureRow) {
  return {
    capture_id: c.captureId,
    status: c.status,
    resolution: c.resolution,
    source: c.source,
    raw_text: c.rawText,
    raw_url: c.rawUrl,
    file_id: c.fileId,
    space_id: c.spaceId,
    suggestion: c.suggestion || {},
    provider: c.provider,
    error: c.error,
    attempts: c.attempts,
    object_id: c.objectId,
    captured_on: c.capturedOn,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
    processed_at: c.processedAt ? c.processedAt.toISOString() : null,
  };
}

async function ownedCapture(userId: string, captureId: string) {
  const r = await db.select().from(captures).where(and(eq(captures.captureId, captureId), eq(captures.userId, userId))).limit(1);
  if (r.length === 0) throw new AccessError(404, "Yakalama bulunamadı");
  return r[0] as CaptureRow;
}

async function fileMeta(userId: string, fileId: string) {
  const r = await db
    .select({ name: files.originalFilename, contentType: files.contentType, size: files.size })
    .from(files)
    .where(and(eq(files.fileId, fileId), eq(files.userId, userId), eq(files.isDeleted, false)))
    .limit(1);
  return r[0] ? { name: r[0].name, content_type: r[0].contentType, size: Number(r[0].size) } : null;
}

export interface NewCaptureInput {
  text?: string;
  url?: string | null;
  file_id?: string | null;
  source?: string;
  space_id?: string | null;
  captured_on?: string | null;
}

export async function createCapture(userId: string, input: NewCaptureInput) {
  const text = (input.text || "").replace(/\r\n/g, "\n").trim();
  const url = (input.url || "").trim() || (text.match(URL_RE)?.[0] ?? null);
  if (!text && !url && !input.file_id) throw new AccessError(400, "Boş içerik yakalanamaz");
  if (input.file_id && !(await fileMeta(userId, input.file_id))) throw new AccessError(404, "Dosya bulunamadı");
  const target = await resolveTargetSpace(userId, input.space_id);
  const capturedOn = input.captured_on && /^\d{4}-\d{2}-\d{2}$/.test(input.captured_on) ? input.captured_on : todayIso();
  const captureId = genId("cap");
  await db.insert(captures).values({
    captureId,
    userId,
    workspaceId: target.workspaceId,
    spaceId: target.spaceId,
    status: "new",
    source: input.source || "quick",
    rawText: text,
    rawUrl: url,
    fileId: input.file_id || null,
    capturedOn,
  });
  await recordEvent(userId, "first_capture", { source: input.source || "quick" }, { once: true, workspaceId: target.workspaceId });
  return ownedCapture(userId, captureId);
}

export function startCaptureProcessing(captureId: string) {
  enqueue(QUEUE, captureId);
}

async function typeOptions(userId: string): Promise<TypeOption[]> {
  const userTypes = await db
    .select({ id: noteTypes.typeId, name: noteTypes.name, description: noteTypes.description })
    .from(noteTypes)
    .where(eq(noteTypes.userId, userId));
  return [
    ...SYSTEM_OBJECT_TYPES.filter((t) => !isJournalPageType(t.type_id)).map((t) => ({ type_id: t.type_id, key: t.key, name: t.name, description: t.description })),
    ...userTypes.map((t: any) => ({ type_id: t.id, key: t.id, name: t.name, description: t.description || undefined })),
  ];
}

export async function processCapture(captureId: string) {
  const rows = await db.select().from(captures).where(eq(captures.captureId, captureId)).limit(1);
  const cap = rows[0] as CaptureRow | undefined;
  if (!cap || (cap.status !== "new" && cap.status !== "processing")) return;
  const userId = cap.userId;
  await db
    .update(captures)
    .set({ status: "processing", attempts: cap.attempts + 1, error: null, updatedAt: new Date() })
    .where(eq(captures.captureId, captureId));
  try {
    const types = await typeOptions(userId);
    const known = await db.select({ name: peopleTable.name }).from(peopleTable).where(eq(peopleTable.userId, userId));
    let linkCtx: { url: string; title?: string; description?: string; site?: string } | null = null;
    if (cap.rawUrl) {
      try {
        const p = await Promise.race([
          linkPreview(cap.rawUrl),
          new Promise<null>((r) => setTimeout(() => r(null), 8000)),
        ]);
        if (p) linkCtx = { url: cap.rawUrl, title: p.title || undefined, description: p.description || undefined, site: p.site || undefined };
      } catch {
        linkCtx = null; // unreachable pages still capture fine
      }
    }
    const file = cap.fileId ? await fileMeta(userId, cap.fileId) : null;
    const text = cap.rawText || cap.rawUrl || "";
    const { extraction, provider, fellBack, error } = await extractWithFallback(text, {
      today: cap.capturedOn,
      types,
      knownPeople: known.map((k: any) => k.name),
      link: linkCtx,
      file,
    }, userId);
    const typeId = types.find((t) => t.key === extraction.type_key)?.type_id || PLAIN_TYPE_ID;

    const candidates = await db
      .select({ id: notes.noteId, title: notes.title, tags: notes.tags, people: notes.people })
      .from(notes)
      .where(and(eq(notes.userId, userId), eq(notes.archived, false), sql`coalesce(${notes.noteTypeId}, '') <> ${DAILY_TYPE_ID}`));
    const related = suggestRelated(text, extraction, candidates as any);

    const suggestion: CaptureSuggestion = {
      provider: provider.id,
      type_id: typeId,
      type_confidence: extraction.type_confidence,
      title: extraction.title || linkCtx?.title || "Adsız yakalama",
      summary: extraction.summary,
      tags: extraction.tags,
      people: extraction.people,
      organizations: extraction.organizations,
      locations: extraction.locations,
      dates: extraction.dates,
      tasks: extraction.tasks,
      url: cap.rawUrl,
      site: linkCtx?.site || (cap.rawUrl ? safeHost(cap.rawUrl) : null),
      author: extraction.author || null,
      related: related.map(({ object_id, title, reason }) => ({ object_id, title, reason })),
    };
    await db
      .update(captures)
      .set({
        status: "ready",
        suggestion,
        provider: provider.label,
        error: fellBack ? `Yapay zeka kullanılamadı, kural tabanlı çıkarım yapıldı (${(error || "").slice(0, 160)})` : null,
        updatedAt: new Date(),
      })
      .where(eq(captures.captureId, captureId));
  } catch (e) {
    console.error("[Capture] processing failed", captureId, e);
    await db
      .update(captures)
      .set({ status: "failed", error: "İşleme sırasında hata oluştu. Tekrar deneyebilir veya yapay zekasız kaydedebilirsin.", updatedAt: new Date() })
      .where(eq(captures.captureId, captureId));
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

registerQueue(QUEUE, processCapture, 2);

/** Boot recovery: re-enqueue anything left unfinished by a restart. */
export async function recoverCaptures() {
  const rows = await db
    .select({ id: captures.captureId })
    .from(captures)
    .where(inArray(captures.status, ["new", "processing"]));
  rows.forEach((r: any) => startCaptureProcessing(r.id));
  if (rows.length) console.log(`[Capture] re-queued ${rows.length} unfinished captures`);
}

export async function listInbox(userId: string, scope: "open" | "processed" | "all" = "open", limit = 100) {
  const where =
    scope === "all"
      ? eq(captures.userId, userId)
      : scope === "processed"
        ? and(eq(captures.userId, userId), eq(captures.status, "processed"))
        : and(eq(captures.userId, userId), inArray(captures.status, OPEN_STATUSES));
  const rows = await db.select().from(captures).where(where).orderBy(desc(captures.createdAt)).limit(limit);
  return rows.map(serializeCapture);
}

export async function inboxCounts(userId: string) {
  const rows = await db
    .select({ status: captures.status, n: sql<number>`count(*)` })
    .from(captures)
    .where(eq(captures.userId, userId))
    .groupBy(captures.status);
  const out: Record<string, number> = { new: 0, processing: 0, ready: 0, processed: 0, failed: 0 };
  for (const r of rows as any[]) out[r.status] = Number(r.n);
  return { ...out, open: out.new + out.processing + out.ready + out.failed, needs_review: out.ready + out.failed };
}

// ---------------------------------------------------------------------------
// Review actions
// ---------------------------------------------------------------------------
export interface AcceptOverrides {
  title?: string;
  type_id?: string;
  space_id?: string | null;
  tags?: string[];
  people?: string[];
  tasks?: string[];
  related_ids?: string[];
  summary?: string;
}

/** Fill the type's well-known properties from what was literally extracted. */
function propertiesFor(typeId: string, s: CaptureSuggestion, file: { name: string; content_type: string } | null, rawText: string) {
  const key = SYSTEM_TYPE_BY_ID[typeId]?.key;
  const p: Record<string, any> = {};
  if (key === "article" || key === "reference") {
    if (s.url) p.url = s.url;
    if (key === "article" && s.site) p.site = s.site;
    if (key === "article" && s.author) p.author = s.author;
  }
  if (key === "paper") {
    const doi = rawText.match(/\b10\.\d{4,9}\/[^\s"<>]+/i)?.[0];
    if (doi) p.doi = doi.replace(/[.,;]$/, "");
    if (s.url) p.pdf = /\.pdf($|\?)/i.test(s.url) ? s.url : p.pdf;
  }
  if (key === "quote" && s.author) p.author = s.author;
  if (key === "book") {
    const isbn = rawText.match(/ISBN(?:-1[03])?:?\s*([0-9Xx][0-9Xx -]{8,16})/)?.[1];
    if (isbn) p.isbn = isbn.trim();
    if (s.author) p.author = s.author;
  }
  if (key === "file" && file) {
    p.file_name = file.name;
    p.file_type = file.content_type;
  }
  if (key === "task") p.kanban_column = "todo";
  return p;
}

async function dailyNoteFor(userId: string, day: string) {
  const r = await db
    .select({ noteId: notes.noteId })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.noteTypeId, DAILY_TYPE_ID), sql`substr(${notes.date}, 1, 10) = ${day}`))
    .limit(1);
  return r[0]?.noteId || null;
}

async function linkToDailyNote(userId: string, day: string, objectId: string) {
  const daily = await dailyNoteFor(userId, day);
  if (daily && daily !== objectId) {
    await createRelation(userId, { source_id: daily, target_id: objectId, relation_type: "captured_on", origin: "capture" }).catch(() => undefined);
  }
}

export async function acceptCapture(userId: string, captureId: string, o: AcceptOverrides = {}) {
  const cap = await ownedCapture(userId, captureId);
  if (cap.status !== "ready") throw new AccessError(409, "Bu yakalama incelemeye hazır değil");
  const s = (cap.suggestion || {}) as CaptureSuggestion;
  const file = cap.fileId ? await fileMeta(userId, cap.fileId) : null;
  const typeId = o.type_id || s.type_id || PLAIN_TYPE_ID;
  const tasks = o.tasks ?? s.tasks ?? [];
  const content = buildCaptureContent(cap, file && cap.fileId ? { id: cap.fileId, ...file } : null, {
    tags: o.tags ?? s.tags,
    people: o.people ?? s.people,
    tasks,
  });
  const obj = await createObject(userId, {
    title: (o.title ?? s.title ?? "").trim() || "Adsız yakalama",
    content,
    note_type_id: typeId,
    custom_fields: propertiesFor(typeId, s, file, cap.rawText),
    date: cap.capturedOn,
    space_id: o.space_id ?? cap.spaceId,
    source: { kind: "capture", capture_id: cap.captureId, capture_source: cap.source, url: s.url || cap.rawUrl || null, site: s.site || null, author: s.author || null },
    ai_meta: {
      provider: s.provider,
      detected_type: s.type_id,
      type_confidence: s.type_confidence,
      dates: s.dates || [],
      organizations: s.organizations || [],
      locations: s.locations || [],
      user_edited: Object.keys(o).length > 0,
    },
    ai_summary: (o.summary ?? s.summary) || null,
    version_summary: "Gelen kutusundan oluşturuldu (v1)",
  });
  const relatedIds = o.related_ids ?? (s.related || []).map((r) => r.object_id);
  for (const rid of relatedIds) {
    const reason = (s.related || []).find((r) => r.object_id === rid)?.reason || null;
    await createRelation(userId, { source_id: obj.noteId, target_id: rid, relation_type: "related_to", origin: "capture", note: reason }).catch(() => undefined);
  }
  await linkToDailyNote(userId, cap.capturedOn, obj.noteId);
  await db
    .update(captures)
    .set({ status: "processed", resolution: "accepted", objectId: obj.noteId, processedAt: new Date(), updatedAt: new Date() })
    .where(eq(captures.captureId, captureId));
  return { capture: serializeCapture(await ownedCapture(userId, captureId)), object_id: obj.noteId, slug: obj.slug };
}

export async function saveCaptureRaw(userId: string, captureId: string, opts: { type_id?: string | null } = {}) {
  const cap = await ownedCapture(userId, captureId);
  if (cap.status === "processed") throw new AccessError(409, "Bu yakalama zaten işlendi");
  const file = cap.fileId ? await fileMeta(userId, cap.fileId) : null;
  const content = buildCaptureContent(cap, file && cap.fileId ? { id: cap.fileId, ...file } : null);
  const firstLine = (cap.rawText.split("\n").find((l) => l.trim()) || file?.name || cap.rawUrl || "Adsız yakalama").replace(/^#+\s*/, "").trim();
  const typeId = opts.type_id || PLAIN_TYPE_ID;
  const obj = await createObject(userId, {
    title: firstLine.slice(0, 120),
    content,
    note_type_id: typeId,
    custom_fields: SYSTEM_TYPE_BY_ID[typeId]?.key === "task" ? { kanban_column: "todo" } : {},
    date: cap.capturedOn,
    space_id: cap.spaceId,
    source: { kind: "capture", capture_id: cap.captureId, capture_source: cap.source, url: cap.rawUrl || null, raw: true },
    version_summary: "Gelen kutusundan yapay zekasız kaydedildi (v1)",
  });
  await linkToDailyNote(userId, cap.capturedOn, obj.noteId);
  await db
    .update(captures)
    .set({ status: "processed", resolution: "saved_raw", objectId: obj.noteId, processedAt: new Date(), updatedAt: new Date() })
    .where(eq(captures.captureId, captureId));
  return { capture: serializeCapture(await ownedCapture(userId, captureId)), object_id: obj.noteId, slug: obj.slug };
}

export async function rejectCapture(userId: string, captureId: string) {
  const cap = await ownedCapture(userId, captureId);
  if (cap.status === "processed") throw new AccessError(409, "Bu yakalama zaten işlendi");
  // The raw text is kept (processed/rejected), never deleted.
  await db
    .update(captures)
    .set({ status: "processed", resolution: "rejected", processedAt: new Date(), updatedAt: new Date() })
    .where(eq(captures.captureId, captureId));
  return serializeCapture(await ownedCapture(userId, captureId));
}

export async function retryCapture(userId: string, captureId: string) {
  const cap = await ownedCapture(userId, captureId);
  if (cap.status !== "failed" && cap.status !== "ready") throw new AccessError(409, "Yalnızca hatalı veya hazır yakalamalar yeniden işlenebilir");
  await db.update(captures).set({ status: "new", updatedAt: new Date() }).where(eq(captures.captureId, captureId));
  startCaptureProcessing(captureId);
  return serializeCapture(await ownedCapture(userId, captureId));
}

export async function capturesForDay(userId: string, day: string) {
  const rows = await db
    .select()
    .from(captures)
    .where(and(eq(captures.userId, userId), eq(captures.capturedOn, day)))
    .orderBy(desc(captures.createdAt));
  return rows.map(serializeCapture);
}
