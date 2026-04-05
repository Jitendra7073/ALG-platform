# PostgreSQL Adapter - Quick Reference

## Installation

```bash
npm install pg
```

## Environment Setup

Add to your `.env` file:

```env
# Supabase DATABASE_URL (get from Supabase project settings)
DATABASE_URL=postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres

# Optional: Override default pool settings
PG_POOL_MAX=20
PG_POOL_IDLE_TIMEOUT=30000
PG_CONNECTION_TIMEOUT=10000
```

## API Comparison

### SQLite (better-sqlite3) → PostgreSQL Adapter

| SQLite | PostgreSQL Adapter | Notes |
|--------|-------------------|-------|
| `db.prepare(sql).run()` | `await run(sql, params)` | Returns `{rows, lastInsertId}` |
| `db.prepare(sql).get()` | `await get(sql, params)` | Returns single row or `null` |
| `db.prepare(sql).all()` | `await all(sql, params)` | Returns array of rows |
| `db.exec(sql)` | `await query(sql)` | For raw queries without params |

### Before (SQLite)

```javascript
const db = initDatabase();

// Insert
const result = db.prepare('INSERT INTO users (name) VALUES (?)').run('John');
console.log(result.lastInsertRowid);

// Get single
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(1);

// Get all
const users = db.prepare('SELECT * FROM users WHERE active = ?').all(1);
```

### After (PostgreSQL)

```javascript
const { run, get, all } = require('./database/db-adapter');

// Insert
const result = await run('INSERT INTO users (name) VALUES (?)', ['John']);
console.log(result.lastInsertId);

// Get single
const user = await get('SELECT * FROM users WHERE id = ?', [1]);

// Get all
const users = await all('SELECT * FROM users WHERE active = ?', [1]);
```

## Key Differences

### 1. All Queries Are Async

**Before:**
```javascript
const user = db.prepare('SELECT * FROM users').get();
```

**After:**
```javascript
const user = await get('SELECT * FROM users');
```

### 2. Parameters Are Always Arrays

**Before:**
```javascript
db.prepare('INSERT INTO users VALUES (?, ?)').run('John', 'john@example.com');
```

**After:**
```javascript
await run('INSERT INTO users VALUES (?, ?)', ['John', 'john@example.com']);
```

### 3. Last Insert ID

**IMPORTANT:** PostgreSQL doesn't automatically return inserted IDs like SQLite.

**Default behavior (safe - no query breaks):**
```javascript
// lastInsertId will be null unless you add RETURNING
const result = await run('INSERT INTO users (name) VALUES (?)', ['John']);
console.log(result.lastInsertId); // null (safe, no error)
```

**Option A: Enable auto-RETURNING if all tables use "id" column:**
```javascript
const { initializePool, run } = require('./database/db-adapter');

initializePool(process.env.DATABASE_URL, { autoReturning: true });

const result = await run('INSERT INTO users (name) VALUES (?)', ['John']);
console.log(result.lastInsertId); // 123 (auto-added RETURNING id)
```

**Option B: Add RETURNING manually (recommended for mixed schemas):**
```javascript
// For tables with 'id' column
const result = await run(
  'INSERT INTO users (name) VALUES (?) RETURNING id',
  ['John']
);
console.log(result.lastInsertId); // 123

// For tables with custom primary key
const result = await run(
  'INSERT INTO orders (total) VALUES (?) RETURNING order_id',
  [100]
);
console.log(result.lastInsertId); // 456
```

**Supported RETURNING column names (auto-detected):**
- `id`, `Id`, `ID`
- `pk_id`
- `uuid`, `UUID`

### 4. Auto-increment Columns

| SQLite | PostgreSQL |
|--------|------------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `DATETIME DEFAULT CURRENT_TIMESTAMP` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` |

## Transaction Examples

### Style 1: Recommended - Callback-based (automatic cleanup)

```javascript
const { transaction } = require('./database/db-adapter');

await transaction(async (db) => {
  await db.run('INSERT INTO accounts (user_id, balance) VALUES (?, ?)', [1, 100]);
  await db.run('UPDATE users SET account_count = account_count + 1 WHERE id = ?', [1]);
});
// Automatically commits on success, rolls back on error, ALWAYS releases client
```

### Style 2: Manual Begin/Commit/Rollback (with auto-release)

```javascript
const { begin } = require('./database/db-adapter');

const tx = await begin();
try {
  await tx.run('INSERT INTO accounts (user_id, balance) VALUES (?, ?)', [1, 100]);
  await tx.run('UPDATE users SET account_count = account_count + 1 WHERE id = ?', [1]);
  await tx.commit();  // Automatically releases client
} catch (error) {
  await tx.rollback();  // Automatically releases client, even if rollback fails
  throw error;
}
```

### Style 2: Callback-based Transaction

```javascript
const { transaction, wrapClient } = require('./database/db-adapter');

await transaction(async (client) => {
  const db = wrapClient(client);
  await db.run('INSERT INTO accounts (user_id, balance) VALUES (?, ?)', [1, 100]);
  await db.run('UPDATE users SET account_count = account_count + 1 WHERE id = ?', [1]);
});
// Automatically commits on success, rolls back on error
```

## Initializing in Your App

### In server.js or main entry point:

```javascript
const { initDatabase, closePool, healthCheck } = require('./database/db-adapter-init');

async function startServer() {
  // Initialize connection
  initDatabase();

  // Verify connection
  const healthy = await healthCheck();
  if (!healthy) {
    console.error('Failed to connect to database');
    process.exit(1);
  }

  // Start your server
  const server = app.listen(8080, () => {
    console.log('Server running on port 8080');
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    server.close();
    await closePool();
    process.exit(0);
  });
}

startServer();
```

## Error Handling

```javascript
const { DatabaseError, run } = require('./database/db-adapter');

try {
  await run('INSERT INTO users (email) VALUES (?)', ['test@example.com']);
} catch (error) {
  if (error instanceof DatabaseError) {
    console.error('Database error:', error.message);
    console.error('SQL:', error.sql);
    console.error('Params:', error.params);
    console.error('PostgreSQL code:', error.code);
  }
}
```

## Common Error Codes

| Code | Meaning |
|------|---------|
| `23505` | Unique violation |
| `23503` | Foreign key violation |
| `23502` | NOT NULL violation |
| `08001` | Connection error |
| `08006` | Connection failure |

## Health Check Endpoint

```javascript
// In your Express server
app.get('/api/health', async (req, res) => {
  const { healthCheck, getPoolStats } = require('./database/db-adapter');

  const dbHealthy = await healthCheck();
  const poolStats = getPoolStats();

  res.json({
    database: dbHealthy ? 'healthy' : 'unhealthy',
    pool: poolStats,
  });
});
```

## Production Schema Notes

### Boolean Flags Use INTEGER (0/1), NOT BOOLEAN

**IMPORTANT**: The production schema uses INTEGER for boolean flags to maintain 100% compatibility with existing code.

```javascript
// ✅ CORRECT - Use 0/1 (works in both SQLite and PostgreSQL)
WHERE is_wordpress = 1
WHERE ai_processed = 0
WHERE is_active = 1

// ❌ WRONG - Do NOT use TRUE/FALSE (schema uses INTEGER, not BOOLEAN)
WHERE is_wordpress = TRUE
```

**Affected columns:**
- `sites.is_wordpress`, `sites.ai_processed`, `sites.ai_verified_wp`, `sites.ai_content_relevant`
- `linkedin_credentials.is_active`
- `email_senders.is_active`
- `email_templates.is_active`

### Case-Insensitive Searches

PostgreSQL `LIKE` is case-sensitive. Use `ILIKE` for case-insensitive searches:

```javascript
// For URLs, domains, emails
WHERE url ILIKE '%example.com%'
WHERE email ILIKE '%@gmail.com%'
```

### Foreign Key Behavior

Foreign keys use `ON DELETE NO ACTION` or `ON DELETE SET NULL` to prevent accidental data loss. Deleting a parent record will NOT auto-delete child records.

## Migration Checklist

- [ ] Install `pg` package
- [ ] Add `DATABASE_URL` to `.env`
- [ ] Replace `require('./database/database.js')` with `require('./database/db-adapter-init')`
- [ ] Add `await` to all database calls
- [ ] Wrap parameters in arrays: `[param]` instead of `param`
- [ ] Use INTEGER 0/1 for boolean flags (NOT TRUE/FALSE)
- [ ] Replace `LIKE` with `ILIKE` for case-insensitive searches
- [ ] Update `lastInsertRowid` to `lastInsertId` or enable `autoReturning`
- [ ] Test all database operations
- [ ] Verify foreign key constraints work correctly
- [ ] Verify ON DELETE NO ACTION prevents cascading deletes
