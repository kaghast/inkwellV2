// Anthropic (Claude) provider, used with a user's own API key from
// Settings > Yapay Zeka. Claude has no embeddings endpoint, so semantic
// retrieval stays off with this provider (full text + relations still work).
import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, Extraction, ExtractionContext, GenerateRequest } from "./types";
import { buildExtractionPrompt, parseExtraction } from "./gemini";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

function textFrom(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
}

async function complete(client: Anthropic, model: string, req: GenerateRequest): Promise<string> {
  // Server-side fallback: if the model declines for a policy reason, the API
  // retries the same request on a fallback model chosen by refusal category.
  const res = await client.beta.messages.create({
    model,
    max_tokens: req.maxTokens || 4096,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: req.json ? `${req.system}\n\nReply with a single JSON object and nothing else.` : req.system,
    messages: [{ role: "user", content: req.prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error("Model declined the request");
  const out = textFrom(res.content);
  if (!out) throw new Error("Empty model response");
  return out;
}

export function anthropicForKey(apiKey: string, model?: string | null): AiProvider {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  const modelName = (model && model.trim()) || DEFAULT_ANTHROPIC_MODEL;
  return {
    id: "anthropic",
    label: "Claude",
    isModel: true,
    available: () => true,
    async extract(text: string, ctx: ExtractionContext): Promise<Extraction> {
      const out = await complete(client, modelName, {
        system: "You extract structured metadata from captured notes.",
        prompt: buildExtractionPrompt(text, ctx),
        maxTokens: 2048,
        json: true,
      });
      const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
      return parseExtraction(json, ctx);
    },
    generate: (req) => complete(client, modelName, req),
    embed: async () => null,
  };
}

/** Cheapest real call that proves the key and model work; throws on failure. */
export async function pingAnthropic(apiKey: string, model?: string | null): Promise<void> {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 30_000 });
  await client.messages.create({
    model: (model && model.trim()) || DEFAULT_ANTHROPIC_MODEL,
    max_tokens: 64,
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
  });
}
