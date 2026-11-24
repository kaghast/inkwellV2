import React, { useState } from "react";
import { toast } from "sonner";
import { Circle, FilePlus2, Feather, Loader2, Minus, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatApiError } from "@/lib/api";
import { parseLogEntry, type BulletKind } from "@/lib/tasks";

export type QuickKind = BulletKind | "object";

const KINDS: Array<{ id: QuickKind; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "task", label: "Görev", hint: ". ya da t", icon: Square },
  { id: "event", label: "Etkinlik", hint: "o", icon: Circle },
  { id: "note", label: "Not", hint: "-", icon: Minus },
  { id: "object", label: "Ayrı not", hint: "", icon: FilePlus2 },
];

/**
 * Rapid-log input: one line becomes a task, event or note. A typed prefix
 * (". ", "o ", "- ") wins over the selected kind, as on paper; "!" and "?"
 * add a signifier. The field clears at once so the next entry can be typed
 * while this one saves, and comes back if saving fails.
 */
export default function QuickLog({
  onSubmit,
  kinds = ["task", "event", "note"],
  placeholder = "Hızlı kayıt: görev, etkinlik ya da not… (! öncelikli, ? araştır)",
  objectPlaceholder = "Bu güne bağlı ayrı bir not yaz…",
  testId = "quick-log",
  compact = false,
}: {
  onSubmit: (text: string, kind: QuickKind) => Promise<void>;
  kinds?: QuickKind[];
  placeholder?: string;
  objectPlaceholder?: string;
  testId?: string;
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<QuickKind>(kinds[0]);
  const [busy, setBusy] = useState(false);
  const typed = kind === "object" ? null : parseLogEntry(text, kind);
  const shownKind = typed && text.trim() ? typed.kind : kind;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = text;
    if (!value.trim() || busy) return;
    if (typed && !typed.text) return;
    setText("");
    setBusy(true);
    try {
      await onSubmit(value, kind);
    } catch (err) {
      setText((cur) => (cur ? cur : value));
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} data-testid={testId}>
      {kinds.length > 1 && (
        <div className={`flex flex-wrap items-center gap-1 ${compact ? "mb-1" : "mb-2"}`} role="radiogroup" aria-label="Kayıt türü">
          {KINDS.filter((k) => kinds.includes(k.id)).map((k) => {
            const active = shownKind === k.id && (k.id !== "object" || kind === "object");
            const Icon = k.icon;
            return (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setKind(k.id)}
                title={k.hint ? `Kısayol: satırın başına "${k.hint}"` : "Ayrı bir not oluşturur"}
                className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors ${active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"}`}
                data-testid={`log-kind-${k.id}`}
              >
                <Icon className="w-3.5 h-3.5" /> {k.label}
              </button>
            );
          })}
          {typed?.signifier && (
            <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{typed.signifier === "priority" ? "! öncelikli" : "? araştırılacak"}</span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Feather className="w-4 h-4 shrink-0 text-primary" aria-hidden />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "object" ? objectPlaceholder : placeholder}
          className="h-8 flex-1 min-w-0 bg-transparent text-sm outline-none"
          aria-label="Kayıt ekle"
          data-testid={`${testId}-input`}
        />
        <Button type="submit" size="sm" disabled={busy || !text.trim() || (typed !== null && !typed.text)}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Ekle"}
        </Button>
      </div>
    </form>
  );
}
