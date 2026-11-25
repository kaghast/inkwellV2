// Bullet search across notes (Phase 2.5f), pure part: which bullets match a
// filter. Unit tested; the database read lives in journalTools.ts.
import { listBullets, type BulletEntry, type BulletKind, type Signifier, type TaskState } from "../../src/lib/tasks";

export interface BulletFilter {
  kind?: BulletKind;
  /** Only for tasks. */
  states?: TaskState[];
  signifier?: Signifier;
  /** Case-insensitive text match (Turkish casing). */
  q?: string;
}

export interface BulletHit extends BulletEntry {
  note_id: string;
  slug: string | null;
  title: string;
  date: string;
  note_type_id: string | null;
}

const lower = (s: string) => s.toLocaleLowerCase("tr-TR");

export function matchBullet(b: BulletEntry, f: BulletFilter): boolean {
  if (f.kind && b.kind !== f.kind) return false;
  if (f.states && f.states.length && (b.kind !== "task" || !b.state || !f.states.includes(b.state))) return false;
  if (f.signifier && b.signifier !== f.signifier) return false;
  if (f.q && !lower(b.text).includes(lower(f.q.trim()))) return false;
  return true;
}

export interface PageForBullets {
  noteId: string;
  slug: string | null;
  title: string;
  content: string;
  date: string;
  noteTypeId: string | null;
}

/** Matching bullets, newest page first, then in page order; `limit` caps the result. */
export function queryBullets(pages: PageForBullets[], f: BulletFilter, limit = 300): { items: BulletHit[]; truncated: boolean } {
  const sorted = [...pages].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const items: BulletHit[] = [];
  for (const p of sorted) {
    for (const b of listBullets(p.content)) {
      if (!matchBullet(b, f)) continue;
      if (items.length >= limit) return { items, truncated: true };
      items.push({ ...b, note_id: p.noteId, slug: p.slug, title: p.title, date: (p.date || "").slice(0, 10), note_type_id: p.noteTypeId });
    }
  }
  return { items, truncated: false };
}

/** A card title from a task's text: wikilinks become their labels, markdown marks are dropped. */
export function cardTitleFromTask(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t, label) => label || t)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
