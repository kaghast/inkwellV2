import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import api from "@/lib/api";
import type { Note } from "@/types";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BellRing, Calendar, Clock, ArrowRight, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";

export interface ActiveReminder {
  id: string; // unique key combining noteId and iso
  noteId: string;
  noteTitle: string;
  date: string;
  targetIso: string;
  text: string;
  triggeredAt?: number;
  read: boolean;
}

interface ReminderContextType {
  reminders: ActiveReminder[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  refreshReminders: () => Promise<void>;
}

const ReminderContext = createContext<ReminderContextType | null>(null);

// Web Audio API notification sound generator
function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
    osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.24); // D6

    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.65);
  } catch {
    /* ignore audio errors if blocked by browser policy */
  }
}

const STORAGE_TRIGGERED_KEY = "inkwell_triggered_reminders";
const STORAGE_READ_KEY = "inkwell_read_reminders";

function getStoredSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveStoredSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore */
  }
}

export function ReminderProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [reminders, setReminders] = useState<ActiveReminder[]>([]);
  const [activePopup, setActivePopup] = useState<ActiveReminder | null>(null);

  // Parse reminders from all notes
  const refreshReminders = useCallback(async () => {
    try {
      const { data } = await api.get<Note[]>("/notes");
      if (!Array.isArray(data)) return;

      const readSet = getStoredSet(STORAGE_READ_KEY);
      const parsed: ActiveReminder[] = [];

      for (const note of data) {
        if (!note.content) continue;
        const lines = note.content.replace(/\r\n/g, "\n").split("\n");
        let i = 0;
        while (i < lines.length) {
          if (lines[i].trim().startsWith("```reminder")) {
            i++;
            const iso = i < lines.length ? lines[i].trim() : "";
            i++;
            const buf: string[] = [];
            while (i < lines.length && lines[i].trim() !== "```") {
              buf.push(lines[i]);
              i++;
            }
            if (iso) {
              const text = buf.join("\n").trim() || note.title || "Hatırlatma";
              const id = `${note.note_id}_${iso}`;
              parsed.push({
                id,
                noteId: note.note_id,
                noteTitle: note.title || "İsimsiz Not",
                date: note.date,
                targetIso: iso,
                text,
                read: readSet.has(id),
              });
            }
          }
          i++;
        }
      }

      setReminders(parsed);
    } catch {
      /* ignore */
    }
  }, []);

  // Request browser desktop notification permission on mount
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    }
  }, []);

  // Initial load and periodic refresh
  useEffect(() => {
    refreshReminders();
    const interval = setInterval(refreshReminders, 30000);
    return () => clearInterval(interval);
  }, [refreshReminders]);

  // Real-time reminder checker (every 2 seconds)
  useEffect(() => {
    const checkInterval = setInterval(() => {
      const now = Date.now();
      const triggeredSet = getStoredSet(STORAGE_TRIGGERED_KEY);
      let updatedTriggered = false;

      for (const r of reminders) {
        const targetTime = new Date(r.targetIso).getTime();
        if (isNaN(targetTime)) continue;

        // Check if reminder datetime has passed (within last 24 hours or just reached)
        // and hasn't been popped up yet in this browser storage
        if (now >= targetTime && !triggeredSet.has(r.id)) {
          triggeredSet.add(r.id);
          updatedTriggered = true;

          // 1. Play audio chime
          playNotificationChime();

          // 2. Show Active Modal Popup Dialog
          setActivePopup(r);

          // 3. Show Sonner Toast
          toast.warning(`⏰ Hatırlatma: ${r.text}`, {
            description: `${r.noteTitle} — Zamanı geldi!`,
            duration: 8000,
            action: {
              label: "Nota Git",
              onClick: () => navigate(`/day/${r.date}`),
            },
          });

          // 4. Native Browser Notification
          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            try {
              new Notification(`⏰ Inkwell: ${r.text}`, {
                body: `${r.noteTitle} - Hatırlatma zamanı geldi`,
                icon: "/favicon.ico",
              });
            } catch {
              /* ignore */
            }
          }
          break; // Show one modal at a time
        }
      }

      if (updatedTriggered) {
        saveStoredSet(STORAGE_TRIGGERED_KEY, triggeredSet);
      }
    }, 2000);

    return () => clearInterval(checkInterval);
  }, [reminders, navigate]);

  const markAsRead = useCallback((id: string) => {
    const readSet = getStoredSet(STORAGE_READ_KEY);
    readSet.add(id);
    saveStoredSet(STORAGE_READ_KEY, readSet);

    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, read: true } : r))
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    const readSet = getStoredSet(STORAGE_READ_KEY);
    (Array.isArray(reminders) ? reminders : []).forEach((r) => readSet.add(r.id));
    saveStoredSet(STORAGE_READ_KEY, readSet);

    setReminders((prev) => (Array.isArray(prev) ? prev : []).map((r) => ({ ...r, read: true })));
    toast.success("Tüm bildirimler okundu olarak işaretlendi");
  }, [reminders]);

  const unreadCount = (Array.isArray(reminders) ? reminders : []).filter((r) => {
    const targetTime = new Date(r.targetIso).getTime();
    return !r.read && Date.now() >= targetTime;
  }).length;

  const handleDismissPopup = () => {
    if (activePopup) {
      markAsRead(activePopup.id);
    }
    setActivePopup(null);
  };

  const handleGoToNote = () => {
    if (activePopup) {
      markAsRead(activePopup.id);
      navigate(`/day/${activePopup.date}`);
    }
    setActivePopup(null);
  };

  return (
    <ReminderContext.Provider
      value={{
        reminders,
        unreadCount,
        markAsRead,
        markAllAsRead,
        refreshReminders,
      }}
    >
      {children}

      {/* Realtime Alert Modal Pop Up */}
      {activePopup && (
        <Dialog open={!!activePopup} onOpenChange={(open) => !open && handleDismissPopup()}>
          <DialogContent
            className="max-w-md bg-card border-border shadow-2xl rounded-xl p-6 select-none animate-in fade-in zoom-in-95 duration-200"
            data-testid="reminder-popup-alert"
          >
            <DialogHeader>
              <div className="w-12 h-12 rounded-full bg-[hsl(var(--accent-tag))/0.15] text-[hsl(var(--accent-tag))] flex items-center justify-center mb-3">
                <BellRing className="w-6 h-6 animate-bounce" />
              </div>
              <DialogTitle className="font-serif text-2xl tracking-tight text-foreground flex items-center gap-2">
                Hatırlatma Zamanı Geldi!
              </DialogTitle>
            </DialogHeader>

            <div className="my-3 p-4 rounded-lg bg-muted/60 border border-border space-y-2">
              <div className="text-base font-semibold text-foreground font-serif leading-snug">
                {activePopup.text}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {activePopup.date}
                </span>
                <span className="flex items-center gap-1 font-mono">
                  <Clock className="w-3.5 h-3.5" />
                  {new Date(activePopup.targetIso).toLocaleTimeString("tr-TR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="text-xs text-muted-foreground/80 truncate pt-1 border-t border-border/50">
                Not: <span className="font-medium text-foreground">{activePopup.noteTitle}</span>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 mt-2">
              <Button
                variant="outline"
                onClick={handleDismissPopup}
                className="rounded-md border-border"
                data-testid="reminder-popup-dismiss-btn"
              >
                <Check className="w-4 h-4 mr-1.5 text-muted-foreground" /> Tamam
              </Button>
              <Button
                onClick={handleGoToNote}
                className="bg-foreground text-background hover:bg-foreground/90 rounded-md"
                data-testid="reminder-popup-view-btn"
              >
                Nota Git <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </ReminderContext.Provider>
  );
}

export function useReminders(): ReminderContextType {
  const ctx = useContext(ReminderContext);
  if (!ctx) throw new Error("useReminders must be used within ReminderProvider");
  return ctx;
}
