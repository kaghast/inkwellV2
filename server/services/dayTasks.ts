// Open markdown tasks of an object, numbered like PATCH /notes/:id/tasks (pure).
import { taskLineIndexMap } from "../../src/lib/tasks";

export interface DayTask {
  note_id: string;
  note_title: string;
  task_index: number;
  text: string;
}

/** Open tasks with the task index the existing PATCH /notes/:id/tasks API expects. */
export function openTasks(noteId: string, title: string, content: string): DayTask[] {
  const out: DayTask[] = [];
  const lines = (content || "").split(/\n/);
  for (const [lineNo, idx] of taskLineIndexMap(content)) {
    const m = lines[lineNo - 1].match(/^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+(.+)$/);
    if (m) out.push({ note_id: noteId, note_title: title, task_index: idx, text: m[1].trim() });
  }
  return out;
}

