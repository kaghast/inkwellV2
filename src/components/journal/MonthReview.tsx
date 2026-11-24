import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CitedText } from "@/pages/AskPage";
import { formatApiError } from "@/lib/api";
import { monthLabel } from "@/lib/journal";
import { aiApi, habitApi, notifyJournalChanged, type ReviewData } from "@/lib/workspaceApi";

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Citations become [[links]] when the review is saved into the month page. */
function toNoteText(review: string, citations: ReviewData["citations"]) {
  const byN = new Map(citations.map((c) => [c.n, c.title]));
  return review.replace(/\s*\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g, (_m, list: string) => {
    const links = list
      .split(",")
      .map((x) => byN.get(Number(x.trim())))
      .filter(Boolean)
      .map((t) => `[[${t}]]`);
    return links.length ? ` (${links.join(", ")})` : "";
  });
}

/**
 * Monthly review: counts from the month's pages, habits and mood, and — with
 * a model — a short cited narrative that can be saved into the month page.
 */
export default function MonthReview({ month, onSaved }: { month: string; onSaved?: () => void }) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  async function run() {
    setBusy(true);
    try {
      setData(await habitApi.review(month, localDay()));
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!data?.review || !data.monthly_id) return;
    setSaving(true);
    try {
      await aiApi.append(data.monthly_id, `## Değerlendirme\n\n${toNoteText(data.review, data.citations)}`, `Aylık değerlendirme eklendi (${monthLabel(month)})`);
      toast.success("Değerlendirme ayın sayfasına eklendi");
      notifyJournalChanged();
      onSaved?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Bu ayın kayıtlarından neler yapıldığını, nelerin ertelendiğini ve öne çıkan konuları çıkar.</p>
        <Button size="sm" onClick={run} disabled={busy} data-testid="review-run">
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />} Ayı değerlendir
        </Button>
      </div>
    );
  }

  const f = data.facts;
  const stat = (label: string, v: React.ReactNode) => (
    <div className="rounded-md bg-muted/50 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{v}</div>
    </div>
  );

  return (
    <div className="space-y-3" data-testid="review-result">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat("Kayıtlı gün", f.days_logged)}
        {stat("Yapılan görev", `${f.tasks.done} / ${f.tasks.done + f.tasks.open}`)}
        {stat("Taşınan · planlanan", `${f.tasks.migrated} · ${f.tasks.scheduled}`)}
        {stat("Etkinlik", f.events)}
        {f.mood_avg != null && stat("Ruh hali ort.", `${f.mood_avg}/5`)}
        {f.energy_avg != null && stat("Enerji ort.", `${f.energy_avg}/5`)}
        {f.tasks.cancelled > 0 && stat("İptal", f.tasks.cancelled)}
      </div>
      {f.postponed.length > 0 && (
        <div className="text-sm">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Tekrar tekrar ertelenenler</div>
          <ul className="ml-4 list-disc space-y-0.5">
            {f.postponed.map((p) => (
              <li key={p.text}>{p.text} <span className="text-xs text-muted-foreground">({p.times} kez)</span></li>
            ))}
          </ul>
        </div>
      )}
      {f.habits.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {f.habits.map((h) => (
            <span key={h.name} className="rounded-full border border-border px-2 py-0.5">{h.name} · {h.done}/{h.days}</span>
          ))}
        </div>
      )}
      {data.review && (
        <div className="rounded-md border border-border bg-background p-3 text-sm" data-testid="review-text">
          <CitedText text={data.review} citations={data.citations.map((c) => ({ ...c, slug: null, snippet: c.date }))} />
          <div className="mt-2 text-[11px] text-muted-foreground">{data.provider} · kaynaklar: {data.citations.map((c) => c.title).join(", ") || "yok"}</div>
        </div>
      )}
      {data.warning && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {data.warning}
          {data.mode === "facts_only" && <Link to="/settings?tab=ai" className="ml-1 text-primary hover:underline">Ayarlar</Link>}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {data.review && data.monthly_id && (
          <Button size="sm" onClick={save} disabled={saving} data-testid="review-save">
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Ayın sayfasına ekle
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={run} disabled={busy}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Yenile
        </Button>
      </div>
    </div>
  );
}
