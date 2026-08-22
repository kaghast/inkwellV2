import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  History,
  RotateCcw,
  Clock,
  FileText,
  Calendar,
  Tag,
  Check,
  AlertCircle,
  Loader2,
  Sparkles,
} from "lucide-react";
import api from "@/lib/api";
import { Note, NoteVersion } from "@/types";
import MarkdownView from "@/components/MarkdownView";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  noteTitle: string;
  onRestored?: (restoredNote: Note) => void;
}

export default function NoteVersionsDialog({
  open,
  onOpenChange,
  noteId,
  noteTitle,
  onRestored,
}: Props) {
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [selectedVer, setSelectedVer] = useState<NoteVersion | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open || !noteId) return;

    (async () => {
      setLoading(true);
      try {
        const res = await api.get<NoteVersion[]>("/notes/" + noteId + "/versions");
        const data = Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);
        setVersions(data);
        if (data.length > 0) {
          setSelectedVer(data[0]);
        } else {
          setSelectedVer(null);
        }
      } catch (err: any) {
        toast.error("Versiyon geçmişi yüklenirken hata oluştu");
        setVersions([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, noteId]);

  const handleRestore = async () => {
    if (!selectedVer) return;

    const confirmed = window.confirm(
      "v" + selectedVer.version_number + " versiyonuna geri dönmek istediğinize emin misiniz? Güncel not bu versiyonun içeriğiyle güncellenecektir."
    );
    if (!confirmed) return;

    setRestoring(true);
    try {
      const res = await api.post<Note>(
        "/notes/" + noteId + "/versions/" + selectedVer.version_id + "/restore"
      );
      const restored = res.data || res;
      toast.success("v" + selectedVer.version_number + " versiyonuna başarıyla geri dönüldü");
      if (onRestored) {
        onRestored(restored);
      }
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Versiyona dönülürken hata oluştu");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden bg-card border-border">
        <DialogHeader className="p-4 sm:p-5 border-b border-border/60 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="font-serif text-lg sm:text-xl flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              <span>Versiyon Geçmişi</span>
              <span className="text-xs font-sans font-normal text-muted-foreground max-w-xs truncate">
                ({noteTitle || "İsimsiz Not"})
              </span>
            </DialogTitle>

            {versions.length > 0 && (
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                Toplam {versions.length} Versiyon
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col md:flex-row min-h-0 divide-y md:divide-y-0 md:divide-x divide-border/60">
          <div className="w-full md:w-80 overflow-y-auto p-3 space-y-2 shrink-0 bg-muted/15">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground gap-2 text-xs">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>Versiyonlar yükleniyor...</span>
              </div>
            ) : versions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-xs">
                Henüz kaydedilmiş versiyon geçmişi bulunmuyor.
              </div>
            ) : (
              versions.map((ver, idx) => {
                const isSelected = selectedVer?.version_id === ver.version_id;
                const isLatest = idx === 0;

                const dateStr = new Date(ver.created_at).toLocaleString("tr-TR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });

                const words = ver.content ? ver.content.trim().split(/\s+/).length : 0;

                return (
                  <button
                    key={ver.version_id}
                    type="button"
                    onClick={() => setSelectedVer(ver)}
                    className={"w-full text-left p-3 rounded-lg border transition-all cursor-pointer " + (
                      isSelected
                        ? "bg-primary/10 border-primary shadow-xs"
                        : "bg-card hover:bg-muted/40 border-border/60"
                    )}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-xs text-primary">
                          v{ver.version_number}
                        </span>
                        {isLatest && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold">
                            Güncel
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {dateStr}
                      </span>
                    </div>

                    <p className="text-xs font-medium text-foreground truncate mb-1">
                      {ver.title || "Başlıksız Not"}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="truncate italic">
                        {ver.change_summary || "Değişiklik yapıldı"}
                      </span>
                      <span className="font-mono shrink-0">{words} kelime</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="flex-1 flex flex-col min-h-0 p-4 sm:p-6 overflow-y-auto bg-card">
            {selectedVer ? (
              <div className="space-y-4 max-w-2xl w-full mx-auto">
                <div className="p-3 rounded-lg bg-secondary/50 border border-border flex items-center justify-between gap-2 flex-wrap text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-primary px-2 py-0.5 rounded bg-primary/10">
                      Versiyon {selectedVer.version_number}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(selectedVer.created_at).toLocaleString("tr-TR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>

                  {selectedVer.change_summary && (
                    <span className="text-muted-foreground italic">
                      {selectedVer.change_summary}
                    </span>
                  )}
                </div>

                <h3 className="text-xl sm:text-2xl font-serif font-bold text-foreground">
                  {selectedVer.title || "Başlıksız Not"}
                </h3>

                <div className="prose prose-sm dark:prose-invert max-w-none border-t border-border/40 pt-3">
                  {selectedVer.content ? (
                    <MarkdownView content={selectedVer.content} />
                  ) : (
                    <p className="text-xs italic text-muted-foreground">İçerik bulunmuyor.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
                Önizlemek için bir versiyon seçin.
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-3 sm:p-4 border-t border-border/60 shrink-0 flex items-center justify-between gap-2 bg-muted/10">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Kapat
          </Button>

          {selectedVer && (
            <Button
              type="button"
              size="sm"
              onClick={handleRestore}
              disabled={restoring}
              className="gap-1.5 cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"
              data-testid="restore-version-btn"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>v{selectedVer.version_number} Versiyonuna Geri Dön</span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
