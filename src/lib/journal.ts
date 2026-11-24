// Journal (bullet journal) calendar helpers shared by the client and the server.
// Months are "YYYY-MM" keys; names are Turkish and do not depend on Intl.

export const MONTH_NAMES = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const WEEKDAY_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(v: unknown): v is string {
  return typeof v === "string" && MONTH_RE.test(v);
}

export function monthOf(day: string): string {
  return day.slice(0, 7);
}

export function addMonths(ym: string, delta: number): string {
  const y = +ym.slice(0, 4);
  const m = +ym.slice(5, 7) - 1 + delta;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

export function daysInMonth(ym: string): number {
  const y = +ym.slice(0, 4);
  const m = +ym.slice(5, 7);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Every "YYYY-MM-DD" of the month. */
export function monthDays(ym: string): string[] {
  return Array.from({ length: daysInMonth(ym) }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
}

/** 0 = Sunday … 6 = Saturday, computed in UTC so it is the same everywhere. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** "Kasım 2026" */
export function monthLabel(ym: string): string {
  return `${MONTH_NAMES[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
}

/** Stable title of a monthly log; wikilinks from migrated tasks point at it. */
export function monthlyTitle(ym: string): string {
  return `Aylık kayıt · ${ym}`;
}

/** Same title the daily template gives a daily note. */
export function dailyTitle(day: string): string {
  return `Günlük not · ${day}`;
}

export function monthlyContent(): string {
  return `## Hedefler\n\n## Görevler\n\n## Notlar\n`;
}

export function collectionContent(description?: string): string {
  const d = (description || "").trim();
  return `${d ? `${d}\n\n` : ""}## Liste\n`;
}
