import React from "react";
import { Check, ChevronLeft, ChevronRight, Circle, Minus, Square, X } from "lucide-react";

/** Small read-only bullet marker for lists outside the note view (future log, migration). */
export default function BulletGlyph({ kind, state, signifier }: { kind: string; state?: string | null; signifier?: string | null }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  const icon =
    kind === "event" ? <Circle className={`${cls} text-[hsl(var(--accent-tag))]`} strokeWidth={2.5} aria-label="Etkinlik" />
    : kind === "note" ? <Minus className={`${cls} text-muted-foreground`} aria-label="Not" />
    : state === "done" ? <Check className={`${cls} text-emerald-600`} strokeWidth={3} aria-label="Tamamlandı" />
    : state === "migrated" ? <ChevronRight className={`${cls} text-muted-foreground`} strokeWidth={2.5} aria-label="Taşındı" />
    : state === "scheduled" ? <ChevronLeft className={`${cls} text-muted-foreground`} strokeWidth={2.5} aria-label="İleriye planlandı" />
    : state === "cancelled" ? <X className={`${cls} text-muted-foreground`} strokeWidth={2.5} aria-label="İptal" />
    : <Square className={`${cls} text-muted-foreground`} aria-label="Açık görev" />;
  return (
    <span className="inline-flex items-center gap-0.5">
      {icon}
      {signifier === "priority" && <span className="text-[10px] font-bold text-red-600 dark:text-red-400" aria-label="Öncelikli">!</span>}
      {signifier === "explore" && <span className="text-[10px] font-bold text-sky-600 dark:text-sky-400" aria-label="Araştırılacak">?</span>}
    </span>
  );
}
