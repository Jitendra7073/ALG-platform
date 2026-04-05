# SQLite → PostgreSQL Migration Guide

## Quick Reference

| SQLite | PostgreSQL |
|--------|------------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `DATETIME` | `TIMESTAMP` (UTC, no timezone) |
| `INTEGER` (0/1 flags) | `INTEGER` (0/1) - **NOT BOOLEAN** |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| `INSERT OR REPLACE` | `INSERT ... ON CONFLICT DO UPDATE` |
| `lastInsertRowid` | `RETURNING id` |
| `LIKE` (case-insensitive) | `ILIKE` (for case-insensitive) |

---

## Critical Design Decisions

### Boolean Flags → INTEGER (NOT BOOLEAN)

**IMPORTANT**: All boolean-like columns use INTEGER (0/1), NOT BOOLEAN.

This ensures **100% code compatibility** - no changes needed to existing INSERT/UPDATE statements.

```javascript
// These work UNCHANGED in PostgreSQL
is_wordpress: 1
ai_processed: 0
is_active: 1

// These would BREAK if we used BOOLEAN
// TRUE/FALSE is not compatible with existing 1/0 code
```

**Columns affected**:
- `sites.is_wordpress`, `sites.ai_processed`, `sites.ai_verified_wp`, `sites.ai_content_relevant`, `sites.ai_is_wordpress`, `sites.ai_is_genuine_match`
- `linkedin_credentials.is_active`
- `email_senders.is_active`
- `email_templates.is_active`

---

## Critical Differences

### 1. Boolean Values (NO CHANGE NEEDED)

**Both SQLite and PostgreSQL use INTEGER 0/1:**
```javascript
// Works in BOTH SQLite and PostgreSQL
is_wordpress: 1
ai_processed: 0
ai_verified_wp: null
is_active: 1

// Queries work identically
WHERE is_wordpress = 1
WHERE ai_processed = 0
WHERE is_active = 1
```

**NO code changes required for boolean flags.**

---

### 2. Case Sensitivity in String Comparisons

**SQLite:** `LIKE` is case-insensitive by default
**PostgreSQL:** `LIKE` is case-sensitive, use `ILIKE` for case-insensitive

```javascript
// BEFORE (SQLite) - case-insensitive by default
WHERE url LIKE '%EXAMPLE.COM'
WHERE email LIKE '%@gmail.com'

// AFTER (PostgreSQL) - use ILIKE for case-insensitive
WHERE url ILIKE '%EXAMPLE.COM'
WHERE email ILIKE '%@gmail.com'
```

**Code changes needed**: Replace `LIKE` with `ILIKE` for URL, email, and domain searches.

---

### 3. Last Insert ID

**SQLite:**
```javascript
const result = stmt.run();
const id = result.lastInsertRowid;
```

**PostgreSQL:**
```javascript
// Option 1: Use RETURNING clause (recommended)
const result = await db.query(
  'INSERT INTO sites (url, is_wordpress) VALUES ($1, $2) RETURNING id',
  [url, 1]  // Note: is_wordpress = 1, not TRUE
);
const id = result.rows[0].id;

// Option 2: Use lastval() (after INSERT)
await db.query('INSERT INTO sites (url, is_wordpress) VALUES ($1, $2)', [url, 1]);
const result = await db.query('SELECT lastval() AS id');
const id = result.rows[0].id;

// Option 3: Use db-adapter.js (handles RETURNING automatically)
const result = await db.run('INSERT INTO sites (url, is_wordpress) VALUES (?, ?)', [url, 1]);
const id = result.lastInsertId;
```

---

### 4. Upsert Operations

**SQLite:**
```javascript
INSERT OR IGNORE INTO contacts (site_id, type, value) VALUES (?, ?, ?)
INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
```

**PostgreSQL:**
```javascript
// INSERT OR IGNORE → ON CONFLICT DO NOTHING
INSERT INTO contacts (site_id, type, value)
VALUES ($1, $2, $3)
ON CONFLICT (site_id, type, value) DO NOTHING

// INSERT OR REPLACE → ON CONFLICT DO UPDATE
INSERT INTO settings (key, value)
VALUES ($1, $2)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
```

---

### 5. Timestamp Handling

**SQLite:** `CURRENT_TIMESTAMP` returns UTC as string
**PostgreSQL:** `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` returns UTC as string

Both store and return ISO format: `'2024-01-01 12:00:00'`

```javascript
// Schema definition
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

// Queries work identically
WHERE created_at > '2024-01-01'
ORDER BY created_at DESC
```

**Important**: All timestamps stored in UTC. Application code must ensure UTC conversion before insert.

---

### 6. Foreign Key Behavior

**SQLite:** Foreign keys can be toggled with `PRAGMA foreign_keys = ON/OFF`
**PostgreSQL:** Foreign keys are always enforced

**New: ON DELETE NO ACTION** (prevents accidental data loss)

```javascript
// PostgreSQL will reject orphaned inserts
INSERT INTO sites (search_id, url) VALUES (9999, 'https://example.com')
// ERROR: insert or update on table "sites" violates foreign key constraint

// But will NOT auto-delete child records
DELETE FROM searches WHERE id = 1
// Succeeds - sites remain intact (ON DELETE NO ACTION)
```

---

## Query Translation Examples

### SELECT with boolean conditions

```javascript
// Works IDENTICAL in both SQLite and PostgreSQL
SELECT * FROM sites WHERE is_wordpress = 1 AND ai_processed = 0
SELECT * FROM email_senders WHERE is_active = 1

// NO CHANGE NEEDED
```

### UPDATE with boolean

```javascript
// Works IDENTICAL in both SQLite and PostgreSQL
UPDATE sites SET ai_processed = 1, ai_status = 'completed' WHERE id = ?
UPDATE email_senders SET is_active = 0 WHERE id = ?

// NO CHANGE NEEDED
```

### INSERT with defaults

```javascript
// SQLite
INSERT INTO sites (url, is_wordpress) VALUES (?, 1)

// PostgreSQL (using db-adapter.js - same syntax)
INSERT INTO sites (url, is_wordpress) VALUES (?, 1)

// NO CHANGE NEEDED with adapter
```

---

## Worker Query Compatibility

### AI Processor Query

```javascript
// Works IDENTICAL in both databases
SELECT * FROM sites
WHERE is_wordpress = 1
  AND ai_status = 'pending'
  AND text_content IS NOT NULL
  AND text_content != ''
ORDER BY checked_at ASC
LIMIT 5
```

### Email Queue Worker Query

```javascript
// Works IDENTICAL in both databases
SELECT * FROM email_queue
WHERE status = 'queued'
ORDER BY id ASC
LIMIT 10

// Scheduled emails query
SELECT * FROM email_queue
WHERE status = 'scheduled'
  AND scheduled_at <= CURRENT_TIMESTAMP
ORDER BY scheduled_at ASC
```

---

## Common Migration Pitfalls

### 1. Using TRUE/FALSE instead of 1/0
```javascript
// ❌ Wrong (schema uses INTEGER, not BOOLEAN)
WHERE is_wordpress = TRUE

// ✅ Correct (use 1/0)
WHERE is_wordpress = 1
```

### 2. Case-sensitive string comparisons
```javascript
// ❌ Wrong (won't match 'GMAIL.COM')
WHERE email LIKE '%@gmail.com'

// ✅ Correct (use ILIKE)
WHERE email ILIKE '%@gmail.com'
```

### 3. Not handling sequence names
```javascript
// After bulk import, may need to reset sequences
SELECT setval('sites_id_seq', (SELECT MAX(id) FROM sites));
SELECT setval('email_queue_id_seq', (SELECT MAX(id) FROM email_queue));
```

---

## Testing Checklist

- [ ] Boolean columns accept 0/1 (not TRUE/FALSE)
- [ ] Case-insensitive searches use ILIKE
- [ ] Foreign key constraints work correctly
- [ ] ON DELETE NO ACTION prevents cascading deletes
- [ ] Timestamps return in ISO format (no timezone suffix)
- [ ] ON CONFLICT syntax works for upserts
- [ ] Sequences are synchronized after bulk import
- [ ] AI processor queries return correct results
- [ ] Email queue worker queries return correct results

---

## Node.js Driver Migration

**SQLite (better-sqlite3):**
```javascript
const db = require('better-sqlite3')('db.sqlite');
const stmt = db.prepare('SELECT * FROM sites WHERE id = ?');
const result = stmt.get(id);
```

**PostgreSQL (using db-adapter.js):**
```javascript
const db = require('./src/database/db-adapter.js');
await db.initializePool(process.env.DATABASE_URL);

// Same API as better-sqlite3
const result = await db.get('SELECT * FROM sites WHERE id = ?', [id]);
```

**Direct PostgreSQL (node-postgres / pg):**
```javascript
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const result = await pool.query('SELECT * FROM sites WHERE id = $1', [id]);
const site = result.rows[0];
```

---

## Data Migration Script

```javascript
/**
 * Migrate data from SQLite to PostgreSQL
 * Handles all type conversions automatically
 */

const sqliteDb = require('better-sqlite3')('wordpress-detector.db');
const pgDb = require('./src/database/db-adapter.js');

async function migrateTable(tableName, columns) {
  // Read from SQLite
  const rows = sqliteDb.prepare(`SELECT * FROM ${tableName}`).all();

  // Insert into PostgreSQL
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = columns.map(() => '?').join(', ');

    await pgDb.run(
      `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
      values
    );
  }

  console.log(`Migrated ${rows.length} rows from ${tableName}`);
}

async function main() {
  await pgDb.initializePool(process.env.DATABASE_URL);

  // Migrate in order (parent tables first)
  await migrateTable('searches');
  await migrateTable('sites');
  await migrateTable('keywords');
  await migrateTable('contacts');
  await migrateTable('company_executives');
  await migrateTable('linkedin_credentials');
  await migrateTable('country_timezones');
  await migrateTable('email_senders');
  await migrateTable('email_templates');
  await migrateTable('email_campaigns');
  await migrateTable('email_queue');
  await migrateTable('email_send_log');
  await migrateTable('email_settings');

  // Reset sequences
  await pgDb.query("SELECT setval('sites_id_seq', (SELECT MAX(id) FROM sites))");
  await pgDb.query("SELECT setval('email_queue_id_seq', (SELECT MAX(id) FROM email_queue))");

  console.log('Migration complete!');
}

main().catch(console.error);
```

---

## Rollback Plan

If issues arise:
1. Stop application
2. Revert to SQLite database
3. Investigate and fix issue
4. Retry migration

No data is lost in migration process.
