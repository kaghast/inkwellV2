import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitMerge, Search, Calendar, FileText, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import type { Note } from "@/types";
import { formatDisplayDatetime } from "@/lib/datetime";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentNoteId?: string;
  onConfirm: (mergedContentToInsert: string, mergedNote: Note) => void;
}

export default function MergeNoteDialog({
  open,
  onOpenChange,
  currentNoteId,
  onConfirm,
}: Props) {
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelectedNote(null);
      return;
    }

    let isMounted = true;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get<Note[]>("/notes");
        if (isMounted && Array.isArray(data)) {
          // Exclude current active note
          const filtered = data.filter((n) => n.note_id !== currentNoteId);
          setNotes(filtered);
        }
      } catch (err: any) {
        toast.error("Notlar yüklenemedi");
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [open, currentNoteId]);

  const filteredNotes = notes.filter((n) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    const titleMatch = (n.title || "").toLowerCase().includes(q);
    const contentMatch = (n.content || "").toLowerCase().includes(q);
    const tagMatch = n.tags?.some((t) => t.toLowerCase().includes(q));
    return titleMatch || contentMatch || tagMatch;
  });

  async function handleExecuteMerge() {
    if (!selectedNote) return;
    setMerging(true);
    try {
      // Format markdown content to append/insert
      const noteTitle = selectedNote.title ? selectedNote.title.trim() : "Birleştirilen Not";
      const noteContent = (selectedNote.content || "").trim();
      
      let markdownToInsert = "";
      if (noteContent) {
        markdownToInsert = `\n\n---\n### ${noteTitle}\n\n${noteContent}\n`;
      } else {
        markdownToInsert = `\n\n---\n### ${noteTitle}\n`;
      }

      // Delete the merged note as required
      await api.delete(`/notes/${encodeURIComponent(selectedNote.note_id)}`);

      // Call parent callback to insert content into editor
      onConfirm(markdownToInsert, selectedNote);

      toast.success(`"${noteTitle}" başarıyla birleştirildi ve silindi.`);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Not birleştirilirken hata oluştu");
    } finally {
      setMerging(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-5 bg-card border-border shadow-xl">
        <DialogHeader className="shrink-0 space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base font-serif font-bold text-foreground">
            <GitMerge className="w-4 h-4 text-primary" />
            Notu Birleştir (Merge)
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Başka bir notun içeriğini mevcut notunuza ekleyin. Birleştirilen not sistemden silinecektir.
          </DialogDescription>
        </DialogHeader>

        {/* Search Input */}
        <div className="relative my-2 shrink-0">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Birleştirilecek notu ara..."
            className="pl-8 text-xs bg-muted/40 border-border h-8"
            autoFocus
          />
        </div>

        {/* Selected Note Warning Banner */}
        {selectedNote && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-900 dark:text-amber-300 space-y-1 shrink-0 animate-in fade-in duration-150">
            <div className="flex items-center gap-1.5 font-bold">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>Seçilen Not: {selectedNote.title || "Başlıksız Not"}</span>
            </div>
            <p className="text-[11px] opacity-80">
              Bu notun tüm içeriği mevcut notunuza eklenecek ve orijinal not kalıcı olarak silinecektir.
            </p>
          </div>
        )}

        {/* Notes List */}
        <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[340px] space-y-2 pr-1 my-1">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
              Notlar yükleniyor...
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-xs text-muted-foreground text-center space-y-1">
              <FileText className="w-8 h-8 opacity-30 mb-1" />
              <p className="font-medium">Birleştirilecek not bulunamadı</p>
              <p className="text-[11px] opacity-70">Arama teriminizi değiştirmeyi deneyin.</p>
            </div>
          ) : (
            filteredNotes.map((n) => {
              const isSelected = selectedNote?.note_id === n.note_id;
              const snippet = (n.content || "").replace(/<!--[\s\S]*?-->/g, "").slice(0, 140).trim();

              return (
                <div
                  key={n.note_id}
                  onClick={() => setSelectedNote(n)}
                  className={`p-3 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between gap-1.5 ${
                    isSelected
                      ? "border-primary bg-primary/5 ring-1 ring-primary shadow-xs"
                      : "border-border/60 hover:border-border hover:bg-muted/30 bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-serif font-bold text-xs text-foreground truncate">
                      {n.title || "Başlıksız Not"}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1 shrink-0">
                      <Calendar className="w-2.5 h-2.5" />
                      {formatDisplayDatetime(n.date)}
                    </span>
                  </div>

                  {snippet && (
                    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {snippet}
                    </p>
                  )}

                  {n.tags && n.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {n.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <DialogFooter className="shrink-0 flex items-center justify-between pt-3 border-t border-border/60 mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={merging}
            className="h-8 text-xs cursor-pointer"
          >
            İptal
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleExecuteMerge}
            disabled={!selectedNote || merging}
            className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 cursor-pointer font-semibold shadow-xs"
          >
            <GitMerge className="w-3.5 h-3.5" />
            {merging ? "Birleştiriliyor..." : "Birleştir ve Sil"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
