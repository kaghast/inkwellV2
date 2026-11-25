// Pure search ranking (no database), unit-tested.
import { stripCode } from "../../src/lib/wikilinks";

export interface SearchDoc {
  id: string;
  slug?: string | null;
  title: string;
  content: string;
  tags: string[];
  people: string[];
  type_id: string;
  type_name: string;
  space_id: string | null;
  is_encrypted: boolean;
  archived: boolean;
  updated_at: string;
}

export interface SearchHit {
  id: string;
  slug?: string | null;
  title: string;
  type_id: string;
  type_name: string;
  space_id: string | null;
  snippet: string;
  matched: string[];
  score: number;
  updated_at: string;
}

export const fold = (s: string) =>
  s
    .toLocaleLowerCase("tr-TR")
    .replace(/[ıİ]/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Folded query words (letters and digits only), unique, at most `max`. */
export function queryWords(query: string, max = 32): string[] {
  return Array.from(new Set(fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean))).slice(0, max);
}

/**
 * A `to_tsquery('simple', …)` string that matches a row containing ANY of the
 * words (the caller still checks every word). Words at least `prefixMin` long
 * match as prefixes, so "toplanti" finds "toplantisi" (Turkish suffixes).
 * Only letters and digits get through, so the string is always valid syntax.
 */
export function tsQueryFor(words: string[], prefixMin = 1): string | null {
  const clean = words.map((w) => w.replace(/[^\p{L}\p{N}]+/gu, "")).filter(Boolean);
  if (clean.length === 0) return null;
  return Array.from(new Set(clean))
    .map((w) => (w.length >= prefixMin ? `${w}:*` : w))
    .join(" | ");
}

function snippetAround(text: string, terms: string[], radius = 70): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const f = fold(flat);
  let at = -1;
  for (const t of terms) {
    at = f.indexOf(t);
    if (at >= 0) break;
  }
  if (at < 0) return flat.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, at + radius)}${at + radius < flat.length ? "…" : ""}`;
}

/** Pure ranking so it can be unit-tested. */
export function rankDocuments(query: string, docs: SearchDoc[], limit = 20): SearchHit[] {
  const q = fold(query.trim());
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const hits: SearchHit[] = [];
  for (const d of docs) {
    const title = fold(d.title || "");
    const body = d.is_encrypted ? "" : fold(stripCode(d.content || "").replace(/<!--[\s\S]*?-->/g, " "));
    const tags = d.tags.map(fold);
    const people = d.people.map(fold);
    const typeName = fold(d.type_name);
    let score = 0;
    const matched = new Set<string>();
    let allTerms = true;
    for (const t of terms) {
      let termHit = false;
      if (title === q) { score += 12; matched.add("başlık"); termHit = true; }
      else if (title.startsWith(t)) { score += 6; matched.add("başlık"); termHit = true; }
      else if (title.includes(t)) { score += 4; matched.add("başlık"); termHit = true; }
      if (tags.some((x) => x === t || x.startsWith(t))) { score += 3; matched.add("etiket"); termHit = true; }
      if (people.some((x) => x === t || x.startsWith(t))) { score += 3; matched.add("kişi"); termHit = true; }
      if (typeName.includes(t)) { score += 1; matched.add("tip"); termHit = true; }
      if (body.includes(t)) {
        const count = body.split(t).length - 1;
        score += Math.min(3, 1 + Math.log2(count));
        matched.add("içerik");
        termHit = true;
      }
      if (!termHit) allTerms = false;
    }
    if (!allTerms || score === 0) continue;
    if (d.archived) score *= 0.6;
    hits.push({
      id: d.id,
      slug: d.slug,
      title: d.title || "Adsız",
      type_id: d.type_id,
      type_name: d.type_name,
      space_id: d.space_id,
      snippet: d.is_encrypted ? "Parola kilitli not" : snippetAround(stripCode(d.content || "").replace(/<!--[\s\S]*?-->/g, " "), terms),
      matched: Array.from(matched),
      score,
      updated_at: d.updated_at,
    });
  }
  return hits.sort((a, b) => b.score - a.score || b.updated_at.localeCompare(a.updated_at)).slice(0, limit);
}

