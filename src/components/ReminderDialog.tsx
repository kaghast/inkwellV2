import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BellRing, Clock } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (isoDateTime: string, text: string) => void;
  initial?: { at?: string; text?: string };
}

function formatDateForInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowLocalRoundedISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 15, 0, 0);
  return formatDateForInput(d);
}

export default function ReminderDialog({ open, onOpenChange, onConfirm, initial }: Props) {
  const [dt, setDt] = useState<string>(initial?.at?.slice(0, 16) || nowLocalRoundedISO());
  const [text, setText] = useState<string>(initial?.text || "");

  useEffect(() => {
    if (open) {
      setDt(initial?.at?.slice(0, 16) || nowLocalRoundedISO());
      setText(initial?.text || "");
    }
  }, [open, initial]);

  const applyOffsetMinutes = (mins: number) => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + mins);
    setDt(formatDateForInput(d));
  };

  const applyTomorrowMorning = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    setDt(formatDateForInput(d));
  };

  function confirm() {
    if (!dt) return;
    const local = new Date(dt);
    onConfirm(local.toISOString(), text.trim() || "Hatırlatma");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border rounded-lg" data-testid="reminder-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl flex items-center gap-2">
            <BellRing className="w-4 h-4 text-[hsl(var(--accent-tag))]" strokeWidth={1.5} /> Hatırlatma Ekle
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Quick presets */}
          <div>
            <label className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground block mb-1.5 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Hızlı Seçimler
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => applyOffsetMinutes(15)}
                className="py-1 px-1.5 text-xs rounded border border-border hover:border-primary hover:bg-muted text-muted-foreground hover:text-foreground transition-all text-center"
              >
                +15 Dk
              </button>
              <button
                type="button"
                onClick={() => applyOffsetMinutes(60)}
                className="py-1 px-1.5 text-xs rounded border border-border hover:border-primary hover:bg-muted text-muted-foreground hover:text-foreground transition-all text-center"
              >
                +1 Saat
              </button>
              <button
                type="button"
                onClick={() => applyOffsetMinutes(180)}
                className="py-1 px-1.5 text-xs rounded border border-border hover:border-primary hover:bg-muted text-muted-foreground hover:text-foreground transition-all text-center"
              >
                +3 Saat
              </button>
              <button
                type="button"
                onClick={applyTomorrowMorning}
                className="py-1 px-1.5 text-xs rounded border border-border hover:border-primary hover:bg-muted text-muted-foreground hover:text-foreground transition-all text-center"
              >
                Yarın 09:00
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground block mb-1">
              Tarih & Saat
            </label>
            <Input
              type="datetime-local"
              value={dt}
              onChange={(e: any) => setDt(e.target.value)}
              className="font-mono text-xs rounded-md"
              data-testid="reminder-datetime-input"
            />
          </div>

          <div>
            <label className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground block mb-1">
              Hatırlatma Notu / Konu
            </label>
            <Input
              value={text}
              onChange={(e: any) => setText(e.target.value)}
              placeholder="Örn: Toplantı hazırlığı, Fatura ödemesi..."
              className="text-xs rounded-md"
              data-testid="reminder-text-input"
            />
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            onClick={confirm}
            className="bg-foreground text-background hover:bg-foreground/90 rounded-md"
            data-testid="reminder-confirm-btn"
          >
            Hatırlatmayı Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
