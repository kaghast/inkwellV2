import React from "react";
import { Calendar } from "lucide-react";
import { PERIOD_OPTIONS, periodLabel, type NotePeriod } from "@/lib/period";

interface Props {
  period: NotePeriod;
  onPeriodChange: (p: NotePeriod) => void;
  /** datetime-local value (YYYY-MM-DDTHH:mm) */
  dateTime: string;
  onDateTimeChange: (v: string) => void;
  testIdPrefix?: string;
}

/**
 * "Gün / Hafta / Ay" switch with the matching date input. A day note keeps the full
 * date and time; a week or month note only needs a day inside that period.
 */
export default function PeriodPicker({ period, onPeriodChange, dateTime, onDateTimeChange, testIdPrefix = "period" }: Props) {
  const day = (dateTime || "").slice(0, 10);
  const time = (dateTime || "").slice(11, 16) || "00:00";
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div
        className="inline-flex items-center rounded-sm border border-border bg-secondary/70 p-0.5 text-xs"
        role="radiogroup"
        aria-label="Not dönemi"
      >
        {PERIOD_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={period === o.value}
            onClick={() => onPeriodChange(o.value)}
            className={`px-2 py-0.5 rounded-[3px] transition-colors cursor-pointer ${
              period === o.value
                ? "bg-background text-foreground shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`${testIdPrefix}-${o.value}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 bg-secondary/70 border border-border text-xs rounded-sm px-2 py-1">
        <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {period === "day" ? (
          <input
            type="datetime-local"
            value={dateTime}
            onChange={(e) => onDateTimeChange(e.target.value)}
            className="bg-transparent text-foreground text-xs outline-none cursor-pointer font-mono"
            data-testid="composer-datetime-input"
          />
        ) : (
          <>
            <input
              type="date"
              value={day}
              onChange={(e) => e.target.value && onDateTimeChange(`${e.target.value}T${time}`)}
              className="bg-transparent text-foreground text-xs outline-none cursor-pointer font-mono"
              data-testid={`${testIdPrefix}-date-input`}
              title={period === "week" ? "Haftadan herhangi bir gün seçin" : "Aydan herhangi bir gün seçin"}
            />
            {day && (
              <span className="text-[11px] text-muted-foreground whitespace-nowrap" data-testid={`${testIdPrefix}-label`}>
                → {periodLabel(day, period)}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
