// Timeslot block data model, parser, duration calculator and markdown serializer

export interface TimeSlotData {
  start: string; // e.g. "09:00" or "2026-08-21T09:00"
  end: string;   // e.g. "10:30" or "2026-08-21T10:30"
  duration?: string; // e.g. "1 saat 30 dk"
  title: string; // e.g. "Proje Toplantısı"
  description?: string; // e.g. "Sprint hedefleri ve tasarım revizyonları"
  color?: string; // Hex color code e.g. "#3b82f6"
}

export interface PresetColor {
  name: string;
  hex: string;
  bg: string;
  border: string;
}

export const TIME_SLOT_PRESET_COLORS: PresetColor[] = [
  { name: "Mavi", hex: "#3b82f6", bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.35)" },
  { name: "Zümrüt", hex: "#10b981", bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.35)" },
  { name: "Mor", hex: "#8b5cf6", bg: "rgba(139, 92, 246, 0.12)", border: "rgba(139, 92, 246, 0.35)" },
  { name: "Kehribar", hex: "#f59e0b", bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.35)" },
  { name: "Mercan", hex: "#ef4444", bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.35)" },
  { name: "Pembe", hex: "#ec4899", bg: "rgba(236, 72, 153, 0.12)", border: "rgba(236, 72, 153, 0.35)" },
  { name: "Camgöbeği", hex: "#06b6d4", bg: "rgba(6, 182, 212, 0.12)", border: "rgba(6, 182, 212, 0.35)" },
  { name: "İndigo", hex: "#6366f1", bg: "rgba(99, 102, 241, 0.12)", border: "rgba(99, 102, 241, 0.35)" },
  { name: "Kömür", hex: "#64748b", bg: "rgba(100, 116, 139, 0.12)", border: "rgba(100, 116, 139, 0.35)" },
];

/**
 * Calculates human-readable duration between two times (HH:mm or ISO strings).
 */
export function calculateDuration(startTime: string, endTime: string): { durationText: string; totalMinutes: number } {
  if (!startTime || !endTime) return { durationText: "", totalMinutes: 0 };

  const parseToMinutes = (val: string): number | null => {
    const trimmed = val.trim();
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
      const [h, m] = trimmed.split(":").map(Number);
      return h * 60 + m;
    }
    if (trimmed.includes("T") || trimmed.includes(" ")) {
      const d = new Date(trimmed.replace(" ", "T"));
      if (!isNaN(d.getTime())) {
        return d.getHours() * 60 + d.getMinutes();
      }
    }
    return null;
  };

  let diffMinutes = 0;
  // If full dates with day difference
  if ((startTime.includes("-") || startTime.includes("T")) && (endTime.includes("-") || endTime.includes("T"))) {
    const d1 = new Date(startTime.replace(" ", "T")).getTime();
    const d2 = new Date(endTime.replace(" ", "T")).getTime();
    if (!isNaN(d1) && !isNaN(d2)) {
      diffMinutes = Math.round((d2 - d1) / (1000 * 60));
    }
  } else {
    const startMin = parseToMinutes(startTime);
    const endMin = parseToMinutes(endTime);
    if (startMin !== null && endMin !== null) {
      diffMinutes = endMin - startMin;
      if (diffMinutes < 0) {
        // Crossed midnight (e.g. 23:00 to 01:30)
        diffMinutes += 24 * 60;
      }
    }
  }

  if (diffMinutes <= 0) {
    return { durationText: "0 dk", totalMinutes: 0 };
  }

  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;

  if (hours > 0 && mins > 0) {
    return { durationText: `${hours} sa ${mins} dk`, totalMinutes: diffMinutes };
  } else if (hours > 0) {
    return { durationText: `${hours} saat`, totalMinutes: diffMinutes };
  } else {
    return { durationText: `${mins} dk`, totalMinutes: diffMinutes };
  }
}

/**
 * Parses timeslot block content inside ```timeslot ... ```
 */
export function parseTimeSlotBlock(rawContent: string): TimeSlotData {
  const lines = rawContent.trim().split("\n");
  const data: TimeSlotData = {
    start: "",
    end: "",
    title: "",
    description: "",
    color: "#3b82f6",
    duration: "",
  };

  const descLines: string[] = [];
  let readingDesc = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!readingDesc) {
      const lower = trimmed.toLowerCase();
      if (lower.startsWith("start:") || lower.startsWith("başlangıç:") || lower.startsWith("baslangic:")) {
        data.start = trimmed.replace(/^[^:]+:\s*/i, "").trim();
        continue;
      }
      if (lower.startsWith("end:") || lower.startsWith("bitiş:") || lower.startsWith("bitis:")) {
        data.end = trimmed.replace(/^[^:]+:\s*/i, "").trim();
        continue;
      }
      if (lower.startsWith("title:") || lower.startsWith("başlık:") || lower.startsWith("is:") || lower.startsWith("iş:")) {
        data.title = trimmed.replace(/^[^:]+:\s*/i, "").trim();
        continue;
      }
      if (lower.startsWith("color:") || lower.startsWith("renk:")) {
        data.color = trimmed.replace(/^[^:]+:\s*/i, "").trim();
        continue;
      }
      if (lower.startsWith("duration:") || lower.startsWith("süre:") || lower.startsWith("sure:")) {
        data.duration = trimmed.replace(/^[^:]+:\s*/i, "").trim();
        continue;
      }
      if (lower.startsWith("description:") || lower.startsWith("açıklama:") || lower.startsWith("aciklama:")) {
        descLines.push(trimmed.replace(/^[^:]+:\s*/i, "").trim());
        readingDesc = true;
        continue;
      }
      // If it doesn't match a prefix:
      if (!data.title) {
        data.title = trimmed;
      } else {
        descLines.push(line);
      }
    } else {
      descLines.push(line);
    }
  }

  data.description = descLines.join("\n").trim();

  // Auto calculate duration if start & end are present
  if (data.start && data.end) {
    const calc = calculateDuration(data.start, data.end);
    data.duration = calc.durationText || data.duration;
  }

  return data;
}

/**
 * Serializes TimeSlot data to standard markdown code fence format
 */
export function serializeTimeSlotBlock(data: TimeSlotData): string {
  const calc = calculateDuration(data.start, data.end);
  const dur = calc.durationText || data.duration || "";
  let md = "```timeslot\n";
  md += `start: ${data.start}\n`;
  md += `end: ${data.end}\n`;
  if (dur) md += `duration: ${dur}\n`;
  md += `color: ${data.color || "#3b82f6"}\n`;
  md += `title: ${data.title || "İş"}\n`;
  if (data.description && data.description.trim()) {
    md += `description: ${data.description.trim()}\n`;
  }
  md += "```";
  return md;
}
