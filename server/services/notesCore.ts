// Core note/object helpers shared by the legacy routes in server.ts and the
// new service modules (capture, templates, today). Moved verbatim from
// server.ts; behaviour is unchanged.
import crypto from "crypto";
import { eq, and, desc } from "drizzle-orm";
import type { DriveFileRef } from "../../src/db/schema";
import { db, tags, people, reminders, noteVersions } from "../../src/db/index";
import { periodStart, type NotePeriod } from "../../src/lib/period";

export function genId(prefix: string): string {
  // Cryptographically random IDs: some IDs (e.g. file IDs) act as unguessable URLs.
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}${Date.now().toString(36).substring(4)}`;
}

// ---------------------------------------------------------------------------
// Helpers & Regex
// ---------------------------------------------------------------------------
export const TAG_RE = /(?<!\S)#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)(?!\S)/gu;
export const MENTION_RE = /(?<!\S)@([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)(?!\S)/gu;
export const REMINDER_RE = /```reminder\s*\n([^\n]+)\n([\s\S]*?)\n?```/gi;

export function extractTags(content: string): string[] {
  // Strip fenced code blocks before extracting tags
  const cleanContent = (content || "").replace(/```[\s\S]*?```/g, "");
  const extracted: string[] = [];
  const re = new RegExp(TAG_RE.source, "gu");
  let m;
  while ((m = re.exec(cleanContent)) !== null) {
    const t = m[1].toLowerCase();
    if (!extracted.includes(t)) extracted.push(t);
  }
  return extracted;
}

export function extractPeople(content: string): string[] {
  // Strip fenced code blocks before extracting people
  const cleanContent = (content || "").replace(/```[\s\S]*?```/g, "");
  const extracted: string[] = [];
  const re = new RegExp(MENTION_RE.source, "gu");
  let m;
  while ((m = re.exec(cleanContent)) !== null) {
    const p = m[1].toLowerCase();
    if (!extracted.includes(p)) extracted.push(p);
  }
  return extracted;
}

export function extractReminders(content: string): Array<{ at: string; text: string }> {
  const out: Array<{ at: string; text: string }> = [];
  const re = new RegExp(REMINDER_RE.source, "gi");
  let m;
  while ((m = re.exec(content || "")) !== null) {
    const iso = m[1].trim();
    const text = (m[2] || "").trim();
    const dt = new Date(iso);
    if (!isNaN(dt.getTime())) {
      out.push({ at: dt.toISOString(), text: text || "Hatırlatma" });
    }
  }
  return out;
}

export async function ensureTags(userId: string, tagNames: string[]) {
  for (const raw of tagNames) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    try {
      const existing = await db.select().from(tags).where(and(eq(tags.userId, userId), eq(tags.name, name))).limit(1);
      if (existing.length === 0) {
        await db.insert(tags).values({
          tagId: genId("tag"),
          userId,
          name,
        });
      }
    } catch (e) {
      console.warn("Failed ensuring tag in db:", e);
    }
  }
}

export async function ensurePeople(userId: string, names: string[]) {
  for (const raw of names) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    try {
      const existing = await db.select().from(people).where(and(eq(people.userId, userId), eq(people.name, name))).limit(1);
      if (existing.length === 0) {
        await db.insert(people).values({
          personId: genId("person"),
          userId,
          name,
        });
      }
    } catch (e) {
      console.warn("Failed ensuring person in db:", e);
    }
  }
}

export async function syncReminders(userId: string, noteId: string, content: string) {
  try {
    await db.delete(reminders).where(and(eq(reminders.userId, userId), eq(reminders.noteId, noteId)));
    const items = extractReminders(content);
    for (const item of items) {
      await db.insert(reminders).values({
        reminderId: genId("rem"),
        userId,
        noteId,
        at: new Date(item.at),
        text: item.text,
        fired: false,
      });
    }
  } catch (err) {
    console.warn("Error syncing reminders in db:", err);
  }
}

export async function saveNoteVersion(
  userId: string,
  noteId: string,
  noteData: {
    title?: string;
    content?: string;
    date?: string;
    tags?: string[];
    people?: string[];
    custom_fields?: Record<string, any>;
    customFields?: Record<string, any>;
    is_encrypted?: boolean;
    isEncrypted?: boolean;
    password_hash?: string | null;
    passwordHash?: string | null;
  },
  changeSummary = "Değişiklik yapıldı"
) {
  try {
    const existingVersions = await db
      .select({ versionNumber: noteVersions.versionNumber })
      .from(noteVersions)
      .where(and(eq(noteVersions.noteId, noteId), eq(noteVersions.userId, userId)))
      .orderBy(desc(noteVersions.versionNumber))
      .limit(1);

    const nextVer = (existingVersions[0]?.versionNumber || 0) + 1;
    const versionId = genId("ver");

    await db.insert(noteVersions).values({
      versionId,
      noteId,
      userId,
      versionNumber: nextVer,
      title: noteData.title || "",
      content: noteData.content || "",
      date: noteData.date || new Date().toISOString(),
      tags: noteData.tags || [],
      people: noteData.people || [],
      customFields: noteData.customFields || noteData.custom_fields || {},
      changeSummary,
      isEncrypted: Boolean(noteData.isEncrypted || noteData.is_encrypted),
      passwordHash: noteData.passwordHash !== undefined ? noteData.passwordHash : (noteData.password_hash || null),
      createdAt: new Date(),
    });
  } catch (e) {
    console.error("Failed to save note version in db:", e);
  }
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function nowDatetimeIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function normalizeDateToIso(dateStr?: string): string {
  if (!dateStr || !dateStr.trim()) return nowDatetimeIso();
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${trimmed}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  return trimmed;
}

// Week and month notes keep their period's first day (Monday / the 1st) as the date
export function dateForPeriod(dateIso: string, period: NotePeriod): string {
  if (period === "day") return dateIso;
  return `${periodStart(dateIso.slice(0, 10), period)}T00:00:00`;
}

/** Keeps well-formed Drive file references (from the picker) and drops anything else. */
export function sanitizeDriveFiles(raw: unknown): DriveFileRef[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const link = (v: unknown) => {
    const u = str(v, 2000);
    return /^https:\/\/[^\s]+$/i.test(u) ? u : null;
  };
  const seen = new Set<string>();
  const out: DriveFileRef[] = [];
  for (const f of raw) {
    const id = str((f as any)?.id, 200);
    if (!id || !/^[\w-]+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: str((f as any)?.name, 300) || "Adsız dosya",
      mime_type: str((f as any)?.mime_type, 200),
      web_view_link: link((f as any)?.web_view_link),
      icon_link: link((f as any)?.icon_link),
    });
    if (out.length >= 30) break;
  }
  return out;
}

export function extractNoteDates(note: { date?: string | null; content?: string | null }): string[] {
  const dates = new Set<string>();
  if (note.date) {
    dates.add(note.date.slice(0, 10));
  }
  if (note.content) {
    const matches = note.content.matchAll(/<!--\s*comment:id=[^,]+,(?:author=[^,]+,)?date=([^,>]+)/gi);
    for (const match of matches) {
      if (match[1]) {
        const d = match[1].trim().slice(0, 10);
        if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
          dates.add(d);
        }
      }
    }
  }
  return Array.from(dates);
}

export function slugify(text: string): string {
  const trMap: Record<string, string> = {
    'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'İ': 'i',
    'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u'
  };
  return (text || '')
    .split('')
    .map((c) => trMap[c] || c)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function generateSlugForNote(title: string, date: string, noteId: string, customSlug?: string): string {
  if (customSlug && customSlug.trim()) {
    const clean = slugify(customSlug.trim());
    if (clean) return clean;
  }
  const cleanTitle = slugify(title || '');
  const day = (date || todayIso()).slice(0, 10);
  const shortId = noteId.replace(/^note_/, '').slice(0, 6);
  if (cleanTitle) {
    return `${cleanTitle}-${shortId}`;
  }
  return `not-${day}-${shortId}`;
}

