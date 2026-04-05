/**
 * PostgreSQL Database Adapter - Initialization & Usage Guide
 *
 * This file demonstrates how to initialize and use the PostgreSQL adapter.
 * Replace your current database.js with this pattern for PostgreSQL/Supabase.
 */

const {
  initializePool,
  closePool,
  run,
  get,
  all,
  query,
  transaction,
  begin,
  commit,
  rollback,
  wrapClient,
  healthCheck,
  getPoolStats,
} = require("./db-adapter");

// ============ INITIALIZATION ============

/**
 * Initialize the database connection
 * Call this once at application startup (e.g., in server.js)
 *
 * @param {string} connectionString - Supabase DATABASE_URL
 */
function initPostgres(connectionString = process.env.DATABASE_URL) {
  return initializePool(connectionString, {
    max: 20, // Maximum connections in pool
    idleTimeoutMillis: 30000, // Close idle connections after 30s
    connectionTimeoutMillis: 10000, // Give up connecting after 10s
  });
}

// ============ EXAMPLE USAGE ============

/**
 * Example: Insert a record (like db.prepare().run())
 */
async function exampleInsert() {
  const result = await run(
    "INSERT INTO users (name, email) VALUES (?, ?)",
    ["John Doe", "john@example.com"]
  );

  console.log("Inserted row ID:", result.lastInsertId);
  console.log("Affected rows:", result.rows);
}

/**
 * Example: Get a single record (like db.prepare().get())
 */
async function exampleGetSingle() {
  const user = await get("SELECT * FROM users WHERE id = ?", [1]);

  console.log("User:", user);
  // Returns: { id: 1, name: 'John Doe', email: 'john@example.com' } or null
}

/**
 * Example: Get multiple records (like db.prepare().all())
 */
async function exampleGetAll() {
  const users = await all("SELECT * FROM users WHERE status = ?", ["active"]);

  console.log("Active users:", users);
  // Returns: Array of user objects
}

/**
 * Example: Update a record
 */
async function exampleUpdate() {
  const result = await run(
    "UPDATE users SET status = ? WHERE id = ?",
    ["inactive", 1]
  );

  console.log("Updated rows:", result.rows);
}

/**
 * Example: Delete a record
 */
async function exampleDelete() {
  const result = await run("DELETE FROM users WHERE id = ?", [1]);

  console.log("Deleted rows:", result.rows);
}

/**
 * Example: Transaction with helper functions
 */
async function exampleTransactionWithHelpers() {
  const client = await begin();

  try {
    await run(
      "INSERT INTO accounts (user_id, balance) VALUES (?, ?)",
      [1, 100]
    );
    await run("UPDATE users SET account_count = account_count + 1 WHERE id = ?", [
      1,
    ]);

    await commit(client);
    console.log("Transaction committed");
  } catch (error) {
    await rollback(client);
    console.error("Transaction rolled back:", error);
    throw error;
  }
}

/**
 * Example: Transaction with callback (cleaner syntax)
 */
async function exampleTransactionWithCallback() {
  await transaction(async (client) => {
    // Use wrapped client for same API
    const db = wrapClient(client);

    await db.run(
      "INSERT INTO accounts (user_id, balance) VALUES (?, ?)",
      [1, 100]
    );
    await db.run(
      "UPDATE users SET account_count = account_count + 1 WHERE id = ?",
      [1]
    );
  });

  console.log("Transaction committed automatically");
}

/**
 * Example: Health check
 */
async function exampleHealthCheck() {
  const isHealthy = await healthCheck();
  const stats = getPoolStats();

  console.log("Database healthy:", isHealthy);
  console.log("Pool stats:", stats);
}

// ============ MIGRATION EXAMPLE ============

/**
 * Example: Replace your current initDatabase() function
 */
async function initDatabaseSchema() {
  // Create tables using raw PostgreSQL syntax
  await query(`
    CREATE TABLE IF NOT EXISTS searches (
      id SERIAL PRIMARY KEY,
      query TEXT NOT NULL,
      country TEXT DEFAULT 'in',
      total_sites INTEGER NOT NULL,
      wordpress_count INTEGER NOT NULL,
      non_wordpress_count INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sites (
      id SERIAL PRIMARY KEY,
      search_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      country TEXT DEFAULT 'in',
      is_wordpress INTEGER NOT NULL,
      confidence_score INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (search_id) REFERENCES searches(id) ON DELETE CASCADE
    )
  `);

  // Create indexes
  await query(
    "CREATE INDEX IF NOT EXISTS idx_sites_search_id ON sites(search_id)"
  );
  await query(
    "CREATE INDEX IF NOT EXISTS idx_sites_is_wordpress ON sites(is_wordpress)"
  );
}

// ============ EXPORTS FOR YOUR APP ============

/**
 * Export the same API as your current database.js
 * This allows drop-in replacement in most files
 */
module.exports = {
  // Initialization
  initDatabase: initPostgres,

  // Core query functions (SQLite-compatible)
  run,
  get,
  all,
  prepare: (sql) => {
    // Note: prepare() is synchronous in SQLite but async in Postgres
    // This returns a proxy that converts to async calls
    return {
      run: async (...params) => await run(sql, params),
      get: async (...params) => await get(sql, params),
      all: async (...params) => await all(sql, params),
    };
  },

  // Transaction support
  transaction,
  begin,
  commit,
  rollback,
  wrapClient,

  // Utilities
  healthCheck,
  getPoolStats,
  closePool,

  // Raw query access
  query,
};
