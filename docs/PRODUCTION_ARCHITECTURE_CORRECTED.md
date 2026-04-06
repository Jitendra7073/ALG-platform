# Production-Ready Email System Architecture (Corrected)
## Critical Review & Hardened Design

**Version:** 2.0 (Corrected)
**Date:** 2026-04-06
**Status:** Production Architecture

---

## 1. Critical Issues in Previous Plan

### 1.1 Database Choice Problems

| Issue | Why It's Critical | Production Impact |
|-------|------------------|-------------------|
| **SQLite write locking** | Only ONE writer at a time, even with WAL | Worker scaling impossible, deadlocks under load |
| **Turso limitations** | 5K rows/sec write limit, eventual consistency | Email sending rate bottleneck, lost updates |
| **No proper transactions** | SQLite has limited transaction support | Race conditions between queue reads and status updates |
| **No foreign key enforcement** | Previous design didn't leverage FK constraints | Orphaned records, inconsistent state |

**The Fix**: Use PostgreSQL with proper transaction isolation and row-level locking.

### 1.2 Vercel Limitations Not Addressed

| Issue | Why It's Critical |
|-------|------------------|
| **Serverless functions timeout** | Max 10-60 seconds execution - insufficient for batch operations |
| **No persistent connections** | Cannot maintain Redis connection pooling efficiently |
| **Cold start delays** | First API call after idle has 1-3s latency |
| **No background jobs** | Cannot run queue workers or schedulers |

**The Fix**: Vercel for UI/lightweight APIs ONLY. Persistent worker service on Railway/Render/VPS.

### 1.3 Queue Reliability Issues

| Issue | Why It's Critical |
|-------|------------------|
| **No idempotency keys** | Same email could be sent twice on retry |
| **Worker crash mid-send** | Email sent but DB not updated = duplicate on retry |
| **No distributed locking** | Two workers could claim same queue item |
| **Missing dead-letter handling** | Permanent failures clog the queue indefinitely |

**The Fix**: Implement proper idempotency layer with unique constraints and transactional sends.

### 1.4 Sequence Logic Flaws

```javascript
// FLAW 1: Cron-based follow-up scheduler is fragile
// It scans entire database every hour - doesn't scale
// If cron job misses, follow-ups are delayed

// FLAW 2: No strict dependency enforcement
// What if follow-up job processes BEFORE main email sent?
// The scheduler just checks DB - no locking

// FLAW 3: Failure recovery is incomplete
// If Email 1 fails, should Email 2 be scheduled?
// Previous design: "Don't schedule" - but what if Email 1 already in queue?
```

**The Fix**: Event-driven sequence chain, not cron scanning.

### 1.5 Over-Engineering Issues

| Component | Previous Plan | Why It's Overkill |
|-----------|---------------|-------------------|
| **Socket.io** | Real-time updates | Adds infrastructure complexity; SSE sufficient |
| **Multiple cron jobs** | Separate scheduler, health workers | Unnecessary - one worker handles all |
| **Separate scheduler queue** | `email-scheduler` queue | Redundant - same queue with delays works |
| **Complex prioritizer** | Multiple priority levels | Simple "business hours now" flag is enough |

---

## 2. Corrected Architecture

### 2.1 System Responsibilities

```
┌─────────────────────────────────────────────────────────────────────┐
│                     RESPONSIBILITY SEPARATION                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐              ┌─────────────────────┐      │
│  │    NEXT.JS (Vercel) │              │   WORKER SERVICE    │      │
│  │                     │              │   (Railway/VPS)     │      │
│  │  ✓ UI/Dashboard     │              │                     │      │
│  │  ✓ CRUD APIs        │              │  ✓ Queue processing │      │
│  │  ✓ Validation       │              │  ✓ Email sending    │      │
│  │  ✓ User auth        │              │  ✓ Retry logic      │      │
│  │  ✗ No background    │              │  ✓ Sequencing       │      │
│  │  ✗ No long jobs     │              │  ✓ Scheduling       │      │
│  │  ✗ No queue work    │              │  ✓ Health checks    │      │
│  └─────────────────────┘              └─────────────────────┘      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Final Clean Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            USER INTERACTION                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     Next.js Frontend                             │   │
│  │                     (Hosted on Vercel)                           │   │
│  │                                                                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │   │
│  │  │  Dashboard  │  │  Templates  │  │  Campaigns  │              │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │   │
│  │  │   Queue     │  │   Leads     │  │  Settings   │              │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                  │
│                                    ▼                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     API Routes (Vercel)                          │   │
│  │                                                                   │   │
│  │  POST /api/queue/add       → Validates, creates DB records       │   │
│  │  GET  /api/queue           → Returns queue state                │   │
│  │  POST /api/templates       → Template CRUD                      │   │
│  │  GET  /api/stats           → Statistics (read-only queries)     │   │
│  │                                                                   │   │
│  │  ✗ NO queue processing                                         │   │
│  │  ✗ NO email sending                                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
        ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
        │  PostgreSQL   │ │    Redis      │ │  External     │
        │  (Neon/Supa)  │ │   (Upstash)   │ │  Services     │
        │               │ │               │ │               │
        │  - sites      │ │  - Job Queue  │ │  - Resend     │
        │  - contacts   │ │  - Rate Limit │ │  - SendGrid   │
        │  - email_*    │ │  - Locks      │ │               │
        │  - sequences  │ │               │ │               │
        └───────────────┘ └───────────────┘ └───────────────┘
                    │
                    ▼
        ┌───────────────────────────────────────────────────────────────┐
        │                    WORKER SERVICE                              │
        │                    (Railway / Render / VPS)                    │
        │                                                                │
        │  ┌────────────────────────────────────────────────────────┐   │
        │  │                    BullMQ Worker                        │   │
        │  │                                                           │   │
        │  │  process('send-email')                                  │   │
        │  │    1. Acquire distributed lock                          │   │
        │  │    2. Validate business hours                           │   │
        │  │    3. Check idempotency key                            │   │
        │  │    4. Get sender (round-robin, respect limits)          │   │
        │  │    5. Send email via provider                           │   │
        │  │    6. Update DB (transaction)                           │   │
        │  │    7. Schedule follow-up if needed                      │   │
        │  │    8. Release lock                                     │   │
        │  └────────────────────────────────────────────────────────┘   │
        │                                                                │
        │  ┌────────────────────────────────────────────────────────┐   │
        │  │                    Health Monitor                       │   │
        │  │  - Worker heartbeats to Redis                          │   │
        │  │  - Dead letter queue processing                        │   │
        │  │  - Stuck job recovery                                  │   │
        │  └────────────────────────────────────────────────────────┘   │
        └───────────────────────────────────────────────────────────────┘
```

---

## 3. Database Design (PostgreSQL Optimized)

### 3.1 Schema with Proper Constraints

```sql
-- =====================================================
-- CORE TABLES (Existing - Read Only for Email System)
-- =====================================================

-- Sites table (from scraper, read-only)
CREATE TABLE IF NOT EXISTS sites (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'in',
    -- ... other fields from existing system
    CHECK (country IN ('in', 'us', 'uk', 'ca', 'au', 'de', 'fr', 'ae', 'sg', 'jp'))
);

-- Contacts table (from scraper, read-only)
CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL REFERENCES sites(id),
    type TEXT NOT NULL CHECK (type IN ('email', 'phone', 'linkedin')),
    value TEXT NOT NULL,
    is_bouncing BOOLEAN DEFAULT FALSE,
    bounce_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(site_id, type, value)
);

-- =====================================================
-- EMAIL SYSTEM TABLES (Write-Heavy)
-- =====================================================

-- Email senders with proper constraints
CREATE TABLE IF NOT EXISTS email_senders (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    -- Password stored encrypted
    password_encrypted TEXT NOT NULL,
    service TEXT NOT NULL DEFAULT 'gmail' CHECK (service IN ('gmail', 'smtp', 'resend', 'sendgrid')),

    -- SMTP settings for custom service
    smtp_host TEXT,
    smtp_port INTEGER CHECK (smtp_port BETWEEN 1 AND 65535),
    smtp_user TEXT,

    -- Rate limiting
    daily_limit INTEGER NOT NULL DEFAULT 500 CHECK (daily_limit > 0),
    hourly_limit INTEGER NOT NULL DEFAULT 50 CHECK (hourly_limit > 0),

    -- Status tracking
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sent_today INTEGER NOT NULL DEFAULT 0 CHECK (sent_today >= 0),
    sent_hour INTEGER NOT NULL DEFAULT 0 CHECK (sent_hour >= 0),
    last_reset_date DATE,
    last_reset_hour TIMESTAMPTZ,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CHECK (sent_today <= daily_limit)
);

-- Indexes for sender selection
CREATE INDEX idx_senders_active_daily ON email_senders(is_active, sent_today, daily_limit)
    WHERE is_active = TRUE;

-- Email templates with versioning
CREATE TABLE IF NOT EXISTS email_templates (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    html_content TEXT NOT NULL,
    text_content TEXT,

    -- Organization
    category TEXT NOT NULL DEFAULT 'general',
    tags TEXT[] DEFAULT '{}',
    sequence_number INTEGER NOT NULL DEFAULT 0 CHECK (sequence_number >= 0),

    -- Validation
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Tracking
    version INTEGER NOT NULL DEFAULT 1,
    parent_template_id INTEGER REFERENCES email_templates(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique name within category
    UNIQUE(category, name)
);

-- GIN index for array tag searches
CREATE INDEX idx_templates_tags ON email_templates USING GIN(tags);

-- Email campaigns
CREATE TABLE IF NOT EXISTS email_campaigns (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,

    -- Template selection
    template_tag TEXT NOT NULL, -- Use tag, not single template ID
    template_ids INTEGER[] NOT NULL REFERENCES email_templates(id),

    -- Targeting
    target_criteria JSONB, -- Flexible targeting rules

    -- Status
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'failed')),

    -- Counts
    total_recipients INTEGER NOT NULL DEFAULT 0,
    queued_count INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,

    -- Timing
    start_after TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- QUEUE TABLE (Critical - Needs Transaction Safety)
-- =====================================================

CREATE TABLE IF NOT EXISTS email_queue (
    id SERIAL PRIMARY KEY,

    -- Relationships
    campaign_id INTEGER REFERENCES email_campaigns(id),
    sender_id INTEGER REFERENCES email_senders(id),
    contact_id INTEGER NOT NULL REFERENCES contacts(id),

    -- Recipient info (denormalized for performance)
    recipient_email TEXT NOT NULL,
    recipient_name TEXT,

    -- Email content (denormalized - snapshot at queue time)
    template_id INTEGER NOT NULL REFERENCES email_templates(id),
    subject TEXT NOT NULL,
    html_content TEXT NOT NULL,
    text_content TEXT,

    -- Sequence tracking
    sequence_tag TEXT NOT NULL, -- The tag that groups this sequence
    sequence_position INTEGER NOT NULL CHECK (sequence_position > 0),
    depends_on_queue_id INTEGER REFERENCES email_queue(id), -- Previous email in sequence

    -- Scheduling
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending',           -- Initial state, not yet processed
            'scheduled',         -- Has scheduled_at, waiting for time
            'acquired',          -- Worker has picked it up (processing)
            'sent',              -- Successfully sent
            'failed',            -- Failed, will retry
            'failed_permanent',  -- Permanent failure, no retry
            'cancelled'          -- User cancelled
        )),
    priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),

    -- Timing
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,     -- When worker picked it up
    completed_at TIMESTAMPTZ,   -- When finished (sent or failed)

    -- Retry tracking
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
    last_error TEXT,
    last_error_at TIMESTAMPTZ,

    -- Idempotency (CRITICAL)
    idempotency_key TEXT NOT NULL UNIQUE,
    processing_token TEXT,     -- Set when worker acquires, used for lock verification

    -- Timezone info
    country_code TEXT NOT NULL CHECK (country_code IN ('in', 'us', 'uk', 'ca', 'au', 'de', 'fr', 'ae', 'sg', 'jp')),

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CHECK (attempts <= max_attempts),
    CHECK (scheduled_at IS NULL OR scheduled_at > created_at),
    CHECK (started_at IS NULL OR started_at >= scheduled_at),
    CHECK (depends_on_queue_id IS NULL OR sequence_position > 1)
);

-- Critical indexes for queue processing
CREATE INDEX idx_queue_status_scheduled
    ON email_queue(status, scheduled_at)
    WHERE status IN ('pending', 'scheduled');

CREATE INDEX idx_queue_campaign_status
    ON email_queue(campaign_id, status);

CREATE INDEX idx_queue_contact_sequence
    ON email_queue(contact_id, sequence_tag, sequence_position, status);

CREATE INDEX idx_queue_processing
    ON email_queue(status, priority, scheduled_at)
    WHERE status IN ('pending', 'scheduled')
    AND (scheduled_at IS NULL OR scheduled_at <= NOW());

-- Partial index for acquiring jobs (prevents double-acquisition)
CREATE INDEX idx_queue_acquire
    ON email_queue(id, status)
    WHERE status = 'pending'
    OR (status = 'scheduled' AND scheduled_at <= NOW());

-- =====================================================
-- SEQUENCE STATE TABLE (New - Critical for reliability)
-- =====================================================

CREATE TABLE IF NOT EXISTS email_sequence_state (
    id SERIAL PRIMARY KEY,

    -- Identification
    contact_id INTEGER NOT NULL REFERENCES contacts(id),
    campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id),
    sequence_tag TEXT NOT NULL,

    -- State tracking
    current_position INTEGER NOT NULL DEFAULT 0,
    max_position INTEGER NOT NULL,

    -- Status
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'completed', 'failed')),

    -- The queue item for current position
    current_queue_id INTEGER REFERENCES email_queue(id),

    -- Error tracking
    last_failed_position INTEGER,
    last_failed_at TIMESTAMPTZ,
    failure_reason TEXT,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(contact_id, campaign_id, sequence_tag)
);

-- =====================================================
-- SEND LOG (Append-only, for analytics)
-- =====================================================

CREATE TABLE IF NOT EXISTS email_send_log (
    id BIGSERIAL PRIMARY KEY,

    -- References
    queue_id INTEGER NOT NULL REFERENCES email_queue(id),
    contact_id INTEGER NOT NULL REFERENCES contacts(id),
    template_id INTEGER REFERENCES email_templates(id),
    sender_id INTEGER REFERENCES email_senders(id),
    campaign_id INTEGER REFERENCES email_campaigns(id),

    -- Email info (snapshot)
    to_email TEXT NOT NULL,
    from_email TEXT NOT NULL,
    subject TEXT NOT NULL,

    -- Provider info
    provider TEXT NOT NULL,
    provider_message_id TEXT, -- External message ID for tracking

    -- Results
    status TEXT NOT NULL CHECK (status IN ('sent', 'bounced', 'opened', 'clicked', 'complained')),
    error_message TEXT,

    -- Timing
    sent_at TIMESTAMPTZ NOT NULL,
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Prevent duplicate logs for same queue item
    UNIQUE(queue_id)
);

-- Partition by month for performance (optional for high volume)
-- CREATE TABLE email_send_log_y2024m01 PARTITION OF email_send_log
--     FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- =====================================================
-- SETTINGS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS email_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- FUNCTIONS FOR SEQUENCE MANAGEMENT
-- =====================================================

-- Get next unsent position for a contact/tag/campaign
CREATE OR REPLACE FUNCTION get_next_sequence_position(
    p_contact_id INTEGER,
    p_campaign_id INTEGER,
    p_sequence_tag TEXT
) RETURNS TABLE(position INTEGER, template_id INTEGER) AS $$
    WITH sequence_config AS (
        SELECT
            s.current_position,
            s.status,
            s.last_failed_position
        FROM email_sequence_state s
        WHERE s.contact_id = p_contact_id
          AND s.campaign_id = p_campaign_id
          AND s.sequence_tag = p_sequence_tag
    ),
    previous_email AS (
        SELECT eq.id, eq.status
        FROM email_queue eq
        WHERE eq.contact_id = p_contact_id
          AND eq.campaign_id = p_campaign_id
          AND eq.sequence_tag = p_sequence_tag
          AND eq.sequence_position = (
              SELECT COALESCE(current_position, 0) + 1
              FROM sequence_config
          )
        ORDER BY eq.id DESC
        LIMIT 1
    )
    SELECT
        sc.current_position + 1 AS position,
        t.id AS template_id
    FROM sequence_config sc
    CROSS JOIN LATERAL (
        SELECT id
        FROM email_templates
        WHERE tags @> ARRAY[p_sequence_tag]
          AND sequence_number = sc.current_position + 1
          AND is_active = TRUE
        LIMIT 1
    ) t
    WHERE
        -- Sequence is active
        sc.status = 'active'
        -- Previous email was sent (or this is position 1)
        AND (sc.current_position = 0 OR EXISTS (
            SELECT 1 FROM previous_email WHERE status = 'sent'
        ))
        -- Haven't reached max
        AND sc.current_position < (
            SELECT MAX(sequence_number)
            FROM email_templates
            WHERE tags @> ARRAY[p_sequence_tag]
        )
    UNION ALL
    -- If no state exists, start from position 1
    SELECT
        1 AS position,
        t.id AS template_id
    FROM email_templates t
    WHERE
        NOT EXISTS (SELECT 1 FROM sequence_config)
        AND t.tags @> ARRAY[p_sequence_tag]
        AND t.sequence_number = 1
        AND t.is_active = TRUE
    LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER email_queue_updated_at
    BEFORE UPDATE ON email_queue
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
```

### 3.2 Database Migration Strategy

```sql
-- Migration script to move from SQLite to PostgreSQL

-- Step 1: Export SQLite to CSV
-- Step 2: Import to PostgreSQL
-- Step 3: Add new columns and constraints
-- Step 4: Backfill idempotency keys
-- Step 5: Create sequence states for existing campaigns

-- Backfill idempotency keys for existing queue items
UPDATE email_queue
SET idempotency_key = 'email_' || id || '_' || md5(recipient_email || COALESCE(subject, '') || COALESCE(sequence_tag, ''))
WHERE idempotency_key IS NULL OR idempotency_key = '';
```

---

## 4. Idempotency Strategy (Detailed)

### 4.1 The Problem

```
Worker crashes HERE:
                    │
                    ▼
    ┌─────────────────────────────────────┐
    │ 1. Acquire lock ✓                   │
    │ 2. Validate business hours ✓        │
    │ 3. Get sender ✓                     │
    │ 4. Send email ✓ (RECEIVED BY USER)  │
    │ 5. Update DB ✗ (WORKER CRASHES)    │  ← CRASH
    │ 6. Release lock ✗                   │
    └─────────────────────────────────────┘

Result:
- Email was sent (user received it)
- DB status still "pending"
- Retry worker picks it up
- Email sent AGAIN (duplicate!)
```

### 4.2 The Solution: Multi-Layer Idempotency

```typescript
// lib/email/idempotency.ts

/**
 * Idempotency Strategy:
 *
 * LAYER 1: Database Unique Constraint (idempotency_key)
 *   - Prevents duplicate queue entries
 *   - Catches race conditions at DB level
 *
 * LAYER 2: Email Provider Message ID Tracking
 *   - Before sending, check if we already have a message_id
 *   - If yes, skip sending (already sent)
 *
 * LAYER 3: Distributed Lock with Timeout
 *   - Prevents concurrent processing
 *   - Auto-releases if worker crashes
 *
 * LAYER 4: Transactional Send + Update
 *   - Use database transaction
 *   - If update fails, we can check if email was sent
 */

import { randomUUID } from 'crypto';

export interface IdempotencyContext {
  queueItemId: number;
  contactId: number;
  recipientEmail: string;
  subject: string;
  sequenceTag: string;
  sequencePosition: number;
}

export class IdempotencyManager {
  /**
   * Generate a deterministic idempotency key
   * Same input = same key
   */
  generateKey(context: IdempotencyContext): string {
    const normalized = {
      email: context.recipientEmail.toLowerCase().trim(),
      subject: context.subject.trim(),
      tag: context.sequenceTag.trim(),
      position: context.sequencePosition,
    };

    const base = `${normalized.email}:${normalized.subject}:${normalized.tag}:${normalized.position}`;

    // Use hash for consistent key
    return `email_${Buffer.from(base).toString('base64').slice(0, 64)}`;
  }

  /**
   * Check if email was already sent
   * Returns message_id if found, null otherwise
   */
  async checkAlreadySent(trx: Transaction, context: IdempotencyContext): Promise<string | null> {
    // Check send log for this queue item
    const result = await trx.query(`
      SELECT provider_message_id
      FROM email_send_log
      WHERE queue_id = $1
      LIMIT 1
    `, [context.queueItemId]);

    return result.rows[0]?.provider_message_id || null;
  }

  /**
   * Acquire distributed lock for processing
   * Returns lock token, or null if already locked
   */
  async acquireLock(redis: Redis, queueItemId: number, timeoutMs: number = 300000): Promise<string | null> {
    const lockKey = `lock:email:${queueItemId}`;
    const token = randomUUID();

    // SETNX with expiration
    const acquired = await redis.set(
      lockKey,
      token,
      'PX', // Milliseconds
      timeoutMs,
      'NX' // Only set if not exists
    );

    return acquired === 'OK' ? token : null;
  }

  /**
   * Verify we still hold the lock
   */
  async verifyLock(redis: Redis, queueItemId: number, token: string): Promise<boolean> {
    const lockKey = `lock:email:${queueItemId}`;
    const currentToken = await redis.get(lockKey);
    return currentToken === token;
  }

  /**
   * Release the lock
   */
  async releaseLock(redis: Redis, queueItemId: number, token: string): Promise<void> {
    const lockKey = `lock:email:${queueItemId}`;

    // Only release if we still hold it
    await redis.eval(`
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `, 1, lockKey, token);
  }
}

export const idempotency = new IdempotencyManager();
```

### 4.3 Worker Processing with Idempotency

```typescript
// workers/email-processor.ts

export async function processEmailJob(job: Job<EmailJobData>): Promise<JobResult> {
  const { queueItemId } = job.data;
  const trx = await pool.beginTransaction();

  try {
    // STEP 1: Get queue item with lock
    const queueItem = await trx.query(`
      SELECT * FROM email_queue
      WHERE id = $1 FOR UPDATE SKIP LOCKED
    `, [queueItemId]);

    if (!queueItem.rows[0]) {
      throw new Error(`Queue item ${queueItemId} not found or locked`);
    }

    const item = queueItem.rows[0];

    // STEP 2: Check status (might have been processed already)
    if (item.status === 'sent') {
      return { success: true, alreadySent: true };
    }

    // STEP 3: Check idempotency - was email already sent?
    const existingMessageId = await idempotency.checkAlreadySent(trx, {
      queueItemId: item.id,
      contactId: item.contact_id,
      recipientEmail: item.recipient_email,
      subject: item.subject,
      sequenceTag: item.sequence_tag,
      sequencePosition: item.sequence_position,
    });

    if (existingMessageId) {
      // Email was already sent! Update status to sent
      await trx.query(`
        UPDATE email_queue
        SET status = 'sent', completed_at = NOW()
        WHERE id = $1
      `, [queueItemId]);

      await trx.commit();
      return { success: true, alreadySent: true, messageId: existingMessageId };
    }

    // STEP 4: Acquire distributed lock
    const lockToken = await idempotency.acquireLock(redis, queueItemId);
    if (!lockToken) {
      // Another worker is processing this
      await trx.rollback();
      throw new Error(`Could not acquire lock for queue item ${queueItemId}`);
    }

    try {
      // STEP 5: Update status to 'acquired'
      await trx.query(`
        UPDATE email_queue
        SET status = 'acquired',
            started_at = NOW(),
            processing_token = $2,
            attempts = attempts + 1
        WHERE id = $1
      `, [queueItemId, lockToken]);

      await trx.commit(); // Commit before expensive operation
      const newTrx = await pool.beginTransaction();

      // STEP 6: Validate business hours
      if (!businessHours.isBusinessHour(new Date(), item.country_code)) {
        const nextTime = businessHours.calculateNextBusinessTime(item.country_code);

        // Update scheduled time and release lock
        await newTrx.query(`
          UPDATE email_queue
          SET status = 'scheduled',
              scheduled_at = $2,
              processing_token = NULL
          WHERE id = $1
        `, [queueItemId, nextTime]);

        await idempotency.releaseLock(redis, queueItemId, lockToken);
        await newTrx.commit();

        // Re-add to queue with delay
        await emailQueue.add('send-email', job.data, {
          delay: nextTime.getTime() - Date.now(),
          jobId: `email-${queueItemId}`,
        });

        return { success: false, rescheduled: true, nextTime };
      }

      // STEP 7: Get and validate sender
      const sender = await getAvailableSender(newTrx);
      if (!sender) {
        throw new Error('No available sender');
      }

      // STEP 8: SEND EMAIL (Point of no return)
      const sendResult = await emailProvider.send(sender, {
        to: item.recipient_email,
        subject: item.subject,
        html: item.html_content,
        text: item.text_content,
      });

      // STEP 9: Transactional update (CRITICAL)
      await newTrx.query(`
        -- Update queue status
        UPDATE email_queue
        SET status = 'sent',
            sender_id = $2,
            completed_at = NOW(),
            processing_token = NULL
        WHERE id = $1;

        -- Log the send
        INSERT INTO email_send_log (
            queue_id, contact_id, template_id, sender_id, campaign_id,
            to_email, from_email, subject, provider, provider_message_id,
            status, sent_at
        )
        VALUES (
            $1, $3, $4, $2, $5,
            $6, $7, $8, $9, $10,
            'sent', NOW()
        );

        -- Update sender counter
        UPDATE email_senders
        SET sent_today = sent_today + 1,
            sent_hour = sent_hour + 1
        WHERE id = $2;

        -- Update campaign counter
        UPDATE email_campaigns
        SET sent_count = sent_count + 1
        WHERE id = $5;
      `, [
        queueItemId,         -- $1
        sender.id,          -- $2
        item.contact_id,    -- $3
        item.template_id,   -- $4
        item.campaign_id,   -- $5
        item.recipient_email, -- $6
        sender.email,       -- $7
        item.subject,       -- $8
        'resend',           -- $9
        sendResult.messageId, -- $10
      ]);

      // STEP 10: Schedule follow-up if this was part of a sequence
      if (item.sequence_position > 0) {
        await scheduleNextFollowUp(newTrx, item, sendResult.messageId);
      }

      await newTrx.commit();
      await idempotency.releaseLock(redis, queueItemId, lockToken);

      return { success: true, messageId: sendResult.messageId };

    } catch (error) {
      // Release lock on error
      await idempotency.releaseLock(redis, queueItemId, lockToken);
      throw error;
    }

  } catch (error) {
    await trx.rollback();
    throw error;
  }
}
```

---

## 5. Sequence Engine Design (Corrected)

### 5.1 Problems with Previous Approach

```
OLD APPROACH (FLAWED):
┌─────────────────────────────────────────────────────────┐
│  Cron job runs every hour                               │
│  Scans entire email_queue for recently sent emails      │
│  For each sent email, calculates if follow-up is due    │
│  Creates new queue items for follow-ups                 │
└─────────────────────────────────────────────────────────┘

PROBLEMS:
- Doesn't scale (full table scan every hour)
- Race conditions (what if two cron jobs run?)
- No strict dependency enforcement
- If cron misses, follow-ups are delayed
```

### 5.2 New Approach: Event-Driven Chain

```
NEW APPROACH (CORRECT):
┌─────────────────────────────────────────────────────────────────┐
│                    EMAIL N SENDS SUCCESSFULLY                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Update email_queue status = 'sent'                         │
│  2. Insert into email_send_log                                 │
│  3. UPDATE email_sequence_state                                │
│     SET current_position = N                                   │
│     WHERE contact_id = X AND campaign_id = Y                   │
│  4. IF current_position < max_position:                        │
│     CREATE email_queue for position N+1                        │
│     WITH scheduled_at calculated from follow-up gap            │
│     ADD to BullMQ with delay                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 Sequence State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                     SEQUENCE STATE DIAGRAM                      │
└─────────────────────────────────────────────────────────────────┘

                    ┌─────────────┐
                    │   INITIAL   │
                    │  (no state) │
                    └──────┬──────┘
                           │
                    User starts campaign
                           │
                           ▼
                    ┌─────────────┐
                    │   ACTIVE    │◄─────────────────────┐
                    │  pos=0/1    │                      │
                    └──────┬──────┘                      │
                           │                             │
                    Email 1 scheduled                    │
                           │                             │
                           ▼                             │
                    ┌─────────────┐                      │
                    │  SENDING    │                      │
                    │  pos=1       │                      │
                    └──────┬──────┘                      │
                           │                             │
              ┌────────────┴────────────┐                │
              │                         │                │
              ▼                         ▼                │
       ┌─────────────┐          ┌─────────────┐          │
       │    SENT     │          │   FAILED    │          │
       │  pos=1→2    │          │  pos=1      │          │
       └──────┬──────┘          └──────┬──────┘          │
              │                         │                │
              │                         │                │
              ▼                         ▼                │
       ┌─────────────┐          ┌─────────────┐          │
       │   ACTIVE    │          │   FAILED    │          │
       │  pos=2      │          │  (paused)   │          │
       └──────┬──────┘          └─────────────┘          │
              │                                            │
         Email 2 scheduled                               Retry?
              │                                            │
              └────────────────────┐  (yes) ┌─────────────┘
                                   │        │
                                   ▼        ▼
                            ┌─────────────┐
                            │  SENDING    │
                            │  pos=1       │
                            └─────────────┘
```

### 5.4 Sequence Implementation

```typescript
// lib/sequences/manager.ts

export class SequenceManager {
  /**
   * Initialize sequence state for a contact
   */
  async initializeSequence(
    trx: Transaction,
    contactId: number,
    campaignId: number,
    sequenceTag: string
  ): Promise<SequenceState> {
    // Get max position for this tag
    const maxResult = await trx.query(`
      SELECT MAX(sequence_number) as max_pos
      FROM email_templates
      WHERE tags @> ARRAY[$1]
    `, [sequenceTag]);

    const maxPosition = maxResult.rows[0].max_pos || 1;

    // Create sequence state
    const result = await trx.query(`
      INSERT INTO email_sequence_state (
        contact_id, campaign_id, sequence_tag,
        current_position, max_position, status
      ) VALUES ($1, $2, $3, 0, $4, 'active')
      ON CONFLICT (contact_id, campaign_id, sequence_tag)
      DO UPDATE SET
        current_position = 0,
        status = 'active',
        max_position = $4,
        updated_at = NOW()
      RETURNING *
    `, [contactId, campaignId, sequenceTag, maxPosition]);

    return result.rows[0];
  }

  /**
   * Called after successful email send
   * Updates sequence state and schedules next email
   */
  async onEmailSent(
    trx: Transaction,
    queueItem: QueueItem,
    messageId: string
  ): Promise<void> {
    const { contact_id, campaign_id, sequence_tag, sequence_position, id } = queueItem;

    // Update sequence state
    const stateResult = await trx.query(`
      UPDATE email_sequence_state
      SET
        current_position = $2,
        current_queue_id = NULL,
        updated_at = NOW()
      WHERE contact_id = $1
        AND campaign_id = $3
        AND sequence_tag = $4
      RETURNING *
    `, [contact_id, sequence_position, campaign_id, sequence_tag]);

    const state = stateResult.rows[0];
    if (!state) {
      console.warn(`No sequence state found for contact ${contact_id}, campaign ${campaign_id}, tag ${sequence_tag}`);
      return;
    }

    // Check if there's a next email
    if (sequence_position < state.max_position) {
      await this.scheduleNext(trx, state, queueItem);
    } else {
      // Sequence complete
      await trx.query(`
        UPDATE email_sequence_state
        SET status = 'completed', updated_at = NOW()
        WHERE id = $1
      `, [state.id]);
    }
  }

  /**
   * Schedule next email in sequence
   */
  private async scheduleNext(
    trx: Transaction,
    state: SequenceState,
    previousItem: QueueItem
  ): Promise<void> {
    const nextPosition = state.current_position + 1;

    // Get template for next position
    const templateResult = await trx.query(`
      SELECT * FROM email_templates
      WHERE tags @> ARRAY[$1]
        AND sequence_number = $2
        AND is_active = TRUE
      LIMIT 1
    `, [state.sequence_tag, nextPosition]);

    const template = templateResult.rows[0];
    if (!template) {
      console.warn(`No template found for ${state.sequence_tag} position ${nextPosition}`);
      return;
    }

    // Get gap days
    const gapKey = `followup_gap_${previousItem.sequence_position}`;
    const gapResult = await trx.query(`
      SELECT value::integer as gap_days
      FROM email_settings
      WHERE key = $1
    `, [gapKey]);

    const gapDays = gapResult.rows[0]?.gap_days ||
      (nextPosition === 2 ? 2 : 5);

    // Calculate scheduled time
    const baseTime = new Date();
    const scheduledAt = businessHours.calculateFollowUpDate(
      baseTime,
      gapDays,
      previousItem.country_code
    );

    // Get contact info
    const contactResult = await trx.query(`
      SELECT c.*, s.country, s.url
      FROM contacts c
      LEFT JOIN sites s ON c.site_id = s.id
      WHERE c.id = $1
    `, [state.contact_id]);

    const contact = contactResult.rows[0];

    // Create queue item (within transaction)
    const queueResult = await trx.query(`
      INSERT INTO email_queue (
        campaign_id, contact_id,
        recipient_email, recipient_name,
        template_id, subject, html_content, text_content,
        sequence_tag, sequence_position, depends_on_queue_id,
        scheduled_at, status, country_code,
        idempotency_key
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, 'scheduled', $13,
        'email_' || encode(digest($3 || $6 || $9 || $10, 'sha256'), 'hex')
      )
      RETURNING *
    `, [
      state.campaign_id,
      state.contact_id,
      contact.value,
      extractName(contact.value),
      template.id,
      template.subject,
      template.html_content,
      template.text_content,
      state.sequence_tag,
      nextPosition,
      previousItem.id, // depends_on_queue_id
      scheduledAt,
      previousItem.country_code,
    ]);

    const newQueueItem = queueResult.rows[0];

    // Update sequence state with current queue item
    await trx.query(`
      UPDATE email_sequence_state
      SET current_queue_id = $2
      WHERE id = $1
    `, [state.id, newQueueItem.id]);

    // Add to BullMQ with delay
    await emailQueue.add('send-email', {
      queueItemId: newQueueItem.id,
      contactId: state.contact_id,
      countryCode: previousItem.country_code,
    }, {
      jobId: `email-${newQueueItem.id}`,
      delay: scheduledAt.getTime() - Date.now(),
    });
  }

  /**
   * Handle email failure in sequence
   */
  async onEmailFailed(
    trx: Transaction,
    queueItem: QueueItem,
    error: string,
    isPermanent: boolean
  ): Promise<void> {
    if (isPermanent || queueItem.attempts >= queueItem.max_attempts) {
      // Mark sequence as failed
      await trx.query(`
        UPDATE email_sequence_state
        SET
          status = 'failed',
          last_failed_position = $2,
          last_failed_at = NOW(),
          failure_reason = $3,
          updated_at = NOW()
        WHERE contact_id = $1
          AND campaign_id = $4
          AND sequence_tag = $5
      `, [
        queueItem.contact_id,
        queueItem.sequence_position,
        error,
        queueItem.campaign_id,
        queueItem.sequence_tag,
      ]);
    }
    // For transient failures, we'll retry - no state change needed
  }

  /**
   * Recovery: Find sequences stuck in 'acquired' state
   * (Worker crashed while processing)
   */
  async recoverStuckSequences(trx: Transaction): Promise<number> {
    const result = await trx.query(`
      UPDATE email_queue
      SET
        status = 'scheduled',
        processing_token = NULL,
        attempts = attempts + 1,
        last_error = 'Recovery: Worker crashed during processing',
        last_error_at = NOW()
      WHERE status = 'acquired'
        AND started_at < NOW() - INTERVAL '10 minutes'
      RETURNING id
    `);

    const recovered = result.rows;

    // Re-add to queue
    for (const item of recovered) {
      await emailQueue.add('send-email', {
        queueItemId: item.id,
      }, {
        jobId: `recovery-${item.id}`,
      });
    }

    return recovered.length;
  }
}
```

---

## 6. Queue + Worker Design

### 6.1 Simplified Queue Structure

```typescript
// lib/queue/types.ts

/**
 * Only ONE job type needed
 * All differentiation via job data
 */
export interface EmailJobData {
  queueItemId: number;
  contactId: number;
  countryCode: string;
}

/**
 * Job priorities (simple)
 */
export enum Priority {
  LOW = 1,
  NORMAL = 5,
  HIGH = 10,
}

/**
 * Error types for different retry strategies
 */
export enum ErrorType {
  TRANSIENT = 'transient',      // Retry: rate limit, timeout
  PERMANENT = 'permanent',      // Don't retry: invalid email, bounced
  RECOVERABLE = 'recoverable',  // Retry with backoff: SMTP error
}

/**
 * Classify error for retry strategy
 */
export function classifyError(error: Error): ErrorType {
  const message = error.message.toLowerCase();

  // Permanent failures
  if (message.includes('invalid') && message.includes('email')) return ErrorType.PERMANENT;
  if (message.includes('bounced')) return ErrorType.PERMANENT;
  if (message.includes('mailbox not found')) return ErrorType.PERMANENT;
  if (message.includes('does not exist')) return ErrorType.PERMANENT;

  // Transient (retry quickly)
  if (message.includes('rate limit')) return ErrorType.TRANSIENT;
  if (message.includes('timeout')) return ErrorType.TRANSIENT;
  if (message.includes('econnrefused')) return ErrorType.TRANSIENT;

  // Recoverable (retry with backoff)
  return ErrorType.RECOVERABLE;
}
```

### 6.2 Worker Configuration

```typescript
// workers/email-worker.ts

import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { pool } from '../lib/db/postgres';
import { emailQueue } from '../lib/queue/client';
import { processEmailJob } from '../lib/queue/processors';
import { sequenceManager } from '../lib/sequences/manager';
import { logger } from '../lib/utils/logger';

const CONNECTIONS = {
  redis: new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
  }),
  pg: pool,
};

export function createWorker(): Worker {
  const worker = new Worker<EmailJobData>(
    'emails',
    async (job: Job<EmailJobData>) => {
      const trx = await pool.beginTransaction();

      try {
        const result = await processEmailJob(job);

        // Handle sequence advancement
        if (result.success && !result.alreadySent) {
          const queueItem = await trx.query(
            'SELECT * FROM email_queue WHERE id = $1',
            [job.data.queueItemId]
          );

          if (queueItem.rows[0]?.sequence_tag) {
            await sequenceManager.onEmailSent(
              trx,
              queueItem.rows[0],
              result.messageId
            );
          }
        }

        await trx.commit();
        return result;

      } catch (error) {
        await trx.rollback();

        // Check if permanent failure
        const errorType = classifyError(error);

        if (errorType === ErrorType.PERMANENT) {
          // Mark as permanently failed, don't retry
          await pool.query(`
            UPDATE email_queue
            SET status = 'failed_permanent',
                last_error = $2,
                last_error_at = NOW()
            WHERE id = $1
          `, [job.data.queueItemId, error.message]);

          // Update sequence state
          const queueItem = await pool.query(
            'SELECT * FROM email_queue WHERE id = $1',
            [job.data.queueItemId]
          );

          if (queueItem.rows[0]) {
            await sequenceManager.onEmailFailed(
              null,
              queueItem.rows[0],
              error.message,
              true
            );
          }

          // Don't throw - job completes successfully but marked as failed
          return { success: false, permanent: true };
        }

        throw error; // BullMQ will retry
      }
    },
    {
      connection: CONNECTIONS.redis,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY || '10'),
      limiter: {
        max: 100,
        duration: 60000, // 100 emails per minute max
      },
    }
  );

  // Event handlers
  worker.on('completed', (job, result) => {
    logger.info('Job completed', { jobId: job.id, result });
  });

  worker.on('failed', (job, error) => {
    logger.error('Job failed', {
      jobId: job?.id,
      error: error.message,
      attemptsMade: job?.attemptsMade,
    });
  });

  // Health check
  worker.on('error', (error) => {
    logger.error('Worker error', { error: error.message });
  });

  return worker;
}

/**
 * Recovery worker - runs periodically to clean up stuck jobs
 */
export function createRecoveryWorker(): Worker {
  return new Worker(
    'recovery',
    async () => {
      const trx = await pool.beginTransaction();

      try {
        const recovered = await sequenceManager.recoverStuckSequences(trx);
        await trx.commit();

        logger.info('Recovery completed', { recovered });

        return { recovered };
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    },
    {
      connection: CONNECTIONS.redis,
      limiter: {
        max: 1,
        duration: 300000, // Once per 5 minutes
      },
    }
  );
}
```

### 6.3 Sender Selection with Proper Limits

```typescript
// lib/email/sender-selector.ts

export interface SenderSelection {
  sender: EmailSender;
  waitUntil?: Date; // If all senders at limit
}

export class SenderSelector {
  private roundRobinIndex = 0;
  private senderCache: EmailSender[] | null = null;
  private cacheExpiry = 0;

  /**
   * Get next available sender with proper limit checking
   */
  async getNextSender(trx: Transaction): Promise<SenderSelection | null> {
    // Refresh cache if expired
    if (!this.senderCache || Date.now() > this.cacheExpiry) {
      const result = await trx.query(`
        SELECT * FROM email_senders
        WHERE is_active = TRUE
        ORDER BY created_at ASC
      `);

      this.senderCache = result.rows;
      this.cacheExpiry = Date.now() + 60000; // Cache for 1 minute
    }

    const senders = this.senderCache!;

    // Check if we need to reset hourly counters
    await this.resetHourlyIfNeeded(trx, senders);

    // Find available sender (round-robin within available)
    const available = senders.filter(s =>
      s.sent_today < s.daily_limit &&
      s.sent_hour < s.hourly_limit
    );

    if (available.length === 0) {
      // Find when next sender will be available
      return { sender: null, waitUntil: this.calculateWaitTime(senders) };
    }

    // Round-robin within available
    const sender = available[this.roundRobinIndex % available.length];
    this.roundRobinIndex++;

    return { sender };
  }

  /**
   * Reset hourly counters if needed
   */
  private async resetHourlyIfNeeded(trx: Transaction, senders: EmailSender[]): Promise<void> {
    const now = new Date();
    const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

    for (const sender of senders) {
      if (!sender.last_reset_hour || sender.last_reset_hour < currentHour) {
        await trx.query(`
          UPDATE email_senders
          SET sent_hour = 0, last_reset_hour = $2
          WHERE id = $1
        `, [sender.id, currentHour]);

        sender.sent_hour = 0;
        sender.last_reset_hour = currentHour;
      }
    }
  }

  /**
   * Calculate when next sender will be available
   */
  private calculateWaitTime(senders: EmailSender[]): Date {
    // Find sender with earliest availability
    const now = new Date();
    const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

    // If any sender has hourly capacity but daily limit hit, wait for tomorrow
    const hasHourlyCapacity = senders.some(s => s.sent_hour < s.hourly_limit);

    if (hasHourlyCapacity) {
      // Wait for next hour
      return new Date(currentHour.getTime() + 3600000);
    }

    // All senders at hourly limit - wait for next hour
    return new Date(currentHour.getTime() + 3600000);
  }
}

export const senderSelector = new SenderSelector();
```

---

## 7. Failure Handling Strategy

### 7.1 Failure Scenarios

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| **Worker crashes mid-send** | Lock timeout | Recovery job re-acquires, checks send log |
| **Email provider down** | Job fails, retries | Switch to backup provider |
| **Database connection lost** | Query errors | Backoff, retry with new connection |
| **Redis connection lost** | Job processing stops | Auto-reconnect, replay in-flight jobs |
| **Stuck 'acquired' jobs** | Cron check | Reset to 'scheduled', increment attempts |
| **Permanent bounce** | Provider notification | Mark contact as bouncing, stop sequence |

### 7.2 Retry Strategy by Error Type

```typescript
// lib/queue/retry-config.ts

export const retryConfig = {
  // Transient errors (rate limits, timeouts)
  transient: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000, // Start with 5 seconds
    },
  },

  // Recoverable errors (SMTP errors)
  recoverable: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 60000, // Start with 1 minute
    },
  },

  // Permanent errors (invalid email)
  permanent: {
    attempts: 1, // Only try once
    markAsPermanent: true,
  },
};
```

### 7.3 Dead-Letter Queue

```typescript
// lib/queue/dead-letter.ts

export async function handleDeadLetter(job: Job, error: Error): Promise<void> {
  const { queueItemId } = job.data;

  // Mark as permanently failed in DB
  await pool.query(`
    UPDATE email_queue
    SET status = 'failed_permanent',
        last_error = $2,
        last_error_at = NOW()
    WHERE id = $1
  `, [queueItemId, error.message]);

  // Add to dead letter analysis
  await pool.query(`
    INSERT INTO dead_letter_analysis (queue_id, error_type, error_message, created_at)
    VALUES ($1, $2, $3, NOW())
  `, [queueItemId, classifyError(error), error.message]);

  // Notify admin (in production)
  await notifyAdminOfDeadLetter(queueItemId, error);
}
```

---

## 8. Simplified Deployment Plan

### 8.1 Infrastructure

```
┌─────────────────────────────────────────────────────────────────┐
│                        DEPLOYMENT                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Vercel (Frontend + API)                                        │
│  - Next.js app                                                  │
│  - Serverless functions (lightweight only)                      │
│  - Static assets                                                │
│                                                                  │
│  Railway (Worker Service)                                       │
│  - Email worker (replicated: 2-3 instances)                     │
│  - Recovery worker (1 instance)                                 │
│  - Redis connection (via Upstash)                               │
│                                                                  │
│  Neon (PostgreSQL)                                              │
│  - Primary database                                             │
│  - Automatic backups                                            │
│                                                                  │
│  Upstash (Redis)                                                │
│  - Job queue                                                    │
│  - Distributed locks                                            │
│  - Rate limiting                                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Environment Variables

```bash
# .env.production - Vercel
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..." # For migrations
REDIS_URL="rediss://..."
NEXT_PUBLIC_APP_URL="https://..."

# .env - Railway Worker
DATABASE_URL="postgresql://..."
REDIS_URL="rediss://..."
RESEND_API_KEY="re_..."
WORKER_CONCURRENCY="10"
```

### 8.3 Deployment Commands

```bash
# Vercel deployment
vercel --prod

# Railway deployment
railway up

# Database migrations
npm run db:migrate

# Seed initial data
npm run db:seed
```

---

## 9. What NOT to Build (Avoid Over-Engineering)

### 9.1 Unnecessary Components

| Don't Build | Why | Alternative |
|-------------|-----|-------------|
| **Socket.io server** | Adds infrastructure complexity | Polling or SSE for updates |
| **Multiple scheduler queues** | One queue with delays works | Single `emails` queue |
| **Cron-based follow-up checker** | Event-driven is better | Chain jobs on completion |
| **Custom rate limiter** | BullMQ has built-in limiter | Use BullMQ limiter |
| **Complex analytics DB** | Not needed for MVP | Query main DB |
| **Separate "processing" status** | Redundant with lock token | Just 'pending' → 'sent' |
| **Email preview worker** | Can be done synchronously | API route |
| **Webhook system** | Over-engineering for now | Manual status checks |

### 9.2 Simplified Data Flow

```
BEFORE (Over-engineered):
User → API → Queue → Scheduler Queue → Worker → Email
                                     ↓
                                 Follow-up Queue
                                     ↓
                                 Worker → Email

AFTER (Simple):
User → API → Create DB Record → Queue (with delay) → Worker → Email
                                                                  ↓
                                                          On Success:
                                                          Create next record
                                                          Queue with delay
```

### 9.3 Feature Prioritization

| Phase | Must Have | Nice to Have | Later |
|-------|-----------|--------------|-------|
| **1** | Core email sending | Basic dashboard | Analytics |
| **2** | Sequences | Template editor | A/B testing |
| **3** | Retry logic | Real-time updates | Advanced segmentation |
| **4** | Idempotency | Multiple senders | Custom domains |

---

## 10. Summary of Key Changes

| Aspect | Previous Plan | Corrected Plan |
|--------|--------------|----------------|
| **Database** | SQLite/Turso | PostgreSQL (Neon) |
| **Queue processing** | Vercel serverless | Persistent worker service |
| **Sequence logic** | Cron-based scanning | Event-driven chaining |
| **Idempotency** | Basic check | Multi-layer with locks |
| **Failure handling** | Simple retry | Classified error types |
| **Real-time** | Socket.io | Polling/SSE |
| **Architecture** | Multiple workers | Single worker type |

---

**Document Status:** Ready for Implementation
**Next Steps:**
1. Set up PostgreSQL database
2. Implement idempotency layer
3. Build sequence manager
4. Deploy worker service
5. Connect frontend APIs
