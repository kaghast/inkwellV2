// Optional pgvector support. On a Postgres server where the `vector`
// extension is installed (or can be created), note embeddings are also kept in
// `notes.embedding_vec vector` and nearest notes are found in SQL. Everywhere
// else (PGlite, Postgres without the extension) nothing changes: vectors stay
// in the JSON text column and are compared in Node.
//
// The text column `notes.embedding` stays the source of truth; embedding_vec
// is derived from it and can be dropped and rebuilt at any time.
//
// Search is exact (cosine distance over the user's own rows), not HNSW: an
// approximate index filtered by user afterwards can silently drop results
// unless pgvector >= 0.8 iterative scans are configured; see the roadmap.
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../src/db/index";
import { rowsOf } from "../../src/db/migrations";

let enabled = false;

/** True once the column exists and the extension is usable on this database. */
export function hasPgvector(): boolean {
  return enabled;
}

/** Literal pgvector accepts: "[0.1,0.2,...]" (finite numbers only). */
export function vectorLiteral(v: number[]): string | null {
  if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) return null;
  return `[${v.join(",")}]`;
}

/**
 * Called once at boot. Never throws: any failure leaves pgvector off. Only
 * real Postgres is tried (PGlite has no vector extension in this build).
 */
export async function initPgvector(isPostgres: boolean): Promise<boolean> {
  enabled = false;
  if (!isPostgres || process.env.INKWELL_PGVECTOR === "off") return false;
  try {
    const avail = rowsOf(await db.execute(sql`SELECT installed_version FROM pg_available_extensions WHERE name = 'vector'`));
    if (avail.length === 0) {
      console.log("[pgvector] extension not available on this server; vectors are compared in Node");
      return false;
    }
    if (!avail[0].installed_version) await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    await db.execute(sql`ALTER TABLE notes ADD COLUMN IF NOT EXISTS embedding_vec vector`);
    // Fill the column from stored vectors once; rows with a malformed vector are skipped
    const filled = await db.execute(sql`
      UPDATE notes SET embedding_vec = embedding::vector
      WHERE embedding_vec IS NULL AND embedding_model IS NOT NULL AND embedding ~ '^\\[[-0-9.eE, ]+\\]$'`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS notes_embedding_vec_user_idx ON notes (user_id, embedding_model) WHERE embedding_vec IS NOT NULL`);
    enabled = true;
    console.log(`[pgvector] on (${(filled as any)?.rowCount ?? 0} vectors copied)`);
  } catch (e) {
    console.warn("[pgvector] not enabled:", (e as Error).message);
  }
  return enabled;
}

/** Keep embedding_vec in step after a note's embedding was written. */
export async function writeVector(userId: string, noteId: string, vec: number[]): Promise<void> {
  if (!enabled) return;
  const lit = vectorLiteral(vec);
  try {
    await db.execute(sql`UPDATE notes SET embedding_vec = ${lit}::vector WHERE note_id = ${noteId} AND user_id = ${userId}`);
  } catch (e) {
    console.warn("[pgvector] vector not stored for", noteId, (e as Error).message);
  }
}

/**
 * Ids of the user's notes nearest to the query vector (cosine similarity >=
 * `min`, best first), among rows matching `scope`, from the same model and
 * dimension only.
 */
export async function nearestNoteIdsSql(
  scope: SQL,
  embedModel: string,
  queryVector: number[],
  k: number,
  min = 0.3,
  exclude?: Set<string>
): Promise<string[]> {
  const lit = vectorLiteral(queryVector);
  if (!lit) return [];
  const ex = exclude && exclude.size ? sql`AND notes.note_id NOT IN (${sql.join(Array.from(exclude).map((id) => sql`${id}`), sql`, `)})` : sql``;
  const rows = rowsOf(
    await db.execute(sql`
      SELECT note_id FROM (
        SELECT notes.note_id, 1 - (notes.embedding_vec <=> ${lit}::vector) AS sim
        FROM notes
        WHERE ${scope} AND notes.embedding_model = ${embedModel}
          AND notes.embedding_vec IS NOT NULL AND vector_dims(notes.embedding_vec) = ${queryVector.length} ${ex}
      ) s
      WHERE sim >= ${min}
      ORDER BY sim DESC
      LIMIT ${k}`)
  );
  return rows.map((r: any) => r.note_id);
}
