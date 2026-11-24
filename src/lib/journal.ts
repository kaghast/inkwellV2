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
  return `## Hedefler\n\n## Görevler\n\n## Notlar\n\n## Yansıma\n`;
}

export function collectionContent(description?: string): string {
  const d = (description || "").trim();
  return `${d ? `${d}\n\n` : ""}## Liste\n`;
}

/** The day before / after "YYYY-MM-DD" (UTC arithmetic, no time zone drift). */
export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Current streak: consecutive done days ending today, or ending yesterday
 * when today is not ticked yet (the day is not over). Longest streak too.
 */
export function habitStreaks(doneDays: Iterable<string>, today: string): { current: number; longest: number } {
  const set = new Set(doneDays);
  let start = set.has(today) ? today : shiftDay(today, -1);
  let current = 0;
  while (set.has(start)) {
    current++;
    start = shiftDay(start, -1);
  }
  let longest = 0;
  for (const d of set) {
    if (set.has(shiftDay(d, -1))) continue; // not the first day of a run
    let n = 0;
    let x = d;
    while (set.has(x)) {
      n++;
      x = shiftDay(x, 1);
    }
    longest = Math.max(longest, n);
  }
  return { current, longest };
}

/** Rotating reflection questions; Sundays ask weekly ones, the month page monthly ones. */
export const DAILY_PROMPTS = [
  "Bugün ne iyi gitti?",
  "Bugün neyi farklı yapardım?",
  "Bugün neye minnettarım?",
  "Bugün enerjimi en çok ne aldı, ne verdi?",
  "Bugün kimden ya da neden bir şey öğrendim?",
  "Yarın için en önemli tek şey ne?",
  "Bugün kendime nasıl iyi davrandım?",
];
export const WEEKLY_PROMPTS = [
  "Bu haftanın en anlamlı anı neydi?",
  "Bu hafta neyi ertelemeye devam ettim, neden?",
  "Gelecek hafta neye hayır diyeceğim?",
];
export const MONTHLY_PROMPTS = [
  "Bu ay neler iyi gitti?",
  "Bu ay neyi bırakmalıyım?",
  "Gelecek ay neye odaklanacağım?",
];

/** Same question all day, a different one tomorrow. */
export function promptFor(day: string, pool: string[]): string {
  const n = day.split("-").reduce((a, p) => a * 31 + Number(p), 7);
  return pool[Math.abs(n) % pool.length];
}
