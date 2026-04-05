# PostgreSQL Schema Changes Summary

## Production Migration from SQLite to PostgreSQL

---

## Critical Changes Applied

### 1. BOOLEAN → INTEGER Conversion (CRITICAL)

**All boolean flag columns converted from BOOLEAN to INTEGER (0/1)**

| Table | Column | Old Type | New Type | Reason |
|-------|--------|----------|----------|--------|
| sites | is_wordpress | BOOLEAN | INTEGER | Existing code uses 1/0 |
| sites | ai_processed | BOOLEAN | INTEGER | Existing code uses 1/0 |
| sites | ai_verified_wp | BOOLEAN | INTEGER | Existing code uses 1/0 |
| sites | ai_content_relevant | BOOLEAN | INTEGER | Existing code uses 1/0 |
| sites | ai_is_wordpress | BOOLEAN | INTEGER | Existing code uses 1/0 |
| sites | ai_is_genuine_match | BOOLEAN | INTEGER | Existing code uses 1/0 |
| linkedin_credentials | is_active | BOOLEAN | INTEGER | Existing code uses 1/0 |
| email_senders | is_active | BOOLEAN | INTEGER | Existing code uses 1/0 |
| email_templates | is_active | BOOLEAN | INTEGER | Existing code uses 1/0 |

**Impact**: NO code changes required. Existing INSERT/UPDATE statements using 1/0 work unchanged.

**Check constraints added**: All boolean flag columns have CHECK (column IN (0, 1)) to ensure data integrity.

---

### 2. Foreign Key Safety - CASCADE Removed (CRITICAL)

**Changed all ON DELETE CASCADE to safer actions**

| Table | Column | Old Action | New Action | Reason |
|-------|--------|------------|------------|--------|
| sites | search_id | CASCADE | NO ACTION | Preserve searches even if sites deleted |
| contacts | site_id | CASCADE | NO ACTION | **Never** auto-delete contacts (audit trail) |
| company_executives | site_id | CASCADE | NO ACTION | Preserve executive data |
| email_queue | campaign_id | CASCADE | SET NULL | Preserve queue if campaign deleted |
| email_send_log | contact_id | CASCADE | NO ACTION | **Never** auto-delete log history |

**Impact**: Critical data is protected from accidental deletion. Manual cleanup required for orphaned records (if needed).

**Risks Mitigated**:
- Deleting a site no longer deletes all associated contacts
- Deleting a campaign no longer deletes queued emails
- Deleting a contact no longer deletes email send log history

---

### 3. TIMESTAMP Type Change

| Table | Columns | Old Type | New Type | Reason |
|-------|---------|----------|----------|--------|
| All tables | created_at, updated_at, etc. | TIMESTAMPTZ | TIMESTAMP | SQLite compatibility |

**Why TIMESTAMP instead of TIMESTAMPTZ**:
- SQLite stores DATETIME as ISO strings: `'2024-01-01 12:00:00'`
- PostgreSQL TIMESTAMPTZ adds timezone suffix: `'2024-01-01 12:00:00+00'`
- Existing code may expect ISO format without timezone
- All times stored in UTC (application responsibility)

**Impact**: Minimal. Code that parses timestamps as strings sees identical format.

---

### 4. Indexes Added for Worker Queries

**AI Processor Optimization**:
```sql
-- Compound index for most common AI query
CREATE INDEX idx_sites_wordpress_pending_ai
ON sites(is_wordpress, ai_status, checked_at)
WHERE is_wordpress = 1 AND ai_status = 'pending';
```

**Email Queue Worker Optimization**:
```sql
-- Compound index for queue processing
CREATE INDEX idx_email_queue_status_id
ON email_queue(status, id);

-- Scheduled emails index
CREATE INDEX idx_email_queue_status_scheduled
ON email_queue(status, scheduled_at)
WHERE status = 'scheduled';
```

**Active Senders/Templates** (Partial indexes):
```sql
CREATE INDEX idx_email_senders_is_active
ON email_senders(id) WHERE is_active = 1;

CREATE INDEX idx_email_templates_is_active
ON email_templates(id) WHERE is_active = 1;
```

---

### 5. Views Updated for INTEGER Boolean Flags

**vw_wordpress_pending_ai**:
```sql
-- Changed: WHERE is_wordpress = TRUE
-- To:      WHERE is_wordpress = 1
```

**vw_active_email_senders**:
```sql
-- New view for active senders
-- WHERE is_active = 1
```

---

### 6. Check Constraints Added

**Boolean Flag Validation**:
- All INTEGER boolean columns have CHECK (column IN (0, 1))
- Prevents invalid values like 2, -1, etc.

**Status Column Validation**:
- `sites.ai_status`: pending, processing, completed, failed
- `keywords.status`: pending, processing, completed, failed
- `email_queue.status`: queued, scheduled, sending, sent, failed, cancelled
- `email_campaigns.status`: queued, running, paused, completed, failed
- `email_send_log.status`: sent, failed, bounced, opened, clicked

---

## What Was NOT Changed

| Category | Details |
|----------|---------|
| Table names | All preserved exactly |
| Column names | All preserved exactly |
| Relationships | All foreign keys preserved |
| Default values | All defaults preserved |
| NOT NULL constraints | All preserved |
| UNIQUE constraints | All preserved |

---

## Query Compatibility

### Existing Queries Work Without Changes

```sql
-- AI processor query (works unchanged)
SELECT * FROM sites WHERE is_wordpress = 1 AND ai_status = 'pending'

-- Email queue query (works unchanged)
SELECT * FROM email_queue WHERE status = 'queued' LIMIT 10

-- Active senders query (works unchanged)
SELECT * FROM email_senders WHERE is_active = 1
```

### Queries That Need Updates

```sql
-- ❌ Case-sensitive LIKE (PostgreSQL default)
WHERE url LIKE '%EXAMPLE.COM'

-- ✅ Use ILIKE for case-insensitive
WHERE url ILIKE '%example.com%'
```

---

## Default Values Preserved

| Table | Column | Default |
|-------|--------|---------|
| sites | country | 'in' |
| sites | confidence_score | 0 |
| sites | ai_processed | 0 |
| sites | ai_status | 'pending' |
| sites | retry_count | 0 |
| keywords | max_sites | 20 |
| keywords | status | 'pending' |
| email_senders | daily_limit | 500 |
| email_senders | is_active | 1 |
| email_senders | sent_today | 0 |
| email_queue | status | 'queued' |
| email_queue | attempts | 0 |
| email_send_log | send_type | 'main' |
| email_send_log | status | 'sent' |

---

## Risk Notes

### Low Risk

| Area | Risk Level | Notes |
|------|------------|-------|
| Boolean flags | LOW | INTEGER 0/1 works identically to existing code |
| Foreign keys | LOW | NO ACTION prevents accidental deletion |
| Indexes | LOW | Only improves performance |
| Defaults | LOW | All preserved |

### Medium Risk

| Area | Risk Level | Mitigation |
|------|------------|------------|
| Case sensitivity | MEDIUM | Use ILIKE for URL/domain searches |
| Orphaned records | MEDIUM | Manual cleanup may be needed for deleted parent records |

### High Risk

| Area | Risk Level | Mitigation |
|------|------------|------------|
| Timezone handling | HIGH | Application must ensure UTC storage |
| Data migration | HIGH | Test migration with production copy first |

---

## Testing Checklist

- [ ] Verify AI processor queries work: `WHERE is_wordpress = 1`
- [ ] Verify email queue worker queries work: `WHERE status = 'queued'`
- [ ] Verify INSERT with 1/0 values works
- [ ] Verify UPDATE with 1/0 values works
- [ ] Test case-insensitive searches with ILIKE
- [ ] Verify foreign key constraints prevent invalid inserts
- [ ] Verify ON DELETE NO ACTION prevents cascading deletes
- [ ] Test scheduled email queries with `scheduled_at`
- [ ] Verify timezone-scheduler.js queries work
- [ ] Verify views return correct data

---

## Migration Steps

1. **Backup SQLite database**
2. **Run schema-postgres.sql in PostgreSQL**
3. **Migrate data using script** (handles 1/0 boolean conversion)
4. **Verify record counts match**
5. **Test worker queries**
6. **Test application endpoints**
7. **Monitor for errors**

---

## Rollback Plan

If issues arise:
1. Stop application
2. Revert to SQLite database
3. Investigate and fix issue
4. Retry migration

No data is lost in migration process.
