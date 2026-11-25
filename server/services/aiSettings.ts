// Per-user AI provider settings (Settings > Yapay Zeka). The key is encrypted
// at rest and never sent back to the browser; only its last 4 characters are.
import { eq } from "drizzle-orm";
import { db, aiSettings } from "../../src/db/index";
import { encryptSecret, decryptSecret } from "../lib/secrets";
import { geminiForKey, pingGemini, DEFAULT_GEMINI_MODEL } from "../ai/gemini";
import { anthropicForKey, pingAnthropic, DEFAULT_ANTHROPIC_MODEL } from "../ai/anthropic";
import { openaiForKey, pingOpenAi, DEFAULT_OPENAI_MODEL } from "../ai/openai";
import type { AiProvider } from "../ai/types";
import { AccessError } from "./workspaces";

export const AI_PROVIDERS = [
  { id: "gemini", name: "Google Gemini", key_url: "https://aistudio.google.com/apikey", default_model: DEFAULT_GEMINI_MODEL(), semantic: true },
  { id: "anthropic", name: "Anthropic Claude", key_url: "https://console.anthropic.com/settings/keys", default_model: DEFAULT_ANTHROPIC_MODEL, semantic: false },
  { id: "openai", name: "OpenAI", key_url: "https://platform.openai.com/api-keys", default_model: DEFAULT_OPENAI_MODEL, semantic: true },
] as const;
type ProviderId = (typeof AI_PROVIDERS)[number]["id"];

function ping(provider: string, apiKey: string, model: string | null) {
  if (provider === "anthropic") return pingAnthropic(apiKey, model);
  if (provider === "openai") return pingOpenAi(apiKey, model);
  return pingGemini(apiKey, model);
}

type Row = typeof aiSettings.$inferSelect;

async function row(userId: string): Promise<Row | null> {
  const r = await db.select().from(aiSettings).where(eq(aiSettings.userId, userId)).limit(1);
  return r[0] || null;
}

export function serializeAiSettings(r: Row | null) {
  return {
    provider: r?.provider || "gemini",
    has_key: Boolean(r?.apiKeyEnc),
    key_hint: r?.keyHint || null,
    model: r?.model || null,
    default_model: AI_PROVIDERS.find((p) => p.id === (r?.provider || "gemini"))?.default_model || DEFAULT_GEMINI_MODEL(),
    enabled: Boolean(r?.enabled && r?.apiKeyEnc),
    last_check_at: r?.lastCheckAt ? r.lastCheckAt.toISOString() : null,
    last_check_ok: r?.lastCheckOk ?? null,
    last_error: r?.lastError || null,
    providers: AI_PROVIDERS,
  };
}

export async function getAiSettings(userId: string) {
  return serializeAiSettings(await row(userId));
}

/** Providers' errors are long; keep the useful sentence, in Turkish. */
export function friendlyAiError(e: unknown): string {
  const msg = String((e as any)?.message || e || "");
  const status = Number((e as any)?.status);
  if (/API key not valid|API_KEY_INVALID|invalid x-api-key|authentication_error|Incorrect API key/i.test(msg) || status === 401)
    return "API anahtarı geçersiz. Sağlayıcının panelinden kopyaladığın anahtarı kontrol et.";
  if (/credit balance|billing/i.test(msg)) return "Sağlayıcı hesabında kredi ya da faturalandırma sorunu var.";
  if (/not found|is not supported|NOT_FOUND/i.test(msg)) return "Model bulunamadı. Model adını kontrol et ya da boş bırak.";
  if (/insufficient_quota|exceeded your current quota/i.test(msg)) return "Sağlayıcı hesabında kredi ya da faturalandırma sorunu var.";
  if (/quota|RESOURCE_EXHAUSTED|rate limit|429/i.test(msg) || status === 429) return "Kota ya da hız sınırı aşıldı. Biraz sonra tekrar dene ya da sağlayıcının panelinde kotanı kontrol et.";
  if (/PERMISSION_DENIED|403/i.test(msg) || status === 403) return "Bu anahtarın bu modele ya da API'ye erişim izni yok.";
  if (/fetch failed|ENOTFOUND|ECONN|timeout|aborted/i.test(msg)) return "Sağlayıcıya bağlanılamadı. Sunucunun internet erişimini kontrol et.";
  return msg.replace(/\s+/g, " ").slice(0, 240) || "Bilinmeyen hata";
}

async function check(userId: string, provider: string, apiKey: string, model: string | null) {
  try {
    await ping(provider, apiKey, model);
    await db.update(aiSettings).set({ lastCheckAt: new Date(), lastCheckOk: true, lastError: null }).where(eq(aiSettings.userId, userId));
    return { ok: true as const };
  } catch (e) {
    const error = friendlyAiError(e);
    await db.update(aiSettings).set({ lastCheckAt: new Date(), lastCheckOk: false, lastError: error }).where(eq(aiSettings.userId, userId));
    return { ok: false as const, error };
  }
}

/**
 * Save settings. A new key is verified with a real call before it can be
 * enabled; enabling without a working key is refused.
 */
export async function saveAiSettings(
  userId: string,
  input: { provider?: string; api_key?: string | null; model?: string | null; enabled?: boolean }
) {
  if (input.provider && !AI_PROVIDERS.some((p) => p.id === input.provider)) throw new AccessError(400, "Desteklenmeyen sağlayıcı");
  const current = await row(userId);
  const newKey = typeof input.api_key === "string" ? input.api_key.trim() : "";
  const model = input.model === undefined ? current?.model ?? null : (input.model || "").trim() || null;
  const provider = (input.provider || current?.provider || "gemini") as ProviderId;
  const providerChanged = Boolean(current && current.provider !== provider);
  if (providerChanged && !newKey) throw new AccessError(400, "Sağlayıcıyı değiştirirken o sağlayıcının API anahtarını da gir");
  const values: Partial<Row> = { provider, model: providerChanged && input.model === undefined ? null : model, updatedAt: new Date() };
  if (newKey) {
    values.apiKeyEnc = encryptSecret(newKey);
    values.keyHint = newKey.slice(-4);
    values.lastCheckOk = null;
    values.lastError = null;
  }
  if (current) await db.update(aiSettings).set(values).where(eq(aiSettings.userId, userId));
  else await db.insert(aiSettings).values({ userId, ...values } as any);

  const saved = (await row(userId))!;
  const keyChanged = Boolean(newKey);
  const modelChanged = (current?.model ?? null) !== model;
  let enabled = input.enabled ?? (keyChanged ? true : saved.enabled);
  let testError: string | null = null;
  if (saved.apiKeyEnc && (keyChanged || modelChanged || (enabled && !saved.enabled))) {
    const res = await check(userId, saved.provider, decryptSecret(saved.apiKeyEnc), saved.model);
    if (!res.ok) {
      testError = res.error;
      enabled = false;
    }
  }
  if (enabled && !saved.apiKeyEnc) throw new AccessError(400, "Önce bir API anahtarı gir");
  await db.update(aiSettings).set({ enabled }).where(eq(aiSettings.userId, userId));
  return { settings: await getAiSettings(userId), test_error: testError };
}

export async function testAiSettings(userId: string) {
  const r = await row(userId);
  if (!r?.apiKeyEnc) throw new AccessError(400, "Kayıtlı bir API anahtarı yok");
  const res = await check(userId, r.provider, decryptSecret(r.apiKeyEnc), r.model);
  // A failed check switches AI off. When the key works again, switch it back
  // on; a user who turned it off deliberately (last check was fine) keeps it off.
  let enabled_now = false;
  if (res.ok && !r.enabled && r.lastCheckOk !== true) {
    await db.update(aiSettings).set({ enabled: true }).where(eq(aiSettings.userId, userId));
    enabled_now = true;
  }
  return { ...res, enabled_now, settings: await getAiSettings(userId) };
}

export async function deleteAiKey(userId: string) {
  await db.delete(aiSettings).where(eq(aiSettings.userId, userId));
  return getAiSettings(userId);
}

/** The user's own provider when enabled, else null (callers fall back to server/heuristic). */
export async function userAiProvider(userId: string): Promise<AiProvider | null> {
  const r = await row(userId);
  if (!r?.enabled || !r.apiKeyEnc) return null;
  try {
    const key = decryptSecret(r.apiKeyEnc);
    if (r.provider === "anthropic") return anthropicForKey(key, r.model);
    if (r.provider === "openai") return openaiForKey(key, r.model);
    return geminiForKey(key, r.model);
  } catch (e) {
    console.warn("[AI] could not load user key", (e as Error).message);
    return null;
  }
}
