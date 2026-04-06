-- =====================================================
-- Email System Tables - PostgreSQL Schema
-- Migration: 001_init_tables.sql
-- =====================================================

-- Enable UUID extension if needed (for future use)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- EMAIL SENDERS TABLE
-- Stores email sender accounts (Gmail, SMTP, Resend, SendGrid)
-- =====================================================
CREATE TABLE IF NOT EXISTS email_senders (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_encrypted TEXT,
    service VARCHAR(50) NOT NULL CHECK (service IN ('gmail', 'smtp', 'resend', 'sendgrid')),
    smtp_host VARCHAR(255),
    smtp_port INTEGER,
    smtp_user VARCHAR(255),
    daily_limit INTEGER NOT NULL DEFAULT 100,
    hourly_limit INTEGER NOT NULL DEFAULT 20,
    is_active SMALLINT NOT NULL DEFAULT 1,
    sent_today INTEGER NOT NULL DEFAULT 0,
    sent_hour INTEGER NOT NULL DEFAULT 0,
    last_reset_date DATE,
    last_reset_hour TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for email_senders
CREATE INDEX IF NOT EXISTS idx_email_senders_is_active ON email_senders(is_active);
CREATE INDEX IF NOT EXISTS idx_email_senders_service ON email_senders(service);

-- =====================================================
-- EMAIL TEMPLATES TABLE
-- Stores email templates with variable substitution support
-- =====================================================
CREATE TABLE IF NOT EXISTS email_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    subject TEXT NOT NULL,
    html_content TEXT NOT NULL,
    text_content TEXT,
    category VARCHAR(100) NOT NULL DEFAULT 'general',
    tags TEXT[] NOT NULL DEFAULT '{}',
    sequence_number INTEGER NOT NULL DEFAULT 0,
    is_active SMALLINT NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    parent_template_id INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for email_templates
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);
CREATE INDEX IF NOT EXISTS idx_email_templates_sequence_number ON email_templates(sequence_number);
CREATE INDEX IF NOT EXISTS idx_email_templates_is_active ON email_templates(is_active);
-- Note: GIN index on text[] array requires special handling, skipped for now
-- CREATE INDEX IF NOT EXISTS idx_email_templates_tags ON email_templates USING GIN(tags);

-- =====================================================
-- EMAIL CAMPAIGNS TABLE
-- Manages email campaigns with multiple templates
-- =====================================================
CREATE TABLE IF NOT EXISTS email_campaigns (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    template_tag VARCHAR(100) NOT NULL,
    template_ids INTEGER[] NOT NULL DEFAULT '{}',
    target_criteria JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'failed')),
    total_recipients INTEGER NOT NULL DEFAULT 0,
    queued_count INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    start_after TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for email_campaigns
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_template_tag ON email_campaigns(template_tag);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_start_after ON email_campaigns(start_after);

-- =====================================================
-- EMAIL QUEUE TABLE
-- Queue for email sending with retry logic and idempotency
-- =====================================================
CREATE TABLE IF NOT EXISTS email_queue (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER REFERENCES email_campaigns(id) ON DELETE SET NULL,
    sender_id INTEGER REFERENCES email_senders(id) ON DELETE SET NULL,
    contact_id INTEGER NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    recipient_name VARCHAR(255),
    template_id INTEGER NOT NULL REFERENCES email_templates(id) ON DELETE RESTRICT,
    subject TEXT NOT NULL,
    html_content TEXT NOT NULL,
    text_content TEXT,
    sequence_tag VARCHAR(100) NOT NULL,
    sequence_position INTEGER NOT NULL DEFAULT 1,
    depends_on_queue_id INTEGER REFERENCES email_queue(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'acquired', 'sent', 'failed', 'failed_permanent', 'cancelled')),
    priority INTEGER NOT NULL DEFAULT 5,
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    last_error TEXT,
    last_error_at TIMESTAMPTZ,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    processing_token VARCHAR(255) UNIQUE,
    country_code VARCHAR(10) NOT NULL DEFAULT 'us',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for email_queue
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status);
CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled_at ON email_queue(scheduled_at) WHERE status IN ('pending', 'scheduled');
CREATE INDEX IF NOT EXISTS idx_email_queue_priority ON email_queue(priority, created_at);
CREATE INDEX IF NOT EXISTS idx_email_queue_contact_id ON email_queue(contact_id);
CREATE INDEX IF NOT EXISTS idx_email_queue_campaign_id ON email_queue(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_queue_sender_id ON email_queue(sender_id);
CREATE INDEX IF NOT EXISTS idx_email_queue_sequence_tag ON email_queue(sequence_tag);
CREATE INDEX IF NOT EXISTS idx_email_queue_idempotency_key ON email_queue(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_email_queue_country_code ON email_queue(country_code);

-- =====================================================
-- EMAIL SEQUENCE STATE TABLE
-- Tracks progress of email sequences per contact
-- =====================================================
CREATE TABLE IF NOT EXISTS email_sequence_state (
    id SERIAL PRIMARY KEY,
    contact_id INTEGER NOT NULL UNIQUE,
    campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
    sequence_tag VARCHAR(100) NOT NULL,
    current_position INTEGER NOT NULL DEFAULT 0,
    max_position INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'failed')),
    current_queue_id INTEGER REFERENCES email_queue(id) ON DELETE SET NULL,
    last_failed_position INTEGER,
    last_failed_at TIMESTAMPTZ,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for email_sequence_state
CREATE INDEX IF NOT EXISTS idx_email_sequence_state_campaign_id ON email_sequence_state(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_sequence_state_sequence_tag ON email_sequence_state(sequence_tag);
CREATE INDEX IF NOT EXISTS idx_email_sequence_state_status ON email_sequence_state(status);

-- =====================================================
-- EMAIL SEND LOG TABLE
-- Append-only log of all email send attempts
-- =====================================================
CREATE TABLE IF NOT EXISTS email_send_log (
    id SERIAL PRIMARY KEY,
    queue_id INTEGER NOT NULL REFERENCES email_queue(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL,
    template_id INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
    sender_id INTEGER REFERENCES email_senders(id) ON DELETE SET NULL,
    campaign_id INTEGER REFERENCES email_campaigns(id) ON DELETE SET NULL,
    to_email VARCHAR(255) NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    subject TEXT NOT NULL,
    provider VARCHAR(50) NOT NULL,
    provider_message_id VARCHAR(255),
    status VARCHAR(50) NOT NULL CHECK (status IN ('sent', 'bounced', 'opened', 'clicked', 'complained')),
    error_message TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for email_send_log
CREATE INDEX IF NOT EXISTS idx_email_send_log_queue_id ON email_send_log(queue_id);
CREATE INDEX IF NOT EXISTS idx_email_send_log_contact_id ON email_send_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_email_send_log_campaign_id ON email_send_log(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_send_log_sender_id ON email_send_log(sender_id);
CREATE INDEX IF NOT EXISTS idx_email_send_log_sent_at ON email_send_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_email_send_log_status ON email_send_log(status);

-- =====================================================
-- EMAIL SETTINGS TABLE
-- Key-value store for email system settings
-- =====================================================
CREATE TABLE IF NOT EXISTS email_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- COUNTRY TIMEZONES TABLE
-- Timezone and business hours data for countries
-- =====================================================
CREATE TABLE IF NOT EXISTS country_timezones (
    id SERIAL PRIMARY KEY,
    country VARCHAR(10) NOT NULL UNIQUE,
    country_name VARCHAR(255) NOT NULL,
    timezone VARCHAR(100) NOT NULL,
    business_hours_start VARCHAR(5) NOT NULL DEFAULT '09:00',
    business_hours_end VARCHAR(5) NOT NULL DEFAULT '17:00',
    business_days TEXT[] NOT NULL DEFAULT '{mon,tue,wed,thu,fri}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for country_timezones
CREATE INDEX IF NOT EXISTS idx_country_timezones_country ON country_timezones(country);

-- =====================================================
-- FUNCTIONS AND TRIGGERS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
DROP TRIGGER IF EXISTS update_email_senders_updated_at ON email_senders;
CREATE TRIGGER update_email_senders_updated_at
    BEFORE UPDATE ON email_senders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_email_templates_updated_at ON email_templates;
CREATE TRIGGER update_email_templates_updated_at
    BEFORE UPDATE ON email_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_email_campaigns_updated_at ON email_campaigns;
CREATE TRIGGER update_email_campaigns_updated_at
    BEFORE UPDATE ON email_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_email_queue_updated_at ON email_queue;
CREATE TRIGGER update_email_queue_updated_at
    BEFORE UPDATE ON email_queue
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_email_sequence_state_updated_at ON email_sequence_state;
CREATE TRIGGER update_email_sequence_state_updated_at
    BEFORE UPDATE ON email_sequence_state
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_country_timezones_updated_at ON country_timezones;
CREATE TRIGGER update_country_timezones_updated_at
    BEFORE UPDATE ON country_timezones
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE email_senders IS 'Email sender accounts for different providers';
COMMENT ON TABLE email_templates IS 'Reusable email templates with variable substitution';
COMMENT ON TABLE email_campaigns IS 'Email campaigns organizing multiple templates and targets';
COMMENT ON TABLE email_queue IS 'Queue for email sending with retry logic and idempotency';
COMMENT ON TABLE email_sequence_state IS 'Tracks progress of email sequences per contact';
COMMENT ON TABLE email_send_log IS 'Append-only log of all email send attempts';
COMMENT ON TABLE email_settings IS 'Key-value store for email system configuration';
COMMENT ON TABLE country_timezones IS 'Timezone and business hours data for countries worldwide';
