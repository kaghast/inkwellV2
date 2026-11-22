import React, { useEffect, useRef, useState } from "react";
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
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerCaptureFocus(() => {
      setOpen(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => registerCaptureFocus(null);
  }, [registerCaptureFocus]);

  // Close when clicking outside an empty capture
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node) && !text.trim() && !file) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, text, file]);

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
      if (!text.trim() && !file) reset();
      else inputRef.current?.blur();
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

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1 max-w-xl" data-testid="capture-bar">
      <div
        className={`flex items-start gap-2 rounded-lg border bg-card px-2.5 transition-shadow ${
          open ? "border-primary/40 shadow-md ring-2 ring-primary/10" : "border-border hover:border-primary/30"
        }`}
      >
        <Feather className="w-4 h-4 mt-2 text-primary shrink-0" strokeWidth={1.75} aria-hidden />
        <textarea
          ref={inputRef}
          value={text}
          rows={open ? Math.min(8, Math.max(2, text.split("\n").length)) : 1}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="Aklında ne var? Yaz, bağlantı ya da dosya yapıştır…"
          aria-label="Hızlı yakalama"
          aria-keyshortcuts="c"
          className={`w-0 flex-1 min-w-0 resize-none ${open ? "overflow-y-auto" : "overflow-hidden"} bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground/80 leading-6`}
          data-testid="capture-input"
        />
        {!open && (
          <kbd className="hidden md:inline-flex mt-1.5 h-5 items-center rounded border border-border px-1.5 font-mono text-[10px] text-muted-foreground">
            C
          </kbd>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-border bg-popover p-2 shadow-lg z-50 text-xs">
          {file && (
            <div className="mb-2 flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1">
              <Paperclip className="w-3.5 h-3.5" aria-hidden />
              <span className="truncate flex-1">{file.name}</span>
              <button type="button" onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground" aria-label="Dosyayı kaldır">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {hint && (
            <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Link2 className="w-3.5 h-3.5" aria-hidden /> {hint}
            </div>
          )}
          <div className="flex items-center gap-2">
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
              <kbd className="font-mono">Enter</kbd> gelen kutusu · <kbd className="font-mono">Ctrl+Enter</kbd> doğrudan not ·{" "}
              <kbd className="font-mono">Shift+Enter</kbd> satır
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
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 font-semibold text-primary-foreground disabled:opacity-40"
              data-testid="capture-submit-btn"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CornerDownLeft className="w-3.5 h-3.5" />} Yakala
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
