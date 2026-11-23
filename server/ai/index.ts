// AI service entry point. Provider order for a request:
//   1. the user's own key from Settings > Yapay Zeka (when enabled),
//   2. the server-wide key (AI_PROVIDER / GEMINI_API_KEY),
//   3. the deterministic heuristic provider.
// Results always carry the provider that produced them.
import type { AiProvider, Extraction, ExtractionContext } from "./types";
import { heuristicProvider, heuristicExtract } from "./heuristic";
import { geminiProvider } from "./gemini";
import { userAiProvider } from "../services/aiSettings";

const PROVIDERS: Record<string, AiProvider> = {
  gemini: geminiProvider,
  heuristic: heuristicProvider,
};

/** Server-wide provider from environment configuration. */
export function serverProvider(): AiProvider {
  const wanted = (process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? "gemini" : "heuristic")).toLowerCase();
  const p = PROVIDERS[wanted];
  return p && p.available() ? p : heuristicProvider;
}

export async function activeProvider(userId?: string): Promise<{ provider: AiProvider; source: "user" | "server" | "none" }> {
  if (userId) {
    const own = await userAiProvider(userId);
    if (own) return { provider: own, source: "user" };
  }
  const s = serverProvider();
  return { provider: s, source: s.isModel ? "server" : "none" };
}

export async function aiStatus(userId?: string) {
  const { provider, source } = await activeProvider(userId);
  return {
    provider: provider.id,
    label: provider.label,
    is_model: provider.isModel,
    source,
  };
}

/**
 * Extract with the active provider. Explicit signals the user typed (#tags,
 * @mentions, checkbox tasks, literal dates) are always merged in from the
 * heuristic pass, so a model can add but never drop them.
 */
export async function extractWithFallback(
  text: string,
  ctx: ExtractionContext,
  userId?: string
): Promise<{ extraction: Extraction; provider: AiProvider; fellBack: boolean; error?: string }> {
  const { provider } = await activeProvider(userId);
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
