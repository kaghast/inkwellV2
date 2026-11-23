// Per-user AI provider settings (Settings > Yapay Zeka). The key is encrypted
// at rest and never sent back to the browser; only its last 4 characters are.
import { eq } from "drizzle-orm";
import { db, aiSettings } from "../../src/db/index";
import { encryptSecret, decryptSecret } from "../lib/secrets";
import { geminiForKey, pingGemini, DEFAULT_GEMINI_MODEL } from "../ai/gemini";
import type { AiProvider } from "../ai/types";
import { AccessError } from "./workspaces";

export const AI_PROVIDERS = [{ id: "gemini", name: "Google Gemini", key_url: "https://aistudio.google.com/apikey" }] as const;

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
    default_model: DEFAULT_GEMINI_MODEL(),
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

/** Google's errors are long JSON blobs; keep the useful sentence. */
export function friendlyAiError(e: unknown): string {
  const msg = String((e as any)?.message || e || "");
  if (/API key not valid|API_KEY_INVALID/i.test(msg)) return "API anahtarı geçersiz. Google AI Studio'dan kopyaladığın anahtarı kontrol et.";
  if (/not found|is not supported|NOT_FOUND/i.test(msg)) return "Model bulunamadı. Model adını kontrol et ya da boş bırak.";
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) return "Kota aşıldı. Biraz sonra tekrar dene ya da Google AI Studio'da kotanı kontrol et.";
  if (/PERMISSION_DENIED|403/i.test(msg)) return "Bu anahtarın Gemini API'ye erişim izni yok.";
  if (/fetch failed|ENOTFOUND|ECONN|timeout/i.test(msg)) return "Google'a bağlanılamadı. Sunucunun internet erişimini kontrol et.";
  return msg.replace(/\s+/g, " ").slice(0, 240) || "Bilinmeyen hata";
}

async function check(userId: string, apiKey: string, model: string | null) {
  try {
    await pingGemini(apiKey, model);
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
  const values: Partial<Row> = { provider: input.provider || current?.provider || "gemini", model, updatedAt: new Date() };
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
    const res = await check(userId, decryptSecret(saved.apiKeyEnc), model);
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
  const res = await check(userId, decryptSecret(r.apiKeyEnc), r.model);
  return { ...res, settings: await getAiSettings(userId) };
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
    return geminiForKey(decryptSecret(r.apiKeyEnc), r.model);
  } catch (e) {
    console.warn("[AI] could not load user key", (e as Error).message);
    return null;
  }
}
