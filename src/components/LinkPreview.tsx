import React, { ReactNode, useEffect, useState } from "react";
import { Globe, Link2 } from "lucide-react";
import api from "@/lib/api";

export interface LinkPreviewData {
  url: string;
  title: string;
  description: string;
  image: string;
  site_name: string;
  favicon: string;
  has_title: boolean;
}

const previewCache = new Map<string, Promise<LinkPreviewData | null>>();

function loadPreview(url: string): Promise<LinkPreviewData | null> {
  let p = previewCache.get(url);
  if (!p) {
    p = api
      .get<LinkPreviewData>("/link-preview", { params: { url } })
      .then(({ data }) => data)
      .catch(() => null);
    previewCache.set(url, p);
  }
  return p;
}

export function useLinkPreview(url: string | undefined): LinkPreviewData | null {
  const [data, setData] = useState<LinkPreviewData | null>(null);
  useEffect(() => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    let alive = true;
    loadPreview(url).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [url]);
  return data;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Plain text of a rendered markdown label. */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) return textOf((node.props as any).children);
  return "";
}

/** True when the label is missing or just repeats the URL. */
function isBareLabel(label: string, href: string): boolean {
  const plain = (s: string) => s.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return !label.trim() || label === "undefined" || plain(label) === plain(href);
}

function Favicon({ src, className }: { src?: string; className: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <Globe className={`${className} text-muted-foreground`} strokeWidth={1.5} />;
  return (
    <img
      src={src}
      alt=""
      className={`${className} link-favicon rounded-[3px] object-contain`}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

const stop = (e: React.MouseEvent) => e.stopPropagation();

/** A link on its own line: card with favicon, page title, description and thumbnail. */
export function LinkPreviewCard({ href, label }: { href: string; label?: ReactNode }) {
  const preview = useLinkPreview(href);
  const labelText = textOf(label);
  const host = hostOf(href);
  const title = isBareLabel(labelText, href) ? (preview?.has_title ? preview.title : host) : labelText;
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = Boolean(preview?.image) && !imgFailed;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={stop}
      className="link-card group/link my-2 flex max-w-xl items-stretch overflow-hidden rounded-lg border border-border/80 bg-card no-underline transition-colors hover:border-primary/50 hover:bg-secondary/40"
      data-testid="link-preview-card"
      title={href}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2} aria-label="Bağlantı" />
          <Favicon src={preview?.favicon} className="h-4 w-4 shrink-0" />
          <span className="truncate text-sm font-semibold text-foreground group-hover/link:text-primary" data-testid="link-preview-title">
            {title || (preview ? host : "Yükleniyor…")}
          </span>
        </div>
        {preview?.description ? (
          <p className="m-0 line-clamp-2 text-xs leading-snug text-muted-foreground">{preview.description}</p>
        ) : null}
        <span className="truncate font-mono text-[11px] text-muted-foreground/80">{host}</span>
      </div>
      {showImage && (
        <div className="hidden w-28 shrink-0 border-l border-border/60 bg-muted sm:block">
          <img
            src={preview!.image}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        </div>
      )}
    </a>
  );
}

/** A link inside running text: link icon + favicon + title. */
export function InlineLink({ href, children }: { href: string; children?: ReactNode }) {
  const preview = useLinkPreview(href);
  const labelText = textOf(children);
  const bare = isBareLabel(labelText, href);
  const label = bare ? (preview?.has_title ? preview.title : href) : children;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={stop}
      title={href}
      className="link-inline inline-flex max-w-full items-baseline gap-1 rounded px-0.5 align-baseline font-medium [overflow-wrap:anywhere]"
      data-testid="inline-link"
    >
      <Link2 className="h-3 w-3 shrink-0 self-center" strokeWidth={2} aria-label="Bağlantı" />
      <Favicon src={preview?.favicon} className="h-3.5 w-3.5 shrink-0 self-center" />
      <span className={`link-label ${bare && !preview?.has_title ? "break-all" : ""}`}>{label}</span>
    </a>
  );
}
