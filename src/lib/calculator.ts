import type { NoteTypeField, CalculationConfig } from "@/types";

export interface CalculationResult {
  result: number | string | null;
  formatted: string;
  isValid: boolean;
  labelA?: string;
  labelB?: string;
  opSymbol?: string;
}

/**
 * Format a millisecond difference into a human readable Turkish time string
 * e.g. "2 gün 4 saat 30 dakika", "45 dakika", "3 saat 10 dakika"
 */
export function formatTimeDifference(ms: number): string {
  if (isNaN(ms)) return "—";
  const isNegative = ms < 0;
  const absMs = Math.abs(ms);

  const totalMinutes = Math.floor(absMs / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} gün`);
  if (hours > 0) parts.push(`${hours} saat`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} dakika`);

  const formatted = parts.join(" ");
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Evaluates a calculated field against the values object
 */
export function evaluateCalculation(
  field: NoteTypeField,
  allFields: NoteTypeField[],
  values: Record<string, any>
): CalculationResult {
  const config = field.calcConfig;
  if (!config || !config.fieldAId || !config.fieldBId) {
    return {
      result: null,
      formatted: "Formül yapılandırılmamış",
      isValid: false,
    };
  }

  const fieldA = allFields.find((f) => f.id === config.fieldAId);
  const fieldB = allFields.find((f) => f.id === config.fieldBId);

  const labelA = fieldA ? fieldA.name : "Parametre 1";
  const labelB = fieldB ? fieldB.name : "Parametre 2";

  const rawValA = values[config.fieldAId];
  const rawValB = values[config.fieldBId];

  // If one of the values is missing or empty
  if (
    rawValA === undefined ||
    rawValA === null ||
    rawValA === "" ||
    rawValB === undefined ||
    rawValB === null ||
    rawValB === ""
  ) {
    return {
      result: null,
      formatted: "Değerler bekleniyor...",
      isValid: false,
      labelA,
      labelB,
    };
  }

  const isFieldADate = fieldA?.type === "datetime" || !isNaN(Date.parse(String(rawValA)));
  const isFieldBDate = fieldB?.type === "datetime" || !isNaN(Date.parse(String(rawValB)));
  const isBothDates = isFieldADate && isFieldBDate;

  const unit = config.unit ? ` ${config.unit.trim()}` : "";
  const decimals = config.decimalPlaces !== undefined ? config.decimalPlaces : 2;

  // 1. Time / Date difference calculations
  if (
    isBothDates ||
    config.operator.startsWith("time_diff") ||
    (fieldA?.type === "datetime" && fieldB?.type === "datetime")
  ) {
    const timeA = new Date(rawValA).getTime();
    const timeB = new Date(rawValB).getTime();

    if (isNaN(timeA) || isNaN(timeB)) {
      return {
        result: null,
        formatted: "Geçersiz tarih formatı",
        isValid: false,
        labelA,
        labelB,
      };
    }

    const diffMs = timeB - timeA;

    if (config.operator === "time_diff_hours") {
      const hours = diffMs / (1000 * 60 * 60);
      const rounded = Number(hours.toFixed(decimals));
      return {
        result: rounded,
        formatted: `${rounded}${unit || " saat"}`,
        isValid: true,
        labelA,
        labelB,
        opSymbol: "Fark (Saat)",
      };
    }

    if (config.operator === "time_diff_days") {
      const days = diffMs / (1000 * 60 * 60 * 24);
      const rounded = Number(days.toFixed(decimals));
      return {
        result: rounded,
        formatted: `${rounded}${unit || " gün"}`,
        isValid: true,
        labelA,
        labelB,
        opSymbol: "Fark (Gün)",
      };
    }

    if (config.operator === "time_diff_minutes") {
      const mins = Math.round(diffMs / (1000 * 60));
      return {
        result: mins,
        formatted: `${mins}${unit || " dakika"}`,
        isValid: true,
        labelA,
        labelB,
        opSymbol: "Fark (Dakika)",
      };
    }

    // Default time diff / time_diff_auto or '-'
    const formattedDiff = formatTimeDifference(diffMs);
    return {
      result: formattedDiff,
      formatted: `${formattedDiff}${unit}`,
      isValid: true,
      labelA,
      labelB,
      opSymbol: "Zaman Farkı",
    };
  }

  // 2. Numeric arithmetic calculations
  const numA = Number(rawValA);
  const numB = Number(rawValB);

  if (isNaN(numA) || isNaN(numB)) {
    return {
      result: null,
      formatted: "Sayısal değer gerekli",
      isValid: false,
      labelA,
      labelB,
    };
  }

  let computedNum: number = 0;
  let opSym = "+";

  switch (config.operator) {
    case "+":
      computedNum = numA + numB;
      opSym = "+";
      break;
    case "-":
      computedNum = numA - numB;
      opSym = "-";
      break;
    case "*":
      computedNum = numA * numB;
      opSym = "×";
      break;
    case "/":
      if (numB === 0) {
        return {
          result: null,
          formatted: "Tanımsız (Sıfıra bölünemez)",
          isValid: false,
          labelA,
          labelB,
          opSymbol: "÷",
        };
      }
      computedNum = numA / numB;
      opSym = "÷";
      break;
    default:
      computedNum = numA + numB;
      opSym = "+";
  }

  const rounded = Number(
    Number.isInteger(computedNum) ? computedNum : computedNum.toFixed(decimals)
  );

  return {
    result: rounded,
    formatted: `${rounded.toLocaleString("tr-TR")}${unit}`,
    isValid: true,
    labelA,
    labelB,
    opSymbol: opSym,
  };
}
