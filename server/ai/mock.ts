// Deterministic stand-in for a language model, for automated tests and local
// UI checks only. Enabled with AI_PROVIDER=mock and refused in production.
// Its answers are built from the prompt's own sources, always cited.
import type { AiProvider } from "./types";
import { heuristicExtract } from "./heuristic";
import { reportUsage } from "./usageScope";
import { IMAGE_MIMES } from "./fileRead";

export const mockEnabled = () => process.env.AI_PROVIDER === "mock" && process.env.NODE_ENV !== "production";

const tokens = (s: string) => Math.ceil((s || "").length / 4);

export const mockProvider: AiProvider = {
  id: "mock",
  label: "Test modeli",
  isModel: true,
  available: mockEnabled,
  extract: async (text, ctx) => {
    reportUsage({ model: "mock", input: tokens(text), output: 50 });
    return heuristicExtract(text, ctx);
  },
  async generate({ prompt, json }) {
    const out = mockAnswer(prompt, json);
    reportUsage({ model: "mock", input: tokens(prompt), output: tokens(out) });
    return out;
  },
  embed: async () => null,
  canRead: (mime, bytes) => (IMAGE_MIMES.includes(mime) || mime === "application/pdf") && bytes <= 10 * 1024 * 1024,
  // A file whose bytes start with "MOCK-OCR:" "contains" the text after it;
  // anything else has no readable text.
  async readFile({ data }) {
    reportUsage({ model: "mock", input: 258, output: 20 });
    const head = data.subarray(0, 4096).toString("utf8");
    return head.startsWith("MOCK-OCR:") ? head.slice(9).trim() : "";
  },
};

function mockAnswer(prompt: string, json?: boolean): string {
  const sources = Array.from(prompt.matchAll(/^\[(\d+)\] ([^\n]+)\n([^\n]*)/gm));
  if (json) return JSON.stringify({ items: sources.slice(0, 3).map((m) => m[2]) });
  if (sources.length === 0) return "Notlarında bununla ilgili bir bilgi bulamadım.";
  const first = sources[0];
  const sentence = (first[3] || first[2]).split(/(?<=[.!?])\s/)[0].slice(0, 200);
  return `Notlarına göre: ${sentence} [${first[1]}]${sources[1] ? `\nAyrıca “${sources[1][2]}” notu da bununla ilgili [${sources[1][1]}].` : ""}`;
}
