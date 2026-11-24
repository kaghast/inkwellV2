import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CalendarDays, Library, Sun, Telescope } from "lucide-react";
import PageShell, { Empty, Section } from "@/components/PageShell";
import { formatApiError } from "@/lib/api";
import { monthLabel } from "@/lib/journal";
import { journalApi, type JournalIndexData } from "@/lib/workspaceApi";

const pad = (n: number) => String(n).padStart(2, "0");

/** The journal's index, built from what exists: months, collections and tags. */
export default function JournalIndexPage() {
  const [data, setData] = useState<JournalIndexData | null>(null);
  useEffect(() => {
    journalApi
      .index()
      .then(setData)
      .catch((e) => toast.error(formatApiError(e)));
  }, []);
  const d = new Date();
  const current = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

  const pages = [
    { to: "/", label: "Bugün", hint: "Günlük kayıt", icon: Sun },
    { to: `/journal/month/${current}`, label: monthLabel(current), hint: "Aylık kayıt", icon: CalendarDays },
    { to: "/journal/future", label: "Gelecek kaydı", hint: "Önümüzdeki 12 ay", icon: Telescope },
    { to: "/journal/collections", label: "Koleksiyonlar", hint: "Konu listeleri", icon: Library },
  ];

  return (
    <PageShell title="Dizin" subtitle="Defterin içindekiler: aylar, koleksiyonlar ve konular" wide>
      <div className="space-y-4" data-testid="journal-index">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {pages.map((p) => {
            const Icon = p.icon;
            return (
              <Link key={p.to} to={p.to} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 hover:border-primary/40">
                <Icon className="w-5 h-5 text-primary" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{p.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{p.hint}</span>
                </span>
              </Link>
            );
          })}
        </div>

        {!data ? (
          <div className="text-sm text-muted-foreground">Yükleniyor…</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Aylar">
              {data.months.length === 0 ? (
                <Empty>Henüz kayıt yok. Bugün sayfasından ilk kaydını ekle.</Empty>
              ) : (
                <ul className="divide-y divide-border/60" data-testid="index-months">
                  {data.months.map((m) => (
                    <li key={m.month}>
                      <Link to={`/journal/month/${m.month}`} className="flex items-center gap-3 rounded-md px-1 py-2 hover:bg-muted/50">
                        <span className="flex-1 text-sm font-medium">{monthLabel(m.month)}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {m.days} gün · {m.entries} kayıt{m.open > 0 ? ` · ${m.open} açık görev` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <div className="space-y-4">
              <Section title="Koleksiyonlar">
                {data.collections.length === 0 ? (
                  <Empty>Koleksiyon yok.</Empty>
                ) : (
                  <ul className="divide-y divide-border/60" data-testid="index-collections">
                    {data.collections.map((c) => (
                      <li key={c.note_id}>
                        <Link to={`/journal/collections/${c.note_id}`} className="flex items-center gap-2.5 rounded-md px-1 py-2 hover:bg-muted/50">
                          <Library className="w-4 h-4 text-teal-600" />
                          <span className="flex-1 truncate text-sm">{c.title}</span>
                          <span className="text-[11px] text-muted-foreground">{c.items} öğe</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Konular">
                {data.tags.length === 0 ? (
                  <Empty>Notlarda #etiket kullandıkça konular burada listelenir.</Empty>
                ) : (
                  <div className="flex flex-wrap gap-1.5" data-testid="index-tags">
                    {data.tags.map((t) => (
                      <Link
                        key={t.tag}
                        to={`/tag/${encodeURIComponent(t.tag)}`}
                        className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs hover:border-primary/40"
                      >
                        #{t.tag} <span className="text-muted-foreground">{t.count}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
