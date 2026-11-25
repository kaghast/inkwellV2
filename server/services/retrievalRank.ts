// Pure hybrid ranking for Ask Inkwell and "find related" (no database).
// Signals: BM25 over note chunks, cosine similarity of note embeddings (when
// both vectors come from the same model), and a small boost for objects that
// are related to the strongest hits. Scores are explainable per signal.
import { stripCode } from "../../src/lib/wikilinks";

export interface RetrievalDoc {
  id: string;
  slug?: string | null;
  title: string;
  content: string;
  type_name: string;
  date: string;
  tags: string[];
  /** Embedding of the note from the active embedding model, if any. */
  vector?: number[] | null;
}

export interface Chunk {
  doc: RetrievalDoc;
  ord: number;
  text: string;
}

export interface RankedChunk {
  note_id: string;
  slug?: string | null;
  title: string;
  type_name: string;
  date: string;
  ord: number;
  text: string;
  score: number;
  signals: { text: number; semantic: number; relation: number };
}

let STOP_CACHE: Set<string> | null = null;
const STOP_WORDS = () => STOP_CACHE || (STOP_CACHE = new Set(
  (
    "ve ile bir bu şu o da de mi mı mu mü ne için gibi çok daha en ama veya ya ki ise olan olarak var yok her hangi nasıl neden niçin nerede kim " +
    "ben sen biz siz onlar benim bana beni hakkında the a an and or of to in on for with is are was were be been it this that what which who how why when where do does did my me i"
  )
    .split(" ")
    .map((w) => fold(w))
));

export function fold(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function tokenize(s: string): string[] {
  return fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !STOP_WORDS().has(t));
}

/** Clean markdown and split a note into ~700-character chunks on paragraph boundaries. */
export function chunkDoc(doc: RetrievalDoc, size = 700): Chunk[] {
  const clean = stripCode(doc.content || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
  const paras = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: Chunk[] = [];
  let buf = "";
  for (const p of paras) {
    if (buf && buf.length + p.length > size) {
      chunks.push({ doc, ord: chunks.length, text: buf });
      buf = "";
    }
    if (p.length > size * 1.5) {
      for (let i = 0; i < p.length; i += size) chunks.push({ doc, ord: chunks.length, text: p.slice(i, i + size) });
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) chunks.push({ doc, ord: chunks.length, text: buf });
  if (chunks.length === 0) chunks.push({ doc, ord: 0, text: "" });
  return chunks;
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Ids of the `k` vectors most similar to the query (cosine >= `min`), best first. */
export function nearestIds(query: number[], rows: Array<{ id: string; vector: number[] | null }>, k: number, min = 0.3): string[] {
  return rows
    .filter((r): r is { id: string; vector: number[] } => Array.isArray(r.vector) && r.vector.length > 0)
    .map((r) => ({ id: r.id, sim: cosine(query, r.vector) }))
    .filter((r) => r.sim >= min)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k)
    .map((r) => r.id);
}

export interface RankOptions {
  queryVector?: number[] | null;
  /** note id -> related note ids (relations, wikilinks), used for the relation boost. */
  neighbors?: Map<string, Set<string>>;
  limit?: number;
  perNote?: number;
  excludeIds?: Set<string>;
}

/** BM25 (k1=1.2, b=0.75) over chunks; title and tags count as part of every chunk. */
export function rankChunks(query: string, docs: RetrievalDoc[], opts: RankOptions = {}): RankedChunk[] {
  const qTerms = Array.from(new Set(tokenize(query)));
  const chunks = docs.filter((d) => !opts.excludeIds?.has(d.id)).flatMap((d) => chunkDoc(d));
  if (chunks.length === 0) return [];
  const tokenized = chunks.map((c) => tokenize(`${c.doc.title} ${c.doc.title} ${c.doc.tags.join(" ")} ${c.text}`));
  const avgLen = tokenized.reduce((s, t) => s + t.length, 0) / tokenized.length || 1;
  const df = new Map<string, number>();
  for (const toks of tokenized) for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  const N = chunks.length;
  const bm25 = tokenized.map((toks) => {
    if (qTerms.length === 0) return 0;
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const q of qTerms) {
      // prefix match lets "toplantı" find "toplantısı" (Turkish suffixes)
      let f = tf.get(q) || 0;
      if (!f && q.length >= 4) for (const [t, c] of tf) if (t.startsWith(q)) f += c;
      if (!f) continue;
      const n = df.get(q) || 1;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * 2.2) / (f + 1.2 * (1 - 0.75 + (0.75 * toks.length) / avgLen));
    }
    return score;
  });
  const maxBm = Math.max(...bm25, 0) || 1;
  const sem = new Map<string, number>();
  if (opts.queryVector) {
    for (const d of docs) if (d.vector) sem.set(d.id, Math.max(0, cosine(opts.queryVector, d.vector)));
  }
  const base = chunks.map((c, i) => ({
    c,
    text: bm25[i] / maxBm,
    semantic: sem.get(c.doc.id) || 0,
  }));
  // Relation boost: neighbours of the three best notes by first-pass score
  const firstPass = new Map<string, number>();
  for (const b of base) {
    const s = 0.6 * b.text + 0.4 * b.semantic;
    firstPass.set(b.c.doc.id, Math.max(firstPass.get(b.c.doc.id) || 0, s));
  }
  const topIds = Array.from(firstPass.entries()).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  const boosted = new Set<string>();
  for (const id of topIds) for (const n of opts.neighbors?.get(id) || []) boosted.add(n);

  const scored = base
    .map((b) => {
      const relation = boosted.has(b.c.doc.id) && (b.text > 0 || b.semantic > 0.3) ? 0.15 : 0;
      const score = 0.6 * b.text + 0.4 * b.semantic + relation;
      return {
        note_id: b.c.doc.id,
        slug: b.c.doc.slug,
        title: b.c.doc.title || "Adsız",
        type_name: b.c.doc.type_name,
        date: b.c.doc.date,
        ord: b.c.ord,
        text: b.c.text,
        score,
        signals: { text: b.text, semantic: b.semantic, relation },
      };
    })
    // Semantic-only matches need real similarity; text matches need any hit
    .filter((r) => r.signals.text > 0 || r.signals.semantic >= 0.55)
    .sort((a, b) => b.score - a.score);

  const perNote = opts.perNote ?? 2;
  const counts = new Map<string, number>();
  const out: RankedChunk[] = [];
  for (const r of scored) {
    const c = counts.get(r.note_id) || 0;
    if (c >= perNote) continue;
    counts.set(r.note_id, c + 1);
    out.push(r);
    if (out.length >= (opts.limit ?? 8)) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------
export interface CitationCheck {
  answer: string;
  used: number[];
  removed: number[];
  uncitedSentences: number;
}

/**
 * Keep only [n] markers that point at a real source (1..count); report what
 * was removed and how many factual sentences carry no citation at all.
 */
export function checkCitations(answer: string, count: number): CitationCheck {
  const used = new Set<number>();
  const removed = new Set<number>();
  const cleaned = answer.replace(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g, (_m, list: string) => {
    const nums = list.split(",").map((x) => Number(x.trim()));
    const ok = nums.filter((n) => n >= 1 && n <= count);
    nums.filter((n) => !(n >= 1 && n <= count)).forEach((n) => removed.add(n));
    ok.forEach((n) => used.add(n));
    return ok.length ? `[${ok.join(", ")}]` : "";
  });
  // "…onaylandı. [1]" -> "…onaylandı [1]." so a trailing citation belongs to its sentence
  const attached = cleaned.replace(
    /([.!?])[ \t]*(\[\d{1,3}(?:,\s*\d{1,3})*\](?:[ \t]*\[\d{1,3}(?:,\s*\d{1,3})*\])*)([ \t]*)/g,
    (_m, p: string, c: string, ws: string) => ` ${c}${p}${ws}`
  );
  const sentences = attached
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25 && !/^#+\s/.test(s) && !/bulamadım|could not find|bilgi yok/i.test(s));
  const uncitedSentences = sentences.filter((s) => !/\[\d/.test(s)).length;
  return { answer: attached.replace(/[ \t]+([.,;:!?])/g, "$1").trim(), used: Array.from(used).sort((a, b) => a - b), removed: Array.from(removed), uncitedSentences };
}
