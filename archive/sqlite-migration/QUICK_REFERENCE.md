# SQLite → PostgreSQL Migration - Quick Reference

## The Complete Migration Pipeline (5 Commands)

```bash
# 0. Prerequisites: Install pg package
npm install pg

# 1. Export from SQLite (READ-ONLY, safe to run multiple times)
node src/database/migration/export-sqlite.js

# 2. Create PostgreSQL database
psql -U postgres -c "CREATE DATABASE wordpress_lead_generator;"
psql -U postgres -c "CREATE USER migration_user WITH PASSWORD 'your_password';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE wordpress_lead_generator TO migration_user;"

# 3. Apply PostgreSQL schema
psql -U migration_user -d wordpress_lead_generator -f src/database/schema-postgres.sql

# 4. Import to PostgreSQL
DATABASE_URL="postgresql://migration_user:your_password@localhost:5432/wordpress_lead_generator" \
node src/database/migration/import-postgres.js

# 5. Validate migration
psql -U migration_user -d wordpress_lead_generator -f src/database/migration/validation.sql
```

---

## Dry Run (Test Without Changes)

```bash
DATABASE_URL="postgresql://migration_user:your_password@localhost:5432/wordpress_lead_generator" \
DRY_RUN=true \
node src/database/migration/import-postgres.js
```

---

## Add DATABASE_URL to .env

```env
DATABASE_URL=postgresql://migration_user:your_password@localhost:5432/wordpress_lead_generator
```

---

## Quick Validation Commands

```bash
# Connect to PostgreSQL
psql -U migration_user -d wordpress_lead_generator

# Check row counts
SELECT 'sites' as tbl, COUNT(*) FROM sites
UNION ALL SELECT 'email_queue', COUNT(*) FROM email_queue
UNION ALL SELECT 'contacts', COUNT(*) FROM contacts;

# Check for AI processor work
SELECT COUNT(*) FROM sites
WHERE is_wordpress = 1 AND ai_status = 'pending'
AND text_content IS NOT NULL;

# Check for email queue work
SELECT COUNT(*) FROM email_queue WHERE status = 'queued';

# Check foreign key integrity
SELECT COUNT(*) FROM sites WHERE search_id NOT IN (SELECT id FROM searches);
SELECT COUNT(*) FROM contacts WHERE site_id NOT IN (SELECT id FROM sites);
```

---

## Reset Sequences (If Needed)

```sql
SELECT setval('sites_id_seq', (SELECT MAX(id) FROM sites));
SELECT setval('email_queue_id_seq', (SELECT MAX(id) FROM email_queue));
SELECT setval('contacts_id_seq', (SELECT MAX(id) FROM contacts));
```

---

## Rollback to SQLite

```bash
# 1. Stop application
pkill -f "node src/api/server.js"

# 2. Remove DATABASE_URL from .env

# 3. Restart
npm run admin
```

---

## Files Created

```
src/database/migration/
├── export-sqlite.js              # Export SQLite to JSON
├── import-postgres.js            # Import JSON to PostgreSQL
├── validation.sql                # Validation queries
├── COMPLETE_MIGRATION_GUIDE.md   # Full documentation
├── ROLLBACK_GUIDE.md             # Rollback procedures
└── QUICK_REFERENCE.md            # This file
```

---

## Data Safety Guarantees

| Aspect | Guarantee |
|--------|-----------|
| SQLite modifications | NONE - read-only export |
| ID preservation | ALL IDs preserved exactly |
| Foreign keys | All relationships maintained |
| Data loss | ZERO - original SQLite untouched |
| Rollback | Always possible to SQLite |
