import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Feather, Link2, Loader2, Paperclip, CornerDownLeft, X } from "lucide-react";
import { formatApiError } from "@/lib/api";
import { uploadFile } from "@/lib/uploads";
import { notifyInboxChanged, objectPath, wsApi } from "@/lib/workspaceApi";
import { useWorkspace } from "@/contexts/WorkspaceContext";

const URL_RE = /https?:\/\/[^\s<>()]+/i;
const MAX_FILE = 25 * 1024 * 1024;

/**
 * The persistent "Aklında ne var?" entry. Enter saves to the Inbox at once
 * (processing happens in the background); Ctrl/⌘+Enter saves straight as a
 * note without AI. Files and pasted images go to the Inbox too.
 */
export default function CaptureBar() {
  const navigate = useNavigate();
  const { registerCaptureFocus } = useWorkspace();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    registerCaptureFocus(() => {
      setOpen(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => registerCaptureFocus(null);
  }, [registerCaptureFocus]);

  const url = text.match(URL_RE)?.[0];
  const hint = file
    ? `Dosya gelen kutusuna eklenecek: ${file.name}`
    : url && text.trim() === url
      ? "Bağlantı olarak yakalanacak; başlık ve site bilgisi alınacak"
      : text.length > 280
        ? "Uzun metin: özet, etiket ve görevler çıkarılacak"
        : null;

  const reset = () => {
    setText("");
    setFile(null);
    setOpen(false);
    inputRef.current?.blur();
  };

  async function submit(direct: boolean) {
    if (busy || (!text.trim() && !file)) return;
    setBusy(true);
    try {
      let fileId: string | undefined;
      if (file) {
        if (file.size > MAX_FILE) throw new Error("Dosya 25 MB sınırını aşıyor");
        fileId = (await uploadFile(file)).file_id;
      }
      const res = await wsApi.capture({
        text: text.trim() || undefined,
        file_id: fileId,
        source: file ? (file.type.startsWith("image/") ? "image" : "file") : url && text.trim() === url ? "paste" : "quick",
        mode: direct ? "direct" : "inbox",
      });
      reset();
      notifyInboxChanged();
      if (direct && res.object_id) {
        toast.success("Not olarak kaydedildi");
        navigate(objectPath({ slug: res.slug, note_id: res.object_id }));
      } else {
        toast.success("Gelen kutusuna eklendi", {
          description: "Arka planda işleniyor; hazır olunca inceleyebilirsin.",
          action: { label: "Gelen kutusu", onClick: () => navigate("/inbox") },
        });
      }
    } catch (err: any) {
      toast.error(err?.response ? formatApiError(err) : err?.message || "Kaydedilemedi");
    } finally {
      setBusy(false);
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(e.ctrlKey || e.metaKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData.files || []);
    if (pasted.length > 0) {
      e.preventDefault();
      setFile(pasted[0]);
      setOpen(true);
    }
  };

  const preview = text.trim().split("\n")[0];

  return (
    <>
      {/* Header trigger: looks like a field, opens the centered capture dialog */}
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="flex min-w-0 flex-1 max-w-xl items-center gap-2 rounded-lg border border-border bg-card px-2.5 h-9 text-left text-sm text-muted-foreground hover:border-primary/40 transition-colors"
        aria-haspopup="dialog"
        aria-keyshortcuts="c"
        data-testid="capture-bar"
      >
        <Feather className="w-4 h-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
        <span className={`min-w-0 flex-1 truncate ${preview || file ? "text-foreground" : ""}`}>
          {preview || (file ? file.name : "Aklında ne var? Yaz, bağlantı ya da dosya yapıştır…")}
        </span>
        <kbd className="hidden md:inline-flex h-5 items-center rounded border border-border px-1.5 font-mono text-[10px]">C</kbd>
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px] animate-in fade-in duration-100"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false); // backdrop click keeps the draft
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Hızlı yakalama"
            className="w-full max-w-2xl rounded-xl border border-border bg-popover p-3 shadow-2xl"
            data-testid="capture-dialog"
          >
            <div className="flex items-start gap-2">
              <Feather className="mt-2 w-5 h-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
              <textarea
                ref={inputRef}
                autoFocus
                value={text}
                rows={Math.min(12, Math.max(4, text.split("\n").length + 1))}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                placeholder="Aklında ne var? Yaz, bağlantı ya da dosya yapıştır…"
                aria-label="Hızlı yakalama"
                className="w-0 flex-1 min-w-0 resize-none bg-transparent py-1.5 text-base leading-6 outline-none placeholder:text-muted-foreground/80"
                data-testid="capture-input"
              />
            </div>

            {file && (
              <div className="mt-2 flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1 text-xs">
                <Paperclip className="w-3.5 h-3.5" aria-hidden />
                <span className="flex-1 truncate">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground" aria-label="Dosyayı kaldır">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {hint && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Link2 className="w-3.5 h-3.5" aria-hidden /> {hint}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3 text-xs">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                data-testid="capture-attach-btn"
              >
                <Paperclip className="w-3.5 h-3.5" aria-hidden /> Dosya
              </button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFile(f);
                  e.target.value = "";
                  inputRef.current?.focus();
                }}
              />
              <span className="flex-1 text-muted-foreground hidden sm:block">
                <kbd className="font-mono">Enter</kbd> gelen kutusu · <kbd className="font-mono">Ctrl+Enter</kbd> doğrudan not · <kbd className="font-mono">Esc</kbd> kapat
              </span>
              <button
                type="button"
                onClick={() => submit(true)}
                disabled={busy || (!text.trim() && !file)}
                className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                data-testid="capture-direct-btn"
              >
                Not olarak kaydet
              </button>
              <button
                type="button"
                onClick={() => submit(false)}
                disabled={busy || (!text.trim() && !file)}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-40"
                data-testid="capture-submit-btn"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CornerDownLeft className="w-3.5 h-3.5" />} Yakala
              </button>
            </div>
          </div>
        </div>,
        // Portal: the header's backdrop-filter would otherwise trap a fixed overlay inside it
        document.body
      )}
    </>
  );
}
