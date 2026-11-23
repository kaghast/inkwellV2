// Deterministic stand-in for a language model, for automated tests and local
// UI checks only. Enabled with AI_PROVIDER=mock and refused in production.
// Its answers are built from the prompt's own sources, always cited.
import type { AiProvider } from "./types";
import { heuristicExtract } from "./heuristic";

export const mockEnabled = () => process.env.AI_PROVIDER === "mock" && process.env.NODE_ENV !== "production";

export const mockProvider: AiProvider = {
  id: "mock",
  label: "Test modeli",
  isModel: true,
  available: mockEnabled,
  extract: async (text, ctx) => heuristicExtract(text, ctx),
  async generate({ prompt, json }) {
    const sources = Array.from(prompt.matchAll(/^\[(\d+)\] ([^\n]+)\n([^\n]*)/gm));
    if (json) return JSON.stringify({ items: sources.slice(0, 3).map((m) => m[2]) });
    if (sources.length === 0) return "Notlarında bununla ilgili bir bilgi bulamadım.";
    const first = sources[0];
    const sentence = (first[3] || first[2]).split(/(?<=[.!?])\s/)[0].slice(0, 200);
    return `Notlarına göre: ${sentence} [${first[1]}]${sources[1] ? `\nAyrıca “${sources[1][2]}” notu da bununla ilgili [${sources[1][1]}].` : ""}`;
  },
  embed: async () => null,
};
