// Monthly review (Phase 2.5e), pure part: facts counted from the month's
// journal pages and the numbered sources a model may cite. Everything here is
// counted from note text; nothing is inferred.
import { listBullets } from "../../src/lib/tasks";

export interface ReviewPage {
  note_id: string;
  title: string;
  /** "YYYY-MM-DD" for a daily note, "YYYY-MM" for the monthly log. */
  date: string;
  content: string;
}

export interface HabitStat {
  name: string;
  done: number;
  days: number;
}

export interface ReviewFacts {
  days_logged: number;
  entries: number;
  tasks: { done: number; open: number; migrated: number; scheduled: number; cancelled: number };
  events: number;
  /** Tasks carried forward or rescheduled at least twice this month. */
  postponed: Array<{ text: string; times: number }>;
  top_tags: Array<{ tag: string; count: number }>;
  habits: HabitStat[];
  mood_avg: number | null;
  energy_avg: number | null;
}

/** Task text without the migration link and tags/case differences, to recognise the same task across days. */
export function taskKey(text: string): string {
  return text
    .replace(/\s*→\s*\[\[[^\]]*\]\]\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr-TR");
}

function cleanText(text: string): string {
  return text.replace(/\s*→\s*\[\[[^\]]*\]\]\s*$/u, "").trim();
}

export function reviewFacts(pages: ReviewPage[], habits: HabitStat[] = [], ratings: Array<{ mood: number | null; energy: number | null }> = []): ReviewFacts {
  const tasks = { done: 0, open: 0, migrated: 0, scheduled: 0, cancelled: 0 };
  let events = 0;
  let entries = 0;
  let days = 0;
  const moved = new Map<string, { text: string; times: number }>();
  const tags = new Map<string, number>();
  for (const p of pages) {
    const bullets = listBullets(p.content).filter((b) => !b.habit); // habits are counted from the tracker
    if (p.date.length === 10 && bullets.length > 0) days++;
    entries += bullets.length;
    for (const b of bullets) {
      if (b.kind === "event") events++;
      if (b.kind === "task" && b.state) {
        tasks[b.state === "open" ? "open" : b.state]++;
        if (b.state === "migrated" || b.state === "scheduled") {
          const k = taskKey(b.text);
          const cur = moved.get(k) || { text: cleanText(b.text), times: 0 };
          cur.times++;
          moved.set(k, cur);
        }
      }
      for (const m of b.text.matchAll(/(?<!\S)#([\p{L}\p{N}_-]+)/gu)) tags.set(m[1].toLocaleLowerCase("tr-TR"), (tags.get(m[1].toLocaleLowerCase("tr-TR")) || 0) + 1);
    }
  }
  const avg = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => typeof x === "number");
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  };
  return {
    days_logged: days,
    entries,
    tasks,
    events,
    postponed: [...moved.values()].filter((m) => m.times >= 2).sort((a, b) => b.times - a.times).slice(0, 10),
    top_tags: [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([tag, count]) => ({ tag, count })),
    habits,
    mood_avg: avg(ratings.map((r) => r.mood)),
    energy_avg: avg(ratings.map((r) => r.energy)),
  };
}

export const REVIEW_SYSTEM = [
  "Sen kullanıcının bullet journal defterinin aylık değerlendirmesini yazan bir yardımcısın.",
  "Yalnızca verilen kaynaklardaki kayıtlara ve verilen sayılara dayan; tahmin yürütme, kaynakta olmayan etkinlik ya da duygu ekleme.",
  "Her cümlenin sonunda dayandığı kaynağı [n] biçiminde göster. Sayılar bölümünden gelen bilgiler için kaynak numarası gerekmez.",
  "Türkçe yaz. Şu başlıkları kullan: '### Neler yapıldı', '### Tekrar tekrar ertelenenler', '### Öne çıkan temalar', '### Gelecek ay için'.",
  "Ertelenen görev yoksa bunu açıkça söyle. 'Gelecek ay için' bölümünde yalnızca kaynaklardaki açık ya da ertelenen işlere dayanan en fazla üç öneri ver.",
  "Kısa ve somut ol; toplam 250 kelimeyi geçme.",
].join(" ");

/** Numbered sources: one per page that has bullets, lines kept short. */
export function reviewSources(pages: ReviewPage[], maxChars = 900): Array<ReviewPage & { n: number; text: string }> {
  const out: Array<ReviewPage & { n: number; text: string }> = [];
  for (const p of [...pages].sort((a, b) => a.date.localeCompare(b.date))) {
    const lines = listBullets(p.content).map((b) => {
      const mark = b.kind === "event" ? "(etkinlik)" : b.kind === "note" ? "(not)" : `(görev: ${b.state === "open" ? "açık" : b.state === "done" ? "yapıldı" : b.state === "migrated" ? "taşındı" : b.state === "scheduled" ? "ileriye planlandı" : "iptal"})`;
      return `${mark} ${cleanText(b.text)}`;
    });
    if (!lines.length) continue;
    let text = lines.join(" · ");
    if (text.length > maxChars) text = `${text.slice(0, maxChars)}…`;
    out.push({ ...p, n: out.length + 1, text });
  }
  return out.slice(0, 40);
}

export function buildReviewPrompt(monthLabel: string, facts: ReviewFacts, sources: Array<{ n: number; title: string; text: string }>): string {
  const f = facts;
  const numbers = [
    `Kayıt tutulan gün: ${f.days_logged}, toplam kayıt: ${f.entries}, etkinlik: ${f.events}`,
    `Görevler — yapıldı: ${f.tasks.done}, açık: ${f.tasks.open}, taşındı: ${f.tasks.migrated}, ileriye planlandı: ${f.tasks.scheduled}, iptal: ${f.tasks.cancelled}`,
    f.postponed.length ? `En az iki kez ertelenenler: ${f.postponed.map((p) => `"${p.text}" (${p.times} kez)`).join(", ")}` : "En az iki kez ertelenen görev yok.",
    f.habits.length ? `Alışkanlıklar: ${f.habits.map((h) => `${h.name} ${h.done}/${h.days} gün`).join(", ")}` : "",
    f.mood_avg != null ? `Ortalama ruh hali: ${f.mood_avg}/5` : "",
    f.energy_avg != null ? `Ortalama enerji: ${f.energy_avg}/5` : "",
  ].filter(Boolean);
  return [
    `Ay: ${monthLabel}`,
    "",
    "Sayılar:",
    ...numbers.map((x) => `- ${x}`),
    "",
    "Kaynaklar:",
    ...sources.map((s) => `[${s.n}] ${s.title}\n${s.text}`),
  ].join("\n");
}
