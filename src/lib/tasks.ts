// Markdown task-list helpers shared by the client and the server.
//
// A task line is a list item whose text starts with "[ ]" or "[x]", e.g.
// "- [ ] milk", "* [x] done", "1. [ ] first". Lines inside fenced code blocks
// or HTML comments (such as the comments block) are not tasks, which keeps the
// numbering identical to what the markdown renderer shows as checkboxes.

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](?=\s|$)/;

/** Calls `fn` for every real task line, in document order. */
function forEachTaskLine(lines: string[], fn: (lineIndex: number, match: RegExpMatchArray) => void | boolean) {
  let fence: string | null = null;
  let inComment = false;
  let inCommentsBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    const fenceMatch = trimmed.match(/^(```|~~~)/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    // The note's comments live between these markers and are not shown as content
    if (/<!--\s*inkwell:comments:start\s*-->/i.test(line)) {
      inCommentsBlock = true;
      continue;
    }
    if (inCommentsBlock) {
      if (/<!--\s*inkwell:comments:end\s*-->/i.test(line)) inCommentsBlock = false;
      continue;
    }
    if (trimmed.startsWith("<!--")) {
      if (!trimmed.includes("-->")) inComment = true;
      continue;
    }

    const m = line.match(TASK_LINE);
    if (m && fn(i, m) === false) return;
  }
}

/** Maps 1-based source line numbers of task lines to their task index. */
export function taskLineIndexMap(md: string): Map<number, number> {
  const map = new Map<number, number>();
  let idx = 0;
  forEachTaskLine((md || "").split("\n"), (i) => {
    map.set(i + 1, idx++);
  });
  return map;
}

export function countTasks(md: string): { total: number; done: number } {
  let total = 0;
  let done = 0;
  forEachTaskLine((md || "").split("\n"), (_i, m) => {
    total++;
    if (m[2] !== " ") done++;
  });
  return { total, done };
}

/** Sets the `index`-th task's checkbox. Returns the input unchanged if there is no such task. */
export function toggleTaskInMarkdown(md: string, index: number, checked: boolean): string {
  const lines = (md || "").split("\n");
  let count = 0;
  let changed = false;
  forEachTaskLine(lines, (i, m) => {
    if (count++ !== index) return;
    lines[i] = `${m[1]}[${checked ? "x" : " "}]${lines[i].slice(m[0].length)}`;
    changed = true;
    return false;
  });
  return changed ? lines.join("\n") : md;
}
