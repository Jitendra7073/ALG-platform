# Database Migrations

This directory contains PostgreSQL migration scripts for the email system.

## Files

- `001_init_tables.sql` - Creates all email system tables
- `002_seed_data.sql` - Seeds default settings and country timezone data
- `migrate.ts` - TypeScript migration runner

## Tables Created

### Email System Tables

1. **`email_senders`** - Email sender accounts (Gmail, SMTP, Resend, SendGrid)
2. **`email_templates`** - Reusable email templates with variable substitution
3. **`email_campaigns`** - Email campaigns organizing multiple templates and targets
4. **`email_queue`** - Queue for email sending with retry logic and idempotency
5. **`email_sequence_state`** - Tracks progress of email sequences per contact
6. **`email_send_log`** - Append-only log of all email send attempts
7. **`email_settings`** - Key-value store for email system configuration
8. **`country_timezones`** - Timezone and business hours data for countries worldwide

## Usage

### Set Database URL

Make sure your `DATABASE_URL` environment variable is set:

```bash
# Supabase
export DATABASE_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres"

# Local PostgreSQL
export DATABASE_URL="postgresql://user:password@localhost:5432/email_system"
```

Or add to `.env.local`:

```env
DATABASE_URL=postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres
```

### Run Migrations

```bash
# Run pending migrations
npm run db:migrate

# Check migration status
npm run db:migrate:status

# Reset and re-run all migrations (DEV ONLY!)
npm run db:migrate:reset
```

### Direct Usage

```bash
# Run migrations
tsx database/migrations/migrate.ts

# Show status
tsx database/migrations/migrate.ts --status

# Reset all
tsx database/migrations/migrate.ts --reset
```

## PostgreSQL Features Used

- **SERIAL PRIMARY KEY** - Auto-incrementing IDs
- **TIMESTAMPTZ** - Timestamps with timezone awareness
- **TEXT[]** - Arrays for tags and business days
- **JSONB** - Flexible JSON storage for settings and criteria
- **FOREIGN KEYS** - Referential integrity with CASCADE/SET NULL
- **CHECK constraints** - Validate enum-like values
- **GIN indexes** - Fast array searching
- **Partial indexes** - Indexes with WHERE clauses
- **TRIGGERS** - Auto-update `updated_at` timestamps
- **SKIP LOCKED** - Concurrent queue processing

## Schema Highlights

### Email Queue
- Idempotency keys to prevent duplicate sends
- Processing tokens for concurrent worker safety
- Priority-based scheduling
- Retry tracking with max attempts
- Dependency tracking for sequence emails

### Country Timezones
- 70+ countries with timezone data
- Business hours configuration
- Weekend day patterns (varies by region)
- Middle East countries have Fri-Sat weekends

### Email Settings
- Configurable delays between emails
- Follow-up gap settings (2-4 days)
- Business hours respect toggle
- Retry delay configuration
- Batch size and queue processing interval

## Adding New Migrations

1. Create a new SQL file: `003_your_migration.sql`
2. Name it chronologically after existing migrations
3. The migration runner will automatically detect and run it

Example:
```sql
-- 003_add_new_feature.sql
ALTER TABLE email_queue ADD COLUMN new_field VARCHAR(255);
CREATE INDEX idx_email_queue_new_field ON email_queue(new_field);
```

## Troubleshooting

### Connection Issues
```
Error: DATABASE_URL environment variable is not set.
```
Set the `DATABASE_URL` in your environment or `.env.local` file.

### Permission Issues
Make sure your database user has CREATE TABLE and ALTER SCHEMA permissions.

### Migration Conflicts
If a migration fails, it will rollback automatically. Fix the issue and run again.
