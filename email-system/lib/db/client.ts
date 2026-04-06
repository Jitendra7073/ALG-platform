/**
 * PostgreSQL Database Client for Supabase
 * Single connection pool with transaction support
 */

import { Pool, PoolClient, QueryResult } from 'pg';
import { randomUUID } from 'crypto';

// Supabase DATABASE_URL from environment
// Expected format: postgresql://postgres.password@host:port/database
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL or POSTGRES_URL environment variable is required for Supabase connection');
}

// Database configuration from connection string or environment
const getConfig = () => {
  // If DATABASE_URL is provided, use it as connection string
  // Otherwise fall back to individual environment variables
  if (DATABASE_URL) {
    return {
      connectionString: DATABASE_URL,
      max: parseInt(process.env.DB_POOL_MAX || '20'),
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000'),
    };
  }

  // Fallback to individual environment variables
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'email_system',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: parseInt(process.env.DB_POOL_MAX || '20'),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000'),
  };
};

// Query logging in development
const shouldLogQueries = process.env.NODE_ENV === 'development' || process.env.LOG_QUERIES === 'true';

function logQuery(sql: string, params?: unknown[]): void {
  if (shouldLogQueries) {
    console.debug(`[DB Query] ${sql.trim()}`);
    if (params && params.length > 0) {
      console.debug(`[DB Params]`, params);
    }
  }
}

/**
 * Singleton connection pool
 */
let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    const config = getConfig();
    _pool = new Pool(config);

    _pool.on('error', (err) => {
      console.error('[DB Pool] Unexpected error on idle client', err);
    });

    if (shouldLogQueries) {
      console.debug('[DB Pool] Created PostgreSQL connection pool with config:', {
        hasConnectionString: !!config.connectionString,
        host: config.connectionString ? 'from connection string' : config.host,
        port: config.port,
        database: config.database,
        max: config.max,
      });
    }
  }
  return _pool;
}

/**
 * Transaction helper class
 * Provides automatic commit/rollback with proper resource cleanup
 */
export class Transaction {
  private client: PoolClient;
  private committed = false;
  private rolledBack = false;

  constructor(client: PoolClient) {
    this.client = client;
  }

  /**
   * Execute a query within the transaction
   */
  async query<T = unknown>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    logQuery(sql, params);
    return this.client.query<T>(sql, params);
  }

  /**
   * Execute a prepared statement
   */
  async prepared<T = unknown>(
    name: string,
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    logQuery(sql, params);
    return this.client.query<T>({ name, text: sql, values: params });
  }

  /**
   * Commit the transaction
   */
  async commit(): Promise<void> {
    if (!this.committed && !this.rolledBack) {
      await this.client.query('COMMIT');
      this.committed = true;
    }
  }

  /**
   * Rollback the transaction
   */
  async rollback(): Promise<void> {
    if (!this.committed && !this.rolledBack) {
      await this.client.query('ROLLBACK');
      this.rolledBack = true;
    }
  }

  /**
   * Release the client back to the pool
   * Call this when done with the transaction
   */
  async release(): Promise<void> {
    // Auto-rollback if not committed/rolled back
    if (!this.committed && !this.rolledBack) {
      await this.rollback();
    }
    this.client.release();
  }

  /**
   * Get the underlying pool client (use sparingly)
   */
  getClient(): PoolClient {
    return this.client;
  }
}

/**
 * Database client with helper methods
 */
export class DbClient {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool || getPool();
  }

  /**
   * Execute a query
   */
  async query<T = unknown>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    logQuery(sql, params);
    return this.pool.query<T>(sql, params);
  }

  /**
   * Get a single row
   */
  async one<T = unknown>(
    sql: string,
    params?: unknown[]
  ): Promise<T | null> {
    const result = await this.query<T>(sql, params);
    return result.rows[0] || null;
  }

  /**
   * Get multiple rows
   */
  async many<T = unknown>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]> {
    const result = await this.query<T>(sql, params);
    return result.rows;
  }

  /**
   * Execute a statement and return affected rows count
   */
  async execute(
    sql: string,
    params?: unknown[]
  ): Promise<number> {
    const result = await this.query(sql, params);
    return result.rowCount || 0;
  }

  /**
   * Begin a new transaction
   */
  async begin(): Promise<Transaction> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      return new Transaction(client);
    } catch (error) {
      client.release();
      throw error;
    }
  }

  /**
   * Acquire an advisory lock for distributed locking
   * Returns true if lock was acquired, false otherwise
   */
  async acquireLock(lockKey: bigint, timeoutMs: number = 10000): Promise<boolean> {
    const result = await this.query<{ pg_try_advisory_lock: boolean }>(
      `SELECT pg_try_advisory_lock($1::bigint) as acquired`,
      [lockKey]
    );
    return result.rows[0]?.pg_try_advisory_lock || false;
  }

  /**
   * Release an advisory lock
   */
  async releaseLock(lockKey: bigint): Promise<void> {
    await this.query(`SELECT pg_advisory_unlock($1::bigint)`, [lockKey]);
  }

  /**
   * Acquire an advisory lock with timeout using pg_try_advisory_xact_lock
   * The lock is automatically released when the transaction ends
   */
  async acquireTransactionalLock(lockKey: bigint, trx: Transaction): Promise<boolean> {
    const result = await trx.query<{ pg_try_advisory_xact_lock: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1::bigint) as acquired`,
      [lockKey]
    );
    return result.rows[0]?.pg_try_advisory_xact_lock || false;
  }

  /**
   * Generate a unique idempotency key
   */
  generateIdempotencyKey(...parts: (string | number)[]): string {
    const normalized = parts
      .map((p) => String(p).toLowerCase().trim())
      .join(':');
    return `idemp_${Buffer.from(normalized).toString('base64').slice(0, 64)}`;
  }

  /**
   * Generate a UUID v4
   */
  generateUuid(): string {
    return randomUUID();
  }

  /**
   * Get the underlying pool
   */
  getPool(): Pool {
    return this.pool;
  }
}

// Singleton instance
let _dbClient: DbClient | null = null;

/**
 * Get the singleton database client
 */
export function getDb(): DbClient {
  if (!_dbClient) {
    _dbClient = new DbClient();
  }
  return _dbClient;
}

/**
 * Close the database connection pool
 * Call this when shutting down the application
 */
export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _dbClient = null;
  }
}

/**
 * Health check for database connection
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const db = getDb();
    await db.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('[DB Health Check] Failed:', error);
    return false;
  }
}

// Re-export types
export type { Pool, PoolClient, QueryResult };
