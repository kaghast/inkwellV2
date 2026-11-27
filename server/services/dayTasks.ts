// Open markdown tasks of an object, numbered like PATCH /notes/:id/tasks (pure).
import { bulletLineMap, taskLineIndexMap } from "../../src/lib/tasks";

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
  const info = bulletLineMap(content);
  for (const [lineNo, idx] of taskLineIndexMap(content)) {
    if (info.get(lineNo)?.habit) continue; // habit lines are ticked in the habit tracker
    const m = lines[lineNo - 1].match(/^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+(.+)$/);
    if (m) out.push({ note_id: noteId, note_title: title, task_index: idx, text: m[1].trim() });
  }
  return out;
}

