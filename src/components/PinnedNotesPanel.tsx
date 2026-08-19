import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pin, Calendar, ArrowRight } from "lucide-react";
import api from "@/lib/api";
import type { Note } from "@/types";

interface Props {
  reloadKey?: number;
}

export default function PinnedNotesPanel({ reloadKey }: Props) {
  const [pinnedNotes, setPinnedNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPinned() {
      try {
        const { data } = await api.get<Note[]>("/notes", { params: { pinned: true } });
        setPinnedNotes(data || []);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    }
    loadPinned();
  }, [reloadKey]);

  if (loading && pinnedNotes.length === 0) {
    return null;
  }

  if (pinnedNotes.length === 0) {
    return null;
  }

  return (
    <div className="p-4 border-b border-border/80" data-testid="pinned-notes-panel">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-3 font-mono">
        <Pin className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} /> Sabitlenen Notlar
      </div>

      <div className="space-y-2">
        {pinnedNotes.map((note) => (
          <Link
            key={note.note_id}
            to={`/day/${note.date}`}
            className="group block p-2.5 rounded-lg border border-border/70 hover:border-primary/50 bg-card/60 hover:bg-card transition-all"
            data-testid={`pinned-note-${note.note_id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-serif font-medium text-foreground line-clamp-1 group-hover:text-primary transition-colors">
                {note.title || "Başlıksız Not"}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1 shrink-0 mt-0.5">
                <Calendar className="w-2.5 h-2.5" />
                {note.date}
              </span>
            </div>
            {note.content && (
              <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1 font-sans leading-relaxed">
                {note.content.replace(/[#@`*\-_\[\]]/g, "")}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
