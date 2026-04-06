/**
 * Database utility for Next.js API routes
 * Provides a singleton connection pool to PostgreSQL (Supabase)
 */

import { Pool, PoolClient, QueryResult } from 'pg';

// Connection string from environment
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL or POSTGRES_URL environment variable is required');
}

// Connection pool configuration
const poolConfig = {
  connectionString: DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection could not be established
};

// Singleton connection pool
let pool: Pool | null = null;

/**
 * Get or create the shared connection pool
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(poolConfig);

    pool.on('error', (err) => {
      console.error('[DB Pool] Unexpected error on idle client', err);
    });

    // Log connection in development
    if (process.env.NODE_ENV === 'development') {
      console.debug('[DB Pool] Created PostgreSQL connection pool');
    }
  }
  return pool;
}

/**
 * Execute a query and return all rows
 */
export async function dbAll<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}

/**
 * Execute a query and return the first row
 */
export async function dbGet<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await getPool().query<T>(sql, params);
  return result.rows[0];
}

/**
 * Execute a query and return the result info
 * Compatible interface with SQLite's RunResult
 */
export async function dbRun(sql: string, params: unknown[] = []): Promise<RunResult> {
  const pool = getPool();

  // For INSERT queries, add RETURNING clause to get the inserted id if not present
  let pgSql = sql;
  if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.includes('RETURNING')) {
    pgSql = `${sql} RETURNING id`;
  }

  const result = await pool.query(pgSql, params);

  // Extract inserted id from RETURNING clause
  let lastInsertRowid: number | undefined;
  if (result.rows.length > 0) {
    const id = (result.rows[0] as { id?: number | string }).id;
    if (typeof id === 'string') {
      lastInsertRowid = parseInt(id, 10);
    } else if (typeof id === 'number') {
      lastInsertRowid = id;
    }
  }

  return {
    lastInsertRowid,
    changes: result.rowCount || 0,
  };
}

/**
 * Result type for dbRun (compatible with SQLite's RunResult)
 */
export interface RunResult {
  lastInsertRowid?: number;
  changes: number;
}

/**
 * Transaction helper class
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
  async query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.client.query<T>(sql, params);
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
   */
  async release(): Promise<void> {
    // Auto-rollback if not committed/rolled back
    if (!this.committed && !this.rolledBack) {
      await this.rollback();
    }
    this.client.release();
  }
}

/**
 * Execute a transaction
 */
export async function dbTransaction<T>(fn: (trx: Transaction) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const trx = new Transaction(client);
    const result = await fn(trx);
    await trx.commit();
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close the database connection pool
 */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Health check for database connection
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch (error) {
    console.error('[DB Health Check] Failed:', error);
    return false;
  }
}

// ============================================================================
// Database Schema Initialization
// ============================================================================

/**
 * Initialize email system tables if they don't exist
 */
export async function initializeEmailTables(): Promise<void> {
  const pool = getPool();

  // Email Senders Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_senders (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password TEXT NOT NULL,
      service VARCHAR(50) DEFAULT 'gmail',
      smtp_host VARCHAR(255),
      smtp_port INTEGER,
      smtp_user VARCHAR(255),
      daily_limit INTEGER DEFAULT 500,
      is_active BOOLEAN DEFAULT true,
      sent_today INTEGER DEFAULT 0,
      last_reset_date TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Email Templates Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_templates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      subject TEXT NOT NULL,
      html_content TEXT NOT NULL,
      text_content TEXT,
      description TEXT,
      category VARCHAR(100) DEFAULT 'general',
      tags TEXT DEFAULT '',
      sequence_number INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Email Campaigns Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_campaigns (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      template_id INTEGER,
      target_type VARCHAR(50) DEFAULT 'all',
      status VARCHAR(50) DEFAULT 'draft',
      total_recipients INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES email_templates(id)
    )
  `);

  // Email Queue Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_queue (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER,
      sender_id INTEGER,
      contact_id INTEGER,
      recipient_email VARCHAR(255) NOT NULL,
      recipient_name VARCHAR(255),
      subject TEXT NOT NULL,
      html_content TEXT NOT NULL,
      text_content TEXT,
      status VARCHAR(50) DEFAULT 'queued',
      attempts INTEGER DEFAULT 0,
      error_message TEXT,
      sent_at TIMESTAMP,
      scheduled_at TIMESTAMP,
      tag VARCHAR(100),
      sequence_position INTEGER,
      country_code VARCHAR(10),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id),
      FOREIGN KEY (sender_id) REFERENCES email_senders(id),
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    )
  `);

  // Email Settings Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_settings (
      key VARCHAR(255) PRIMARY KEY,
      value TEXT NOT NULL,
      label VARCHAR(255),
      description TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Email Send Log Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_send_log (
      id SERIAL PRIMARY KEY,
      contact_id INTEGER NOT NULL,
      contact_email VARCHAR(255) NOT NULL,
      template_id INTEGER,
      campaign_id INTEGER,
      send_type VARCHAR(50) DEFAULT 'main',
      status VARCHAR(50) DEFAULT 'sent',
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contact_id) REFERENCES contacts(id),
      FOREIGN KEY (template_id) REFERENCES email_templates(id)
    )
  `);

  // Worker Errors Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS worker_errors (
      id SERIAL PRIMARY KEY,
      error_type VARCHAR(255) NOT NULL,
      error_message TEXT NOT NULL,
      stack_trace TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes for better query performance
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status)',
    'CREATE INDEX IF NOT EXISTS idx_email_queue_campaign ON email_queue(campaign_id)',
    'CREATE INDEX IF NOT EXISTS idx_email_queue_contact ON email_queue(contact_id)',
    'CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled ON email_queue(scheduled_at)',
    'CREATE INDEX IF NOT EXISTS idx_email_send_log_contact ON email_send_log(contact_id)',
    'CREATE INDEX IF NOT EXISTS idx_contacts_site_id ON contacts(site_id)',
    'CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type)',
  ];

  for (const indexSql of indexes) {
    try {
      await pool.query(indexSql);
    } catch (error) {
      // Index might already exist or table might not exist yet
      console.debug(`[DB] Index creation note:`, (error as Error).message);
    }
  }

  // Seed default settings if they don't exist
  const defaults = [
    {
      key: 'per_email_delay',
      value: '60',
      label: 'Per-Email Delay (seconds)',
      description: 'Seconds to wait between sending each email',
    },
    {
      key: 'cycle_cooldown_min',
      value: '10',
      label: 'Cycle Cooldown Min (minutes)',
      description: 'Minimum minutes to wait after a full sender cycle',
    },
    {
      key: 'cycle_cooldown_max',
      value: '13',
      label: 'Cycle Cooldown Max (minutes)',
      description: 'Maximum minutes to wait after a full sender cycle',
    },
    {
      key: 'followup_gap_1',
      value: '2',
      label: 'Gap before Follow-up 1 (days)',
      description: 'Days to wait after main email before sending follow-up 1',
    },
    {
      key: 'followup_gap_2',
      value: '5',
      label: 'Gap before Follow-up 2 (days)',
      description: 'Days to wait after follow-up 1 before sending follow-up 2',
    },
    {
      key: 'followup_gap_3',
      value: '5',
      label: 'Gap before Follow-up 3 (days)',
      description: 'Days to wait after follow-up 2 before sending follow-up 3',
    },
    {
      key: 'followup_gap_4',
      value: '5',
      label: 'Gap before Follow-up 4 (days)',
      description: 'Days to wait after follow-up 3 before sending follow-up 4',
    },
  ];

  const insertSettingSql = `
    INSERT INTO email_settings (key, value, label, description)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (key) DO NOTHING
  `;

  for (const setting of defaults) {
    await pool.query(insertSettingSql, [setting.key, setting.value, setting.label, setting.description]);
  }

  // Run migrations for new columns
  await runMigrations(pool);
}

/**
 * Run database migrations to add new columns
 */
async function runMigrations(pool: Pool): Promise<void> {
  const migrations: Array<{ table: string; column: string; type: string }> = [
    { table: 'email_queue', column: 'contact_id', type: 'INTEGER' },
    { table: 'email_queue', column: 'tag', type: 'VARCHAR(100)' },
    { table: 'email_queue', column: 'sequence_position', type: 'INTEGER' },
    { table: 'email_queue', column: 'country_code', type: 'VARCHAR(10)' },
    { table: 'email_templates', column: 'tags', type: "TEXT DEFAULT ''" },
    { table: 'email_templates', column: 'sequence_number', type: 'INTEGER DEFAULT 0' },
    { table: 'email_senders', column: 'smtp_user', type: 'VARCHAR(255)' },
  ];

  for (const migration of migrations) {
    try {
      // Check if column exists using information_schema
      const columnCheck = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = $1
        AND column_name = $2
      `, [migration.table, migration.column]);

      if (columnCheck.rows.length === 0) {
        await pool.query(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.type}`);
      }
    } catch (error) {
      // Column might already exist or migration failed - ignore
      console.debug(`[DB Migration] Note for ${migration.table}.${migration.column}:`, (error as Error).message);
    }
  }
}

// Track initialization state
let initializationPromise: Promise<void> | null = null;

/**
 * Ensure database tables are initialized (lazy initialization)
 */
export async function ensureInitialized(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = initializeEmailTables().catch((error) => {
      console.error('[DB] Failed to initialize email tables:', error);
      throw error;
    });
  }
  return initializationPromise;
}

// Auto-initialize on module load (lazy - happens on first API call)
ensureInitialized().catch(() => {
  // Silently fail initialization on module load, will retry on first API call
});
