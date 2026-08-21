import fs from 'fs';
import path from 'path';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

declare global {
  var _postgresPool: Pool | undefined;
  var _pgliteClient: PGlite | undefined;
}

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const isCloudSqlConfigured = Boolean(
  dbUrl ||
  (process.env.SQL_HOST && process.env.SQL_DB_NAME && process.env.SQL_USER && process.env.SQL_PASSWORD)
);

export const createPool = () => {
  if (!isCloudSqlConfigured) {
    return undefined;
  }
  if (!global._postgresPool) {
    if (dbUrl) {
      console.log("[Database] Connecting to PostgreSQL via DATABASE_URL");
      global._postgresPool = new Pool({
        connectionString: dbUrl,
        ssl: dbUrl.includes("sslmode=require") || dbUrl.includes("supabase.co") || dbUrl.includes("neon.tech")
          ? { rejectUnauthorized: false }
          : false,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
    } else {
      const host = process.env.SQL_HOST;
      const database = process.env.SQL_DB_NAME;
      const user = process.env.SQL_USER;
      const password = process.env.SQL_PASSWORD;
      const port = Number(process.env.SQL_PORT) || 5432;

      console.log(`[Database] Connecting to PostgreSQL at ${host}:${port}/${database}`);
      global._postgresPool = new Pool({
        host,
        port,
        database,
        user,
        password,
        ssl: process.env.SQL_SSL === "true" ? { rejectUnauthorized: false } : false,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
    }
  }
  return global._postgresPool;
};

export const getPgliteClient = () => {
  if (!global._pgliteClient) {
    const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), '.data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.resolve(dataDir, 'pgdb');
    console.log(`[Database] Using persistent embedded PGlite storage at: ${dbPath}`);
    global._pgliteClient = new PGlite(dbPath);
  }
  return global._pgliteClient;
};

export const pool = createPool();

export const db: any = pool
  ? drizzlePg(pool, { schema })
  : drizzlePglite(getPgliteClient(), { schema });

export async function initDatabaseSchema() {
  const ddl = `
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      picture TEXT,
      password_hash TEXT,
      auth_provider TEXT NOT NULL DEFAULT 'email',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS item_groups (
      group_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      color TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS note_types (
      type_id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      icon TEXT,
      is_default BOOLEAN NOT NULL DEFAULT false,
      fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS kanban_columns (
      column_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#3b82f6',
      order_index DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS categories (
      category_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT,
      icon TEXT,
      group_id TEXT REFERENCES item_groups(group_id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tags (
      tag_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      group_id TEXT REFERENCES item_groups(group_id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS people (
      person_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      group_id TEXT REFERENCES item_groups(group_id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS locations (
      location_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      group_id TEXT REFERENCES item_groups(group_id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notes (
      note_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      slug TEXT,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      people JSONB NOT NULL DEFAULT '[]'::jsonb,
      category_id TEXT REFERENCES categories(category_id) ON DELETE SET NULL,
      location_id TEXT REFERENCES locations(location_id) ON DELETE SET NULL,
      note_type_id TEXT REFERENCES note_types(type_id) ON DELETE SET NULL,
      custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
      pinned BOOLEAN NOT NULL DEFAULT false,
      archived BOOLEAN NOT NULL DEFAULT false,
      embedding TEXT,
      ai_summary TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS note_versions (
      version_id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      people JSONB NOT NULL DEFAULT '[]'::jsonb,
      custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
      change_summary TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS reminders (
      reminder_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
      at TIMESTAMP NOT NULL,
      text TEXT NOT NULL,
      fired BOOLEAN NOT NULL DEFAULT false,
      fired_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS files (
      file_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size DOUBLE PRECISION NOT NULL,
      data_base64 TEXT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const seedSystemTypes = `
    INSERT INTO note_types (type_id, user_id, name, description, color, icon, is_default, fields)
    VALUES
      ('type_plain', NULL, 'Düz Metin', 'Standart sade metin ve Markdown notları', '#64748b', 'FileText', true, '[]'::jsonb),
      ('type_card', NULL, 'Kart', 'Kanban panosu ve kart görünümü için özel not tipi', '#8b5cf6', 'Kanban', true, '[]'::jsonb)
    ON CONFLICT (type_id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      color = EXCLUDED.color,
      icon = EXCLUDED.icon,
      is_default = true;
  `;

  try {
    if (global._pgliteClient) {
      await global._pgliteClient.exec(ddl);
      try {
        await global._pgliteClient.exec(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;`);
        await global._pgliteClient.exec(`ALTER TABLE notes ALTER COLUMN embedding TYPE TEXT;`);
      } catch {}
      try {
        await global._pgliteClient.exec(seedSystemTypes);
      } catch (e) {
        console.warn('Seed note types note:', e);
      }
    } else if (db.execute) {
      await db.execute(sql.raw(ddl));
      try {
        await db.execute(sql.raw(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;`));
        await db.execute(sql.raw(`ALTER TABLE notes ALTER COLUMN embedding TYPE TEXT;`));
      } catch {}
      try {
        await db.execute(sql.raw(seedSystemTypes));
      } catch (e) {
        console.warn('Seed note types note:', e);
      }
    }
  } catch (err) {
    console.warn('Init database schema note:', err);
  }
}

export * from './schema';
