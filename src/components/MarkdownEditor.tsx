import React, { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";
import type { Tag, Person } from "@/types";
import { filterBlockOptions, BlockOption } from "@/lib/blockOptions";
import LinkDialog from "@/components/LinkDialog";
import ReminderDialog from "@/components/ReminderDialog";
import ImageUploadDialog from "@/components/ImageUploadDialog";
import TimeSlotDialog from "@/components/TimeSlotDialog";
import { uploadImage } from "@/lib/uploads";
import { toast } from "sonner";
import {
  Image as ImageIcon,
  BellRing,
  CheckSquare,
  Link as LinkIcon,
  Heading,
  Quote,
  FileText,
  Network,
  CalendarClock,
  Maximize2,
  Minimize2,
  Sparkles,
  Save,
} from "lucide-react";

type SuggestionItem = Tag | Person;

export interface NoteSuggestionItem {
  note_id: string;
  title: string;
  slug?: string;
  date?: string;
  snippet?: string;
}

interface TokenPopup {
  kind: "tag" | "person";
  items: SuggestionItem[];
  start: number;
  query: string;
  selected: number;
}

interface WikilinkPopup {
  kind: "wikilink";
  items: NoteSuggestionItem[];
  start: number;
  query: string;
  selected: number;
}

interface SlashPopup {
  kind: "slash";
  start: number; // index of '/'
  query: string;
  options: BlockOption[];
  selected: number;
}

type Popup = TokenPopup | WikilinkPopup | SlashPopup;

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
  onCancel?: () => void;
  locations?: any[];
  onLocationsChanged?: () => void;
  title?: string;
  onTitleChange?: (t: string) => void;
}

export default function MarkdownEditor({
  value,
  onChange,
  placeholder,
  autoFocus,
  onSubmit,
  onCancel,
  title,
  onTitleChange,
}: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [timeSlotOpen, setTimeSlotOpen] = useState(false);
  const [fullFocus, setFullFocus] = useState(false);
  const [pendingBlock, setPendingBlock] = useState<null | { start: number; end: number }>(null);

  async function fetchSuggestions(type: "tag" | "person", query: string): Promise<SuggestionItem[]> {
    const url = type === "tag" ? "/tags" : "/people";
    const { data } = await api.get<SuggestionItem[]>(url, { params: { q: query } });
    return Array.isArray(data) ? data : [];
  }

  async function fetchNoteSuggestions(query: string): Promise<NoteSuggestionItem[]> {
    try {
      const { data } = await api.get<any[]>("/notes", { params: { q: query || undefined } });
      const notes = Array.isArray(data) ? data : [];
      return notes.map((n) => ({
        note_id: n.note_id,
        title: n.title || "İsimsiz Not",
        slug: n.slug,
        date: n.date,
        snippet: (n.content || "").slice(0, 60).replace(/\n/g, " "),
      }));
    } catch {
      return [];
    }
  }

  // Return token (#tag, @person), slash-command (/), or wikilink ([[]) context
  function getActiveContext(
    text: string,
    caret: number
  ): { type: "tag" | "person" | "slash" | "wikilink"; start: number; query: string } | null {
    let i = caret - 1;
    const chars: string[] = [];
    while (i >= 0) {
      const ch = text[i];
      if (ch === "\n" || ch === "\r") break;

      // Check [[ wikilink
      if (ch === "[" && i > 0 && text[i - 1] === "[") {
        const query = chars.slice().reverse().join("");
        if (!query.includes("]")) {
          return { type: "wikilink", start: i - 1, query };
        }
      }

      if (ch === " " || ch === "\t") {
        // Space stops #tag, @person, /slash, but continues inside [[ wikilink
      } else {
        if (ch === "#" || ch === "@") {
          const query = chars.slice().reverse().join("");
          const prev = i > 0 ? text[i - 1] : "\n";
          const isLineStart = prev === "\n" || prev === "\r" || i === 0;

          if (!(ch === "#" && isLineStart && query.length === 0)) {
            return { type: ch === "#" ? "tag" : "person", start: i, query };
          }
        }
        if (ch === "/") {
          const prev = i > 0 ? text[i - 1] : "\n";
          if (prev === "\n" || prev === " " || prev === "\t" || i === 0) {
            return { type: "slash", start: i, query: chars.slice().reverse().join("") };
          }
        }
      }

      chars.push(ch);
      i--;
    }
    return null;
  }

  async function onChangeTextarea(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    onChange(text);
    const el = e.target;
    const caret = el.selectionStart;
    const ctx = getActiveContext(text, caret);
    if (!ctx) {
      setPopup(null);
      return;
    }
    if (ctx.type === "slash") {
      setPopup({
        kind: "slash",
        start: ctx.start,
        query: ctx.query,
        options: filterBlockOptions(ctx.query),
        selected: 0,
      });
      return;
    }
    if (ctx.type === "wikilink") {
      const items = await fetchNoteSuggestions(ctx.query);
      setPopup({ kind: "wikilink", items, start: ctx.start, query: ctx.query, selected: 0 });
      return;
    }
    const items = await fetchSuggestions(ctx.type, ctx.query);
    setPopup({ kind: ctx.type, items, start: ctx.start, query: ctx.query, selected: 0 });
  }

  function replaceRange(before: number, after: number, insert: string, extraSelectOffset?: number) {
    if (!ref.current) return;
    const el = ref.current;
    const text = el.value;
    const newText = text.slice(0, before) + insert + text.slice(after);
    onChange(newText);
    requestAnimationFrame(() => {
      el.focus();
      const pos = before + (extraSelectOffset ?? insert.length);
      el.setSelectionRange(pos, pos);
    });
  }

  function applyTokenSuggestion(name: string) {
    if (!popup || popup.kind === "slash" || popup.kind === "wikilink" || !ref.current) return;
    const el = ref.current;
    const caret = el.selectionStart;
    const symbol = popup.kind === "tag" ? "#" : "@";
    const inserted = `${symbol}${name} `;
    replaceRange(popup.start, caret, inserted);
    setPopup(null);
  }

  function applyWikilinkSuggestion(item: NoteSuggestionItem) {
    if (!popup || popup.kind !== "wikilink" || !ref.current) return;
    const el = ref.current;
    const caret = el.selectionStart;
    const insertedTitle = item.title.trim() || item.slug || "Not";
    const inserted = `[[${insertedTitle}]] `;
    replaceRange(popup.start, caret, inserted);
    setPopup(null);
  }

  function applyBlockOption(opt: BlockOption) {
    if (!popup || popup.kind !== "slash" || !ref.current) return;
    const el = ref.current;
    const caret = el.selectionStart;
    const from = popup.start;

    const insertPlain = (tpl: string, extraSelect?: number) => {
      const before = el.value.slice(0, from);
      const needsNl = before.length > 0 && !before.endsWith("\n") && !before.endsWith("\n\n");
      const prefix = needsNl ? "\n" : "";
      replaceRange(from, caret, prefix + tpl, prefix.length + (extraSelect ?? tpl.length));
    };

    switch (opt.type) {
      case "paragraph":
        insertPlain("");
        break;
      case "heading1":
        insertPlain("# ");
        break;
      case "heading2":
        insertPlain("## ");
        break;
      case "heading3":
        insertPlain("### ");
        break;
      case "heading4":
        insertPlain("#### ");
        break;
      case "heading5":
        insertPlain("##### ");
        break;
      case "heading6":
        insertPlain("###### ");
        break;
      case "task":
        insertPlain("- [ ] ");
        break;
      case "quote":
        insertPlain("> ");
        break;
      case "divider":
        insertPlain("---\n\n");
        break;
      case "link":
      case "youtube":
      case "gmap":
        setPendingBlock({ start: from, end: caret });
        setPopup(null);
        setLinkOpen(true);
        return;
      case "image":
        setPendingBlock({ start: from, end: caret });
        setPopup(null);
        setImageOpen(true);
        return;
      case "reminder":
        setPendingBlock({ start: from, end: caret });
        setPopup(null);
        setReminderOpen(true);
        return;
      case "timeslot":
        setPendingBlock({ start: from, end: caret });
        setPopup(null);
        setTimeSlotOpen(true);
        return;
    }
    setPopup(null);
  }

  // Handle Clipboard Paste (detect and auto-upload image)
  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData.items;
    let imageItem: DataTransferItem | null = null;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        imageItem = items[i];
        break;
      }
    }

    if (!imageItem) return; // normal text paste

    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;

    const el = ref.current;
    const caret = el ? el.selectionStart : value.length;

    try {
      toast.loading("Görsel panodan yapıştırılıyor ve yükleniyor…", { id: "paste-upl" });
      const res = await uploadImage(file);
      toast.success("Görsel yapıştırıldı ve eklendi", { id: "paste-upl" });

      const before = value.slice(0, caret);
      const needsNl = before.length > 0 && !before.endsWith("\n");
      const prefix = needsNl ? "\n" : "";
      const md = `${prefix}![Görsel | 400w](${res.url})\n`;

      replaceRange(caret, caret, md);
    } catch (err) {
      toast.error("Görsel yüklenirken bir hata oluştu", { id: "paste-upl" });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (popup) {
      const listLen = popup.kind === "slash" ? popup.options.length : popup.items.length;
      if (listLen > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setPopup({ ...popup, selected: (popup.selected + 1) % listLen } as Popup);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setPopup({ ...popup, selected: (popup.selected - 1 + listLen) % listLen } as Popup);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          if (popup.kind === "slash") {
            applyBlockOption(popup.options[popup.selected]);
          } else if (popup.kind === "wikilink") {
            applyWikilinkSuggestion(popup.items[popup.selected] as NoteSuggestionItem);
          } else {
            applyTokenSuggestion((popup.items[popup.selected] as any).name);
          }
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPopup(null);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
    if (e.key === "Escape" && !popup) {
      if (fullFocus) {
        e.preventDefault();
        setFullFocus(false);
        return;
      }
      if (onCancel) {
        e.preventDefault();
        onCancel();
      }
    }
  }

  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
  const charCount = value.length;

  function onImageConfirm(markdown: string) {
    const el = ref.current;
    const caret = el ? el.selectionStart : value.length;
    const from = pendingBlock ? pendingBlock.start : caret;
    const to = pendingBlock ? pendingBlock.end : caret;

    const before = value.slice(0, from);
    const needsNl = before.length > 0 && !before.endsWith("\n");
    const prefix = needsNl ? "\n" : "";
    replaceRange(from, to, prefix + markdown);
    setPendingBlock(null);
  }

  function onLinkConfirm(title: string, url: string) {
    const el = ref.current;
    const caret = el ? el.selectionStart : value.length;
    const from = pendingBlock ? pendingBlock.start : caret;
    const to = pendingBlock ? pendingBlock.end : caret;

    const before = value.slice(0, from);
    const needsNl = before.length > 0 && !before.endsWith("\n");
    const prefix = needsNl ? "\n" : "";
    const md = `[${title}](${url})`;
    replaceRange(from, to, prefix + md + "\n");
    setPendingBlock(null);
  }

  function onReminderConfirm(iso: string, text: string) {
    const el = ref.current;
    const caret = el ? el.selectionStart : value.length;
    const from = pendingBlock ? pendingBlock.start : caret;
    const to = pendingBlock ? pendingBlock.end : caret;

    const before = value.slice(0, from);
    const needsNl = before.length > 0 && !before.endsWith("\n");
    const prefix = needsNl ? "\n" : "";
    const md = "```reminder\n" + iso + "\n" + text + "\n```";
    replaceRange(from, to, prefix + md + "\n");
    setPendingBlock(null);
  }

  function onTimeSlotConfirm(markdown: string) {
    const el = ref.current;
    const caret = el ? el.selectionStart : value.length;
    const from = pendingBlock ? pendingBlock.start : caret;
    const to = pendingBlock ? pendingBlock.end : caret;

    const before = value.slice(0, from);
    const needsNl = before.length > 0 && !before.endsWith("\n");
    const prefix = needsNl ? "\n" : "";
    replaceRange(from, to, prefix + markdown + "\n");
    setPendingBlock(null);
  }

  function insertQuickBlock(kind: "image" | "reminder" | "timeslot" | "task" | "link" | "heading" | "quote" | "wikilink") {
    const el = ref.current;
    const caret = el ? el.selectionStart : value.length;
    const before = value.slice(0, caret);
    const needsNl = before.length > 0 && !before.endsWith("\n");
    const prefix = needsNl ? "\n" : "";

    if (kind === "wikilink") {
      replaceRange(caret, caret, prefix + "[[");
      return;
    }

    setPendingBlock({ start: caret, end: caret });

    if (kind === "image") setImageOpen(true);
    else if (kind === "reminder") setReminderOpen(true);
    else if (kind === "timeslot") setTimeSlotOpen(true);
    else if (kind === "link") setLinkOpen(true);
    else if (kind === "task") {
      replaceRange(caret, caret, prefix + "- [ ] ");
      setPendingBlock(null);
    } else if (kind === "heading") {
      replaceRange(caret, caret, prefix + "## ");
      setPendingBlock(null);
    } else if (kind === "quote") {
      replaceRange(caret, caret, prefix + "> ");
      setPendingBlock(null);
    }
  }

  return (
    <div className="relative flex flex-col">
      <Textarea
        ref={ref}
        data-testid="note-editor-input"
        value={value}
        onChange={onChangeTextarea}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        autoFocus={autoFocus}
        placeholder={placeholder || "Yazın… ‘/’ ile blok tipi seçebilir veya resmi yapıştırabilirsiniz"}
        className="min-h-[160px] resize-y border-border bg-card focus-visible:ring-1 focus-visible:ring-foreground/30 font-mono text-sm leading-relaxed rounded-t-md rounded-b-none"
      />

      {/* Editor Quick Action Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40 border-x border-b border-border rounded-b-md text-xs text-muted-foreground select-none">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => insertQuickBlock("wikilink")}
            data-testid="toolbar-btn-wikilink"
            className="p-1 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
            title="Not Bağlantısı Ekle"
          >
            <Network className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">[[</span>
          </button>

          <button
            type="button"
            onClick={() => insertQuickBlock("timeslot")}
            data-testid="toolbar-btn-timeslot"
            className="p-1 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 text-primary cursor-pointer"
            title="Zaman Bloğu (Time Slot) Ekle"
          >
            <CalendarClock className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">Zaman Bloğu</span>
          </button>

          <button
            type="button"
            onClick={() => insertQuickBlock("image")}
            data-testid="toolbar-btn-image"
            className="p-1 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
            title="Resim Yükle (veya panodan yapıştırın)"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">Resim</span>
          </button>

          <button
            type="button"
            onClick={() => insertQuickBlock("reminder")}
            data-testid="toolbar-btn-reminder"
            className="p-1 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
            title="Hatırlatma Ekle"
          >
            <BellRing className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">Hatırlatma</span>
          </button>

          <button
            type="button"
            onClick={() => insertQuickBlock("task")}
            data-testid="toolbar-btn-task"
            className="p-1 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
            title="Görev Ekle"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">Görev</span>
          </button>

          <button
            type="button"
            onClick={() => insertQuickBlock("link")}
            data-testid="toolbar-btn-link"
            className="p-1 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
            title="Bağlantı Ekle"
          >
            <LinkIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">Link</span>
          </button>

          <button
            type="button"
            onClick={() => insertQuickBlock("heading")}
            data-testid="toolbar-btn-heading"
            className="p-1 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
            title="Başlık Ekle"
          >
            <Heading className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">Başlık</span>
          </button>

          <button
            type="button"
            onClick={() => insertQuickBlock("quote")}
            data-testid="toolbar-btn-quote"
            className="p-1 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
            title="Alıntı Ekle"
          >
            <Quote className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-[10px] text-muted-foreground/70 hidden md:block">
            Ctrl+V ile resim yapıştırın
          </div>

          {/* Full Focus Trigger Button */}
          <button
            type="button"
            onClick={() => setFullFocus(true)}
            data-testid="toolbar-btn-full-focus"
            className="p-1 px-2 rounded-sm bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25 transition-all flex items-center gap-1.5 font-medium cursor-pointer shadow-2xs"
            title="Tam Odaklanma Moduna Geç (Full Focus)"
          >
            <Maximize2 className="w-3 h-3" />
            <span className="text-[11px] font-semibold">Full Focus</span>
          </button>
        </div>
      </div>

      {/* Slash / token / wikilink popup */}
      {popup && (popup.kind === "slash" ? popup.options.length > 0 : popup.items.length > 0) && (
        <div
          className="absolute z-50 min-w-[240px] max-w-[320px] rounded-md border border-border bg-popover/98 backdrop-blur-xl shadow-lg"
          style={{ top: "calc(100% + 4px)", left: 8 }}
          data-testid={popup.kind === "slash" ? "block-picker-popup" : popup.kind === "wikilink" ? "wikilink-popup" : "autocomplete-popup"}
        >
          <div className="px-3 py-1.5 text-[10px] tracking-[0.2em] uppercase text-muted-foreground border-b border-border">
            {popup.kind === "slash" ? "Blok tipi" : popup.kind === "wikilink" ? "İlişkili notlar" : popup.kind === "tag" ? "Etiketler" : "Kişiler"}
          </div>
          <ul className="max-h-72 overflow-auto py-1">
            {popup.kind === "slash"
              ? popup.options.slice(0, 10).map((opt, idx) => {
                  const Icon = opt.icon;
                  return (
                    <li
                      key={opt.type}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyBlockOption(opt);
                      }}
                      className={`px-3 py-1.5 cursor-pointer text-sm flex items-center gap-2.5 ${
                        idx === popup.selected ? "bg-accent" : ""
                      }`}
                      data-testid={`block-picker-item-${opt.type}`}
                    >
                      <Icon className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
                      <div className="flex-1 min-w-0">
                        <div className="font-serif leading-none">{opt.label}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{opt.hint}</div>
                      </div>
                    </li>
                  );
                })
              : popup.kind === "wikilink"
              ? (popup.items as NoteSuggestionItem[]).slice(0, 8).map((it, idx) => (
                  <li
                    key={it.note_id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyWikilinkSuggestion(it);
                    }}
                    className={`px-3 py-1.5 cursor-pointer text-sm flex items-center gap-2 ${
                      idx === popup.selected ? "bg-accent" : ""
                    }`}
                    data-testid={`wikilink-item-${idx}`}
                  >
                    <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                    {it.title}
                  </li>
                ))
              : (popup.items as SuggestionItem[]).slice(0, 8).map((it, idx) => (
                  <li
                    key={(it as any).tag_id || (it as any).person_id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyTokenSuggestion(it.name);
                    }}
                    className={`px-3 py-1.5 cursor-pointer text-sm font-mono flex items-center gap-2 ${
                      idx === popup.selected ? "bg-accent" : ""
                    }`}
                    data-testid={`autocomplete-item-${idx}`}
                  >
                    <span
                      className={
                        popup.kind === "tag"
                          ? "text-[hsl(var(--accent-tag))]"
                          : "text-[hsl(var(--accent-mention))]"
                      }
                    >
                      {popup.kind === "tag" ? "#" : "@"}
                    </span>
                    {it.name}
                  </li>
                ))}
          </ul>
        </div>
      )}

      {/* Full Focus Overlay Mode */}
      {fullFocus && (
        <div
          className="fixed inset-0 z-[100] bg-background flex flex-col p-4 sm:p-8 md:p-12 animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
          data-testid="full-focus-overlay"
        >
          {/* Full Focus Top Header */}
          <div className="max-w-4xl w-full mx-auto flex items-center justify-between pb-3 mb-4 border-b border-border/50 select-none shrink-0">
            <div className="flex items-center gap-2 sm:gap-3 text-xs font-mono text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20 shadow-2xs">
                <Sparkles className="w-3.5 h-3.5" /> Full Focus Modu
              </span>
              <span className="hidden sm:inline opacity-80">
                • {wordCount} kelime, {charCount} karakter
              </span>
            </div>

            <div className="flex items-center gap-2">
              {onSubmit && (
                <Button
                  size="sm"
                  onClick={() => {
                    onSubmit();
                    setFullFocus(false);
                  }}
                  className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer shadow-xs"
                  data-testid="full-focus-save-btn"
                >
                  <Save className="w-3.5 h-3.5 mr-1" /> Kaydet
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setFullFocus(false)}
                className="h-8 text-xs cursor-pointer"
                title="Odaktan Çık (Esc)"
                data-testid="exit-full-focus-btn"
              >
                <Minimize2 className="w-3.5 h-3.5 mr-1.5" /> Odaktan Çık
              </Button>
            </div>
          </div>

          {/* Full Focus Canvas */}
          <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col min-h-0">
            {title !== undefined && onTitleChange && (
              <Input
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="Not Başlığı (opsiyonel)..."
                className="text-2xl sm:text-4xl font-serif border-0 px-0 focus-visible:ring-0 shadow-none bg-transparent mb-3 placeholder:text-muted-foreground/40 font-bold"
                data-testid="full-focus-title-input"
              />
            )}

            <Textarea
              value={value}
              onChange={onChangeTextarea}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              autoFocus
              placeholder={placeholder || "Yazın… ‘/’ ile blok tipi seçebilir veya resmi yapıştırabilirsiniz"}
              className="flex-1 w-full resize-none border-0 bg-transparent focus-visible:ring-0 font-mono text-base sm:text-lg leading-relaxed p-0 shadow-none outline-none overflow-y-auto"
              data-testid="full-focus-textarea"
            />

            {/* Floating Quick Action Bar */}
            <div className="flex items-center justify-between px-3 py-2 bg-muted/60 border border-border/80 rounded-xl text-xs text-muted-foreground select-none mt-3 shrink-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => insertQuickBlock("wikilink")}
                  className="p-1 px-2 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Network className="w-3.5 h-3.5" />
                  <span>[[</span>
                </button>
                <button
                  type="button"
                  onClick={() => insertQuickBlock("timeslot")}
                  className="p-1 px-2 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 text-primary cursor-pointer"
                >
                  <CalendarClock className="w-3.5 h-3.5" />
                  <span>Zaman Bloğu</span>
                </button>
                <button
                  type="button"
                  onClick={() => insertQuickBlock("image")}
                  className="p-1 px-2 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Resim</span>
                </button>
                <button
                  type="button"
                  onClick={() => insertQuickBlock("reminder")}
                  className="p-1 px-2 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <BellRing className="w-3.5 h-3.5" />
                  <span>Hatırlatma</span>
                </button>
                <button
                  type="button"
                  onClick={() => insertQuickBlock("task")}
                  className="p-1 px-2 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  <span>Görev</span>
                </button>
                <button
                  type="button"
                  onClick={() => insertQuickBlock("link")}
                  className="p-1 px-2 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  <span>Link</span>
                </button>
                <button
                  type="button"
                  onClick={() => insertQuickBlock("heading")}
                  className="p-1 px-2 rounded hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Heading className="w-3.5 h-3.5" />
                  <span>Başlık</span>
                </button>
              </div>

              <div className="text-[11px] text-muted-foreground font-mono hidden sm:block">
                Esc: Odaktan Çık • Ctrl+Enter: Kaydet
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <LinkDialog open={linkOpen} onOpenChange={setLinkOpen} onConfirm={onLinkConfirm} />
      <ReminderDialog open={reminderOpen} onOpenChange={setReminderOpen} onConfirm={onReminderConfirm} />
      <ImageUploadDialog open={imageOpen} onOpenChange={setImageOpen} onConfirm={onImageConfirm} />
      <TimeSlotDialog open={timeSlotOpen} onOpenChange={setTimeSlotOpen} onConfirm={onTimeSlotConfirm} />
    </div>
  );
}
