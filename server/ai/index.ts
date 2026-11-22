// AI service entry point. AI_PROVIDER selects a provider ("gemini" today;
// "openai"/"anthropic" are Phase 2). When the chosen provider is unavailable
// the heuristic provider is used and results are labelled accordingly.
import type { AiProvider, Extraction, ExtractionContext } from "./types";
import { heuristicProvider, heuristicExtract } from "./heuristic";
import { geminiProvider } from "./gemini";

const PROVIDERS: Record<string, AiProvider> = {
  gemini: geminiProvider,
  heuristic: heuristicProvider,
};

export function activeProvider(): AiProvider {
  const wanted = (process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? "gemini" : "heuristic")).toLowerCase();
  const p = PROVIDERS[wanted];
  return p && p.available() ? p : heuristicProvider;
}

export function aiStatus() {
  const p = activeProvider();
  return {
    provider: p.id,
    label: p.label,
    is_model: p.isModel,
    configured: {
      gemini: geminiProvider.available(),
      openai: Boolean(process.env.OPENAI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  };
}

/**
 * Extract with the active provider. Explicit signals the user typed (#tags,
 * @mentions, checkbox tasks, literal dates) are always merged in from the
 * heuristic pass, so a model can add but never drop them.
 */
export async function extractWithFallback(text: string, ctx: ExtractionContext): Promise<{ extraction: Extraction; provider: AiProvider; fellBack: boolean; error?: string }> {
  const provider = activeProvider();
  const base = heuristicExtract(text, ctx);
  if (!provider.isModel) return { extraction: base, provider, fellBack: false };
  try {
    const ex = await provider.extract(text, ctx);
    const merge = (a: string[], b: string[]) => Array.from(new Set([...a, ...b]));
    return {
      extraction: {
        ...ex,
        title: ex.title || base.title,
        summary: ex.summary || base.summary,
        tags: merge(base.tags, ex.tags),
        people: merge(base.people, ex.people),
        dates: merge(base.dates, ex.dates).sort(),
        tasks: merge(base.tasks, ex.tasks),
      },
      provider,
      fellBack: false,
    };
  } catch (e) {
    return { extraction: base, provider: heuristicProvider, fellBack: true, error: (e as Error).message };
  }
}

export type { AiProvider, Extraction, ExtractionContext };
