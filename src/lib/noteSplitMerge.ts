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
