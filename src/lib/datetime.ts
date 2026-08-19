// Datetime helpers for Turkish locale and input conversion

export function toDateTimeLocal(isoOrDateStr?: string): string {
  if (!isoOrDateStr) {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const str = isoOrDateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${str}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
    return str.slice(0, 16);
  }
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  } catch {}
  return str;
}

export function formatDisplayDatetime(isoOrDateStr?: string, includeWeekday: boolean = false): string {
  if (!isoOrDateStr) return "";
  const str = isoOrDateStr.trim();
  try {
    const d = new Date(str.includes("T") ? str : `${str}T00:00:00`);
    if (isNaN(d.getTime())) return str;

    const hasTime = str.includes("T") && str.length > 10;
    const options: Intl.DateTimeFormatOptions = {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(includeWeekday ? { weekday: "long" } : {}),
      ...(hasTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    };
    return d.toLocaleDateString("tr-TR", options);
  } catch {
    return str;
  }
}
