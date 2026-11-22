# Inkwell — Database Migration Plan

Principles (from the product brief, non-negotiable):

- **Incremental and backward compatible.** Only `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` (nullable or with a default) and `CREATE INDEX IF NOT EXISTS`. Old code keeps running against the new schema.
- **Never delete user data.** No `DROP`, no destructive `ALTER TYPE`, no `RENAME` of tables or columns until (a) the replacement has been verified in production for at least one release, (b) a backup exists, and (c) a written rollback plan is approved.
- **Both engines.** Every statement must run on PostgreSQL 16 (production, `pg`) and PGlite (dev/self-host). The existing `initDatabaseSchema()` already does this; the new migrations reuse the same path.
- **No live data migration without explicit permission.** The backfills below run automatically at boot only because they are additive and idempotent. Running them on a production database is a deploy decision for the owner.

---

## 1. Migration ledger

New table:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,           -- e.g. '2026_11_22_001_objects_foundation'
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

`src/db/migrations.ts` holds an ordered list of `{ id, up(exec) }`. At boot, after the legacy DDL, each migration whose `id` is not in the ledger runs and then inserts its row. DDL steps are idempotent anyway; the ledger exists so that **data backfills run exactly once**.

## 2. Phase 1 migrations

### 001 — objects foundation (columns on `notes`)

```sql
ALTER TABLE notes ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS space_id TEXT;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS source JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_meta JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS note_space_idx ON notes(space_id);
CREATE INDEX IF NOT EXISTS note_workspace_idx ON notes(workspace_id);
CREATE INDEX IF NOT EXISTS note_type_idx ON notes(note_type_id);
```

No foreign key on `space_id`/`workspace_id` yet: old code paths insert notes without them and the boot backfill (004) fills them. A `NOT NULL` constraint and FKs are added in Phase 3, after every insert path sets them.

### 002 — workspaces, members, spaces

```sql
CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'personal',   -- personal | team
  owner_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',      -- owner | admin | editor | commenter | viewer
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS spaces (
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
);
CREATE INDEX IF NOT EXISTS space_ws_idx ON spaces(workspace_id);
CREATE INDEX IF NOT EXISTS wsm_user_idx ON workspace_members(user_id);
```

### 003 — relations, captures, analytics

```sql
CREATE TABLE IF NOT EXISTS relation_types (
  type_key TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,  -- NULL = system type
  label TEXT NOT NULL,
  inverse_label TEXT NOT NULL,
  is_symmetric BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS object_relations (
  relation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  workspace_id TEXT,
  source_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'related_to',
  origin TEXT NOT NULL DEFAULT 'manual',   -- wikilink | manual | template | capture | ai
  status TEXT NOT NULL DEFAULT 'active',   -- active | suggested
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, target_id, relation_type)
);
CREATE INDEX IF NOT EXISTS rel_source_idx ON object_relations(source_id);
CREATE INDEX IF NOT EXISTS rel_target_idx ON object_relations(target_id);
CREATE INDEX IF NOT EXISTS rel_user_idx ON object_relations(user_id);

CREATE TABLE IF NOT EXISTS captures (
  capture_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  workspace_id TEXT,
  space_id TEXT,
  status TEXT NOT NULL DEFAULT 'new',      -- new | processing | ready | processed | failed
  resolution TEXT,                         -- accepted | saved_raw | rejected
  source TEXT NOT NULL DEFAULT 'quick',    -- quick | paste | file | image | api | share | palette
  raw_text TEXT NOT NULL DEFAULT '',
  raw_url TEXT,
  file_id TEXT,
  suggestion JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  object_id TEXT REFERENCES notes(note_id) ON DELETE SET NULL,
  captured_on TEXT NOT NULL,               -- YYYY-MM-DD, local day of the capture
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS capture_user_status_idx ON captures(user_id, status);

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  workspace_id TEXT,
  event TEXT NOT NULL,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ae_user_event_idx ON analytics_events(user_id, event);
```

System relation types and system object types are upserted (`ON CONFLICT … DO UPDATE` on label/description only) at every boot, like the existing `type_plain`/`type_card` seed.

### 004 — backfill personal workspaces and spaces (data, once)

For every user without a membership row:

1. Insert `workspaces(ws_<user>, 'Kişisel çalışma alanı', 'personal', owner = user)`.
2. Insert `workspace_members(ws, user, 'owner')`.
3. Insert the default space `Kişisel` (`is_default = true`).
4. `UPDATE notes SET workspace_id = ws, space_id = default_space WHERE user_id = user AND space_id IS NULL`.

New users get the same rows lazily on first request (`ensurePersonalWorkspace`), so registration code does not change. Notes created by legacy endpoints without a space are attached to the default space by the same lazy path and by a cheap `UPDATE … WHERE space_id IS NULL` at boot.

### 005 — backfill wikilink relations (data, once)

For each user: load `note_id, title, slug, content`; parse `[[target|label]]` outside fenced code; resolve by lower-case title, slug, then id; insert `links_to` rows with `origin = 'wikilink'` (`ON CONFLICT DO NOTHING`). Encrypted ("password-locked") notes are included because their content is stored in plaintext today; the relation reveals only that a link exists, which the existing client-side graph already shows.

After 005, every `POST/PUT /api/notes`, split, merge and restore path calls `syncWikilinkRelations(noteId)`.

## 3. Rollback

| Migration | Rollback |
| --- | --- |
| 001 | Columns are nullable/defaulted and ignored by old code. Deploy the previous release; no SQL needed. Optional cleanup (`DROP COLUMN`) only with owner approval after a backup. |
| 002, 003 | New tables are unused by old code. Previous release runs unchanged. |
| 004 | Old code ignores `workspace_id`/`space_id`. Nothing to undo. |
| 005 | Derived rows: `DELETE FROM object_relations WHERE origin = 'wikilink'` and remove the ledger row; they are rebuilt on next boot. |

Backups before any production deploy: `pg_dump -Fc` of the database and a copy of `DATA_DIR/uploads`. The in-app JSON export (`/api/backup/export`) also works as a per-user safety net.

## 4. Later phases (planned, not applied)

| Phase | Change | Notes |
| --- | --- | --- |
| 2 | `embedding_vec vector(768)` column + HNSW index on Postgres (keep the `TEXT` column as source until verified); `ai_runs` (provider, task, tokens, latency) | PGlite keeps the Node cosine fallback |
| 2 | `object_chunks (object_id, ord, text, embedding)` for retrieval with citations | Rebuilt by a job, derived data |
| 3 | `subscriptions`, `usage_records`, `api_keys` (hashed), `audit_logs`, `integrations` (moves `google_integrations` rows by copy, old table kept until verified), `sessions` | |
| 3 | `files.storage_key`, `files.storage_provider`, `files.checksum`; copy to S3/R2/MinIO by job; base64 column retained until every file verifies by checksum | Never drop `data_base64` without approval |
| 3 | `NOT NULL` + FKs on `notes.workspace_id`/`space_id`; switch reads to membership predicates | After all insert paths set them |
| 4 | `comments` table (copy from embedded blocks, keep the blocks until verified), `notifications`, `activity` | |
| 4 | `invitations (token_hash, workspace_id, role, expires_at)` | |
