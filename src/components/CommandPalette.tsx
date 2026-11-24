import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import {
  Search, Feather, FilePlus2, CheckSquare, Sun, LayoutTemplate, Home, Inbox, FileText, Network, Share2, MapPin,
  CalendarRange, Calendar, Kanban, Layers, Settings, Boxes, Clock, X, CornerDownLeft, Sparkles,
} from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { formatApiError } from "@/lib/api";
import { notifyInboxChanged, objectPath, wsApi, type SearchResult } from "@/lib/workspaceApi";
import TypeIcon from "@/components/TypeIcon";

const RECENT_KEY = "inkwell_recent_searches";

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 6);
  } catch {
    return [];
  }
}
function pushRecent(q: string) {
  try {
    const next = [q, ...readRecent().filter((x) => x !== q)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage may be unavailable */
  }
}

const fold = (s: string) => s.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

interface Item {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<any>;
  keywords?: string;
  run: () => void | Promise<void>;
}

export default function CommandPalette() {
  const navigate = useNavigate();
  const { paletteOpen, paletteMode, closePalette, focusCapture, openTemplate, spaces, typeById, templates } = useWorkspace();
  const [q, setQ] = useState("");
  const [mode, setMode] = useState(paletteMode);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    if (paletteOpen) {
      setQ("");
      setResults(null);
      setMode(paletteMode);
      setRecent(readRecent());
    }
  }, [paletteOpen, paletteMode]);

  const query = q.startsWith(">") ? q.slice(1).trim() : q.trim();
  const actionsOnly = q.startsWith(">") || mode === "actions";

  // Debounced server search
  useEffect(() => {
    if (!paletteOpen || actionsOnly || mode === "task" || query.length < 2) {
      setResults(null);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      wsApi
        .search(query, { limit: 12 })
        .then((r) => my === seq.current && setResults(r))
        .catch(() => my === seq.current && setResults(null))
        .finally(() => my === seq.current && setLoading(false));
    }, 160);
    return () => window.clearTimeout(t);
  }, [query, paletteOpen, actionsOnly, mode]);

  const go = (path: string) => () => {
    closePalette();
    navigate(path);
  };

  const actions: Item[] = useMemo(
    () => [
      { id: "capture", label: "Yakala", hint: "C", icon: Feather, keywords: "capture not al düşünce", run: () => { closePalette(); setTimeout(focusCapture, 50); } },
      { id: "ask", label: "Ask Inkwell", hint: "notlarına sor", icon: Sparkles, keywords: "ask soru sor yapay zeka ai", run: go("/ask") },
      { id: "new", label: "Yeni not", icon: FilePlus2, keywords: "create note oluştur", run: go("/new") },
      { id: "task", label: "Hızlı görev", icon: CheckSquare, keywords: "task görev kart todo", run: () => { setMode("task"); setQ(""); } },
      {
        id: "daily", label: "Bugünün notunu aç", icon: Sun, keywords: "daily günlük today",
        run: async () => {
          closePalette();
          try {
            const d = await wsApi.ensureDailyNote();
            navigate(objectPath({ slug: d.slug, note_id: d.note_id }));
          } catch (e) {
            toast.error(formatApiError(e));
          }
        },
      },
      ...templates
        .filter((t) => t.id !== "daily")
        .map((t) => ({
          id: `tpl-${t.id}`,
          label: `Şablon: ${t.name}`,
          icon: LayoutTemplate,
          keywords: `template şablon ${t.description}`,
          run: () => {
            closePalette();
            openTemplate(t.id);
          },
        })),
      { id: "tpl-manage", label: "Şablonları yönet", icon: Settings, keywords: "template şablon ayar", run: go("/settings?tab=templates") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templates]
  );

  const destinations: Item[] = useMemo(
    () => [
      { id: "g-inbox", label: "Gelen kutusu", hint: "G I", icon: Inbox, run: go("/inbox") },
      { id: "g-today", label: "Bugün (ana sayfa)", hint: "G T", icon: Sun, keywords: "home ana sayfa today", run: go("/") },
      { id: "g-notes", label: "Bilgi · Bütün notlar", hint: "G K", icon: FileText, run: go("/all-notes") },
      { id: "g-month", label: "Aylık kayıt", hint: "G M", icon: Calendar, keywords: "defter bullet journal ay monthly", run: go("/journal/month") },
      { id: "g-future", label: "Gelecek kaydı", icon: CalendarRange, keywords: "defter future log gelecek planla", run: go("/journal/future") },
      { id: "g-habits", label: "Alışkanlıklar", icon: CalendarRange, keywords: "defter alışkanlık habit tracker ruh hali mood enerji", run: go("/journal/habits") },
      { id: "g-collections", label: "Koleksiyonlar", icon: Layers, keywords: "defter liste collection", run: go("/journal/collections") },
      { id: "g-journal", label: "Dizin (defter)", icon: FileText, keywords: "defter index içindekiler", run: go("/journal") },
      { id: "g-spaces", label: "Bölümler", hint: "G S", icon: Layers, run: go("/spaces") },
      { id: "g-feed", label: "Günlük akış", icon: Calendar, run: go("/feed") },
      { id: "g-timeline", label: "Zaman çizelgesi", icon: CalendarRange, run: go("/timeline") },
      { id: "g-areas", label: "Alan haritası", icon: Network, run: go("/graph") },
      { id: "g-graph", label: "Ağ görünümü", icon: Share2, run: go("/network") },
      { id: "g-map", label: "Harita", icon: MapPin, run: go("/map") },
      { id: "g-kanban", label: "Kanban", icon: Kanban, run: go("/kanban") },
      { id: "g-types", label: "Nesne tipleri", icon: Boxes, run: go("/settings?tab=note_types") },
      { id: "g-ai", label: "Yapay zeka ayarları", icon: Sparkles, run: go("/settings?tab=ai") },
      { id: "g-settings", label: "Ayarlar", icon: Settings, run: go("/settings") },
      ...spaces.filter((s) => !s.archived).map((s) => ({ id: `space-${s.space_id}`, label: `Bölüm: ${s.name}`, icon: Layers, run: go(`/spaces/${s.space_id}`) })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaces]
  );

  const match = (i: Item) => !query || fold(`${i.label} ${i.keywords || ""}`).includes(fold(query));
  const shownActions = actions.filter(match);
  const shownDest = actionsOnly || mode === "all" ? destinations.filter(match) : mode === "search" && !query ? [] : destinations.filter(match);

  async function createTask() {
    const title = query;
    if (!title) return;
    closePalette();
    try {
      const r = await wsApi.capture({ text: title, mode: "direct", type_id: "type_card", source: "palette" });
      notifyInboxChanged();
      toast.success("Görev oluşturuldu", { action: { label: "Aç", onClick: () => navigate(objectPath({ slug: r.slug, note_id: r.object_id })) } });
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  const itemCls =
    "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:opacity-50";
  const groupCls = "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground";

  return (
    <DialogPrimitive.Root open={paletteOpen} onOpenChange={(o) => !o && closePalette()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-[61] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl overflow-hidden"
          aria-describedby={undefined}
          data-testid="command-palette"
        >
          <DialogPrimitive.Title className="sr-only">Komut paleti</DialogPrimitive.Title>
          <Command shouldFilter={false} loop>
            <div className="flex items-center gap-2 border-b border-border px-3">
              {mode === "task" ? <CheckSquare className="w-4 h-4 text-primary" /> : <Search className="w-4 h-4 text-muted-foreground" />}
              <Command.Input
                value={q}
                onValueChange={setQ}
                autoFocus
                placeholder={
                  mode === "task" ? "Görev başlığı yaz, Enter ile oluştur" : mode === "search" ? "Nesnelerde ara…" : "Ara, git veya bir komut çalıştır (> yalnız komutlar)"
                }
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                data-testid="palette-input"
              />
              {mode !== "all" && (
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" onClick={() => setMode("all")}>
                  <X className="w-3 h-3" /> {mode === "task" ? "Görev modu" : "Arama modu"}
                </button>
              )}
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
              {mode === "task" ? (
                <Command.Group heading="Görev" className={groupCls}>
                  <Command.Item value="create-task" onSelect={createTask} disabled={!query} className={itemCls}>
                    <CornerDownLeft className="w-4 h-4" />
                    {query ? <>“{query}” görevini oluştur</> : "Görev başlığı yaz"}
                    <span className="ml-auto text-[11px] text-muted-foreground">Kanban: Yapılacak</span>
                  </Command.Item>
                </Command.Group>
              ) : (
                <>
                  {!query && mode === "search" && recent.length > 0 && (
                    <Command.Group heading="Son aramalar" className={groupCls}>
                      {recent.map((r) => (
                        <Command.Item key={r} value={`recent-${r}`} onSelect={() => setQ(r)} className={itemCls}>
                          <Clock className="w-4 h-4 text-muted-foreground" /> {r}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                  {results && results.objects.length > 0 && (
                    <Command.Group heading="Nesneler" className={groupCls}>
                      {results.objects.map((o) => {
                        const t = typeById(o.type_id);
                        return (
                          <Command.Item
                            key={o.id}
                            value={`obj-${o.id}`}
                            onSelect={() => {
                              pushRecent(query);
                              closePalette();
                              navigate(objectPath(o));
                            }}
                            className={`${itemCls} items-start`}
                          >
                            <span className="mt-0.5"><TypeIcon icon={t?.icon} color={t?.color} className="w-4 h-4" /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{o.title}</span>
                              <span className="block truncate text-xs text-muted-foreground">{o.snippet}</span>
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">{o.type_name}</span>
                          </Command.Item>
                        );
                      })}
                    </Command.Group>
                  )}
                  {results && results.inbox.length > 0 && (
                    <Command.Group heading="Gelen kutusu" className={groupCls}>
                      {results.inbox.map((c) => (
                        <Command.Item key={c.capture_id} value={`cap-${c.capture_id}`} onSelect={go(`/inbox?focus=${c.capture_id}`)} className={itemCls}>
                          <Inbox className="w-4 h-4 text-muted-foreground" /> <span className="truncate">{c.title}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                  {results && results.objects.length === 0 && results.inbox.length === 0 && !loading && (
                    <div className="px-3 py-3 text-sm text-muted-foreground">“{query}” için sonuç yok.</div>
                  )}
                  {loading && !results && <div className="px-3 py-3 text-sm text-muted-foreground">Aranıyor…</div>}
                  {query.length >= 3 && mode !== "actions" && !actionsOnly && (
                    <Command.Group heading="Yapay zeka" className={groupCls}>
                      <Command.Item value="ask-inkwell" onSelect={() => { pushRecent(query); closePalette(); navigate(`/ask?q=${encodeURIComponent(query)}`); }} className={itemCls} data-testid="palette-ask">
                        <Sparkles className="w-4 h-4 text-primary" /> <span className="truncate">Ask Inkwell'e sor: “{query}”</span>
                      </Command.Item>
                    </Command.Group>
                  )}
                  {mode !== "search" && shownActions.length > 0 && (
                    <Command.Group heading="Eylemler" className={groupCls}>
                      {shownActions.map((a) => (
                        <Command.Item key={a.id} value={a.id} onSelect={() => a.run()} className={itemCls}>
                          <a.icon className="w-4 h-4 text-muted-foreground" /> {a.label}
                          {a.hint && <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">{a.hint}</kbd>}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                  {!actionsOnly && shownDest.length > 0 && (
                    <Command.Group heading="Git" className={groupCls}>
                      {shownDest.map((a) => (
                        <Command.Item key={a.id} value={a.id} onSelect={() => a.run()} className={itemCls}>
                          <a.icon className="w-4 h-4 text-muted-foreground" /> {a.label}
                          {a.hint && <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">{a.hint}</kbd>}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                </>
              )}
            </Command.List>
            <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
              <span>↑↓ seç</span>
              <span>Enter aç</span>
              <span>Esc kapat</span>
              <span className="ml-auto">Ctrl/⌘ K</span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
