// AI usage accounting. Providers report the model and token counts of each
// real API call with reportUsage(); the metering wrapper in ./index runs every
// call inside a scope and writes one ai_runs row per call. Calls that never
// reach an API (no key, Claude embeddings) report nothing and are not stored.
import { and, gte, eq, sql } from "drizzle-orm";
import { db, aiRuns } from "../../src/db/index";
import type { AiProvider } from "./types";
import { AiUnavailableError } from "./types";
import { usageScope, type Usage } from "./usageScope";

const toInt = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);

async function record(row: {
  userId?: string;
  provider: string;
  task: string;
  usage: Usage;
  ok: boolean;
  error?: string;
  ms: number;
  keySource?: "user" | "server";
}) {
  try {
    await db.insert(aiRuns).values({
      runId: `air_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      userId: row.userId || null,
      provider: row.provider,
      model: row.usage.model || null,
      task: row.task.slice(0, 60),
      keySource: row.keySource || null,
      inputTokens: toInt(row.usage.input),
      outputTokens: toInt(row.usage.output),
      ok: row.ok,
      error: row.error ? row.error.slice(0, 300) : null,
      durationMs: Math.max(0, Math.round(row.ms)),
    });
  } catch (e) {
    console.warn("[AI] usage not recorded:", (e as Error).message);
  }
}

/** Wraps a model provider so every real call is recorded for `userId`. */
export function metered(p: AiProvider, userId?: string, keySource?: "user" | "server"): AiProvider {
  if (!p.isModel) return p;
  function wrap<A extends unknown[], R>(task: (args: A) => string, fn: (...a: A) => Promise<R>) {
    return async (...args: A): Promise<R> => {
      const usage: Usage & { called?: boolean } = {};
      const t0 = Date.now();
      try {
        const out = await usageScope.run(usage, () => fn(...args));
        if (usage.called) void record({ userId, provider: p.id, task: task(args), usage, ok: true, ms: Date.now() - t0, keySource });
        return out;
      } catch (e) {
        if (usage.called && !(e instanceof AiUnavailableError)) {
          void record({ userId, provider: p.id, task: task(args), usage, ok: false, error: (e as Error).message, ms: Date.now() - t0, keySource });
        }
        throw e;
      }
    };
  }
  return {
    ...p,
    extract: wrap(() => "capture", p.extract),
    generate: wrap(([req]) => req.task || "generate", p.generate),
    embed: wrap(() => "embedding", p.embed),
    readFile: p.readFile ? wrap(() => "file_text", p.readFile) : undefined,
    transcribe: p.transcribe ? wrap(() => "transcribe", p.transcribe) : undefined,
  };
}

export interface UsageSummary {
  days: number;
  since: string;
  calls: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  by_task: Array<{ task: string; calls: number; failed: number; input_tokens: number; output_tokens: number }>;
  by_day: Array<{ day: string; calls: number; tokens: number }>;
  by_model: Array<{ provider: string; model: string | null; calls: number }>;
}

/** The user's model calls over the last `days` days. */
export async function usageSummary(userId: string, days = 30): Promise<UsageSummary> {
  const since = new Date(Date.now() - days * 86400000);
  const where = and(eq(aiRuns.userId, userId), gte(aiRuns.createdAt, since));
  const n = (v: unknown) => Number(v || 0);
  const tasks = await db
    .select({
      task: aiRuns.task,
      calls: sql<number>`count(*)`,
      failed: sql<number>`sum(case when ${aiRuns.ok} then 0 else 1 end)`,
      input: sql<number>`coalesce(sum(${aiRuns.inputTokens}), 0)`,
      output: sql<number>`coalesce(sum(${aiRuns.outputTokens}), 0)`,
    })
    .from(aiRuns)
    .where(where)
    .groupBy(aiRuns.task);
  const daysRows = await db
    .select({
      day: sql<string>`to_char(${aiRuns.createdAt}, 'YYYY-MM-DD')`,
      calls: sql<number>`count(*)`,
      tokens: sql<number>`coalesce(sum(coalesce(${aiRuns.inputTokens}, 0) + coalesce(${aiRuns.outputTokens}, 0)), 0)`,
    })
    .from(aiRuns)
    .where(where)
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const models = await db
    .select({ provider: aiRuns.provider, model: aiRuns.model, calls: sql<number>`count(*)` })
    .from(aiRuns)
    .where(where)
    .groupBy(aiRuns.provider, aiRuns.model);
  const by_task = (tasks as any[])
    .map((t) => ({ task: t.task, calls: n(t.calls), failed: n(t.failed), input_tokens: n(t.input), output_tokens: n(t.output) }))
    .sort((a, b) => b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens) || b.calls - a.calls);
  return {
    days,
    since: since.toISOString(),
    calls: by_task.reduce((s, t) => s + t.calls, 0),
    failed: by_task.reduce((s, t) => s + t.failed, 0),
    input_tokens: by_task.reduce((s, t) => s + t.input_tokens, 0),
    output_tokens: by_task.reduce((s, t) => s + t.output_tokens, 0),
    by_task,
    by_day: (daysRows as any[]).map((d) => ({ day: d.day, calls: n(d.calls), tokens: n(d.tokens) })),
    by_model: (models as any[]).map((m) => ({ provider: m.provider, model: m.model, calls: n(m.calls) })).sort((a, b) => b.calls - a.calls),
  };
}
