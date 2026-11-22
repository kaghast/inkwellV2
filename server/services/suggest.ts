// Relation suggestions for a capture. Every suggestion carries a concrete,
// checkable reason (a title that literally appears, a shared tag or person).
// Mere similarity or graph proximity is never offered as a connection here.

export interface Candidate {
  id: string;
  title: string;
  tags: string[];
  people: string[];
}

export interface RelatedSuggestion {
  object_id: string;
  title: string;
  reason: string;
  score: number;
}

const norm = (s: string) => s.toLocaleLowerCase("tr-TR").trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function suggestRelated(
  text: string,
  extracted: { tags: string[]; people: string[] },
  candidates: Candidate[],
  limit = 5
): RelatedSuggestion[] {
  const body = norm(text);
  const tags = new Set(extracted.tags.map(norm));
  const people = new Set(extracted.people.map(norm));
  const out: RelatedSuggestion[] = [];
  for (const c of candidates) {
    const title = norm(c.title || "");
    const reasons: string[] = [];
    let score = 0;
    if (title.length >= 4 && new RegExp(`(^|[^\\p{L}\\p{N}])${esc(title)}([^\\p{L}\\p{N}]|$)`, "u").test(body)) {
      reasons.push(`Metinde “${c.title.trim()}” geçiyor`);
      score += 3;
    }
    const sharedTags = (c.tags || []).map(norm).filter((t) => tags.has(t));
    if (sharedTags.length) {
      reasons.push(`Ortak etiket: ${sharedTags.map((t) => `#${t}`).join(", ")}`);
      score += sharedTags.length;
    }
    const sharedPeople = (c.people || []).map(norm).filter((p) => people.has(p));
    if (sharedPeople.length) {
      reasons.push(`Ortak kişi: ${sharedPeople.map((p) => `@${p}`).join(", ")}`);
      score += 1.5 * sharedPeople.length;
    }
    if (score > 0) out.push({ object_id: c.id, title: c.title || "Adsız", reason: reasons.join(" · "), score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
