/**
 * SQLite Client for Development
 * Uses the existing WordPress detector database for read-only access
 */

const Database = require('better-sqlite3');
const path = require('path');

// Path to existing SQLite database
const DB_PATH = process.env.LEGACY_SQLITE_PATH ||
  path.join(__dirname, '../../../wordpress-detector.db');

let db: Database.Database | null = null;

/**
 * Get SQLite database connection
 */
export function getSqliteDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: false });
    db.pragma('journal_mode = WAL');
  }
  return db;
}

/**
 * Query helper
 */
export function query(sql: string, params: any[] = []): any[] {
  const database = getSqliteDb();
  const stmt = database.prepare(sql);
  return stmt.all(...params);
}

/**
 * Get single row
 */
export function queryOne(sql: string, params: any[] = []): any | undefined {
  const database = getSqliteDb();
  const stmt = database.prepare(sql);
  return stmt.get(...params);
}

/**
 * Execute statement
 */
export function execute(sql: string, params: any[] = []): any {
  const database = getSqliteDb();
  const stmt = database.prepare(sql);
  return stmt.run(...params);
}

export default getSqliteDb;
