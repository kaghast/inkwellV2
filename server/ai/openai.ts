// OpenAI provider, used with a user's own API key from Settings > Yapay Zeka
// (or the server key OPENAI_API_KEY). Plain REST over fetch, no SDK:
// Chat Completions for text and vision, Embeddings (768 dimensions, like
// Gemini, so vectors stay comparable in size), Audio Transcriptions.
import type { AiProvider, Extraction, ExtractionContext, FileInput, GenerateRequest } from "./types";
import { AiUnavailableError } from "./types";
import { buildExtractionPrompt, parseExtraction } from "./gemini";
import { markCalled, reportUsage } from "./usageScope";
import { READ_FILE_PROMPT, cleanReadText, IMAGE_MIMES } from "./fileRead";

export const DEFAULT_OPENAI_MODEL = "gpt-6.2-sol";
const EMBED_MODEL = () => process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
const TRANSCRIBE_MODEL = () => process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe";
const BASE = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

/** Images OpenAI vision accepts; PDFs go as file parts. */
const OPENAI_IMAGES = IMAGE_MIMES.filter((m) => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(m));
const READ_MAX = 20 * 1024 * 1024;
/** Audio Transcriptions accepts files up to 25 MB. */
const TRANSCRIBE_MAX = 25 * 1024 * 1024;
const TRANSCRIBE_EXT: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg", "audio/webm": "webm",
  "video/webm": "webm", "audio/flac": "flac", "audio/x-flac": "flac",
};

/** An OpenAI API error with its HTTP status, so friendlyAiError can read it. */
export class OpenAiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function call(apiKey: string, path: string, init: { json?: unknown; form?: FormData; timeoutMs?: number }): Promise<any> {
  const res = await fetch(`${BASE()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.form,
    signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) throw new OpenAiError(body?.error?.message || `OpenAI HTTP ${res.status}`, res.status);
  return body;
}

type Part = Record<string, unknown>;

async function chat(apiKey: string, model: string, req: GenerateRequest, parts?: Part[]): Promise<string> {
  markCalled(model);
  const system = req.json ? `${req.system}\n\nReply with a single JSON object and nothing else.` : req.system;
  const body = await call(apiKey, "/chat/completions", {
    json: {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: parts ? [...parts, { type: "text", text: req.prompt }] : req.prompt },
      ],
      max_completion_tokens: req.maxTokens || 4096,
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
    },
    timeoutMs: 120_000,
  });
  reportUsage({ model: body?.model || model, input: body?.usage?.prompt_tokens ?? null, output: body?.usage?.completion_tokens ?? null });
  const choice = body?.choices?.[0];
  if (choice?.message?.refusal) throw new Error("Model declined the request");
  const out = String(choice?.message?.content || "").trim();
  if (!out) throw new Error("Empty model response");
  return out;
}

export function openaiForKey(apiKey: string, model?: string | null): AiProvider {
  const modelName = (model && model.trim()) || DEFAULT_OPENAI_MODEL;
  return {
    id: "openai",
    label: "OpenAI",
    isModel: true,
    available: () => Boolean(apiKey),
    async extract(text: string, ctx: ExtractionContext): Promise<Extraction> {
      const out = await chat(apiKey, modelName, {
        system: "You extract structured metadata from captured notes.",
        prompt: buildExtractionPrompt(text, ctx),
        maxTokens: 2048,
        json: true,
      });
      return parseExtraction(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1), ctx);
    },
    generate: (req) => chat(apiKey, modelName, req),
    embedModel: EMBED_MODEL(),
    async embed(text) {
      if (!text.trim()) return null;
      markCalled(EMBED_MODEL());
      const body = await call(apiKey, "/embeddings", { json: { model: EMBED_MODEL(), input: text.slice(0, 8000), dimensions: 768 } });
      reportUsage({ model: EMBED_MODEL(), input: body?.usage?.prompt_tokens ?? null, output: 0 });
      const v = body?.data?.[0]?.embedding;
      return Array.isArray(v) ? v : null;
    },
    canRead: (mime, bytes) => (OPENAI_IMAGES.includes(mime) || mime === "application/pdf") && bytes <= READ_MAX,
    async readFile({ data, mime, name }: FileInput) {
      const url = `data:${mime};base64,${data.toString("base64")}`;
      const part: Part =
        mime === "application/pdf"
          ? { type: "file", file: { filename: name || "file.pdf", file_data: url } }
          : { type: "image_url", image_url: { url } };
      const out = await chat(apiKey, modelName, { system: "You transcribe text from files.", prompt: READ_FILE_PROMPT, maxTokens: 16000 }, [part]);
      return cleanReadText(out);
    },
    canTranscribe: (mime, bytes) => Boolean(TRANSCRIBE_EXT[mime]) && bytes <= TRANSCRIBE_MAX,
    async transcribe({ data, mime, name }: FileInput) {
      const ext = TRANSCRIBE_EXT[mime];
      if (!ext) throw new AiUnavailableError(`OpenAI cannot transcribe ${mime}`);
      const form = new FormData();
      // The API reads the format from the extension, so it always matches the type
      const stem = (name || "").replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.-]+/g, "_").slice(0, 80) || "audio";
      const fileName = `${stem}.${ext}`;
      form.append("file", new Blob([new Uint8Array(data)], { type: mime }), fileName);
      form.append("model", TRANSCRIBE_MODEL());
      form.append("response_format", "json");
      form.append("prompt", "Verbatim transcription.");
      markCalled(TRANSCRIBE_MODEL());
      const body = await call(apiKey, "/audio/transcriptions", { form, timeoutMs: 300_000 });
      reportUsage({
        model: TRANSCRIBE_MODEL(),
        input: body?.usage?.input_tokens ?? body?.usage?.prompt_tokens ?? null,
        output: body?.usage?.output_tokens ?? null,
      });
      return cleanReadText(String(body?.text || ""));
    },
  };
}

/** Server-wide OpenAI provider from OPENAI_API_KEY (optional). */
export const openaiServerProvider = (): AiProvider | null =>
  process.env.OPENAI_API_KEY ? openaiForKey(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL || null) : null;

/** Cheapest real call that proves the key and model work; throws on failure. */
export async function pingOpenAi(apiKey: string, model?: string | null): Promise<void> {
  await call(apiKey, "/chat/completions", {
    json: {
      model: (model && model.trim()) || DEFAULT_OPENAI_MODEL,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      max_completion_tokens: 16,
    },
    timeoutMs: 30_000,
  });
}

