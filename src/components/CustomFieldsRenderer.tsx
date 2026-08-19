import React from "react";
import {
  CalendarRange,
  Calendar,
  CheckCircle2,
  XCircle,
  Hash,
  Type,
  ChevronDown,
  Clock,
  SlidersHorizontal,
  Calculator,
  ArrowRight,
  Equal,
} from "lucide-react";
import type { NoteTypeField, NoteParameterType } from "@/types";
import { evaluateCalculation } from "@/lib/calculator";

export const PARAMETER_TYPE_LABELS: Record<
  NoteParameterType,
  { label: string; description: string; icon: any }
> = {
  calculation: {
    label: "Hesapla (Dört İşlem & Zaman Farkı)",
    description: "Mevcut parametreler arasında matematiksel veya zamansal hesaplama yapar",
    icon: Calculator,
  },
  dropdown: {
    label: "Açılır Liste (Dropdown)",
    description: "Kullanıcının belirleyeceği seçeneklerden biri",
    icon: ChevronDown,
  },
  boolean: {
    label: "Mantıksal (Evet / Hayır)",
    description: "Doğru/Yanlış veya Açık/Kapalı anahtarı",
    icon: CheckCircle2,
  },
  number: {
    label: "Sayısal Değer",
    description: "Miktar, tutar, puan veya sayısal girdi",
    icon: Hash,
  },
  text: {
    label: "Metin",
    description: "Kısa veya tek satırlık metin alanı",
    icon: Type,
  },
  datetime: {
    label: "Datetime (Tarih & Saat)",
    description: "Tarih ve saat zaman damgası",
    icon: Calendar,
  },
  datetime_range: {
    label: "Tarih & Saat Aralığı (Eski)",
    description: "Başlangıç ve Bitiş Tarih/Saat ikilisi",
    icon: CalendarRange,
  },
};

interface FormProps {
  fields: NoteTypeField[];
  values: Record<string, any>;
  onChange: (fieldId: string, value: any) => void;
  disabled?: boolean;
}

export function CustomFieldsForm({ fields, values, onChange, disabled }: FormProps) {
  if (!fields || fields.length === 0) return null;

  return (
    <div className="space-y-3.5 p-3.5 rounded-lg bg-secondary/40 border border-border/70 my-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-foreground/80 pb-1 border-b border-border/50">
        <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
        <span>Özel Alanlar & Parametreler</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((field) => {
          const val = values[field.id];

          // 1. Calculation Field (Dynamic Live Evaluation)
          if (field.type === "calculation") {
            const calcResult = evaluateCalculation(field, fields, values);
            return (
              <div
                key={field.id}
                className="sm:col-span-2 p-3 rounded-md bg-card/90 border border-primary/30 shadow-2xs space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Calculator className="w-4 h-4 text-emerald-500" />
                    <span>{field.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.2 rounded">
                      Otomatik Hesaplama
                    </span>
                  </label>

                  {calcResult.opSymbol && (
                    <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                      <span>{calcResult.labelA}</span>
                      <span className="font-bold text-foreground">{calcResult.opSymbol}</span>
                      <span>{calcResult.labelB}</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between p-2.5 rounded bg-secondary/70 border border-border/60">
                  <div className="flex items-center gap-2">
                    <Equal className="w-4 h-4 text-primary shrink-0" />
                    <span
                      className={`font-mono text-sm font-bold ${
                        calcResult.isValid
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground font-normal text-xs"
                      }`}
                    >
                      {calcResult.formatted}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {calcResult.isValid ? "Canlı hesaplandı" : "Parametreler girildiğinde hesaplanacak"}
                  </span>
                </div>
              </div>
            );
          }

          // 2. Dropdown
          if (field.type === "dropdown") {
            const options = field.options || [];
            return (
              <div key={field.id} className="space-y-1">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <ChevronDown className="w-3.5 h-3.5 text-sky-500" />
                  {field.name} {field.required && <span className="text-destructive">*</span>}
                </label>
                <select
                  disabled={disabled}
                  value={val || ""}
                  onChange={(e) => onChange(field.id, e.target.value)}
                  className="w-full text-xs bg-background border border-border rounded px-2.5 py-1.5 text-foreground focus:outline-hidden focus:border-primary cursor-pointer"
                >
                  <option value="">— Seçiniz —</option>
                  {options.map((opt, i) => (
                    <option key={i} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          // 3. Boolean
          if (field.type === "boolean") {
            const isChecked = Boolean(val);
            return (
              <div
                key={field.id}
                className="flex items-center justify-between p-2 rounded-md bg-card/60 border border-border/60"
              >
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5 cursor-pointer">
                  {isChecked ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-muted-foreground" />
                  )}
                  {field.name} {field.required && <span className="text-destructive">*</span>}
                </label>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={isChecked}
                  onChange={(e) => onChange(field.id, e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                />
              </div>
            );
          }

          // 4. Number
          if (field.type === "number") {
            return (
              <div key={field.id} className="space-y-1">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-amber-500" />
                  {field.name} {field.required && <span className="text-destructive">*</span>}
                </label>
                <input
                  type="number"
                  disabled={disabled}
                  placeholder={field.placeholder || "0"}
                  value={val !== undefined && val !== null ? val : ""}
                  onChange={(e) =>
                    onChange(field.id, e.target.value === "" ? null : Number(e.target.value))
                  }
                  className="w-full text-xs bg-background border border-border rounded px-2.5 py-1.5 text-foreground focus:outline-hidden focus:border-primary font-mono"
                />
              </div>
            );
          }

          // 5. Datetime
          if (field.type === "datetime") {
            return (
              <div key={field.id} className="space-y-1">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-purple-500" />
                  {field.name} {field.required && <span className="text-destructive">*</span>}
                </label>
                <input
                  type="datetime-local"
                  disabled={disabled}
                  value={val ? String(val).slice(0, 16) : ""}
                  onChange={(e) => onChange(field.id, e.target.value)}
                  className="w-full text-xs font-mono bg-background border border-border rounded px-2.5 py-1.5 text-foreground focus:outline-hidden focus:border-primary"
                />
              </div>
            );
          }

          // Legacy datetime_range fallback if present
          if (field.type === "datetime_range") {
            const rangeVal = val || { start: "", end: "" };
            return (
              <div key={field.id} className="sm:col-span-2 space-y-1.5 bg-card/60 p-2.5 rounded-md border border-border/60">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <CalendarRange className="w-3.5 h-3.5 text-primary" />
                  {field.name} {field.required && <span className="text-destructive">*</span>}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-muted-foreground block mb-0.5">Başlangıç:</span>
                    <input
                      type="datetime-local"
                      disabled={disabled}
                      value={rangeVal.start ? String(rangeVal.start).slice(0, 16) : ""}
                      onChange={(e) =>
                        onChange(field.id, { ...rangeVal, start: e.target.value })
                      }
                      className="w-full text-xs font-mono bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-hidden focus:border-primary"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground block mb-0.5">Bitiş:</span>
                    <input
                      type="datetime-local"
                      disabled={disabled}
                      value={rangeVal.end ? String(rangeVal.end).slice(0, 16) : ""}
                      onChange={(e) =>
                        onChange(field.id, { ...rangeVal, end: e.target.value })
                      }
                      className="w-full text-xs font-mono bg-background border border-border rounded px-2 py-1.5 text-foreground focus:outline-hidden focus:border-primary"
                    />
                  </div>
                </div>
              </div>
            );
          }

          // Default: Text
          return (
            <div key={field.id} className="space-y-1">
              <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-blue-500" />
                {field.name} {field.required && <span className="text-destructive">*</span>}
              </label>
              <input
                type="text"
                disabled={disabled}
                placeholder={field.placeholder || "Metin girin..."}
                value={val || ""}
                onChange={(e) => onChange(field.id, e.target.value)}
                className="w-full text-xs bg-background border border-border rounded px-2.5 py-1.5 text-foreground focus:outline-hidden focus:border-primary"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ViewProps {
  fields: NoteTypeField[];
  values?: Record<string, any>;
  className?: string;
}

export function CustomFieldsView({ fields, values = {}, className = "" }: ViewProps) {
  if (!fields || fields.length === 0) {
    return null;
  }

  // Filter fields that either have values or are calculations with valid result
  const populated = fields.filter((f) => {
    if (f.type === "calculation") {
      const calcResult = evaluateCalculation(f, fields, values);
      return calcResult.isValid;
    }
    const v = values[f.id];
    if (v === undefined || v === null || v === "") return false;
    if (f.type === "datetime_range" && typeof v === "object") {
      return Boolean(v.start || v.end);
    }
    return true;
  });

  if (populated.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-2 my-2.5 ${className}`}>
      {populated.map((f) => {
        // 1. Calculation Field
        if (f.type === "calculation") {
          const calcResult = evaluateCalculation(f, fields, values);
          if (!calcResult.isValid) return null;

          return (
            <div
              key={f.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 shadow-2xs"
              title={`${calcResult.labelA} ${calcResult.opSymbol || "="} ${calcResult.labelB}`}
            >
              <Calculator className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
              <span className="font-sans font-medium text-foreground/75">{f.name}:</span>
              <span className="font-bold">{calcResult.formatted}</span>
            </div>
          );
        }

        const val = values[f.id];

        // 2. Dropdown
        if (f.type === "dropdown") {
          return (
            <div
              key={f.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20"
            >
              <span className="font-medium text-foreground/70">{f.name}:</span>
              <span className="font-semibold">{String(val)}</span>
            </div>
          );
        }

        // 3. Boolean
        if (f.type === "boolean") {
          const isTrue = Boolean(val);
          return (
            <div
              key={f.id}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border ${
                isTrue
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              {isTrue ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
              )}
              <span>
                {f.name}: {isTrue ? "Evet" : "Hayır"}
              </span>
            </div>
          );
        }

        // 4. Number
        if (f.type === "number") {
          return (
            <div
              key={f.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20"
            >
              <Hash className="w-3.5 h-3.5 text-amber-500" />
              <span className="font-sans text-foreground/70">{f.name}:</span>
              <span className="font-bold">{val}</span>
            </div>
          );
        }

        // 5. Datetime
        if (f.type === "datetime") {
          const formatted = new Date(val).toLocaleString("tr-TR", {
            dateStyle: "medium",
            timeStyle: "short",
          });
          return (
            <div
              key={f.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20"
            >
              <Clock className="w-3.5 h-3.5 text-purple-500" />
              <span className="font-sans text-foreground/70">{f.name}:</span>
              <span>{formatted}</span>
            </div>
          );
        }

        // Legacy datetime_range fallback
        if (f.type === "datetime_range" && typeof val === "object") {
          const s = val.start
            ? new Date(val.start).toLocaleString("tr-TR", {
                dateStyle: "short",
                timeStyle: "short",
              })
            : "—";
          const e = val.end
            ? new Date(val.end).toLocaleString("tr-TR", {
                dateStyle: "short",
                timeStyle: "short",
              })
            : "—";
          return (
            <div
              key={f.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20"
            >
              <CalendarRange className="w-3.5 h-3.5 shrink-0 text-blue-500" />
              <span className="font-sans font-medium text-foreground/70">{f.name}:</span>
              <span>
                {s} → {e}
              </span>
            </div>
          );
        }

        return (
          <div
            key={f.id}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-muted/70 text-foreground border border-border"
          >
            <span className="text-muted-foreground">{f.name}:</span>
            <span className="font-medium">{String(val)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default CustomFieldsView;

