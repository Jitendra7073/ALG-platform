# SQLite → PostgreSQL Migration - Rollback Procedures

## Overview

This document provides comprehensive rollback procedures for the SQLite → PostgreSQL migration. **Zero data loss** is guaranteed throughout the migration process.

## Safety Guarantees

1. **SQLite database is NEVER modified** during export
2. **PostgreSQL import can be re-run** without data duplication
3. **Original data always preserved** in migration-data/ directory

---

## Scenarios and Rollback Procedures

### Scenario 1: Import Failed Partway Through

**Symptoms:**
- Import script exited with error
- Some tables imported, some didn't
- PostgreSQL database in unknown state

**Rollback Steps:**

```bash
# 1. Stop all applications
# Make sure no workers are running

# 2. Connect to PostgreSQL and drop all data
psql -U your_user -d your_database

# In psql, run:
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

# 3. Re-apply the PostgreSQL schema
\q
psql -U your_user -d your_database -f src/database/schema-postgres.sql

# 4. Re-run the import
DATABASE_URL="postgresql://user:pass@localhost:5432/dbname" \
node src/database/migration/import-postgres.js
```

**Why this works:** The export data is still in migration-data/ and SQLite is untouched.

---

### Scenario 2: Validation Shows Data Mismatch

**Symptoms:**
- Row counts don't match between SQLite and PostgreSQL
- Foreign key violations detected
- Data appears corrupted

**Rollback Steps:**

```bash
# 1. Investigate the mismatch
# Check the export-manifest.json for expected counts
cat migration-data/export-manifest.json

# 2. Run validation queries to identify specific issues
psql -U your_user -d your_database -f src/database/migration/validation.sql

# 3. If issue cannot be fixed, wipe PostgreSQL and re-import
psql -U your_user -d your_database -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql -U your_user -d your_database -f src/database/schema-postgres.sql

# 4. Re-import
DATABASE_URL="postgresql://user:pass@localhost:5432/dbname" \
node src/database/migration/import-postgres.js
```

---

### Scenario 3: Application Not Working with PostgreSQL

**Symptoms:**
- Application errors after switching to PostgreSQL
- Queries failing
- Workers not processing

**Diagnosis Steps:**

```bash
# 1. Check application logs for specific errors

# 2. Verify database connectivity
psql -U your_user -d your_database -c "SELECT NOW();"

# 3. Run worker compatibility queries
psql -U your_user -d your_database -f src/database/migration/validation.sql

# 4. Check if sequences are synchronized
psql -U your_user -d your_database -c "
SELECT 'sites' as tbl, last_value, (SELECT MAX(id) FROM sites) as max_id FROM sites_id_seq
UNION ALL
SELECT 'email_queue', last_value, (SELECT MAX(id) FROM email_queue) FROM email_queue_id_seq;
"
```

**Rollback if needed:**

```bash
# Switch back to SQLite by setting environment variable
# In .env file, comment out DATABASE_URL and use SQLite instead

# Or temporarily disable DATABASE_URL:
# unset DATABASE_URL

# Restart application with SQLite
npm run admin
```

---

### Scenario 4: Email Queue Issues After Migration

**Symptoms:**
- Email queue worker not processing
- Scheduled emails not sending
- Duplicate sends

**Diagnosis:**

```sql
-- Check email queue status
SELECT status, COUNT(*) FROM email_queue GROUP BY status;

-- Check for stuck "sending" status
SELECT * FROM email_queue WHERE status = 'sending';

-- Verify sender assignments
SELECT eq.id, eq.status, es.id as sender_id, es.email
FROM email_queue eq
LEFT JOIN email_senders es ON eq.sender_id = es.id
WHERE eq.status = 'queued'
LIMIT 10;
```

**Fix for stuck emails:**

```sql
-- Reset stuck "sending" emails back to "queued"
UPDATE email_queue
SET status = 'queued',
    attempts = attempts + 1
WHERE status = 'sending'
AND updated_at < NOW() - INTERVAL '10 minutes';
```

---

## Complete Rollback to SQLite

If you need to completely revert to SQLite:

```bash
# 1. Stop all applications and workers

# 2. Update .env file
# Comment out: DATABASE_URL=postgresql://...
# The application will automatically fall back to SQLite

# 3. Verify SQLite database is intact
node -e "const db = require('./src/database/database.js'); console.log('SQLite OK');"

# 4. Start application with SQLite
npm run admin
```

**Note:** Your SQLite database was never modified, so it remains in the exact state before migration.

---

## Recovery from Backup PostgreSQL

If you need to restore a PostgreSQL backup:

```bash
# 1. Create a backup before any destructive operation
pg_dump -U your_user -d your_database > backup-$(date +%Y%m%d-%H%M%S).sql

# 2. To restore from backup
psql -U your_user -d your_database < backup-YYYYMMDD-HHMMSS.sql

# 3. Or restore to a new database for testing
createdb -U your_user your_database_test
psql -U your_user -d your_database_test < backup-YYYYMMDD-HHMMSS.sql
```

---

## Re-running Migration

To re-run the entire migration from scratch:

```bash
# 1. (Optional) Re-export from SQLite if data changed
node src/database/migration/export-sqlite.js

# 2. Clear PostgreSQL database
psql -U your_user -d your_database -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 3. Re-apply schema
psql -U your_user -d your_database -f src/database/schema-postgres.sql

# 4. Re-import data
DATABASE_URL="postgresql://user:pass@localhost:5432/dbname" \
node src/database/migration/import-postgres.js

# 5. Re-validate
psql -U your_user -d your_database -f src/database/migration/validation.sql
```

---

## Emergency Procedures

### If PostgreSQL Import Hangs

```bash
# 1. Find and kill the import process
ps aux | grep import-postgres
kill -9 <PID>

# 2. Connect to PostgreSQL and check locks
psql -U your_user -d your_database
SELECT * FROM pg_stat_activity WHERE state = 'active';

# 3. Terminate any hanging transactions
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'your_database' AND pid <> pg_backend_pid();

# 4. Start fresh (see "Re-running Migration" above)
```

### If Disk Space Runs Out

```bash
# 1. Check disk space
df -h

# 2. If PostgreSQL disk is full, you may need to clean up
# First, stop PostgreSQL service
sudo systemctl stop postgresql

# 3. Remove partial import data
sudo rm -rf /var/lib/postgresql/<version>/base/*  # BE CAREFUL!

# 4. Restart PostgreSQL
sudo systemctl start postgresql

# 5. Start fresh (see "Re-running Migration" above)
```

---

## Data Safety Checklist

Before starting migration:
- [ ] SQLite database backed up (copy wordpress-detector.db)
- [ ] Enough disk space for 2x database size
- [ ] PostgreSQL server running and accessible
- [ ] DATABASE_URL tested with simple connection

After migration:
- [ ] Export data preserved in migration-data/
- [ ] Validation queries all pass
- [ ] Workers processing correctly
- [ ] SQLite backup kept until verification complete

---

## Support

If you encounter issues not covered here:

1. Check logs in migration-data/export-manifest.json
2. Run validation.sql for diagnostic output
3. Compare row counts between export and import
4. Remember: SQLite is untouched - you can always revert
