// Incremental, additive migrations with a ledger (see DATABASE_MIGRATION_PLAN.md).
// Every statement is idempotent and runs on both PostgreSQL and PGlite.
// Data backfills are registered with runOnce() so they execute exactly once.
import { sql } from "drizzle-orm";
import { db } from "./index";
import { SYSTEM_OBJECT_TYPES, SYSTEM_RELATION_TYPES } from "../lib/objectTypes";

export function rowsOf<T = any>(result: any): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as T[];
  return (result.rows || []) as T[];
}

async function exec(statement: string) {
  return db.execute(sql.raw(statement));
}

const DDL_STEPS: Array<{ id: string; statements: string[] }> = [
  {
    id: "2026_11_22_000_ledger",
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
  },
  {
    id: "2026_11_22_001_objects_foundation",
    statements: [
      `ALTER TABLE notes ADD COLUMN IF NOT EXISTS workspace_id TEXT`,
      `ALTER TABLE notes ADD COLUMN IF NOT EXISTS space_id TEXT`,
      `ALTER TABLE notes ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`,
      `ALTER TABLE notes ADD COLUMN IF NOT EXISTS source JSONB NOT NULL DEFAULT '{}'::jsonb`,
      `ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_meta JSONB NOT NULL DEFAULT '{}'::jsonb`,
      `CREATE INDEX IF NOT EXISTS note_space_idx ON notes(space_id)`,
      `CREATE INDEX IF NOT EXISTS note_workspace_idx ON notes(workspace_id)`,
      `CREATE INDEX IF NOT EXISTS note_type_idx ON notes(note_type_id)`,
    ],
  },
  {
    id: "2026_11_22_002_workspaces_spaces",
    statements: [
      `CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'personal',
        owner_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        plan TEXT NOT NULL DEFAULT 'free',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'owner',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, user_id)
      )`,
      `CREATE TABLE IF NOT EXISTS spaces (
        space_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        created_by TEXT REFERENCES users(user_id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT,
        icon TEXT,
        is_default BOOLEAN NOT NULL DEFAULT false,
        archived BOOLEAN NOT NULL DEFAULT false,
        order_index DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS space_ws_idx ON spaces(workspace_id)`,
      `CREATE INDEX IF NOT EXISTS wsm_user_idx ON workspace_members(user_id)`,
    ],
  },
  {
    id: "2026_11_22_003_relations_captures_analytics",
    statements: [
      `CREATE TABLE IF NOT EXISTS relation_types (
        type_key TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        inverse_label TEXT NOT NULL,
        is_symmetric BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS object_relations (
        relation_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        workspace_id TEXT,
        source_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL DEFAULT 'related_to',
        origin TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'active',
        note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (source_id, target_id, relation_type)
      )`,
      `CREATE INDEX IF NOT EXISTS rel_source_idx ON object_relations(source_id)`,
      `CREATE INDEX IF NOT EXISTS rel_target_idx ON object_relations(target_id)`,
      `CREATE INDEX IF NOT EXISTS rel_user_idx ON object_relations(user_id)`,
      `CREATE TABLE IF NOT EXISTS captures (
        capture_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        workspace_id TEXT,
        space_id TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        resolution TEXT,
        source TEXT NOT NULL DEFAULT 'quick',
        raw_text TEXT NOT NULL DEFAULT '',
        raw_url TEXT,
        file_id TEXT,
        suggestion JSONB NOT NULL DEFAULT '{}'::jsonb,
        provider TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        object_id TEXT REFERENCES notes(note_id) ON DELETE SET NULL,
        captured_on TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS capture_user_status_idx ON captures(user_id, status)`,
      `CREATE TABLE IF NOT EXISTS analytics_events (
        event_id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
        workspace_id TEXT,
        event TEXT NOT NULL,
        props JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS ae_user_event_idx ON analytics_events(user_id, event)`,
    ],
  },
  {
    id: "2026_11_24_008_user_templates",
    statements: [
      `CREATE TABLE IF NOT EXISTS user_templates (
        template_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        builtin_key TEXT,
        name TEXT NOT NULL,
        description TEXT,
        note_type_id TEXT,
        title_template TEXT,
        content_template TEXT,
        hidden BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS utpl_user_idx ON user_templates(user_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS utpl_builtin_uq ON user_templates(user_id, builtin_key) WHERE builtin_key IS NOT NULL`,
    ],
  },
  {
    // Phase 2.5d: habit tracker and daily mood/energy. New tables only.
    id: "2026_11_25_009_habits",
    statements: [
      `CREATE TABLE IF NOT EXISTS habits (
        habit_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        archived BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS habits_user_idx ON habits(user_id)`,
      `CREATE TABLE IF NOT EXISTS habit_logs (
        habit_id TEXT NOT NULL REFERENCES habits(habit_id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (habit_id, day)
      )`,
      `CREATE INDEX IF NOT EXISTS habit_logs_user_day_idx ON habit_logs(user_id, day)`,
      `CREATE TABLE IF NOT EXISTS day_ratings (
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        mood INTEGER,
        energy INTEGER,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, day)
      )`,
    ],
  },
  {
    // Phase 2b: AI usage accounting and text read from captured files.
    // A new table and one nullable column; existing rows are untouched.
    id: "2026_11_26_010_ai_runs",
    statements: [
      `CREATE TABLE IF NOT EXISTS ai_runs (
        run_id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        model TEXT,
        task TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        ok BOOLEAN NOT NULL,
        error TEXT,
        duration_ms INTEGER NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS ai_runs_user_created_idx ON ai_runs(user_id, created_at)`,
      `ALTER TABLE captures ADD COLUMN IF NOT EXISTS file_text TEXT`,
      `ALTER TABLE captures ADD COLUMN IF NOT EXISTS file_text_method TEXT`,
    ],
  },
  {
    // Phase 2: full-text search in SQL. A generated column (Postgres keeps it
    // in step with every write, whatever code path made it) and a GIN index.
    // Text is folded like the app's `fold()` (Turkish dotless i, accents) so
    // "istanbul" finds "İstanbul". Code blocks and HTML comments are left
    // out, as in the Node ranking; locked notes contribute only their title.
    // Adding the column computes it for existing rows; no data is changed.
    id: "2026_11_27_011_search_tsv",
    statements: [
      `CREATE OR REPLACE FUNCTION inkwell_fold(t text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
        $fn$ SELECT translate(lower(translate(coalesce(t, ''), 'İIı', 'iii')),
          'çğöşüâîûêôáàäãéèëíìïóòõúùñ', 'cgosuaiueoaaaaeeeiiiooouun') $fn$`,
      `ALTER TABLE notes ADD COLUMN IF NOT EXISTS search_tsv tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple'::regconfig, inkwell_fold(title)), 'A') ||
        setweight(to_tsvector('simple'::regconfig, inkwell_fold(tags::text || ' ' || people::text)), 'B') ||
        setweight(to_tsvector('simple'::regconfig, CASE WHEN is_encrypted THEN '' ELSE inkwell_fold(left(
          regexp_replace(regexp_replace(content, '\`\`\`.*?\`\`\`', ' ', 'g'), '<!--.*?-->', ' ', 'g'),
          200000)) END), 'D')
      ) STORED`,
      `CREATE INDEX IF NOT EXISTS notes_search_tsv_idx ON notes USING gin (search_tsv)`,
    ],
  },
  {
    id: "2026_11_23_007_embedding_model",
    statements: [`ALTER TABLE notes ADD COLUMN IF NOT EXISTS embedding_model TEXT`],
  },
  {
    id: "2026_11_23_006_ai_settings",
    statements: [
      `CREATE TABLE IF NOT EXISTS ai_settings (
        user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'gemini',
        api_key_enc TEXT,
        key_hint TEXT,
        model TEXT,
        enabled BOOLEAN NOT NULL DEFAULT false,
        last_check_at TIMESTAMP,
        last_check_ok BOOLEAN,
        last_error TEXT,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
  },
];

function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Upsert built-in object and relation types. Runs on every boot (idempotent). */
async function seedSystemTypes() {
  for (const t of SYSTEM_OBJECT_TYPES) {
    await exec(`INSERT INTO note_types (type_id, user_id, name, description, color, icon, is_default, fields)
      VALUES (${lit(t.type_id)}, NULL, ${lit(t.name)}, ${lit(t.description)}, ${lit(t.color)}, ${lit(t.icon)}, true, ${lit(JSON.stringify(t.fields))}::jsonb)
      ON CONFLICT (type_id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
        color = EXCLUDED.color, icon = EXCLUDED.icon, fields = EXCLUDED.fields, is_default = true`);
  }
  for (const r of SYSTEM_RELATION_TYPES) {
    await exec(`INSERT INTO relation_types (type_key, user_id, label, inverse_label, is_symmetric)
      VALUES (${lit(r.type_key)}, NULL, ${lit(r.label)}, ${lit(r.inverse_label)}, ${r.symmetric})
      ON CONFLICT (type_key) DO UPDATE SET label = EXCLUDED.label, inverse_label = EXCLUDED.inverse_label,
        is_symmetric = EXCLUDED.is_symmetric`);
  }
}

export async function hasMigration(id: string): Promise<boolean> {
  const r = rowsOf(await db.execute(sql`SELECT id FROM schema_migrations WHERE id = ${id}`));
  return r.length > 0;
}

async function markMigration(id: string) {
  await db.execute(sql`INSERT INTO schema_migrations (id) VALUES (${id}) ON CONFLICT (id) DO NOTHING`);
}

/** Run a data migration exactly once; it is recorded only when it succeeds. */
export async function runOnce(id: string, fn: () => Promise<void>) {
  if (await hasMigration(id)) return;
  await fn();
  await markMigration(id);
  console.log(`[Migrations] applied ${id}`);
}

export async function runMigrations() {
  for (const step of DDL_STEPS) {
    for (const s of step.statements) {
      await exec(s);
    }
    await markMigration(step.id);
  }
  await seedSystemTypes();
}
