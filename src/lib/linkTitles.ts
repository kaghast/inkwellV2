import { useEffect } from "react";
import api from "@/lib/api";

const BARE_URL_RE = /https?:\/\/[^\s<>()[\]]+[^\s<>()[\].,:;"'!?*_~]/g;
const EMBED_RE =
  /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts|maps\.google\.|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)/i;

/**
 * Quick client-side check: does the note contain a link without a title
 * (raw URL, <url>, or [url](url))? The server does the real rewrite.
 */
export function hasUntitledLinks(content: string): boolean {
  if (!content) return false;
  const main = content.split(/<!--\s*inkwell:comments:start\s*-->/i)[0];
  const plain = (s: string) => s.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  let fence: string | null = null;
  for (const line of main.split("\n")) {
    const t = line.trim();
    const f = t.match(/^(```|~~~)/);
    if (f) {
      if (!fence) fence = f[1];
      else if (t.startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    let masked = line.replace(/`[^`]*`/g, " ");
    let found = false;
    masked = masked.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, bang, label, href) => {
      const lbl = String(label).trim();
      if (!bang && /^https?:\/\//i.test(href) && !EMBED_RE.test(href) && (!lbl || plain(lbl) === plain(href))) found = true;
      return " ";
    });
    if (found) return true;
    masked = masked.replace(/<(https?:\/\/[^>\s]+)>/g, (_m, href) => {
      if (!EMBED_RE.test(href)) found = true;
      return " ";
    });
    if (found) return true;
    masked = masked.replace(/<[^>]*>/g, " ");
    const re = new RegExp(BARE_URL_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      const prev = masked[m.index - 1];
      if (prev && /["'=(]/.test(prev)) continue;
      if (!EMBED_RE.test(m[0])) return true;
    }
  }
  return false;
}

// One attempt per note content per session, so failing sites are not retried on every render.
const attempted = new Set<string>();

function contentKey(noteId: string, content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) | 0;
  return `${noteId}:${content.length}:${h}`;
}

/**
 * When a note has links without titles, asks the server to fetch the page titles
 * and write them into the markdown as [Title](url). Calls onUpdated with the new
 * content when the note changed.
 */
export function useLinkTitleSync(
  noteId: string | undefined,
  content: string | undefined,
  enabled: boolean,
  onUpdated: (content: string) => void
) {
  useEffect(() => {
    if (!enabled || !noteId || !content || !hasUntitledLinks(content)) return;
    const key = contentKey(noteId, content);
    if (attempted.has(key)) return;
    attempted.add(key);
    let cancelled = false;
    api
      .post<{ changed: boolean; content: string }>(`/notes/${encodeURIComponent(noteId)}/link-titles`)
      .then(({ data }) => {
        if (!cancelled && data?.changed && typeof data.content === "string") onUpdated(data.content);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // onUpdated is intentionally not a dependency: callers pass inline closures
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, content, enabled]);
}
