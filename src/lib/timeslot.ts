// Timeslot block data model, parser, duration calculator and markdown serializer

export interface TimeSlotData {
  start: string; // e.g. "09:00" or "2026-08-21T09:00"
  end: string;   // e.g. "10:30" or "2026-08-21T10:30"
  duration?: string; // e.g. "1 saat 30 dk"
  title: string; // e.g. "Proje Toplantısı"
  description?: string; // e.g. "Sprint hedefleri ve tasarım revizyonları"
  color?: string; // CSS rgba color e.g. "rgba(59, 130, 246, 1)"
}

export interface PresetColor {
  name: string;
  rgba: string;
  bg: string;
  border: string;
}

export const TIME_SLOT_PRESET_COLORS: PresetColor[] = [
  { name: "Mavi", rgba: "rgba(59, 130, 246, 1)", bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.35)" },
  { name: "Zümrüt", rgba: "rgba(16, 185, 129, 1)", bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.35)" },
  { name: "Mor", rgba: "rgba(139, 92, 246, 1)", bg: "rgba(139, 92, 246, 0.12)", border: "rgba(139, 92, 246, 0.35)" },
  { name: "Kehribar", rgba: "rgba(245, 158, 11, 1)", bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.35)" },
  { name: "Mercan", rgba: "rgba(239, 68, 68, 1)", bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.35)" },
  { name: "Pembe", rgba: "rgba(236, 72, 153, 1)", bg: "rgba(236, 72, 153, 0.12)", border: "rgba(236, 72, 153, 0.35)" },
  { name: "Camgöbeği", rgba: "rgba(6, 182, 212, 1)", bg: "rgba(6, 182, 212, 0.12)", border: "rgba(6, 182, 212, 0.35)" },
  { name: "İndigo", rgba: "rgba(99, 102, 241, 1)", bg: "rgba(99, 102, 241, 0.12)", border: "rgba(99, 102, 241, 0.35)" },
  { name: "Kömür", rgba: "rgba(100, 116, 139, 1)", bg: "rgba(100, 116, 139, 0.12)", border: "rgba(100, 116, 139, 0.35)" },
];

/**
 * Converts any hex or rgb/rgba string into a standard rgba(r, g, b, alpha) string
 */
export function hexToRgba(hexOrRgba: string, alpha = 1): string {
  if (!hexOrRgba) return `rgba(59, 130, 246, ${alpha})`;
  const trimmed = hexOrRgba.trim();
  if (trimmed.startsWith("rgba") || trimmed.startsWith("rgb")) {
    if (alpha !== 1 && trimmed.startsWith("rgb(")) {
      return trimmed.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
    }
    return trimmed;
  }
  let c = trimmed.replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const num = parseInt(c, 16);
  if (isNaN(num)) return `rgba(59, 130, 246, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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
    color: "rgba(59, 130, 246, 1)",
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
        const rawCol = trimmed.replace(/^[^:]+:\s*/i, "").trim();
        data.color = hexToRgba(rawCol);
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
  const safeColor = hexToRgba(data.color || "rgba(59, 130, 246, 1)");
  let md = "```timeslot\n";
  md += `start: ${data.start}\n`;
  md += `end: ${data.end}\n`;
  if (dur) md += `duration: ${dur}\n`;
  md += `color: ${safeColor}\n`;
  md += `title: ${data.title || "İş"}\n`;
  if (data.description && data.description.trim()) {
    md += `description: ${data.description.trim()}\n`;
  }
  md += "```";
  return md;
}
