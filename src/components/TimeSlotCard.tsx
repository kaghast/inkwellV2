import React from "react";
import { Clock, Calendar, Timer, Tag } from "lucide-react";
import { parseTimeSlotBlock, TimeSlotData, calculateDuration, TIME_SLOT_PRESET_COLORS } from "@/lib/timeslot";

interface Props {
  raw?: string;
  data?: TimeSlotData;
}

export default function TimeSlotCard({ raw, data: propData }: Props) {
  const data: TimeSlotData = propData || (raw ? parseTimeSlotBlock(raw) : {
    start: "",
    end: "",
    title: "",
    description: "",
    color: "#3b82f6",
  });

  const color = data.color || "#3b82f6";
  const calc = calculateDuration(data.start, data.end);
  const durationText = data.duration || calc.durationText;

  // Find matching preset or construct styles
  const preset = TIME_SLOT_PRESET_COLORS.find((p) => p.hex.toLowerCase() === color.toLowerCase());
  const bgColor = preset ? preset.bg : `${color}18`;
  const borderColor = preset ? preset.border : `${color}40`;

  return (
    <div
      className="my-3.5 rounded-xl border p-4 sm:p-5 transition-all shadow-2xs relative overflow-hidden bg-card/90"
      style={{
        borderLeftColor: color,
        borderLeftWidth: "5px",
        borderColor: borderColor,
        backgroundColor: bgColor,
      }}
      data-testid="timeslot-card"
    >
      {/* Top Meta Row: Time Range & Duration Badge */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5">
        <div className="flex items-center gap-2 text-xs font-mono font-medium text-foreground">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0 shadow-2xs"
            style={{ backgroundColor: color }}
          >
            <Clock className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold tracking-wide">
            {data.start || "--:--"}
          </span>
          <span className="text-muted-foreground opacity-60">→</span>
          <span className="font-semibold tracking-wide">
            {data.end || "--:--"}
          </span>
        </div>

        {/* Calculated Duration Badge */}
        {durationText && (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold border shadow-2xs"
            style={{
              color: color,
              borderColor: borderColor,
              backgroundColor: "hsl(var(--card))",
            }}
            title="Hesaplanan toplam süre"
          >
            <Timer className="w-3.5 h-3.5 shrink-0" />
            <span>{durationText}</span>
          </span>
        )}
      </div>

      {/* Title / Task Name */}
      <h4 className="font-serif font-bold text-base sm:text-lg text-foreground tracking-tight leading-snug mb-1.5 break-words [overflow-wrap:anywhere]">
        {data.title || "İsimsiz Zaman Bloğu"}
      </h4>

      {/* Description */}
      {data.description && (
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] mt-1 border-t border-border/40 pt-2 font-sans">
          {data.description}
        </p>
      )}

      {/* Color Chip Indicator */}
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
        <div className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-2xs"
            style={{ backgroundColor: color }}
          />
          <span className="opacity-75 uppercase text-[10px]">{preset?.name || color}</span>
        </div>
      </div>
    </div>
  );
}
