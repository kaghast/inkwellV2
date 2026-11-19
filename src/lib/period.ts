// Notes can belong to a single day (default), an ISO week or a month.
// A week/month note keeps the period's first day in `date` (Monday / the 1st).
// Shared by the client and the server; works on plain YYYY-MM-DD strings.

export type NotePeriod = "day" | "week" | "month";

export const PERIOD_OPTIONS: { value: NotePeriod; label: string }[] = [
  { value: "day", label: "Gün" },
  { value: "week", label: "Hafta" },
  { value: "month", label: "Ay" },
];

const MONTHS_TR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

export function normalizePeriod(value: unknown): NotePeriod {
  return value === "week" || value === "month" ? value : "day";
}

function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `ymd`. */
export function weekStart(ymd: string): string {
  const d = parseYmd(ymd);
  if (!d) return ymd.slice(0, 10);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return toYmd(d);
}

export function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/** First day of the period that contains `ymd`. */
export function periodStart(ymd: string, period: NotePeriod): string {
  if (period === "week") return weekStart(ymd);
  if (period === "month") return monthStart(ymd);
  return ymd.slice(0, 10);
}

/** ISO week number and its year for `ymd`. */
export function isoWeek(ymd: string): { year: number; week: number } {
  const d = parseYmd(ymd);
  if (!d) return { year: 0, week: 0 };
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday decides the year
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const ftDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDow + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { year, week };
}

/** Short label, e.g. "2026 · 47. Hafta (16–22 Kas)" or "Kasım 2026". */
export function periodLabel(ymd: string, period: NotePeriod): string {
  const start = periodStart(ymd, period);
  if (period === "month") {
    const m = Number(start.slice(5, 7)) - 1;
    return `${MONTHS_TR[m] || ""} ${start.slice(0, 4)}`;
  }
  if (period === "week") {
    const { year, week } = isoWeek(start);
    const s = parseYmd(start)!;
    const e = new Date(s);
    e.setUTCDate(e.getUTCDate() + 6);
    const short = (d: Date) => `${d.getUTCDate()} ${MONTHS_TR[d.getUTCMonth()].slice(0, 3)}`;
    return `${year} · ${week}. Hafta (${short(s)} – ${short(e)})`;
  }
  return start;
}
