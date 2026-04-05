# SQLite → PostgreSQL Migration: Complete Production Guide

## Executive Summary

This guide provides a **production-safe, zero-data-loss migration** from SQLite to PostgreSQL. The migration consists of three phases:

1. **EXPORT** - Extract all data from SQLite (READ-ONLY, no modifications)
2. **IMPORT** - Transform and load data into PostgreSQL
3. **VALIDATE** - Verify data integrity and application functionality

**Critical Guarantees:**
- ✅ Zero data loss - SQLite database never modified
- ✅ All IDs preserved - foreign key relationships intact
- ✅ Workers compatible - AI processor and email queue work unchanged
- ✅ Rollback ready - can revert to SQLite at any point

---

## Prerequisites

### Software Required

```bash
# Node.js packages (install if missing)
npm install better-sqlite3 pg

# PostgreSQL client tools
# Ubuntu/Debian: sudo apt-get install postgresql-client
# Windows: Download from postgresql.org
# macOS: brew install postgresql
```

### Pre-Migration Checklist

- [ ] **Backup SQLite database**
  ```bash
  cp wordpress-detector.db wordpress-detector.db.backup.$(date +%Y%m%d)
  ```

- [ ] **Verify PostgreSQL server is running**
  ```bash
  psql -U postgres -c "SELECT version();"
  ```

- [ ] **Create PostgreSQL database**
  ```bash
  psql -U postgres -c "CREATE DATABASE wordpress_lead_generator;"
  psql -U postgres -c "CREATE USER migration_user WITH PASSWORD 'your_password';"
  psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE wordpress_lead_generator TO migration_user;"
  ```

- [ ] **Test DATABASE_URL**
  ```bash
  psql "postgresql://migration_user:your_password@localhost:5432/wordpress_lead_generator"
  ```

---

## Phase 1: Export Data from SQLite

### Step 1.1: Run Export Script

```bash
node src/database/migration/export-sqlite.js
```

**Expected Output:**
```
======================================================================
SQLite → PostgreSQL Migration - EXPORT
======================================================================

Source Database: d:\wordpress-site\wordpress-detector.db
Export Directory: d:\wordpress-site\migration-data

[EXPORT] searches...
  Columns: id, query, country, total_sites, wordpress_count, ...
  Rows: 150

[EXPORT] sites...
  Columns: id, search_id, url, country, is_wordpress, ...
  Rows: 5420

[EXPORT] email_queue (CRITICAL TABLE)...
  Total: 250 rows
  Status distribution: { queued: 45, scheduled: 100, sent: 95, failed: 10 }
  Scheduled emails: 100
  Failed emails: 10

...
======================================================================
EXPORT COMPLETE
======================================================================

Total tables exported: 15
Total rows exported: 6890
Manifest saved to: export-manifest.json
```

### Step 1.2: Verify Export

```bash
# Check export directory
ls -la migration-data/

# View manifest
cat migration-data/export-manifest.json

# Verify critical tables
cat migration-data/sites.json | jq '. | length'
cat migration-data/email_queue.json | jq '. | length'
```

**Troubleshooting:**
- If export fails: Check SQLite database is not locked by running applications
- If files are empty: Verify database path is correct

---

## Phase 2: Import to PostgreSQL

### Step 2.1: Apply PostgreSQL Schema

```bash
# Read password from environment or prompt
psql -U migration_user -d wordpress_lead_generator -f src/database/schema-postgres.sql
```

**Expected Output:**
```
CREATE EXTENSION
CREATE TABLE
CREATE TABLE
...
CREATE INDEX
CREATE TRIGGER
```

### Step 2.2: Dry Run Import (Recommended)

```bash
# Test import without writing data
DATABASE_URL="postgresql://migration_user:your_password@localhost:5432/wordpress_lead_generator" \
DRY_RUN=true \
node src/database/migration/import-postgres.js
```

**Expected Output:**
```
======================================================================
SQLite → PostgreSQL Migration - IMPORT
======================================================================

[IMPORT] searches...
  [VALIDATE] 150 rows, checksum: a1b2c3d4e5f6...
  [DRY RUN] Would import 150 rows

[IMPORT] sites...
  [VALIDATE] 5420 rows, checksum: f6e5d4c3b2a1...
  [DRY RUN] Would import 5420 rows
...
[INFO] Dry run complete - no data was imported
```

### Step 2.3: Actual Import

```bash
# Remove DRY_RUN to perform actual import
DATABASE_URL="postgresql://migration_user:your_password@localhost:5432/wordpress_lead_generator" \
node src/database/migration/import-postgres.js
```

**Expected Output:**
```
======================================================================
SQLite → PostgreSQL Migration - IMPORT
======================================================================

[IMPORT] searches...
  [VALIDATE] 150 rows
  [SUCCESS] 150 rows imported
  [SEQUENCE] Reset searches_id_seq to 150

[IMPORT] sites...
  [VALIDATE] 5420 rows
  [CRITICAL] Extra validation for sites
  [SUCCESS] 5420 rows imported
  [SEQUENCE] Reset sites_id_seq to 5420

[IMPORT] email_queue (CRITICAL TABLE)...
  Total: 250 rows
  Status distribution: { queued: 45, scheduled: 100, sent: 95, failed: 10 }
  [VALIDATE] 250 rows
  [SUCCESS] 250 rows imported

...
======================================================================
IMPORT COMPLETE
======================================================================

Tables imported: 15
Total rows imported: 6890
```

---

## Phase 3: Validation

### Step 3.1: Run Validation Queries

```bash
psql -U migration_user -d wordpress_lead_generator -f src/database/migration/validation.sql
```

**Expected Output (abbreviated):**
```
============================================================================
POSTGRESQL MIGRATION VALIDATION
============================================================================

1. ROW COUNTS
--------------------------------------------------------------------------
 Core Tables:
 searches       | 150
 keywords       | 25
 sites          | 5420
 contacts       | 1250
 ...

2. CRITICAL TABLE: email_queue
--------------------------------------------------------------------------
 Status distribution:
 queued      | 45
 scheduled   | 100
 sent        | 95
 failed      | 10

 Queued emails (ready to send): 45

6. FOREIGN KEY INTEGRITY
--------------------------------------------------------------------------
 All FK violations (should return 0 rows):
 sites with invalid search_id           | 0
 contacts with invalid site_id          | 0
 ...
 All counts above should be 0.

11. AI PROCESSOR QUERY VALIDATION
--------------------------------------------------------------------------
 Query that ai-processor.js will run:
 ai_processor_pending_count: 120

============================================================================
VALIDATION COMPLETE
============================================================================
```

### Step 3.2: Manual Verification

```sql
-- Connect to PostgreSQL
psql -U migration_user -d wordpress_lead_generator

-- Verify critical data points
SELECT COUNT(*) FROM sites WHERE is_wordpress = 1;  -- Should match SQLite
SELECT COUNT(*) FROM contacts WHERE type = 'email'; -- Should match SQLite
SELECT COUNT(*) FROM email_queue WHERE status = 'queued'; -- Should match SQLite

-- Verify AI processor will find work
SELECT COUNT(*) FROM sites
WHERE is_wordpress = 1
  AND ai_status = 'pending'
  AND text_content IS NOT NULL;

-- Verify email queue worker will find work
SELECT COUNT(*) FROM email_queue WHERE status = 'queued';
```

---

## Phase 4: Application Cutover

### Step 4.1: Update Environment Variables

Edit `.env` file:

```env
# Add PostgreSQL connection
DATABASE_URL=postgresql://migration_user:your_password@localhost:5432/wordpress_lead_generator

# Original SQLite remains as backup
# No changes to SQLite database
```

### Step 4.2: Restart Application

```bash
# Stop any running instances
pkill -f "node src/api/server.js"
pkill -f "node src/services/ai/ai-processor.js"

# Start with new database
npm run admin
```

### Step 4.3: Monitor Workers

```bash
# Check AI processor logs
# Should see: "Processing X pending sites"

# Check email queue worker logs
# Should see: "Processing X queued emails"
```

### Step 4.4: Smoke Tests

1. **Admin Panel:** Access `http://localhost:8080` and verify:
   - Dashboard loads with correct statistics
   - Sites list displays correctly
   - Email queue shows correct status

2. **AI Processing:** Verify pending sites are processed:
   ```sql
   -- Check AI status changes
   SELECT ai_status, COUNT(*) FROM sites GROUP BY ai_status;
   ```

3. **Email Queue:** Verify emails send correctly:
   ```sql
   -- Check queue processing
   SELECT status, COUNT(*) FROM email_queue GROUP BY status;
   ```

---

## Post-Migration Checklist

- [ ] All validation queries pass
- [ ] Admin panel loads correctly
- [ ] AI processor working (pending sites decrease)
- [ ] Email queue worker working (queued emails decrease)
- [ ] No errors in application logs
- [ ] SQLite backup preserved
- [ ] Export data preserved in migration-data/

---

## Troubleshooting

### Issue: Import fails with "relation does not exist"

**Cause:** PostgreSQL schema not applied

**Fix:**
```bash
psql -U migration_user -d wordpress_lead_generator -f src/database/schema-postgres.sql
```

### Issue: "Duplicate key value violates unique constraint"

**Cause:** Import run twice on same database

**Fix:**
```bash
# Drop and recreate schema
psql -U migration_user -d wordpress_lead_generator -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql -U migration_user -d wordpress_lead_generator -f src/database/schema-postgres.sql
# Re-run import
```

### Issue: Workers not processing

**Cause:** Sequences not synchronized

**Fix:**
```sql
-- Reset sequences
SELECT setval('sites_id_seq', (SELECT MAX(id) FROM sites));
SELECT setval('email_queue_id_seq', (SELECT MAX(id) FROM email_queue));
SELECT setval('contacts_id_seq', (SELECT MAX(id) FROM contacts));
```

### Issue: Application still using SQLite

**Cause:** DATABASE_URL not set or not read

**Fix:**
```bash
# Verify DATABASE_URL is set
echo $DATABASE_URL

# Check if db-adapter.js is being used
grep -r "DATABASE_URL" src/
```

---

## Rollback

If you need to rollback to SQLite:

```bash
# 1. Stop application
pkill -f "node src/api/server.js"

# 2. Remove DATABASE_URL from .env
# Comment out or delete the line

# 3. Restart with SQLite
npm run admin

# SQLite database was never modified - all data intact
```

See [ROLLBACK_GUIDE.md](./ROLLBACK_GUIDE.md) for detailed rollback procedures.

---

## Performance Considerations

### Import Speed

For large databases (>100,000 rows):

```javascript
// In import-postgres.js, increase batch size
// Change from row-by-row to batches:
const BATCH_SIZE = 1000;
for (let i = 0; i < data.length; i += BATCH_SIZE) {
  const batch = data.slice(i, i + BATCH_SIZE);
  // Batch insert logic
}
```

### Post-Import Indexing

Indexes are created by schema-postgres.sql. For very large datasets, create indexes AFTER import:

```sql
-- Drop indexes first
DROP INDEX IF EXISTS idx_sites_search_id;
DROP INDEX IF EXISTS idx_sites_is_wordpress;
-- ... etc

-- Import data (much faster without indexes)

-- Recreate indexes
CREATE INDEX idx_sites_search_id ON sites(search_id);
CREATE INDEX idx_sites_is_wordpress ON sites(is_wordpress);
-- ... etc
```

---

## File Summary

| File | Purpose |
|------|---------|
| `export-sqlite.js` | Export SQLite data to JSON (READ-ONLY) |
| `import-postgres.js` | Import JSON data to PostgreSQL |
| `validation.sql` | Verify migration success |
| `ROLLBACK_GUIDE.md` | Detailed rollback procedures |
| `COMPLETE_MIGRATION_GUIDE.md` | This file |

---

## Support

If issues arise:

1. Check validation.sql output for specific problems
2. Review export-manifest.json for expected data
3. Remember: SQLite is untouched - you can always revert
4. Check PostgreSQL logs: `sudo tail -f /var/log/postgresql/postgresql-*.log`

---

## Success Criteria

Migration is successful when:

1. ✅ All 15 tables imported with matching row counts
2. ✅ Zero foreign key violations
3. ✅ AI processor queries return expected results
4. ✅ Email queue worker processes emails
5. ✅ Admin panel displays data correctly
6. ✅ No errors in application logs
7. ✅ SQLite backup preserved

Once all criteria met, migration is complete and production-ready!
