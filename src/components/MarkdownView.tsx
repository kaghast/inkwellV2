import React, { ReactNode, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router-dom";
import { useFilter } from "@/contexts/FilterContext";
import { BellRing, MapPin, Youtube, Check, Loader2, Maximize2, X, Clock, Calendar } from "lucide-react";
import { isGmap, isYoutube, extractYoutubeId } from "@/lib/blocks";
import { highlightText } from "@/lib/highlight";
import DrawingViewer from "@/components/drawing/DrawingViewer";
import TimeSlotCard from "@/components/TimeSlotCard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TAG_RE = /(?<!\S)#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)(?!\S)/gu;
const MEN_RE = /(?<!\S)@([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)(?!\S)/gu;
const WIKI_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu;
const URL_RE = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/gu;

function WikiLink({ target, label }: { target: string; label?: string }) {
  const displayText = label || target;
  const encoded = encodeURIComponent(target.trim());
  return (
    <Link
      to={`/note/${encoded}`}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-primary/10 hover:bg-primary/20 text-primary font-medium text-[0.92em] border border-primary/25 transition-all no-underline align-baseline cursor-pointer break-all [overflow-wrap:anywhere]"
      title={`İlişkili Not: ${displayText}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="opacity-60 text-[0.8em]">[[</span>
      <span className="underline decoration-primary/40 underline-offset-2">{displayText}</span>
      <span className="opacity-60 text-[0.8em]">]]</span>
    </Link>
  );
}

function TagLink({ name }: { name: string }) {
  const { tryAddFilter } = useFilter();
  return (
    <Link
      to={`/tag/${encodeURIComponent(name)}`}
      className="inline-tag"
      onClick={(e) => {
        if (tryAddFilter("tag", name, e)) e.preventDefault();
      }}
    >
      #{name}
    </Link>
  );
}

function MentionLink({ name }: { name: string }) {
  const { tryAddFilter } = useFilter();
  return (
    <Link
      to={`/person/${encodeURIComponent(name)}`}
      className="inline-mention"
      onClick={(e) => {
        if (tryAddFilter("person", name, e)) e.preventDefault();
      }}
    >
      @{name}
    </Link>
  );
}

function transformChildren(children: ReactNode, highlight?: string): ReactNode[] {
  const arr = Array.isArray(children) ? children : [children];
  const out: ReactNode[] = [];
  arr.forEach((child, idx) => {
    if (typeof child !== "string") {
      out.push(child);
      return;
    }
    let pieces: ReactNode[] = [child];

    // 1. [[Wiki-Links]]
    pieces = pieces.flatMap((p, i) => {
      if (typeof p !== "string") return [p];
      const parts: ReactNode[] = [];
      let last = 0;
      const re = new RegExp(WIKI_RE.source, "gu");
      let m: RegExpExecArray | null;
      while ((m = re.exec(p)) !== null) {
        if (m.index > last) parts.push(p.slice(last, m.index));
        const target = m[1].trim();
        const label = m[2] ? m[2].trim() : target;
        parts.push(<WikiLink key={`w-${idx}-${i}-${m.index}`} target={target} label={label} />);
        last = m.index + m[0].length;
      }
      if (last < p.length) parts.push(p.slice(last));
      return parts;
    });

    // 2. #Tags
    pieces = pieces.flatMap((p, i) => {
      if (typeof p !== "string") return [p];
      const parts: ReactNode[] = [];
      let last = 0;
      const re = new RegExp(TAG_RE.source, "gu");
      let m: RegExpExecArray | null;
      while ((m = re.exec(p)) !== null) {
        if (m.index > last) parts.push(p.slice(last, m.index));
        const tagName = m[1].toLowerCase();
        parts.push(<TagLink key={`t-${idx}-${i}-${m.index}`} name={tagName} />);
        last = m.index + m[0].length;
      }
      if (last < p.length) parts.push(p.slice(last));
      return parts;
    });

    // 3. @Mentions
    pieces = pieces.flatMap((p, i) => {
      if (typeof p !== "string") return [p];
      const parts: ReactNode[] = [];
      let last = 0;
      const re = new RegExp(MEN_RE.source, "gu");
      let m: RegExpExecArray | null;
      while ((m = re.exec(p)) !== null) {
        if (m.index > last) parts.push(p.slice(last, m.index));
        const name = m[1].toLowerCase();
        parts.push(<MentionLink key={`m-${idx}-${i}-${m.index}`} name={name} />);
        last = m.index + m[0].length;
      }
      if (last < p.length) parts.push(p.slice(last));
      return parts;
    });

    // 4. Raw http/https URLs (Format plain links)
    pieces = pieces.flatMap((p, i) => {
      if (typeof p !== "string") return [p];
      const parts: ReactNode[] = [];
      let last = 0;
      const re = new RegExp(URL_RE.source, "gu");
      let m: RegExpExecArray | null;
      while ((m = re.exec(p)) !== null) {
        if (m.index > last) parts.push(p.slice(last, m.index));
        const rawUrl = m[1];
        parts.push(
          <a
            key={`u-${idx}-${i}-${m.index}`}
            href={rawUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline font-medium break-all [overflow-wrap:anywhere]"
            onClick={(e) => e.stopPropagation()}
          >
            {rawUrl}
          </a>
        );
        last = m.index + m[0].length;
      }
      if (last < p.length) parts.push(p.slice(last));
      return parts;
    });

    // 5. Highlight query
    if (highlight && highlight.trim()) {
      pieces = pieces.flatMap((p, i) => {
        if (typeof p !== "string") return [p];
        return highlightText(p, highlight, `hl-${idx}-${i}`);
      });
    }
    out.push(...pieces);
  });
  return out;
}

// -------- Special embeds --------

function YouTubeEmbed({ url }: { url: string }) {
  const id = extractYoutubeId(url);
  if (!id) return <a href={url} target="_blank" rel="noreferrer">{url}</a>;
  return (
    <div className="my-3 rounded-md overflow-hidden border border-border aspect-video bg-black" data-testid="yt-embed">
      <iframe
        src={`https://www.youtube.com/embed/${id}`}
        title="YouTube video"
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

function GmapEmbed({ url }: { url: string }) {
  const src = `https://maps.google.com/maps?q=${encodeURIComponent(url)}&output=embed`;
  return (
    <div className="my-3 rounded-md overflow-hidden border border-border" data-testid="gmap-embed">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-xs text-muted-foreground">
        <MapPin className="w-3 h-3" strokeWidth={1.5} />
        <a href={url} target="_blank" rel="noreferrer" className="truncate hover:text-foreground">{url}</a>
      </div>
      <iframe src={src} title="Google Map" className="w-full h-64 bg-muted" loading="lazy" />
    </div>
  );
}

function fmtCountdown(msLeft: number): { text: string; status: "past" | "soon" | "future" } {
  if (msLeft <= 0) {
    const pastSec = Math.floor(Math.abs(msLeft) / 1000);
    if (pastSec < 60) return { text: "Az önce doldu", status: "past" };
    const pastMin = Math.floor(pastSec / 60);
    if (pastMin < 60) return { text: `${pastMin} dk önce doldu`, status: "past" };
    const pastHr = Math.floor(pastMin / 60);
    if (pastHr < 24) return { text: `${pastHr} sa önce doldu`, status: "past" };
    const pastDays = Math.floor(pastHr / 24);
    return { text: `${pastDays} gün önce doldu`, status: "past" };
  }

  const s = Math.floor(msLeft / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  const isSoon = msLeft < 30 * 60 * 1000; // less than 30 mins

  let str = "";
  if (d > 0) str = `${d}g ${h}sa ${m}dk`;
  else if (h > 0) str = `${h}sa ${m}dk ${sec}sn`;
  else if (m > 0) str = `${m}dk ${sec}sn`;
  else str = `${sec}sn`;

  return { text: `Kalan: ${str}`, status: isSoon ? "soon" : "future" };
}

function ReminderCard({ iso, text }: { iso: string; text: string }) {
  const target = new Date(iso).getTime();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const msLeft = target - now;
  const { text: countdownText, status } = fmtCountdown(msLeft);
  const dt = new Date(iso);
  const dtLabel = isNaN(dt.getTime())
    ? iso
    : dt.toLocaleString("tr-TR", {
        weekday: "short",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  return (
    <div
      className={`my-3.5 rounded-lg border p-4 transition-all ${
        status === "past"
          ? "border-[hsl(var(--accent-tag))/0.6] bg-[hsl(var(--accent-tag)/0.08)] shadow-2xs"
          : status === "soon"
          ? "border-amber-500/60 bg-amber-500/10 shadow-2xs animate-pulse"
          : "border-border bg-card/80 shadow-2xs"
      }`}
      data-testid="reminder-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
              status === "past"
                ? "bg-[hsl(var(--accent-tag))] text-white"
                : status === "soon"
                ? "bg-amber-500 text-white"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <BellRing className="w-4 h-4" strokeWidth={2} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-sm font-serif font-semibold text-foreground leading-snug break-words">
              {text || "Hatırlatma"}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1.5">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {dtLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Status & Live Countdown Badge */}
        <div className="shrink-0 text-right">
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono font-medium ${
              status === "past"
                ? "bg-[hsl(var(--accent-tag))] text-white font-bold"
                : status === "soon"
                ? "bg-amber-500 text-white font-bold"
                : "bg-secondary text-foreground"
            }`}
          >
            <Clock className="w-3 h-3" />
            {countdownText}
          </span>
        </div>
      </div>
    </div>
  );
}

// Parses alt tag for width specification like "Alt | 200w" or "200w" or "Alt|300px" or "50%"
function parseImageAltAndWidth(alt?: string): { cleanAlt: string; widthStyle: string | null } {
  if (!alt) return { cleanAlt: "", widthStyle: null };

  const raw = alt.trim();
  // Check for pipe delimiter: "Alt text | 250w"
  if (raw.includes("|")) {
    const parts = raw.split("|");
    const cleanAlt = parts[0].trim();
    const widthStr = parts[1].trim().toLowerCase();
    return { cleanAlt, widthStyle: formatWidth(widthStr) };
  }

  // Check if alt itself is just a width: "200w", "300px", "50%"
  const standaloneWidth = formatWidth(raw.toLowerCase());
  if (standaloneWidth) {
    return { cleanAlt: "", widthStyle: standaloneWidth };
  }

  return { cleanAlt: raw, widthStyle: null };
}

function formatWidth(w: string): string | null {
  const clean = w.trim().toLowerCase();
  // e.g. "200w" -> "200px"
  if (/^\d+w$/.test(clean)) {
    return `${clean.slice(0, -1)}px`;
  }
  // e.g. "200px" or "50%" or "100%"
  if (/^\d+(px|%|rem|em|vw)$/.test(clean)) {
    return clean;
  }
  // pure number: "250" -> "250px"
  if (/^\d+$/.test(clean)) {
    return `${clean}px`;
  }
  return null;
}

function AuthImage({ src, alt }: { src?: string; alt?: string }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const { cleanAlt, widthStyle } = useMemo(() => parseImageAltAndWidth(alt), [alt]);

  if (!src || src === "undefined" || src === "null") {
    return (
      <div className="my-2 p-2 rounded border border-dashed border-destructive/40 bg-destructive/5 text-xs text-destructive flex items-center gap-2">
        <span>⚠️ Görsel kaynağı bulunamadı veya yüklenemedi (Lütfen görseli yeniden yapıştırın veya yükleyin)</span>
      </div>
    );
  }

  return (
    <>
      <figure
        className="my-3.5 group relative inline-block max-w-full"
        style={widthStyle ? { width: widthStyle, maxWidth: "100%" } : { maxWidth: "100%" }}
      >
        <div
          className="relative overflow-hidden rounded-lg border border-border/80 bg-muted/30 shadow-2xs transition-all duration-200 hover:border-border hover:shadow-sm cursor-zoom-in"
          onClick={() => setLightboxOpen(true)}
          data-testid="rendered-image-container"
        >
          <img
            src={src}
            alt={cleanAlt || "Resim"}
            loading="lazy"
            className="w-full h-auto object-cover rounded-lg transition-transform duration-300 group-hover:scale-[1.01]"
          />
          {/* Zoom Overlay on Hover */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-end justify-end p-2 opacity-0 group-hover:opacity-100 pointer-events-none">
            <span className="bg-background/90 text-foreground text-[10px] font-mono px-2 py-1 rounded shadow-sm flex items-center gap-1">
              <Maximize2 className="w-3 h-3" /> Büyüt
            </span>
          </div>
        </div>

        {cleanAlt && (
          <figcaption className="text-center text-xs text-muted-foreground font-serif italic mt-1.5 px-1">
            {cleanAlt}
          </figcaption>
        )}
      </figure>

      {/* Lightbox Fullscreen Modal */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent
          className="max-w-4xl bg-background/95 backdrop-blur-md border-border p-2 sm:p-4 rounded-xl flex flex-col items-center justify-center select-none"
          data-testid="image-lightbox-dialog"
        >
          <DialogHeader className="w-full flex flex-row items-center justify-between px-2 pb-2 border-b border-border/40">
            <DialogTitle className="text-sm font-serif truncate text-muted-foreground">
              {cleanAlt || "Görsel Önizleme"}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[80vh] overflow-auto flex items-center justify-center p-1 w-full">
            <img
              src={src}
              alt={cleanAlt || "Önizleme"}
              className="max-h-[75vh] w-auto max-w-full object-contain rounded shadow-lg"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Custom paragraph: detect a raw YouTube/GMap/HTTP URL alone inside → replace with embed or clean link
function ParagraphRenderer({ children }: { children: ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  if (arr.length === 1) {
    const only = arr[0];
    if (typeof only === "string") {
      const s = only.trim();
      if (isYoutube(s)) return <YouTubeEmbed url={s} />;
      if (isGmap(s)) return <GmapEmbed url={s} />;
      if (/^https?:\/\//i.test(s)) {
        return (
          <p className="my-1.5 break-words [overflow-wrap:anywhere] [word-break:break-word]">
            <a
              href={s}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline font-medium break-all [overflow-wrap:anywhere]"
              onClick={(e) => e.stopPropagation()}
            >
              {s}
            </a>
          </p>
        );
      }
    }
    if (React.isValidElement(only) && only.type === "a") {
      const href = (only.props as any).href as string;
      if (href && isYoutube(href)) return <YouTubeEmbed url={href} />;
      if (href && isGmap(href)) return <GmapEmbed url={href} />;
    }
  }
  return <p className="break-words [overflow-wrap:anywhere] [word-break:break-word]">{transformChildren(children)}</p>;
}

// Code fence: render `reminder\n<iso>\n<text>` or `drawing` fenced block
function CodeRenderer(props: any) {
  const cls: string = props.className || "";
  const info = cls.replace(/^language-/, "").trim();
  const looksReminder = info === "reminder" || info.startsWith("reminder");
  const looksTimeslot = info === "timeslot" || info.startsWith("timeslot");
  const looksDrawing = info === "drawing" || info.startsWith("drawing");

  if (looksTimeslot) {
    let raw = "";
    const walk = (c: any) => {
      if (typeof c === "string") raw += c;
      else if (Array.isArray(c)) c.forEach(walk);
      else if (React.isValidElement(c)) walk((c as any).props?.children);
    };
    walk(props.children);
    return <TimeSlotCard raw={raw} />;
  }

  if (looksReminder) {
    let raw = "";
    const walk = (c: any) => {
      if (typeof c === "string") raw += c;
      else if (Array.isArray(c)) c.forEach(walk);
      else if (React.isValidElement(c)) walk((c as any).props?.children);
    };
    walk(props.children);
    const lines = raw.replace(/\n$/, "").split("\n");
    const iso = (lines[0] || "").trim();
    const text = lines.slice(1).join("\n").trim();
    return <ReminderCard iso={iso} text={text} />;
  }

  if (looksDrawing) {
    let raw = "";
    const walk = (c: any) => {
      if (typeof c === "string") raw += c;
      else if (Array.isArray(c)) c.forEach(walk);
      else if (React.isValidElement(c)) walk((c as any).props?.children);
    };
    walk(props.children);
    const drawingMd = "```drawing\n" + raw.trim() + "\n```";
    return (
      <div className="my-2 not-prose">
        <DrawingViewer content={drawingMd} height={220} />
      </div>
    );
  }

  return <code {...props} className={`${cls} break-all [overflow-wrap:anywhere]`} />;
}

interface Props {
  content: string;
  onTaskToggle?: (index: number, checked: boolean) => void | Promise<void>;
  highlight?: string;
}

export default function MarkdownView({ content, onTaskToggle, highlight }: Props) {
  const displayContent = useMemo(() => {
    if (!content) return "";
    let clean = content;
    // Strip the entire comments block cleanly
    clean = clean.replace(/<!--\s*inkwell:comments:start\s*-->[\s\S]*?(?:<!--\s*inkwell:comments:end\s*-->|$)/gi, "");
    clean = clean.replace(/<!--\s*comment:id=[\s\S]*?-->/gi, "");
    clean = clean.replace(/<!--\s*inkwell:comments:(?:start|end)\s*-->/gi, "");
    return clean.trimEnd();
  }, [content]);

  const taskLineToIdx = useMemo(() => {
    const map = new Map<number, number>();
    let idx = 0;
    (displayContent || "").split("\n").forEach((line, i) => {
      if (/^\s*- \[[ xX]\]\s/.test(line)) {
        map.set(i + 1, idx++);
      }
    });
    return map;
  }, [displayContent]);

  const [pendingIdx, setPendingIdx] = useState<number | null>(null);

  async function handleTaskClick(idx: number, next: boolean) {
    if (pendingIdx !== null) return;
    if (!onTaskToggle) return;
    setPendingIdx(idx);
    try {
      await Promise.resolve(onTaskToggle(idx, next));
    } finally {
      setPendingIdx(null);
    }
  }

  return (
    <div className="prose-paper break-words [overflow-wrap:anywhere] [word-break:break-word] max-w-full" data-testid="markdown-view">
      <ReactMarkdown
        children={displayContent}
        remarkPlugins={[remarkGfm]}
        components={{
          p: ParagraphRenderer as any,
          li: ({ children, className, node, ...rest }: any) => {
            const isTaskItem = typeof className === "string" && className.includes("task-list-item");
            const kids = Array.isArray(children) ? children : [children];
            if (isTaskItem) {
              const line: number | undefined = node?.position?.start?.line;
              const myIdx = line != null && taskLineToIdx.has(line) ? (taskLineToIdx.get(line) as number) : 0;
              let checked = false;
              const rest_children: React.ReactNode[] = [];
              for (const c of kids) {
                if (React.isValidElement(c) && (c as any).props && (c as any).props.type === "checkbox") {
                  checked = !!(c as any).props.checked;
                } else {
                  rest_children.push(c);
                }
              }
              const isPending = pendingIdx === myIdx;
              const disabled = pendingIdx !== null;
              return (
                <li className="flex items-start gap-2 list-none -ml-6 break-words [overflow-wrap:anywhere]" data-testid={`task-item-${myIdx}`}>
                  <button
                    type="button"
                    onClick={() => handleTaskClick(myIdx, !checked)}
                    disabled={disabled}
                    className={`mt-1 w-4 h-4 rounded-sm border flex items-center justify-center transition-colors shrink-0 ${
                      checked
                        ? "bg-[hsl(var(--accent-tag))] border-[hsl(var(--accent-tag))]"
                        : "border-border hover:border-foreground/40"
                    } ${disabled ? "opacity-70 cursor-wait" : ""}`}
                    data-testid={`task-toggle-${myIdx}`}
                    aria-label={checked ? "İşareti kaldır" : "İşaretle"}
                    aria-busy={isPending}
                  >
                    {isPending ? (
                      <Loader2
                        className={`w-3 h-3 animate-spin ${checked ? "text-white" : "text-muted-foreground"}`}
                        strokeWidth={2}
                      />
                    ) : checked ? (
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    ) : null}
                  </button>
                  <span className={`break-words [overflow-wrap:anywhere] min-w-0 flex-1 ${checked ? "line-through text-muted-foreground" : ""}`}>
                    {transformChildren(rest_children)}
                  </span>
                </li>
              );
            }
            return (
              <li {...rest} className={`${className || ""} break-words [overflow-wrap:anywhere]`}>
                {transformChildren(children)}
              </li>
            );
          },
          h1: ({ children }: any) => <h1 className="break-words [overflow-wrap:anywhere]">{transformChildren(children)}</h1>,
          h2: ({ children }: any) => <h2 className="break-words [overflow-wrap:anywhere]">{transformChildren(children)}</h2>,
          h3: ({ children }: any) => <h3 className="break-words [overflow-wrap:anywhere]">{transformChildren(children)}</h3>,
          h4: ({ children }: any) => <h4 className="break-words [overflow-wrap:anywhere]">{transformChildren(children)}</h4>,
          h5: ({ children }: any) => <h5 className="break-words [overflow-wrap:anywhere]">{transformChildren(children)}</h5>,
          h6: ({ children }: any) => <h6 className="break-words [overflow-wrap:anywhere]">{transformChildren(children)}</h6>,
          img: ({ src, alt }: any) => <AuthImage src={src} alt={alt} />,
          pre: ({ children }: any) => {
            const first = Array.isArray(children) ? children[0] : children;
            if (React.isValidElement(first)) {
              const cls: string = (first as any).props?.className || "";
              if (
                cls.startsWith("language-reminder") ||
                cls === "language-reminder" ||
                cls.startsWith("language-timeslot") ||
                cls === "language-timeslot"
              ) {
                return <>{first}</>;
              }
            }
            return <pre className="max-w-full overflow-x-auto">{children}</pre>;
          },
          code: CodeRenderer,
          a: ({ href, children }: any) => {
            if (href && isYoutube(href)) return <YouTubeEmbed url={href} />;
            if (href && isGmap(href)) return <GmapEmbed url={href} />;
            
            // Clean up label: prevent "undefined" or empty string
            let label = children;
            if (!label || label === "undefined" || (Array.isArray(label) && (label.length === 0 || label[0] === "undefined" || !label[0]))) {
              label = href;
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline font-medium break-all [overflow-wrap:anywhere]"
                onClick={(e) => e.stopPropagation()}
              >
                {label}
              </a>
            );
          },
        }}
      >
        {displayContent || ""}
      </ReactMarkdown>
    </div>
  );
}

export function toggleTaskInMarkdown(md: string, index: number, checked: boolean): string {
  const lines = md.split("\n");
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)- \[([ xX])\](.*)$/);
    if (m) {
      if (count === index) {
        lines[i] = `${m[1]}- [${checked ? "x" : " "}]${m[3]}`;
        return lines.join("\n");
      }
      count++;
    }
  }
  return md;
}
