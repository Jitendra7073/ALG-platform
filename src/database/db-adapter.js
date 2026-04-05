/**
 * PostgreSQL Database Adapter
 *
 * Provides a SQLite-like API for PostgreSQL using node-postgres (pg).
 * Converts `?` placeholders to `$1, $2, $3` format for PostgreSQL.
 *
 * Features:
 * - Connection pooling
 * - Async/await API
 * - Parameterized queries
 * - Transaction support with guaranteed client release
 * - Supabase SSL configuration
 * - Automatic RETURNING clause for INSERT statements
 */

const { Pool } = require("pg");

// ============ CONFIGURATION ============

let pool = null;
let isInitialized = false;
let config = {
  // Auto-add RETURNING id to INSERT statements for lastInsertId support
  // Default: false (safest - no query breaks, users add RETURNING manually)
  autoReturning: false,
};

/**
 * Initialize PostgreSQL connection pool
 * @param {string} connectionString - Supabase DATABASE_URL or connection string
 * @param {Object} options - Optional pool configuration
 * @param {boolean} options.autoReturning - Auto-add RETURNING id to INSERT (default: false)
 */
function initializePool(connectionString = process.env.DATABASE_URL, options = {}) {
  if (isInitialized) {
    return pool;
  }

  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  // Extract adapter-specific options
  config.autoReturning = options.autoReturning === true;

  // Detect local PostgreSQL instances (no SSL required)
  // Local: localhost, 127.0.0.1
  // Remote/Supabase: enable SSL
  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

  // Pool defaults optimized for serverless/long-running apps
  pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false }, // SSL only for remote/Supabase
    max: options.max || 20,
    idleTimeoutMillis: options.idleTimeoutMillis || 30000,
    connectionTimeoutMillis: options.connectionTimeoutMillis || 10000,
  });

  // Handle pool errors
  pool.on("error", (err) => {
    console.error("Unexpected PostgreSQL pool error:", err);
  });

  isInitialized = true;

  return pool;
}

/**
 * Close the connection pool
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    isInitialized = false;
  }
}

/**
 * Get or create the connection pool
 */
function getPool() {
  if (!isInitialized || !pool) {
    throw new Error(
      "Database pool not initialized. Call initializePool() first."
    );
  }
  return pool;
}

// ============ QUERY PLACEHOLDER CONVERSION ============

/**
 * Convert SQLite-style `?` placeholders to PostgreSQL `$1, $2, $3` format.
 *
 * IMPORTANT: This function only replaces `?` placeholders that are NOT inside
 * string literals. Question marks inside single-quoted strings are preserved.
 *
 * Examples:
 *   "SELECT * WHERE email = ?" → "SELECT * WHERE email = $1"
 *   "SELECT * WHERE name = 'What?'" → "SELECT * WHERE name = 'What?'"
 *   "SELECT * WHERE email = ? AND name = 'Hello?'" → "SELECT * WHERE email = $1 AND name = 'Hello?'"
 *
 * @param {string} sql - SQL query with `?` placeholders
 * @returns {string} - SQL query with `$n` placeholders
 */
function convertPlaceholders(sql) {
  const result = [];
  let current = "";
  let inString = false;
  let paramIndex = 0;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const prevChar = i > 0 ? sql[i - 1] : "";
    const nextChar = i < sql.length - 1 ? sql[i + 1] : "";

    // Handle string literals (single quotes)
    if (char === "'" && prevChar !== "\\") {
      inString = !inString;
      current += char;
      continue;
    }

    // Inside string literal - preserve as-is
    if (inString) {
      current += char;
      continue;
    }

    // Outside string - check for placeholder
    if (char === "?") {
      result.push(current);
      current = "";
      paramIndex++;
      continue;
    }

    current += char;
  }

  // Don't forget the remaining content
  if (current) {
    result.push(current);
  }

  // Reconstruct with PostgreSQL placeholders
  let rebuilt = "";
  for (let i = 0; i < result.length; i++) {
    rebuilt += result[i];
    // Add placeholder after each part except the last
    if (i < paramIndex) {
      rebuilt += `$${i + 1}`;
    }
  }

  return rebuilt;
}

/**
 * Normalize parameters to an array, filtering out non-parameter values
 */
function normalizeParams(params) {
  if (!params) return [];
  if (Array.isArray(params)) {
    return params.filter((p) => typeof p !== "function");
  }
  return [params];
}

/**
 * Detect if SQL is an INSERT statement
 */
function isInsertStatement(sql) {
  return /^\s*INSERT\s+INTO/i.test(sql);
}

/**
 * Check if SQL already has a RETURNING clause
 */
function hasReturningClause(sql) {
  return /\bRETURNING\b/i.test(sql);
}

/**
 * Add RETURNING clause to INSERT statements for lastInsertId support.
 * Attempts to return the primary key column (common names: id, pk_id, uuid).
 */
function addReturningClause(sql) {
  // Don't add if already present
  if (hasReturningClause(sql)) {
    return sql;
  }

  // Trim and add RETURNING id
  const trimmed = sql.trim();
  return `${trimmed} RETURNING id`;
}

// ============ CORE QUERY FUNCTIONS ============

/**
 * Execute a query and return the result (run() equivalent).
 *
 * For INSERT statements with RETURNING clause, captures the returned ID.
 * Auto-adds RETURNING id ONLY if autoReturning config is enabled.
 *
 * Returns an object with:
 * - rows: affected row count
 * - lastInsertId: last inserted ID (only if INSERT has RETURNING)
 * - command: query command type (INSERT, UPDATE, DELETE, etc.)
 * - changes: affected row count (SQLite compatibility alias)
 *
 * @param {string} sql - SQL query with `?` placeholders
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>}
 */
async function run(sql, params = []) {
  const pool = getPool();
  const normalizedParams = normalizeParams(params);
  let pgSql = convertPlaceholders(sql);

  // Only auto-add RETURNING if:
  // 1. It's an INSERT statement
  // 2. No RETURNING clause already exists
  // 3. autoReturning config is enabled
  const originalSql = pgSql;
  if (isInsertStatement(pgSql) && !hasReturningClause(pgSql) && config.autoReturning) {
    pgSql = addReturningClause(pgSql);
  }

  try {
    const result = await pool.query(pgSql, normalizedParams);

    // For INSERT with RETURNING, extract the returned ID
    let lastInsertId = null;
    if (result.command === "INSERT" && result.rows.length > 0) {
      // Try common primary key names (case-insensitive)
      const row = result.rows[0];
      for (const key of ["id", "Id", "ID", "pk_id", "uuid", "UUID"]) {
        if (row[key] !== undefined) {
          lastInsertId = row[key];
          break;
        }
      }
    }

    return {
      rows: result.rowCount || 0,
      lastInsertId,
      command: result.command,
      changes: result.rowCount || 0, // SQLite compatibility
    };
  } catch (error) {
    throw new DatabaseError(error, sql, normalizedParams, originalSql !== pgSql ? pgSql : undefined);
  }
}

/**
 * Execute a query and return a single row (get() equivalent).
 *
 * @param {string} sql - SQL query with `?` placeholders
 * @param {Array} params - Query parameters
 * @returns {Promise<Object|null>}
 */
async function get(sql, params = []) {
  const pool = getPool();
  const normalizedParams = normalizeParams(params);
  const pgSql = convertPlaceholders(sql);

  try {
    const result = await pool.query(pgSql, normalizedParams);
    return result.rows[0] || null;
  } catch (error) {
    throw new DatabaseError(error, sql, normalizedParams);
  }
}

/**
 * Execute a query and return all rows (all() equivalent).
 *
 * @param {string} sql - SQL query with `?` placeholders
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>}
 */
async function all(sql, params = []) {
  const pool = getPool();
  const normalizedParams = normalizeParams(params);
  const pgSql = convertPlaceholders(sql);

  try {
    const result = await pool.query(pgSql, normalizedParams);
    return result.rows;
  } catch (error) {
    throw new DatabaseError(error, sql, normalizedParams);
  }
}

/**
 * Execute a raw query without placeholder conversion.
 * Useful for queries already using PostgreSQL syntax.
 *
 * @param {string} sql - SQL query with PostgreSQL placeholders ($1, $2...)
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>}
 */
async function query(sql, params = []) {
  const pool = getPool();

  try {
    const result = await pool.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
      command: result.command,
    };
  } catch (error) {
    throw new DatabaseError(error, sql, params);
  }
}

// ============ TRANSACTION SUPPORT ============

/**
 * Execute multiple statements in a transaction.
 * Client is ALWAYS released, even on error.
 *
 * @param {Function} callback - Async function that receives a wrapped client
 * @returns {Promise<any>}
 */
async function transaction(callback) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const wrapped = wrapClient(client);
    const result = await callback(wrapped);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // Attempt rollback, but ensure client is released even if rollback fails
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // Log but don't throw - we need to release the client
      console.error("Error during ROLLBACK:", rollbackError);
    }
    throw error;
  } finally {
    // Always release client, guaranteed
    client.release();
  }
}

// ============ TRANSACTION HELPERS ============

/**
 * Begin a transaction and return a wrapped client.
 * IMPORTANT: You MUST call commit() or rollback() to release the client.
 *
 * Recommended: Use transaction() callback style instead for automatic cleanup.
 *
 * Usage:
 *   const tx = await begin();
 *   try {
 *     await tx.run('INSERT INTO users (name) VALUES (?)', ['John']);
 *     await tx.commit();
 *   } catch (e) {
 *     await tx.rollback();
 *   }
 *
 * @returns {Promise<Object>} - Wrapped client with run, get, all, commit, rollback
 */
async function begin() {
  const pool = getPool();
  const client = await pool.connect();

  await client.query("BEGIN");

  // Return a wrapped client with commit/rollback built in
  const wrapped = wrapClient(client);
  let released = false;

  const safeRelease = () => {
    if (!released) {
      released = true;
      client.release();
    }
  };

  // Override commit and rollback to handle client release
  const originalCommit = wrapped.commit;
  const originalRollback = wrapped.rollback;

  wrapped.commit = async () => {
    if (released) {
      throw new Error("Transaction already completed");
    }
    try {
      await client.query("COMMIT");
    } finally {
      safeRelease();
    }
  };

  wrapped.rollback = async () => {
    if (released) {
      throw new Error("Transaction already completed");
    }
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // Log but don't throw - we still need to release
      console.error("Error during ROLLBACK:", rollbackError);
    } finally {
      safeRelease();
    }
  };

  wrapped.isReleased = () => released;

  return wrapped;
}

/**
 * Commit a transaction (only for manual begin/commit/rollback style).
 * NOTE: Use the returned wrapped client's commit() method instead.
 *
 * @param {Object} client - Raw PostgreSQL client (NOT recommended to use directly)
 * @deprecated Use wrapped client's commit() method from begin()
 */
async function commit(client) {
  try {
    await client.query("COMMIT");
  } finally {
    // Always release, even if COMMIT fails
    client.release();
  }
}

/**
 * Rollback a transaction (only for manual begin/commit/rollback style).
 * NOTE: Use the returned wrapped client's rollback() method instead.
 *
 * @param {Object} client - Raw PostgreSQL client (NOT recommended to use directly)
 * @deprecated Use wrapped client's rollback() method from begin()
 */
async function rollback(client) {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    // Log but don't throw - we still need to release
    console.error("Error during ROLLBACK:", rollbackError);
  } finally {
    // Always release, even if ROLLBACK fails
    client.release();
  }
}

// ============ WRAPPED CLIENT FOR TRANSACTIONS ============

/**
 * Create a wrapped client with the same API as the adapter.
 * Used internally by transaction() and begin().
 *
 * @param {Object} client - Raw PostgreSQL client
 * @returns {Object} - Wrapped client with run, get, all, commit, rollback
 */
function wrapClient(client) {
  return {
    /**
     * Execute a query within the transaction
     */
    run: async (sql, params = []) => {
      const normalizedParams = normalizeParams(params);
      let pgSql = convertPlaceholders(sql);

      // Only auto-add RETURNING if config allows and no existing RETURNING
      if (isInsertStatement(pgSql) && !hasReturningClause(pgSql) && config.autoReturning) {
        pgSql = addReturningClause(pgSql);
      }

      const result = await client.query(pgSql, normalizedParams);

      let lastInsertId = null;
      if (result.command === "INSERT" && result.rows.length > 0) {
        const row = result.rows[0];
        for (const key of ["id", "Id", "ID", "pk_id", "uuid", "UUID"]) {
          if (row[key] !== undefined) {
            lastInsertId = row[key];
            break;
          }
        }
      }

      return {
        rows: result.rowCount || 0,
        lastInsertId,
        command: result.command,
        changes: result.rowCount || 0,
      };
    },

    /**
     * Get a single row within the transaction
     */
    get: async (sql, params = []) => {
      const normalizedParams = normalizeParams(params);
      const pgSql = convertPlaceholders(sql);
      const result = await client.query(pgSql, normalizedParams);
      return result.rows[0] || null;
    },

    /**
     * Get all rows within the transaction
     */
    all: async (sql, params = []) => {
      const normalizedParams = normalizeParams(params);
      const pgSql = convertPlaceholders(sql);
      const result = await client.query(pgSql, normalizedParams);
      return result.rows;
    },

    /**
     * Raw query within transaction
     */
    query: async (sql, params = []) => {
      const result = await client.query(sql, params);
      return {
        rows: result.rows,
        rowCount: result.rowCount,
        command: result.command,
      };
    },

    /**
     * Raw client access for advanced use cases
     */
    client,
  };
}

// ============ ERROR HANDLING ============

/**
 * Custom database error that preserves SQL and parameters for debugging.
 */
class DatabaseError extends Error {
  /**
   * @param {Error} originalError - The original PostgreSQL error
   * @param {string} sql - Original SQL with `?` placeholders
   * @param {Array} params - Query parameters
   * @param {string} transformedSql - Optional transformed SQL (with RETURNING clause)
   */
  constructor(originalError, sql, params, transformedSql = null) {
    super(originalError.message);
    this.name = "DatabaseError";
    this.originalError = originalError;
    this.sql = sql;
    this.params = params;
    this.transformedSql = transformedSql;
    this.code = originalError.code;
    this.detail = originalError.detail;
    this.table = originalError.table;
    this.constraint = originalError.constraint;

    // Preserve stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DatabaseError);
    }
  }

  /**
   * Get a detailed error message for debugging
   */
  getDebugInfo() {
    return {
      message: this.message,
      code: this.code,
      detail: this.detail,
      sql: this.sql,
      transformedSql: this.transformedSql,
      params: this.params,
      table: this.table,
      constraint: this.constraint,
    };
  }
}

// ============ HEALTH CHECK ============

/**
 * Check database connection health.
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    return true;
  } catch (error) {
    console.error("Database health check failed:", error.message);
    return false;
  }
}

// ============ STATS ============

/**
 * Get connection pool statistics.
 * @returns {Object|null}
 */
function getPoolStats() {
  if (!pool) return null;
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

// ============ EXPORTS ============

module.exports = {
  // Initialization
  initializePool,
  closePool,
  getPool,

  // Core query functions (SQLite-compatible API)
  run,
  get,
  all,
  query,

  // Transaction support
  transaction,
  begin,
  commit,
  rollback,
  wrapClient,

  // Utilities
  healthCheck,
  getPoolStats,
  convertPlaceholders,
  DatabaseError,

  // Configuration access
  getConfig: () => ({ ...config }),
};
