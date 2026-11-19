import React, { useState } from "react";
import { HardDrive, Plus, X } from "lucide-react";
import type { DriveFileRef } from "@/types";
import DriveFilePicker from "@/components/drive/DriveFilePicker";
import { driveKindLabel } from "@/lib/googleDrive";

/** Linked Drive files as small chips that open the file in Drive. */
export function DriveFileChips({
  files,
  onRemove,
  disabled,
}: {
  files: DriveFileRef[];
  onRemove?: (id: string) => void;
  disabled?: boolean;
}) {
  if (!files || files.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="drive-file-chips">
      {files.map((f) => (
        <span
          key={f.id}
          className="inline-flex items-center gap-1.5 max-w-full rounded-md border border-border bg-secondary/60 pl-2 pr-1 py-0.5 text-xs"
          title={`${f.name} · ${driveKindLabel(f.mime_type)}`}
        >
          {f.icon_link ? (
            <img src={f.icon_link} alt="" className="w-3.5 h-3.5 shrink-0" referrerPolicy="no-referrer" />
          ) : (
            <HardDrive className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          )}
          {f.web_view_link ? (
            <a
              href={f.web_view_link}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="truncate max-w-[16rem] text-foreground hover:underline"
              data-testid={`drive-file-link-${f.id}`}
            >
              {f.name}
            </a>
          ) : (
            <span className="truncate max-w-[16rem] text-foreground">{f.name}</span>
          )}
          {onRemove && !disabled ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(f.id);
              }}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
              aria-label={`${f.name} bağlantısını kaldır`}
              title="Bağlantıyı kaldır"
            >
              <X className="w-3 h-3" />
            </button>
          ) : (
            <span className="w-0.5" />
          )}
        </span>
      ))}
    </div>
  );
}

/** Chips plus a "Drive'dan dosya" button that opens the picker. */
export function DriveFilesField({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: DriveFileRef[];
  onChange: (files: DriveFileRef[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="drive-files-field">
      <DriveFileChips files={value} onRemove={(id) => onChange(value.filter((f) => f.id !== id))} disabled={disabled} />
      {!disabled && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 cursor-pointer"
          data-testid="drive-add-btn"
        >
          <HardDrive className="w-3.5 h-3.5" />
          {compact ? <Plus className="w-3 h-3" /> : <span>Drive'dan dosya</span>}
        </button>
      )}
      <DriveFilePicker
        open={open}
        onOpenChange={setOpen}
        linkedIds={value.map((f) => f.id)}
        onPick={(picked) => onChange([...value, ...picked.filter((p) => !value.some((v) => v.id === p.id))])}
      />
    </div>
  );
}
