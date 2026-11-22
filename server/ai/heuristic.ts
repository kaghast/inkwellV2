// Deterministic, rule-based extractor. Always available, so capture works with
// no AI key and the pipeline is testable. It only reports what is literally in
// the text (or in fetched link metadata); it never guesses facts.
import type { AiProvider, Extraction, ExtractionContext } from "./types";

const TAG_RE = /(?<!\S)#([\p{L}\p{N}_-]+)/gu;
const MENTION_RE = /(?<!\S)@([\p{L}\p{N}_-]+)/gu;
const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,:;"'!?]/gi;
const DOI_RE = /\b10\.\d{4,9}\/[^\s"<>]+/i;
const ISBN_RE = /\bISBN(?:-1[03])?:?\s*([0-9Xx][0-9Xx -]{8,16})/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /(?:\+?\d[\d ()-]{8,}\d)/;

const TR_MONTHS: Record<string, number> = {
  ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5, haziran: 6,
  temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9, ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const check = new Date(`${iso}T12:00:00Z`);
  return check.getUTCMonth() + 1 === m ? iso : null;
}

export function extractDates(text: string, today: string): string[] {
  const out = new Set<string>();
  const lower = text.toLocaleLowerCase("tr-TR");
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const v = validDate(+m[1], +m[2], +m[3]);
    if (v) out.add(v);
  }
  for (const m of text.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g)) {
    const v = validDate(+m[3], +m[2], +m[1]); // Turkish order: day.month.year
    if (v) out.add(v);
  }
  for (const m of lower.matchAll(/\b(\d{1,2})\s+([a-zçğıöşü]+)(?:\s+(\d{4}))?/gu)) {
    const month = TR_MONTHS[m[2]];
    if (!month) continue;
    const year = m[3] ? +m[3] : +today.slice(0, 4);
    const v = validDate(year, month, +m[1]);
    if (v) out.add(v);
  }
  if (/(^|[^\p{L}])(bugün|today)([^\p{L}]|$)/u.test(lower)) out.add(today);
  if (/(^|[^\p{L}])(yarın|tomorrow)([^\p{L}]|$)/u.test(lower)) out.add(addDays(today, 1));
  if (/(^|[^\p{L}])(dün|yesterday)([^\p{L}]|$)/u.test(lower)) out.add(addDays(today, -1));
  return Array.from(out).sort();
}

export function extractTasks(text: string): string[] {
  const tasks: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    let m = t.match(/^[-*]\s+\[\s\]\s+(.+)$/);
    if (!m) m = t.match(/^(?:todo|yapılacak|yapilacak|görev|gorev|aksiyon)\s*:\s*(.+)$/i);
    if (m && m[1].trim()) tasks.push(m[1].trim().slice(0, 200));
  }
  return Array.from(new Set(tasks));
}

function stripMarkdown(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/^[-*]\s+(\[[ xX]\]\s+)?/, "")
    .replace(/[*_`]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

export function deriveTitle(text: string, linkTitle?: string | null, fileName?: string | null): string {
  const lines = text.split(/\r?\n/).map(stripMarkdown).filter(Boolean);
  const first = lines.find((l) => !/^https?:\/\//i.test(l));
  if (!first && linkTitle) return linkTitle.slice(0, 120);
  if (!first && fileName) return fileName.replace(/\.[a-z0-9]{1,5}$/i, "").slice(0, 120);
  if (!first) return "";
  const clean = first.replace(TAG_RE, "").replace(/\s{2,}/g, " ").trim() || first;
  if (clean.length <= 80) return clean;
  const cut = clean.slice(0, 80);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 40 ? space : 80)}…`;
}

export function deriveSummary(text: string, linkDescription?: string | null): string {
  const body = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(URL_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const source = body.length >= 40 ? body : linkDescription || body;
  if (!source) return "";
  const sentences = source.match(/[^.!?]+[.!?]+/g) || [source];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > 240) break;
    out += s;
  }
  return (out || source.slice(0, 240)).trim();
}

interface TypeGuess {
  key: string;
  confidence: number;
}

export function detectType(text: string, ctx: Pick<ExtractionContext, "link" | "file">): TypeGuess {
  const lower = text.toLocaleLowerCase("tr-TR");
  const urls = text.match(URL_RE) || [];
  const nonUrl = text.replace(URL_RE, "").trim();
  if (DOI_RE.test(text) || /arxiv\.org\/(abs|pdf)\//i.test(text)) return { key: "paper", confidence: 0.9 };
  if (ISBN_RE.test(text)) return { key: "book", confidence: 0.85 };
  if (ctx.file) {
    if (/^image\//.test(ctx.file.content_type)) return { key: "file", confidence: 0.6 };
    return { key: "file", confidence: 0.8 };
  }
  const quoteLike = /^\s*(["“«]|>)/.test(text) && /(—|–|-{1,2})\s*\p{L}/u.test(text.split(/\r?\n/).slice(-2).join(" "));
  if (quoteLike) return { key: "quote", confidence: 0.8 };
  if (urls.length > 0 && nonUrl.length < 60) return { key: "article", confidence: 0.75 };
  if (EMAIL_RE.test(text) && PHONE_RE.test(text) && text.length < 400) return { key: "person", confidence: 0.7 };
  if (/(^|[^\p{L}])(toplantı|toplantısı|meeting|görüşme|1:1|standup)([^\p{L}]|$)/u.test(lower)) return { key: "meeting", confidence: 0.65 };
  if (/^(proje|project)\s*:/i.test(text.trim())) return { key: "project", confidence: 0.7 };
  if (/^(fikir|idea)\s*:/i.test(text.trim()) || /(^|[^\p{L}])(fikir|bir fikir|idea)([^\p{L}]|$)/u.test(lower)) return { key: "idea", confidence: 0.55 };
  const tasks = extractTasks(text);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (tasks.length > 0 && tasks.length >= lines.length / 2) return { key: "task", confidence: 0.7 };
  if (/(^|[^\p{L}])(etkinlik|konser|konferans|event|webinar|düğün)([^\p{L}]|$)/u.test(lower)) return { key: "event", confidence: 0.55 };
  return { key: "note", confidence: 0.4 };
}

function collect(re: RegExp, text: string): string[] {
  const out: string[] = [];
  for (const m of text.replace(/```[\s\S]*?```/g, " ").matchAll(new RegExp(re.source, re.flags))) {
    const v = m[1].toLocaleLowerCase("tr-TR");
    if (!/^\d+$/.test(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

export function heuristicExtract(text: string, ctx: ExtractionContext): Extraction {
  const guess = detectType(text, ctx);
  const available = new Set(ctx.types.map((t) => t.key));
  const key = available.has(guess.key) ? guess.key : "note";
  const lower = text.toLocaleLowerCase("tr-TR");
  const people = collect(MENTION_RE, text);
  for (const name of ctx.knownPeople) {
    const n = name.toLocaleLowerCase("tr-TR");
    if (n.length >= 3 && !people.includes(n) && new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u").test(lower)) {
      people.push(n);
    }
  }
  let author: string | null = ctx.link?.author || null;
  if (key === "quote") {
    const m = text.match(/(?:—|–|--)\s*([^\n,]+)\s*$/);
    if (m) author = m[1].trim();
  }
  return {
    type_key: key,
    type_confidence: key === guess.key ? guess.confidence : 0.3,
    title: deriveTitle(text, ctx.link?.title, ctx.file?.name),
    summary: deriveSummary(text, ctx.link?.description),
    tags: collect(TAG_RE, text),
    people,
    organizations: [],
    locations: [],
    dates: extractDates(text, ctx.today),
    tasks: extractTasks(text),
    author,
  };
}

export const heuristicProvider: AiProvider = {
  id: "heuristic",
  label: "Kural tabanlı",
  isModel: false,
  available: () => true,
  extract: async (text, ctx) => heuristicExtract(text, ctx),
  // Hash vectors carry no meaning, so the heuristic provider offers no embeddings.
  embed: async () => null,
};
