// Markdown task-list helpers shared by the client and the server.
//
// A task line is a list item whose text starts with a task box, e.g.
// "- [ ] milk", "* [x] done", "1. [ ] first". Besides open/done, the journal
// (bullet journal) states are "[>]" migrated, "[<]" scheduled and "[-]"
// cancelled. "[o]" marks an event and a plain "- text" item is a note; those
// are bullets but not tasks. Lines inside fenced code blocks or HTML comments
// (such as the comments block) are never bullets, which keeps the numbering
// identical to what the markdown renderer shows.

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX<>-])\](?=\s|$)/;
const EVENT_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[[oO]\](?=\s|$)/;
const LIST_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)/;
const SIGNIFIER = /^\s*([!?])(?=\s)/;

export type TaskState = "open" | "done" | "migrated" | "scheduled" | "cancelled";
export const TASK_STATES: TaskState[] = ["open", "done", "migrated", "scheduled", "cancelled"];
const STATE_CHAR: Record<TaskState, string> = { open: " ", done: "x", migrated: ">", scheduled: "<", cancelled: "-" };

export function stateFromChar(c: string): TaskState {
  if (c === "x" || c === "X") return "done";
  if (c === ">") return "migrated";
  if (c === "<") return "scheduled";
  if (c === "-") return "cancelled";
  return "open";
}

export type BulletKind = "task" | "event" | "note";
export type Signifier = "priority" | "explore";

export interface BulletInfo {
  kind: BulletKind;
  /** Only for tasks. */
  state?: TaskState;
  /** Index used by PATCH /notes/:id/tasks; only for tasks. */
  taskIndex?: number;
  signifier?: Signifier;
}

/** Calls `fn` for every content line that is not code, a comment or the comments block. */
function forEachContentLine(lines: string[], fn: (lineIndex: number, line: string) => void | boolean) {
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

    if (fn(i, line) === false) return;
  }
}

/** Calls `fn` for every real task line, in document order. */
function forEachTaskLine(lines: string[], fn: (lineIndex: number, match: RegExpMatchArray) => void | boolean) {
  forEachContentLine(lines, (i, line) => {
    const m = line.match(TASK_LINE);
    if (m) return fn(i, m);
  });
}

/**
 * Bullets by 1-based source line: tasks (any state), events and notes (plain
 * list items), with their signifier. Used to render journal entries.
 */
export function bulletLineMap(md: string): Map<number, BulletInfo> {
  const map = new Map<number, BulletInfo>();
  let idx = 0;
  forEachContentLine((md || "").split("\n"), (i, line) => {
    const task = line.match(TASK_LINE);
    const event = !task && line.match(EVENT_LINE);
    const list = !task && !event && line.match(LIST_LINE);
    const m = task || event || list;
    if (!m) return;
    const sig = line.slice(m[0].length).match(SIGNIFIER)?.[1];
    const info: BulletInfo = task
      ? { kind: "task", state: stateFromChar(task[2]), taskIndex: idx++ }
      : { kind: event ? "event" : "note" };
    if (sig) info.signifier = sig === "!" ? "priority" : "explore";
    map.set(i + 1, info);
  });
  return map;
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

/** Progress counts open and done tasks; migrated, scheduled and cancelled ones are left out. */
export function countTasks(md: string): { total: number; done: number } {
  let total = 0;
  let done = 0;
  forEachTaskLine((md || "").split("\n"), (_i, m) => {
    const st = stateFromChar(m[2]);
    if (st !== "open" && st !== "done") return;
    total++;
    if (st === "done") done++;
  });
  return { total, done };
}

/** Sets the `index`-th task's state. Returns the input unchanged if there is no such task. */
export function setTaskStateInMarkdown(md: string, index: number, state: TaskState): string {
  const lines = (md || "").split("\n");
  let count = 0;
  let changed = false;
  forEachTaskLine(lines, (i, m) => {
    if (count++ !== index) return;
    lines[i] = `${m[1]}[${STATE_CHAR[state]}]${lines[i].slice(m[0].length)}`;
    changed = true;
    return false;
  });
  return changed ? lines.join("\n") : md;
}

/** Sets the `index`-th task's checkbox. Returns the input unchanged if there is no such task. */
export function toggleTaskInMarkdown(md: string, index: number, checked: boolean): string {
  return setTaskStateInMarkdown(md, index, checked ? "done" : "open");
}

/** Request body for PATCH /notes/:id/tasks: a checkbox toggle or a journal state. */
export function taskPatchBody(index: number, next: boolean | TaskState, content?: string) {
  return typeof next === "boolean" ? { index, checked: next, content } : { index, state: next, content };
}

// ---------------------------------------------------------------- rapid log

export interface LogEntry {
  kind: BulletKind;
  signifier?: Signifier;
  text: string;
}

/**
 * Reads the quick-entry prefixes: "." / "t" / "•" task, "o" / "○" event,
 * "-" / "–" note, then optional "!" priority or "?" explore. Without a kind
 * prefix the given default kind is used.
 */
export function parseLogEntry(input: string, defaultKind: BulletKind = "task"): LogEntry {
  let rest = (input || "").replace(/\s+/g, " ").trim();
  let kind: BulletKind = defaultKind;
  let signifier: Signifier | undefined;
  for (let guard = 0; guard < 2; guard++) {
    // A bare prefix ("." alone) is an empty entry, not the text "."
    const k = rest.match(/^(?:([.•tT])|([oO○])|([-–]))(?:\s+|$)/);
    if (k && guard === 0) {
      kind = k[1] ? "task" : k[2] ? "event" : "note";
      rest = rest.slice(k[0].length);
      continue;
    }
    const s = rest.match(/^([!?])(?:\s+|$)/);
    if (s && !signifier) {
      signifier = s[1] === "!" ? "priority" : "explore";
      rest = rest.slice(s[0].length);
      continue;
    }
    break;
  }
  return { kind, signifier, text: rest };
}

/** One markdown list line for a journal entry. */
export function formatLogEntry(e: LogEntry): string {
  const box = e.kind === "task" ? "[ ] " : e.kind === "event" ? "[o] " : "";
  const sig = e.signifier === "priority" ? "! " : e.signifier === "explore" ? "? " : "";
  return `- ${box}${sig}${e.text.trim()}`;
}

/**
 * Adds a journal line to a daily note: at the end of its "## Kayıt" (or the
 * older "## Plan") section, else at the end of the content. The comments
 * block always stays last. Consecutive entries form one tight list.
 */
export function insertLogLine(content: string, line: string, sections: string[] = ["Kayıt", "Plan"]): string {
  const src = content || "";
  const marker = src.search(/<!--\s*inkwell:comments:start\s*-->/i);
  const body = marker >= 0 ? src.slice(0, marker).replace(/\s+$/, "") : src.replace(/\s+$/, "");
  const tail = marker >= 0 ? `\n\n${src.slice(marker)}` : "\n";
  const lines = body ? body.split("\n") : [];
  const find = (name: string) => lines.findIndex((l) => new RegExp(`^##\\s+${name}\\s*$`, "i").test(l.trim()));
  let head = -1;
  for (const name of sections) {
    head = find(name);
    if (head >= 0) break;
  }
  if (head >= 0) {
    let end = lines.length;
    for (let i = head + 1; i < lines.length; i++) {
      if (/^#{1,2}\s/.test(lines[i])) {
        end = i;
        break;
      }
    }
    let last = end - 1;
    while (last > head && lines[last].trim() === "") last--;
    // Trailing blank lines of the section are replaced by one before the next heading
    const out = lines.slice(0, last + 1);
    if (last === head) out.push("");
    out.push(line);
    const rest = lines.slice(end);
    if (rest.length) out.push("", ...rest);
    return out.join("\n") + tail;
  }
  const lastLine = lines.length ? lines[lines.length - 1] : "";
  const sep = !body ? "" : LIST_LINE.test(lastLine) ? "\n" : "\n\n";
  return `${body}${sep}${line}${tail}`;
}

// ---------------------------------------------------------------- journal reads

export interface BulletEntry extends BulletInfo {
  /** 1-based source line. */
  line: number;
  /** Text after the bullet box and signifier. */
  text: string;
}

/** Every bullet with its text, in document order (code and comments excluded). */
export function listBullets(md: string): BulletEntry[] {
  const lines = (md || "").split("\n");
  const out: BulletEntry[] = [];
  for (const [line, info] of bulletLineMap(md)) {
    let rest = lines[line - 1].replace(LIST_LINE, "");
    if (info.kind !== "note") rest = rest.replace(/^\[[^\]]\]\s*/, "");
    rest = rest.replace(SIGNIFIER, "").trim();
    if (rest) out.push({ ...info, line, text: rest });
  }
  return out;
}

/**
 * Migration: closes the `index`-th task with a journal state and, when a
 * target is given, records where it went (" → [[Target]]", which also
 * becomes a wikilink relation). Returns the entry as written after the box
 * (signifier included) so it can be copied to the target, or null when the
 * index is not an open task.
 */
export function closeTaskInMarkdown(
  md: string,
  index: number,
  state: "migrated" | "scheduled" | "cancelled",
  linkTitle?: string
): { content: string; entry: string } | null {
  const lines = (md || "").split("\n");
  let count = 0;
  let result: { content: string; entry: string } | null = null;
  forEachTaskLine(lines, (i, m) => {
    if (count++ !== index) return;
    if (stateFromChar(m[2]) !== "open") return false;
    const entry = lines[i].slice(m[0].length).trim();
    const suffix = linkTitle ? ` → [[${linkTitle}]]` : "";
    lines[i] = `${m[1]}[${STATE_CHAR[state]}] ${entry}${suffix}`;
    result = { content: lines.join("\n"), entry };
    return false;
  });
  return result;
}

/** Removes the last line equal to `line` (used to undo a half-done migration). */
export function removeLastLine(content: string, line: string): string {
  const lines = (content || "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] === line) {
      lines.splice(i, 1);
      return lines.join("\n");
    }
  }
  return content;
}
