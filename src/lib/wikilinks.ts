// [[wikilink]] parsing shared by the server (relation sync) and tests.
// Same syntax as MarkdownView/GraphView: [[Target]] or [[Target|Label]].
// Links inside fenced code blocks and inline code are ignored.

const WIKI_RE = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/gu;

export function stripCode(markdown: string): string {
  return (markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " ");
}

/** Unique link targets in document order (trimmed, original case). */
export function extractWikilinkTargets(markdown: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(WIKI_RE.source, "gu");
  const text = stripCode(markdown);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const target = m[1].trim();
    const key = target.toLowerCase();
    if (target && !seen.has(key)) {
      seen.add(key);
      out.push(target);
    }
  }
  return out;
}

export interface LinkableObject {
  id: string;
  title: string;
  slug?: string | null;
}

/**
 * Resolve link targets to object ids the same way the graph does:
 * lower-case title first, then slug, then exact id. Self links are dropped.
 */
export function resolveWikilinks(targets: string[], objects: LinkableObject[], selfId?: string): string[] {
  const byTitle = new Map<string, string>();
  const bySlug = new Map<string, string>();
  const ids = new Set<string>();
  for (const o of objects) {
    const t = (o.title || "").trim().toLowerCase();
    if (t && !byTitle.has(t)) byTitle.set(t, o.id);
    if (o.slug) bySlug.set(o.slug.toLowerCase(), o.id);
    ids.add(o.id);
  }
  const out: string[] = [];
  for (const raw of targets) {
    const key = raw.toLowerCase();
    const id = byTitle.get(key) || bySlug.get(key) || (ids.has(raw) ? raw : undefined);
    if (id && id !== selfId && !out.includes(id)) out.push(id);
  }
  return out;
}
