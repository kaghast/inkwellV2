import React, { useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatApiError } from "@/lib/api";
import { promptFor } from "@/lib/journal";
import { journalApi, notifyJournalChanged } from "@/lib/workspaceApi";

/**
 * One reflection question at a time; the answer is written into the page's
 * "## Yansıma" section as "- **Soru** cevap", so it stays in the note text.
 */
export default function ReflectionCard({
  day,
  pool,
  resolveNoteId,
  onSaved,
}: {
  day: string;
  pool: string[];
  /** Returns the page to write into, creating it when needed. */
  resolveNoteId: () => Promise<string>;
  onSaved?: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const base = pool.indexOf(promptFor(day, pool));
  const question = pool[(base + offset) % pool.length];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const text = answer.trim();
    if (!text) return;
    setBusy(true);
    try {
      const noteId = await resolveNoteId();
      await journalApi.log({ note_id: noteId, text: `**${question}** ${text}`, kind: "note", section: "Yansıma" });
      setAnswer("");
      setOffset((o) => o + 1);
      toast.success("Yansıma kaydedildi");
      notifyJournalChanged();
      onSaved?.();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-2" data-testid="reflection-card">
      <div className="flex items-start gap-2">
        <p className="flex-1 font-serif text-base font-semibold leading-snug" data-testid="reflection-question">{question}</p>
        {pool.length > 1 && (
          <button type="button" onClick={() => setOffset((o) => o + 1)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Başka bir soru" title="Başka bir soru">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} placeholder="Kısa bir cevap yaz…" aria-label={question} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={busy || !answer.trim()}>
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Kaydet
        </Button>
      </div>
    </form>
  );
}
