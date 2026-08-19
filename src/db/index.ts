import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const host = process.env.SQL_HOST;
    const database = process.env.SQL_DB_NAME;
    const user = process.env.SQL_USER;
    const password = process.env.SQL_PASSWORD;
    const port = Number(process.env.SQL_PORT) || 5432;

    if (!host || !database || !user || !password) {
      console.warn('Cloud SQL credentials incomplete in environment variables, queries might fail if unconfigured.');
    }

    global._postgresPool = new Pool({
      host,
      port,
      database,
      user,
      password,
      ssl: false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return global._postgresPool;
};

export const pool = createPool();
export const db = drizzle(pool, { schema });
export * from './schema';
