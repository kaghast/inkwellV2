/**
 * Note Split & Merge Utilities
 */

export const SPLIT_MARKER = "<!-- inkwell:split -->";
const SPLIT_REGEX = /(?:\r?\n|^)\s*<!--\s*inkwell:split\s*-->\s*(?:\r?\n|$)/i;

/**
 * Checks if the given markdown content contains a split marker.
 */
export function hasSplitMarker(content: string): boolean {
  if (!content) return false;
  return SPLIT_REGEX.test(content) || content.includes(SPLIT_MARKER);
}

/**
 * Splits markdown content at the first split marker.
 * Extracts a sensible title for the second part (from heading or first line).
 */
export function splitNoteContent(
  content: string,
  originalTitle?: string
): { part1: string; part2: string; title2: string } {
  if (!hasSplitMarker(content)) {
    return { part1: content, part2: "", title2: "" };
  }

  const parts = content.split(SPLIT_REGEX);
  const part1 = (parts[0] || "").trim();
  // Join any remaining parts if there were multiple split markers
  const part2 = parts.slice(1).join("\n\n").trim();

  // Determine title for part 2
  let title2 = "";
  if (part2) {
    const lines = part2.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      const firstLine = lines[0];
      // Check if it is a markdown heading
      const headingMatch = firstLine.match(/^#{1,6}\s+(.+)$/);
      if (headingMatch && headingMatch[1]) {
        title2 = headingMatch[1].trim();
      } else {
        if (firstLine.length <= 60) {
          title2 = firstLine.replace(/^[*-_~`>#\s]+/, "");
        }
      }
    }
  }

  if (!title2) {
    title2 = originalTitle ? originalTitle + " (Bölüm 2)" : "Bölünen Not";
  }

  return { part1, part2, title2 };
}

/**
 * Strips all split markers from content
 */
export function stripSplitMarkers(content: string): string {
  if (!content) return "";
  return content.replace(SPLIT_REGEX, "\n\n").trim();
}

/* ------------------------------------------------------------------ */
/* Line-based splitting used by the "Notu Böl" mode on note cards.     */
/* ------------------------------------------------------------------ */

export type SplitUnitKind = "heading" | "task" | "list" | "quote" | "code" | "table" | "hr" | "text";

/** A piece of a note that is never cut in the middle (a line, a code block, a table). */
export interface SplitUnit {
  /** Raw markdown of the unit, including any blank lines that follow it. */
  raw: string;
  kind: SplitUnitKind;
  /** Short plain-text label for the split preview. */
  preview: string;
  /** Heading level (1-6) for heading units. */
  level?: number;
  /** For task units: whether the box is ticked. */
  checked?: boolean;
}

function plainPreview(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt) => `🖼 ${alt || "görsel"}`)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|~~|`/g, "")
    .trim();
}

function classifyLine(line: string): Omit<SplitUnit, "raw"> {
  const t = line.trim();
  const heading = t.match(/^(#{1,6})\s+(.*)$/);
  if (heading) return { kind: "heading", level: heading[1].length, preview: plainPreview(heading[2]) };
  const task = t.match(/^[-*+]\s+\[([ xX])\]\s*(.*)$/);
  if (task) return { kind: "task", checked: task[1] !== " ", preview: plainPreview(task[2]) };
  if (/^([-*_])(\s*\1){2,}$/.test(t)) return { kind: "hr", preview: "" };
  if (/^([-*+]|\d+[.)])\s+/.test(t)) return { kind: "list", preview: plainPreview(t.replace(/^([-*+]|\d+[.)])\s+/, "")) };
  if (t.startsWith(">")) return { kind: "quote", preview: plainPreview(t.replace(/^>+\s?/, "")) };
  return { kind: "text", preview: plainPreview(t) };
}

/**
 * Breaks markdown into cut-able units. Fenced code blocks and tables stay whole,
 * blank lines stick to the unit before them, and split markers are dropped.
 */
export function splitIntoUnits(markdown: string): SplitUnit[] {
  const lines = (markdown || "").replace(/\r\n/g, "\n").split("\n");
  const units: SplitUnit[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t || /^<!--\s*inkwell:split\s*-->$/i.test(t)) {
      if (units.length && t === "") units[units.length - 1].raw += "\n";
      i++;
      continue;
    }
    const fence = t.match(/^(```|~~~)/);
    if (fence) {
      const block = [line];
      i++;
      while (i < lines.length) {
        block.push(lines[i]);
        if (lines[i].trim().startsWith(fence[1])) {
          i++;
          break;
        }
        i++;
      }
      const lang = t.slice(3).trim();
      units.push({ raw: block.join("\n"), kind: "code", preview: lang ? `${lang} bloğu` : "Kod bloğu" });
      continue;
    }
    if (t.startsWith("|")) {
      const block = [line];
      i++;
      while (i < lines.length && lines[i].trim().startsWith("|")) block.push(lines[i++]);
      units.push({ raw: block.join("\n"), kind: "table", preview: `Tablo (${block.length} satır)` });
      continue;
    }
    units.push({ raw: line, ...classifyLine(line) });
    i++;
  }
  return units;
}

/** Title for a part that becomes a new note: its heading, a short first line, or a numbered fallback. */
export function titleForPart(units: SplitUnit[], originalTitle: string, partNumber: number): string {
  const first = units.find((u) => u.preview.trim());
  if (first) {
    if (first.kind === "heading") return first.preview.slice(0, 120);
    const text = first.preview.replace(/^[*\-_~`>#\s]+/, "").trim();
    if (text && text.length <= 60 && first.kind !== "code" && first.kind !== "table") return text;
  }
  const base = (originalTitle || "").trim() || "Bölünen Not";
  return `${base} (Bölüm ${partNumber})`;
}

/**
 * Groups units into parts. `cuts` holds unit indexes that start a new part
 * (index 0 is ignored, it always starts the first part).
 */
export function groupUnits(units: SplitUnit[], cuts: Iterable<number>): SplitUnit[][] {
  const starts = new Set<number>([...cuts].filter((c) => c > 0 && c < units.length));
  const parts: SplitUnit[][] = [];
  units.forEach((u, idx) => {
    if (idx === 0 || starts.has(idx)) parts.push([]);
    parts[parts.length - 1].push(u);
  });
  return parts;
}

export function joinUnits(units: SplitUnit[]): string {
  return units.map((u) => u.raw).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
