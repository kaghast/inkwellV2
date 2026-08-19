import React from "react";

export function highlightText(
  text: string,
  query: string,
  keyPrefix: string = "hl"
): React.ReactNode[] {
  if (!query || !query.trim()) return [text];

  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? React.createElement(
          "mark",
          {
            key: `${keyPrefix}-${i}`,
            className: "bg-yellow-200 dark:bg-yellow-800 text-foreground rounded-xs px-0.5",
          },
          part
        )
      : part
  );
}
