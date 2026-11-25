// Shared client step for "Kanban kartı yap" in the task menu.
import { toast } from "sonner";
import { formatApiError } from "@/lib/api";
import { journalApi, notifyJournalChanged } from "@/lib/workspaceApi";

/** Turns a note's open task into a Kanban card; returns the note's new content, or null on failure. */
export async function taskToCard(noteId: string, index: number, content: string | undefined, open: (path: string) => void): Promise<string | null> {
  try {
    const r = await journalApi.toCard(noteId, index, content);
    notifyJournalChanged();
    toast.success(`“${r.card_title}” Kanban panosuna eklendi`, {
      action: { label: "Panoyu aç", onClick: () => open("/kanban") },
    });
    return r.content;
  } catch (e) {
    toast.error(formatApiError(e));
    return null;
  }
}
