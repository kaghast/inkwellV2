// Background embeddings. Saving a note never waits for an AI call: a job
// embeds it afterwards with the user's provider (or the server key). Each
// vector records the model that made it (`notes.embedding_model`); vectors from
// another model, or the old hash fallback (model NULL), are never compared.
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db, notes } from "../../src/db/index";
import { stripCode } from "../../src/lib/wikilinks";
import { activeProvider } from "../ai";
import { enqueue, registerQueue } from "../jobs/queue";
import type { AiProvider } from "../ai/types";

const QUEUE = "embed";

/** The embedder for a user, or null when their provider has no embeddings. */
export async function embedderFor(userId: string): Promise<{ provider: AiProvider; model: string } | null> {
  const { provider } = await activeProvider(userId);
  if (!provider.isModel || !provider.embedModel) return null;
  return { provider, model: `${provider.id}:${provider.embedModel}` };
}

export function embeddingText(title: string, content: string): string {
  const body = stripCode(content || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${title || ""}\n${body}`.slice(0, 8000);
}

async function embedNote(key: string) {
  const [userId, noteId] = key.split("|");
  const emb = await embedderFor(userId);
  if (!emb) return;
  const rows = await db
    .select({ title: notes.title, content: notes.content, isEncrypted: notes.isEncrypted })
    .from(notes)
    .where(and(eq(notes.noteId, noteId), eq(notes.userId, userId)))
    .limit(1);
  const n = rows[0];
  // Password-locked notes are never sent to an AI provider.
  if (!n || n.isEncrypted) return;
  try {
    const vec = await emb.provider.embed(embeddingText(n.title, n.content));
    if (!vec || vec.length === 0) return;
    await db
      .update(notes)
      .set({ embedding: JSON.stringify(vec) as any, embeddingModel: emb.model })
      .where(and(eq(notes.noteId, noteId), eq(notes.userId, userId)));
  } catch (e) {
    console.warn("[Embeddings] failed for", noteId, (e as Error).message);
  }
}

registerQueue(QUEUE, embedNote, 2);

export function scheduleEmbedding(userId: string, noteId: string) {
  enqueue(QUEUE, `${userId}|${noteId}`);
}

/** Queue every note of the user whose vector is missing or from another model. */
export async function reindexUser(userId: string): Promise<number> {
  const emb = await embedderFor(userId);
  if (!emb) return 0;
  const rows = await db
    .select({ id: notes.noteId })
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        eq(notes.isEncrypted, false),
        or(isNull(notes.embeddingModel), ne(notes.embeddingModel, emb.model))
      )
    );
  rows.forEach((r: any) => scheduleEmbedding(userId, r.id));
  return rows.length;
}

export async function embeddingCoverage(userId: string) {
  const emb = await embedderFor(userId);
  const [all] = await db.select({ n: sql<number>`count(*)` }).from(notes).where(and(eq(notes.userId, userId), eq(notes.isEncrypted, false)));
  const done = emb
    ? (await db.select({ n: sql<number>`count(*)` }).from(notes).where(and(eq(notes.userId, userId), eq(notes.embeddingModel, emb.model))))[0]
    : { n: 0 };
  return { model: emb?.model || null, total: Number(all?.n || 0), embedded: Number(done?.n || 0) };
}
