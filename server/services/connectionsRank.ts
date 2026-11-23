// Candidate "unexpected connections": pairs of notes that look alike (same
// embedding model vectors, else TF-IDF term vectors) but are NOT connected
// within two hops in the relation graph. Candidates only; a model must explain
// each one from cited passages before it is shown (see connections.ts).
import { cosine, tokenize, type RetrievalDoc } from "./retrievalRank";
import { stripCode } from "../../src/lib/wikilinks";

export interface PairCandidate {
  a: string;
  b: string;
  similarity: number;
  basis: "semantic" | "terms";
  shared_terms: string[];
}

function withinTwoHops(neighbors: Map<string, Set<string>>, a: string, b: string): boolean {
  const n1 = neighbors.get(a);
  if (!n1) return false;
  if (n1.has(b)) return true;
  for (const mid of n1) if (neighbors.get(mid)?.has(b)) return true;
  return false;
}

function termVectors(docs: RetrievalDoc[]) {
  const toks = docs.map((d) => tokenize(`${d.title} ${stripCode(d.content || "")}`).filter((t) => t.length >= 4));
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length;
  return toks.map((t) => {
    const tf = new Map<string, number>();
    for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    const v = new Map<string, number>();
    for (const [w, c] of tf) {
      const d = df.get(w) || 1;
      if (d < 2 || d > Math.max(2, N * 0.3)) continue; // ignore unique and very common terms
      v.set(w, (1 + Math.log(c)) * Math.log(N / d));
    }
    return v;
  });
}

function sparseCosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0, na = 0, nb = 0;
  for (const [, x] of a) na += x * x;
  for (const [, y] of b) nb += y * y;
  for (const [k, x] of a) {
    const y = b.get(k);
    if (y) dot += x * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function findUnexpectedPairs(
  docs: RetrievalDoc[],
  neighbors: Map<string, Set<string>>,
  opts: { limit?: number; minSemantic?: number; minTerms?: number } = {}
): PairCandidate[] {
  const usable = docs.filter((d) => (d.content || "").trim().length >= 60);
  const tv = termVectors(usable);
  const out: PairCandidate[] = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const A = usable[i], B = usable[j];
      if (withinTwoHops(neighbors, A.id, B.id)) continue;
      const shared = Array.from(tv[i].keys()).filter((k) => tv[j].has(k)).sort((x, y) => (tv[j].get(y)! + tv[i].get(y)!) - (tv[j].get(x)! + tv[i].get(x)!)).slice(0, 5);
      if (A.vector && B.vector) {
        const s = cosine(A.vector, B.vector);
        if (s >= (opts.minSemantic ?? 0.72)) out.push({ a: A.id, b: B.id, similarity: s, basis: "semantic", shared_terms: shared });
      } else {
        const s = sparseCosine(tv[i], tv[j]);
        if (s >= (opts.minTerms ?? 0.18) && shared.length >= 2) out.push({ a: A.id, b: B.id, similarity: s, basis: "terms", shared_terms: shared });
      }
    }
  }
  // Best pairs first, each note at most twice so one note does not dominate
  out.sort((x, y) => y.similarity - x.similarity);
  const used = new Map<string, number>();
  const picked: PairCandidate[] = [];
  for (const p of out) {
    if ((used.get(p.a) || 0) >= 2 || (used.get(p.b) || 0) >= 2) continue;
    used.set(p.a, (used.get(p.a) || 0) + 1);
    used.set(p.b, (used.get(p.b) || 0) + 1);
    picked.push(p);
    if (picked.length >= (opts.limit ?? 6)) break;
  }
  return picked;
}
