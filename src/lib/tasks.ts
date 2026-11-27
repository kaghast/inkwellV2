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
  /** Under the daily note's "## Alışkanlıklar" heading: a habit line, not a task to carry or count. */
  habit?: boolean;
}

/** "## Alışkanlıklar" opens the habit section; the next # or ## heading closes it. */
const HABIT_HEADING = /^#{1,2}\s+Alışkanlıklar\s*$/i;
const TOP_HEADING = /^#{1,2}\s/;

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
  let inHabits = false;
  forEachContentLine((md || "").split("\n"), (i, line) => {
    if (TOP_HEADING.test(line.trim())) inHabits = HABIT_HEADING.test(line.trim());
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
    if (inHabits) info.habit = true;
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

/**
 * Progress counts open and done tasks; migrated, scheduled and cancelled ones
 * are left out, and so are habit lines (the habit tracker counts those).
 */
export function countTasks(md: string): { total: number; done: number } {
  let total = 0;
  let done = 0;
  for (const info of bulletLineMap(md).values()) {
    if (info.kind !== "task" || info.habit) continue;
    if (info.state !== "open" && info.state !== "done") continue;
    total++;
    if (info.state === "done") done++;
  }
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

/**
 * Links the `index`-th open task to another page (" → [[Target]]") and keeps
 * it open, e.g. when it becomes a Kanban card. Returns null when the index is
 * not an open task or the task already points somewhere.
 */
export function linkTaskInMarkdown(md: string, index: number, linkTitle: string): { content: string; entry: string; text: string; signifier?: Signifier } | null {
  const lines = (md || "").split("\n");
  let count = 0;
  let result: { content: string; entry: string; text: string; signifier?: Signifier } | null = null;
  forEachTaskLine(lines, (i, m) => {
    if (count++ !== index) return;
    if (stateFromChar(m[2]) !== "open") return false;
    const entry = lines[i].slice(m[0].length).trim();
    if (!entry || /→\s*\[\[[^\]]+\]\]\s*$/.test(entry)) return false;
    const sig = entry.match(SIGNIFIER)?.[1];
    lines[i] = `${m[1]}[ ] ${entry} → [[${linkTitle}]]`;
    result = {
      content: lines.join("\n"),
      entry,
      text: entry.replace(SIGNIFIER, "").trim(),
      signifier: sig === "!" ? "priority" : sig === "?" ? "explore" : undefined,
    };
    return false;
  });
  return result;
}

/** The text of the `index`-th task (signifier removed), or null. */
export function taskText(md: string, index: number): { text: string; state: TaskState; signifier?: Signifier } | null {
  const lines = (md || "").split("\n");
  let count = 0;
  let out: { text: string; state: TaskState; signifier?: Signifier } | null = null;
  forEachTaskLine(lines, (i, m) => {
    if (count++ !== index) return;
    const entry = lines[i].slice(m[0].length).trim();
    const sig = entry.match(SIGNIFIER)?.[1];
    out = { text: entry.replace(SIGNIFIER, "").trim(), state: stateFromChar(m[2]), signifier: sig === "!" ? "priority" : sig === "?" ? "explore" : undefined };
    return false;
  });
  return out;
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

/** Adds an empty "## name" section at the end (before the comments block) when the content has none. */
export function ensureSection(content: string, name: string): string {
  const src = content || "";
  if (new RegExp(`^##\\s+${name}\\s*$`, "im").test(src)) return src;
  const marker = src.search(/<!--\s*inkwell:comments:start\s*-->/i);
  const body = (marker >= 0 ? src.slice(0, marker) : src).replace(/\s+$/, "");
  const tail = marker >= 0 ? `\n\n${src.slice(marker)}` : "\n";
  return `${body}${body ? "\n\n" : ""}## ${name}${tail}`;
}

// ---------------------------------------------------------------- line tags

// Same characters as the server's TAG_RE / MENTION_RE (server/services/notesCore.ts)
const LINE_TAG_RE = /(?<!\S)#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)(?!\S)/gu;
const LINE_MENTION_RE = /(?<!\S)@([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)(?!\S)/gu;

/** Lower case for comparing tags and names (Turkish casing, so "İ" → "i"). */
export const normTag = (s: string) => (s || "").replace(/^[#@]/, "").trim().toLocaleLowerCase("tr-TR");

function tokens(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of (text || "").matchAll(new RegExp(re.source, "gu"))) {
    const t = normTag(m[1]);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** "#tags" written on one line, normalized. */
export const lineTags = (text: string) => tokens(text, LINE_TAG_RE);
/** "@people" written on one line, normalized. */
export const linePeople = (text: string) => tokens(text, LINE_MENTION_RE);

export interface LineEntry extends BulletEntry {
  /** True for a plain paragraph line (not a list item). */
  plain?: boolean;
  tags: string[];
  people: string[];
}

/**
 * Every content line with the tags and people written on it: bullets as
 * listBullets gives them, plus plain paragraph lines (kind "note", plain).
 * Headings, blank lines, code and the comments block are left out.
 */
export function listLines(md: string): LineEntry[] {
  const lines = (md || "").split("\n");
  const bullets = new Map(listBullets(md).map((b) => [b.line, b]));
  const out: LineEntry[] = [];
  forEachContentLine(lines, (i, line) => {
    const b = bullets.get(i + 1);
    if (b) {
      out.push({ ...b, tags: lineTags(b.text), people: linePeople(b.text) });
      return;
    }
    const text = line.trim();
    if (!text || /^#{1,6}\s/.test(text) || LIST_LINE.test(line) || /^(\||>\s*$|---+$|\*\*\*+$)/.test(text)) return;
    const body = text.replace(/^>\s*/, "");
    out.push({ kind: "note", plain: true, line: i + 1, text: body, tags: lineTags(body), people: linePeople(body) });
  });
  return out;
}

// ---------------------------------------------------------------- habits as lines

/**
 * A habit is a tag. On a day, the daily note's lines carrying that tag say
 * whether it was done: a ticked task "- [x] … #tag" or any non-task line
 * (a note, an event, a paragraph) is done; an unticked task is not yet.
 */
export function habitStateInMarkdown(md: string, tag: string): "done" | "open" | null {
  const t = normTag(tag);
  let state: "done" | "open" | null = null;
  for (const l of listLines(md)) {
    if (!l.tags.includes(t)) continue;
    if (l.kind !== "task" || l.state === "done") return "done";
    if (l.state === "open") state = "open";
  }
  return state;
}

export const HABIT_SECTION = "Alışkanlıklar";

/** "- [ ] Okuma #okuma" — the tag is left out of the text when the name already carries it. */
export function habitLine(name: string, tag: string, done = false): string {
  const t = normTag(tag);
  const text = lineTags(name).includes(t) ? name.trim() : `${name.trim()} #${t}`;
  return `- [${done ? "x" : " "}] ${text}`;
}

/** Adds the "## Alışkanlıklar" section before "## Yansıma" (else at the end) when missing. */
function ensureHabitSection(content: string): string {
  const src = content || "";
  if (new RegExp(`^##\\s+${HABIT_SECTION}\\s*$`, "im").test(src)) return src;
  const lines = src.split("\n");
  const at = lines.findIndex((l) => /^##\s+Yansıma\s*$/i.test(l.trim()));
  if (at < 0) return ensureSection(src, HABIT_SECTION);
  let prev = at;
  while (prev > 0 && lines[prev - 1].trim() === "") prev--;
  return [...lines.slice(0, prev), ...(prev > 0 ? [""] : []), `## ${HABIT_SECTION}`, "", ...lines.slice(at)].join("\n");
}

/** Adds an open line for every habit the note does not mention yet, under "## Alışkanlıklar". */
export function addHabitLines(md: string, habits: Array<{ name: string; tag: string }>): string {
  let out = md || "";
  for (const h of habits) {
    if (listLines(out).some((l) => l.tags.includes(normTag(h.tag)))) continue;
    out = insertLogLine(ensureHabitSection(out), habitLine(h.name, h.tag), [HABIT_SECTION]);
  }
  return out;
}

/**
 * Marks a habit done or not done on the note: its task lines are ticked or
 * unticked, a missing line is added. Returns null when the note says done
 * with a line that is not a task (the user wrote it; it is not rewritten).
 */
export function setHabitInMarkdown(md: string, habit: { name: string; tag: string }, done: boolean): string | null {
  const t = normTag(habit.tag);
  const entries = listLines(md).filter((l) => l.tags.includes(t));
  const tasks = entries.filter((l) => l.kind === "task" && (l.state === "open" || l.state === "done"));
  if (!done && entries.some((l) => l.kind !== "task")) return null;
  if (!tasks.length) {
    if (!done) return md;
    if (entries.some((l) => l.kind !== "task")) return md; // already done by a note line
    return insertLogLine(ensureHabitSection(md), habitLine(habit.name, habit.tag, true), [HABIT_SECTION]);
  }
  let out = md;
  for (const l of tasks) out = setTaskStateInMarkdown(out, l.taskIndex!, done ? "done" : "open");
  return out;
}

/** A tag for a habit name: "20 dk Okuma" → "20-dk-okuma". */
export function habitTagFromName(name: string): string {
  const own = lineTags(name);
  if (own.length) return own[0];
  return normTag(name)
    .replace(/[^a-z0-9_\-ğüşıöç]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
