import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Clock, Timer, Check, Palette, Sparkles } from "lucide-react";
import {
  TimeSlotData,
  calculateDuration,
  TIME_SLOT_PRESET_COLORS,
  serializeTimeSlotBlock,
} from "@/lib/timeslot";
import TimeSlotCard from "@/components/TimeSlotCard";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (markdown: string) => void;
  initialData?: Partial<TimeSlotData>;
}

export default function TimeSlotDialog({
  open,
  onOpenChange,
  onConfirm,
  initialData,
}: Props) {
  // Default to current hour & +1 hour
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const defaultStart = `${pad(now.getHours())}:00`;
  const defaultEnd = `${pad((now.getHours() + 1) % 24)}:00`;

  const [start, setStart] = useState(initialData?.start || defaultStart);
  const [end, setEnd] = useState(initialData?.end || defaultEnd);
  const [title, setTitle] = useState(initialData?.title || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [color, setColor] = useState(initialData?.color || "#3b82f6");

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setStart(initialData?.start || defaultStart);
      setEnd(initialData?.end || defaultEnd);
      setTitle(initialData?.title || "");
      setDescription(initialData?.description || "");
      setColor(initialData?.color || "#3b82f6");
    }
  }, [open, initialData]);

  const { durationText, totalMinutes } = calculateDuration(start, end);

  const previewData: TimeSlotData = {
    start,
    end,
    title: title || "Örnek İş / Aktivite",
    description,
    color,
    duration: durationText,
  };

  function handleSave() {
    if (!start.trim() || !end.trim()) {
      toast.error("Lütfen başlangıç ve bitiş zamanını girin");
      return;
    }
    if (!title.trim()) {
      toast.error("Lütfen işin adını/başlığını girin");
      return;
    }

    const md = serializeTimeSlotBlock({
      start: start.trim(),
      end: end.trim(),
      title: title.trim(),
      description: description.trim(),
      color,
      duration: durationText,
    });

    onConfirm(md);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg bg-card border-border p-5 sm:p-6 rounded-xl shadow-xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-lg sm:text-xl flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Zaman Bloğu (Time Slot) Ekle
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Start & End Times with Live Duration Calculation */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                Başlangıç Zamanı
              </label>
              <Input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="font-mono text-sm"
                data-testid="timeslot-start-input"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                Bitiş Zamanı
              </label>
              <Input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="font-mono text-sm"
                data-testid="timeslot-end-input"
              />
            </div>
          </div>

          {/* Automatic Duration Indicator */}
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/70 border border-border/60 text-xs font-mono">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Timer className="w-4 h-4 text-primary" />
              Hesaplanan Toplam Süre:
            </span>
            <span className="font-bold text-foreground bg-card px-2.5 py-0.5 rounded border border-border">
              {durationText || "0 dk"}
            </span>
          </div>

          {/* Title / Job Name */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              İşin Adı / Başlık <span className="text-destructive">*</span>
            </label>
            <Input
              placeholder="Örn: Tasarım Değerlendirme Toplantısı"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-sm"
              autoFocus
              data-testid="timeslot-title-input"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              Açıklama (İsteğe bağlı)
            </label>
            <Textarea
              placeholder="Yapılan işin detayları, notlar..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="text-sm resize-y"
              data-testid="timeslot-desc-input"
            />
          </div>

          {/* Color Selection Palette */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" />
              Blok Rengi
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {TIME_SLOT_PRESET_COLORS.map((p) => {
                const isSelected = color.toLowerCase() === p.hex.toLowerCase();
                return (
                  <button
                    key={p.hex}
                    type="button"
                    onClick={() => setColor(p.hex)}
                    title={p.name}
                    className={`w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                      isSelected
                        ? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110"
                        : "hover:scale-105 opacity-80 hover:opacity-100"
                    }`}
                    style={{ backgroundColor: p.hex }}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Preview Section */}
          <div className="pt-2 border-t border-border/40">
            <div className="text-[11px] font-mono text-muted-foreground mb-1 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-primary" /> Canlı Önizleme:
            </div>
            <TimeSlotCard data={previewData} />
          </div>
        </div>

        <DialogFooter className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer"
          >
            İptal
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            className="bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
            data-testid="timeslot-confirm-btn"
          >
            Bloğu Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
