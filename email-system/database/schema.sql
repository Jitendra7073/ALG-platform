-- =====================================================
-- Email System Database Schema
-- PostgreSQL 14+
-- =====================================================
-- Version: 2.0 (Production-Ready)
-- Date: 2026-04-06
-- Based on: PRODUCTION_ARCHITECTURE_CORRECTED.md
--
-- This schema provides:
-- - Complete email queue system with idempotency
-- - Sequence tracking with state management
-- - Proper constraints and indexes for performance
-- - Dead letter queue for failure analysis
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For text search

-- =====================================================
-- ENUM TYPES
-- =====================================================

-- Email queue status enum
CREATE TYPE email_queue_status AS ENUM (
    'pending',           -- Initial state, not yet processed
    'scheduled',         -- Has scheduled_at, waiting for time
    'acquired',          -- Worker has picked it up (processing)
    'sent',              -- Successfully sent
    'failed',            -- Failed, will retry
    'failed_permanent',  -- Permanent failure, no retry
    'cancelled'          -- User cancelled
);

-- Email send log status enum
CREATE TYPE email_log_status AS ENUM (
    'sent',
    'bounced',
    'opened',
    'clicked',
    'complained'
);

-- Sequence state status enum
CREATE TYPE sequence_state_status AS ENUM (
    'active',
    'paused',
    'completed',
    'failed'
);

-- Campaign status enum
CREATE TYPE campaign_status AS ENUM (
    'draft',
    'scheduled',
    'running',
    'paused',
    'completed',
    'failed'
);

-- Email service provider enum
CREATE TYPE email_service AS ENUM (
    'gmail',
    'smtp',
    'resend',
    'sendgrid'
);

-- Dead letter error type enum
CREATE TYPE dead_letter_error_type AS ENUM (
    'transient',      -- Rate limit, timeout - should retry
    'permanent',      -- Invalid email, bounced - don't retry
    'recoverable'     -- SMTP error - retry with backoff
);

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

-- Indexes for contact lookups
CREATE INDEX IF NOT EXISTS idx_contacts_site ON contacts(site_id);
CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type) WHERE type = 'email';
CREATE INDEX IF NOT EXISTS idx_contacts_bouncing ON contacts(is_bouncing) WHERE is_bouncing = TRUE;

-- =====================================================
-- EMAIL SYSTEM TABLES (Write-Heavy)
-- =====================================================

-- -----------------------------------------------------
-- Email senders with proper constraints
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS email_senders (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,

    -- Password stored encrypted (use pgcrypto or application-level)
    password_encrypted TEXT NOT NULL,

    -- Service configuration
    service email_service NOT NULL DEFAULT 'gmail',

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

    -- Constraints
    CHECK (sent_today <= daily_limit),
    CHECK (sent_hour <= hourly_limit),
    CHECK (
        (service = 'smtp') = (smtp_host IS NOT NULL AND smtp_port IS NOT NULL)
    )
);

-- Indexes for sender selection
CREATE INDEX IF NOT EXISTS idx_senders_active_daily
    ON email_senders(is_active, sent_today, daily_limit)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_senders_hourly
    ON email_senders(is_active, sent_hour, hourly_limit, last_reset_hour)
    WHERE is_active = TRUE;

-- -----------------------------------------------------
-- Email templates with versioning
-- -----------------------------------------------------
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

-- Indexes for template searches
CREATE INDEX IF NOT EXISTS idx_templates_tags
    ON email_templates USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_templates_sequence
    ON email_templates(tags, sequence_number)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_templates_active
    ON email_templates(is_active, category)
    WHERE is_active = TRUE;

-- -----------------------------------------------------
-- Email campaigns
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS email_campaigns (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,

    -- Template selection (use tags for flexibility)
    template_tag TEXT NOT NULL,
    template_ids INTEGER[] NOT NULL,

    -- Targeting (flexible JSONB criteria)
    target_criteria JSONB,

    -- Status
    status campaign_status NOT NULL DEFAULT 'draft',

    -- Counts
    total_recipients INTEGER NOT NULL DEFAULT 0 CHECK (total_recipients >= 0),
    queued_count INTEGER NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
    sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),

    -- Timing
    start_after TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure template_ids references valid templates
    FOREIGN KEY (template_ids[1]) REFERENCES email_templates(id)
);

-- Indexes for campaign queries
CREATE INDEX IF NOT EXISTS idx_campaigns_status
    ON email_campaigns(status);

CREATE INDEX IF NOT EXISTS idx_campaigns_template_tag
    ON email_campaigns(template_tag);

CREATE INDEX IF NOT EXISTS idx_campaigns_targeting
    ON email_campaigns USING GIN(target_criteria);

-- -----------------------------------------------------
-- QUEUE TABLE (Critical - Needs Transaction Safety)
-- -----------------------------------------------------
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
    sequence_tag TEXT NOT NULL,
    sequence_position INTEGER NOT NULL CHECK (sequence_position > 0),
    depends_on_queue_id INTEGER REFERENCES email_queue(id),

    -- Scheduling
    status email_queue_status NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),

    -- Timing
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Retry tracking
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
    last_error TEXT,
    last_error_at TIMESTAMPTZ,

    -- Idempotency (CRITICAL - prevents duplicate sends)
    idempotency_key TEXT NOT NULL UNIQUE,
    processing_token TEXT,

    -- Timezone info
    country_code TEXT NOT NULL CHECK (country_code IN (
        'in', 'us', 'uk', 'ca', 'au', 'de', 'fr', 'ae', 'sg', 'jp'
    )),

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CHECK (attempts <= max_attempts),
    CHECK (scheduled_at IS NULL OR scheduled_at > created_at),
    CHECK (started_at IS NULL OR started_at >= scheduled_at),
    CHECK (depends_on_queue_id IS NULL OR sequence_position > 1),
    CHECK (depends_on_queue_id IS NULL OR depends_on_queue_id != id) -- No self-reference
);

-- Critical indexes for queue processing
CREATE INDEX IF NOT EXISTS idx_queue_status_scheduled
    ON email_queue(status, scheduled_at)
    WHERE status IN ('pending', 'scheduled');

CREATE INDEX IF NOT EXISTS idx_queue_campaign_status
    ON email_queue(campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_queue_contact_sequence
    ON email_queue(contact_id, sequence_tag, sequence_position, status);

CREATE INDEX IF NOT EXISTS idx_queue_processing
    ON email_queue(status, priority, scheduled_at)
    WHERE status IN ('pending', 'scheduled')
    AND (scheduled_at IS NULL OR scheduled_at <= NOW());

-- Partial index for acquiring jobs (prevents double-acquisition)
CREATE INDEX IF NOT EXISTS idx_queue_acquire
    ON email_queue(id, status)
    WHERE status = 'pending'
    OR (status = 'scheduled' AND scheduled_at <= NOW());

-- Index for stuck job recovery
CREATE INDEX IF NOT EXISTS idx_queue_stuck
    ON email_queue(status, started_at)
    WHERE status = 'acquired'
    AND started_at < NOW() - INTERVAL '10 minutes';

-- Index for sequence dependency tracking
CREATE INDEX IF NOT EXISTS idx_queue_dependency
    ON email_queue(depends_on_queue_id, status)
    WHERE depends_on_queue_id IS NOT NULL;

-- -----------------------------------------------------
-- SEQUENCE STATE TABLE (Critical for reliability)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS email_sequence_state (
    id SERIAL PRIMARY KEY,

    -- Identification
    contact_id INTEGER NOT NULL REFERENCES contacts(id),
    campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id),
    sequence_tag TEXT NOT NULL,

    -- State tracking
    current_position INTEGER NOT NULL DEFAULT 0 CHECK (current_position >= 0),
    max_position INTEGER NOT NULL CHECK (max_position > 0),

    -- Status
    status sequence_state_status NOT NULL DEFAULT 'active',

    -- The queue item for current position
    current_queue_id INTEGER REFERENCES email_queue(id),

    -- Error tracking
    last_failed_position INTEGER,
    last_failed_at TIMESTAMPTZ,
    failure_reason TEXT,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- One state per contact/campaign/tag combination
    UNIQUE(contact_id, campaign_id, sequence_tag),

    -- Constraints
    CHECK (current_position <= max_position)
);

-- Indexes for sequence state queries
CREATE INDEX IF NOT EXISTS idx_sequence_state_contact
    ON email_sequence_state(contact_id, status)
    WHERE status IN ('active', 'paused');

CREATE INDEX IF NOT EXISTS idx_sequence_state_campaign
    ON email_sequence_state(campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_sequence_state_current
    ON email_sequence_state(current_queue_id)
    WHERE current_queue_id IS NOT NULL;

-- -----------------------------------------------------
-- SEND LOG (Append-only, for analytics)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS email_send_log (
    id BIGSERIAL PRIMARY KEY,

    -- References
    queue_id INTEGER NOT NULL UNIQUE REFERENCES email_queue(id),
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
    provider_message_id TEXT,

    -- Results
    status email_log_status NOT NULL,
    error_message TEXT,

    -- Timing
    sent_at TIMESTAMPTZ NOT NULL,
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for analytics and tracking
CREATE INDEX IF NOT EXISTS idx_send_log_queue
    ON email_send_log(queue_id);

CREATE INDEX IF NOT EXISTS idx_send_log_contact
    ON email_send_log(contact_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_send_log_campaign
    ON email_send_log(campaign_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_send_log_status
    ON email_send_log(status, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_send_log_provider_message
    ON email_send_log(provider, provider_message_id)
    WHERE provider_message_id IS NOT NULL;

-- Time-based index for analytics (optional - for high volume)
-- CREATE INDEX IF NOT EXISTS idx_send_log_sent_at
--     ON email_send_log(sent_at DESC);

-- -----------------------------------------------------
-- DEAD LETTER ANALYSIS (For permanent failures)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS dead_letter_analysis (
    id SERIAL PRIMARY KEY,

    -- Reference to failed queue item
    queue_id INTEGER NOT NULL REFERENCES email_queue(id),

    -- Error classification
    error_type dead_letter_error_type NOT NULL,
    error_message TEXT NOT NULL,

    -- Analysis
    error_category TEXT, -- Additional classification
    suggested_action TEXT,

    -- Resolution tracking
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for dead letter queries
CREATE INDEX IF NOT EXISTS idx_dead_letter_queue
    ON dead_letter_analysis(queue_id);

CREATE INDEX IF NOT EXISTS idx_dead_letter_type
    ON dead_letter_analysis(error_type, resolved);

CREATE INDEX IF NOT EXISTS idx_dead_letter_created
    ON dead_letter_analysis(created_at DESC);

-- -----------------------------------------------------
-- SETTINGS TABLE (Key-Value configuration)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS email_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO email_settings (key, value, description) VALUES
    ('followup_gap_1', '2', 'Days to wait before sending follow-up email #2'),
    ('followup_gap_2', '5', 'Days to wait before sending follow-up email #3'),
    ('followup_gap_3', '7', 'Days to wait before sending follow-up email #4'),
    ('business_hours_enabled', 'true', 'Whether to respect business hours when sending'),
    ('business_hours_start', '9', 'Start of business hours (24h format)'),
    ('business_hours_end', '18', 'End of business hours (24h format)'),
    ('retry_transient_attempts', '5', 'Max retry attempts for transient errors'),
    ('retry_recoverable_attempts', '3', 'Max retry attempts for recoverable errors'),
    ('worker_concurrency', '10', 'Number of concurrent jobs processed by worker'),
    ('worker_rate_limit', '100', 'Max emails per minute across all workers')
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- FUNCTIONS FOR SEQUENCE MANAGEMENT
-- =====================================================

-- -----------------------------------------------------
-- Get next unsent position for a contact/tag/campaign
-- Returns the next sequence position and template ID
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION get_next_sequence_position(
    p_contact_id INTEGER,
    p_campaign_id INTEGER,
    p_sequence_tag TEXT
) RETURNS TABLE(position INTEGER, template_id INTEGER) AS $$
    WITH sequence_config AS (
        SELECT
            s.current_position,
            s.status,
            s.max_position,
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
              SELECT COALESCE(sc.current_position, 0) + 1
              FROM sequence_config sc
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
        AND sc.current_position < sc.max_position
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

-- -----------------------------------------------------
-- Trigger function to auto-update updated_at column
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all relevant tables
CREATE TRIGGER email_queue_updated_at
    BEFORE UPDATE ON email_queue
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER email_senders_updated_at
    BEFORE UPDATE ON email_senders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER email_templates_updated_at
    BEFORE UPDATE ON email_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER email_campaigns_updated_at
    BEFORE UPDATE ON email_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER email_sequence_state_updated_at
    BEFORE UPDATE ON email_sequence_state
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER email_settings_updated_at
    BEFORE UPDATE ON email_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER dead_letter_analysis_updated_at
    BEFORE UPDATE ON dead_letter_analysis
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------
-- Function to reset sender counters (call daily/hourly)
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION reset_sender_counters(
    p_reset_type TEXT DEFAULT 'daily' -- 'daily' or 'hourly'
) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    IF p_reset_type = 'daily' THEN
        UPDATE email_senders
        SET
            sent_today = 0,
            last_reset_date = CURRENT_DATE
        WHERE last_reset_date IS NULL
           OR last_reset_date < CURRENT_DATE;

        SELECT COUNT(*) INTO v_count
        FROM email_senders
        WHERE last_reset_date = CURRENT_DATE;

    ELSIF p_reset_type = 'hourly' THEN
        UPDATE email_senders
        SET
            sent_hour = 0,
            last_reset_hour = date_trunc('hour', NOW())
        WHERE last_reset_hour IS NULL
           OR last_reset_hour < date_trunc('hour', NOW());

        SELECT COUNT(*) INTO v_count
        FROM email_senders
        WHERE last_reset_hour >= date_trunc('hour', NOW());
    ELSE
        RAISE EXCEPTION 'Invalid reset_type: %', p_reset_type;
    END IF;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------
-- Function to generate idempotency key
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION generate_idempotency_key(
    p_recipient_email TEXT,
    p_subject TEXT,
    p_sequence_tag TEXT,
    p_sequence_position INTEGER
) RETURNS TEXT AS $$
BEGIN
    RETURN 'email_' || encode(
        digest(
            lower(trim(p_recipient_email)) || ':' ||
            trim(p_subject) || ':' ||
            trim(p_sequence_tag) || ':' ||
            p_sequence_position::TEXT,
            'sha256'
        ),
        'hex'
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- -----------------------------------------------------
-- Function to acquire queue item (with row-level lock)
-- Returns the queue item ID if acquired, NULL if already locked
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION acquire_queue_item(
    p_queue_id INTEGER,
    p_processing_token TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_acquired BOOLEAN;
BEGIN
    -- Try to update the status to 'acquired' with lock
    UPDATE email_queue
    SET
        status = 'acquired',
        started_at = NOW(),
        processing_token = p_processing_token,
        attempts = attempts + 1
    WHERE id = p_queue_id
      AND (status = 'pending' OR status = 'scheduled')
      AND (scheduled_at IS NULL OR scheduled_at <= NOW());

    GET DIAGNOSTICS v_acquired = ROW_COUNT;

    RETURN v_acquired > 0;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------
-- Function to release queue item (on error)
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION release_queue_item(
    p_queue_id INTEGER,
    p_processing_token TEXT,
    p_new_status email_queue_status DEFAULT 'pending'
) RETURNS BOOLEAN AS $$
DECLARE
    v_released BOOLEAN;
BEGIN
    -- Only release if we own the lock
    UPDATE email_queue
    SET
        status = p_new_status,
        processing_token = NULL
    WHERE id = p_queue_id
      AND processing_token = p_processing_token;

    GET DIAGNOSTICS v_released = ROW_COUNT;

    RETURN v_released > 0;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------
-- Function to check for stuck jobs and recover them
-- Returns the number of jobs recovered
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION recover_stuck_jobs(
    p_timeout_minutes INTEGER DEFAULT 10
) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Update stuck jobs back to scheduled
    UPDATE email_queue
    SET
        status = 'scheduled',
        processing_token = NULL,
        attempts = attempts + 1,
        last_error = 'Recovery: Worker crashed during processing',
        last_error_at = NOW()
    WHERE status = 'acquired'
      AND started_at < NOW() - (p_timeout_minutes || ' minutes')::INTERVAL;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------
-- Function to get available sender (round-robin)
-- Returns sender_id or NULL if none available
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION get_available_sender(
    p_country_code TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    v_sender_id INTEGER;
BEGIN
    -- Find sender with capacity
    SELECT es.id INTO v_sender_id
    FROM email_senders es
    WHERE es.is_active = TRUE
      AND es.sent_today < es.daily_limit
      AND es.sent_hour < es.hourly_limit
    ORDER BY
        -- Prefer senders with lower usage today (round-robin-ish)
        (es.sent_today::FLOAT / es.daily_limit) ASC,
        es.last_reset_date ASC,
        es.id ASC
    LIMIT 1;

    RETURN v_sender_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- -----------------------------------------------------
-- View for queue statistics
-- -----------------------------------------------------
CREATE OR REPLACE VIEW v_queue_stats AS
SELECT
    campaign_id,
    c.name AS campaign_name,
    COUNT(*) AS total_emails,
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
    COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled_count,
    COUNT(*) FILTER (WHERE status = 'acquired') AS acquired_count,
    COUNT(*) FILTER (WHERE status = 'sent') AS sent_count,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
    COUNT(*) FILTER (WHERE status = 'failed_permanent') AS permanent_failure_count,
    COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_count,
    MIN(created_at) AS first_queued,
    MAX(completed_at) AS last_completed
FROM email_queue eq
LEFT JOIN email_campaigns c ON eq.campaign_id = c.id
GROUP BY campaign_id, c.name;

-- -----------------------------------------------------
-- View for sender statistics
-- -----------------------------------------------------
CREATE OR REPLACE VIEW v_sender_stats AS
SELECT
    es.id,
    es.name,
    es.email,
    es.service,
    es.daily_limit,
    es.sent_today,
    ROUND((es.sent_today::FLOAT / es.daily_limit * 100), 2) AS daily_usage_percent,
    es.hourly_limit,
    es.sent_hour,
    es.is_active,
    COUNT(eq.id) FILTER (WHERE eq.status IN ('pending', 'scheduled', 'acquired')) AS queued_count,
    COUNT(eq.id) FILTER (WHERE eq.status = 'sent') AS sent_total_count,
    MAX(eq.completed_at) AS last_sent_at
FROM email_senders es
LEFT JOIN email_queue eq ON es.id = eq.sender_id
GROUP BY es.id, es.name, es.email, es.service, es.daily_limit, es.sent_today,
         es.hourly_limit, es.sent_hour, es.is_active;

-- -----------------------------------------------------
-- View for campaign statistics
-- -----------------------------------------------------
CREATE OR REPLACE VIEW v_campaign_stats AS
SELECT
    ec.id,
    ec.name,
    ec.status,
    ec.template_tag,
    ec.total_recipients,
    ec.queued_count,
    ec.sent_count,
    ec.failed_count,
    ROUND(
        CASE WHEN ec.total_recipients > 0
             THEN (ec.sent_count::FLOAT / ec.total_recipients * 100)
             ELSE 0
        END, 2
    ) AS completion_percent,
    ec.start_after,
    ec.started_at,
    ec.completed_at,
    EXTRACT(EPOCH FROM (COALESCE(ec.completed_at, NOW()) - ec.started_at)) / 3600 AS hours_running
FROM email_campaigns ec;

-- =====================================================
-- MIGRATION HELPERS
-- =====================================================

-- Function to backfill idempotency keys for existing queue items
CREATE OR REPLACE FUNCTION backfill_idempotency_keys() RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE email_queue
    SET idempotency_key = generate_idempotency_key(
        recipient_email,
        subject,
        sequence_tag,
        sequence_position
    )
    WHERE idempotency_key IS NULL OR idempotency_key = '';

    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- GRANTS (adjust based on your application user)
-- =====================================================
-- These should be adjusted based on your database user setup
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_app_user;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO your_app_user;

-- =====================================================
-- END OF SCHEMA
-- =====================================================
