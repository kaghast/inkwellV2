import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowUpRight, Loader2, Plus } from "lucide-react";
import PageShell from "@/components/PageShell";
import BulletGlyph from "@/components/journal/BulletGlyph";
import { formatApiError } from "@/lib/api";
import { addMonths, monthLabel } from "@/lib/journal";
import { parseLogEntry } from "@/lib/tasks";
import { JOURNAL_CHANGED, journalApi, type FutureMonth } from "@/lib/workspaceApi";

const pad = (n: number) => String(n).padStart(2, "0");
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

function MonthCell({ m, onAdded }: { m: FutureMonth; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = text;
    if (!parseLogEntry(value, "task").text || busy) return;
    setText("");
    setBusy(true);
    try {
      const id = m.note_id || (await journalApi.ensureMonth(m.month)).note_id;
      await journalApi.log({ note_id: id, text: value, kind: "task", section: "Görevler" });
      onAdded();
    } catch (err) {
      setText((c) => c || value);
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-3" data-testid={`future-${m.month}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-serif text-base font-bold">{monthLabel(m.month)}</h3>
        <Link to={`/journal/month/${m.month}`} className="text-muted-foreground hover:text-primary" aria-label={`${monthLabel(m.month)} sayfasını aç`}>
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      <ul className="flex-1 space-y-1">
        {m.items.length === 0 && <li className="text-xs text-muted-foreground">Henüz bir şey planlanmadı.</li>}
        {m.items.map((it, i) => (
          <li key={i} className={`flex items-start gap-1.5 text-sm ${it.state && it.state !== "open" ? "text-muted-foreground" : ""}`}>
            <span className="mt-1">
              <BulletGlyph kind={it.kind} state={it.state} signifier={it.signifier} />
            </span>
            <span className={`min-w-0 break-words ${it.state === "cancelled" ? "line-through" : ""}`}>{it.text}</span>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-2 flex items-center gap-1 border-t border-border/60 pt-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ekle… (o etkinlik)"
          className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none"
          aria-label={`${monthLabel(m.month)} ayına ekle`}
        />
        <button type="submit" disabled={busy || !text.trim()} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label="Ekle">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </form>
    </section>
  );
}

/** Future log: the next twelve months at a glance; items live in each month's monthly log. */
export default function FutureLogPage() {
  const from = addMonths(thisMonth(), 1);
  const [months, setMonths] = useState<FutureMonth[] | null>(null);

  const load = useCallback(() => {
    journalApi
      .future(from, 12)
      .then((r) => setMonths(r.months))
      .catch((e) => toast.error(formatApiError(e)));
  }, [from]);
  useEffect(() => {
    load();
    window.addEventListener(JOURNAL_CHANGED, load);
    return () => window.removeEventListener(JOURNAL_CHANGED, load);
  }, [load]);

  return (
    <PageShell title="Gelecek kaydı" subtitle="Önümüzdeki 12 ay. Taşınacaklar listesinden “Aya” ile planlanan görevler burada görünür." wide>
      {!months ? (
        <div className="text-sm text-muted-foreground">Yükleniyor…</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="future-log">
          {months.map((m) => (
            <MonthCell key={m.month} m={m} onAdded={load} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
