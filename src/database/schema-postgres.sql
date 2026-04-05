-- ============================================================================
-- WordPress Lead Generator - PostgreSQL Schema (Production-Ready)
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Searches table - tracks search runs
CREATE TABLE IF NOT EXISTS searches (
    id SERIAL PRIMARY KEY,
    query TEXT NOT NULL,
    country TEXT DEFAULT 'in',
    total_sites INTEGER NOT NULL,
    wordpress_count INTEGER NOT NULL,
    non_wordpress_count INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sites table - stores individual site checks
CREATE TABLE IF NOT EXISTS sites (
    id SERIAL PRIMARY KEY,
    search_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    country TEXT DEFAULT 'in',
    is_wordpress INTEGER NOT NULL,
    confidence_score INTEGER DEFAULT 0,
    indicators TEXT,
    error TEXT,
    search_query TEXT,
    emails TEXT,
    phones TEXT,
    linkedin_profiles TEXT,
    text_content TEXT,
    ai_processed INTEGER DEFAULT 0,
    ai_status TEXT DEFAULT 'pending',
    ai_verified_wp INTEGER,
    ai_wp_confidence TEXT,
    ai_wp_indicators TEXT,
    ai_content_relevant INTEGER,
    ai_actual_category TEXT,
    ai_content_summary TEXT,
    ai_mismatch_reason TEXT,
    ai_error TEXT,
    ai_processed_at TIMESTAMP,
    classification TEXT,
    relevance_score INTEGER,
    tags TEXT,
    primary_language TEXT,
    value_proposition TEXT,
    ai_reasoning TEXT,
    ai_is_wordpress INTEGER,
    ai_is_genuine_match INTEGER,
    page_title TEXT,
    meta_description TEXT,
    retry_count INTEGER DEFAULT 0,
    last_retried_at TIMESTAMP,
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Keywords table
CREATE TABLE IF NOT EXISTS keywords (
    id SERIAL PRIMARY KEY,
    keyword TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'pending',
    max_sites INTEGER DEFAULT 20,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Excluded domains table
CREATE TABLE IF NOT EXISTS excluded_domains (
    id SERIAL PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ignored tags table
CREATE TABLE IF NOT EXISTS ignored_tags (
    id SERIAL PRIMARY KEY,
    tag TEXT NOT NULL UNIQUE,
    match_type TEXT DEFAULT 'contains',
    scope TEXT DEFAULT 'url',
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Contacts table
CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    source_page TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Company executives table
CREATE TABLE IF NOT EXISTS company_executives (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL,
    company_url TEXT NOT NULL,
    company_name TEXT,
    profile_url TEXT NOT NULL UNIQUE,
    name TEXT,
    headline TEXT,
    role_category TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- LinkedIn credentials table
CREATE TABLE IF NOT EXISTS linkedin_credentials (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    password TEXT,
    is_active INTEGER DEFAULT 1,
    last_used TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Country timezones table
CREATE TABLE IF NOT EXISTS country_timezones (
    country_code TEXT PRIMARY KEY,
    timezone TEXT NOT NULL,
    name TEXT NOT NULL,
    offset_hours REAL NOT NULL,
    business_start INTEGER DEFAULT 9,
    business_end INTEGER DEFAULT 17,
    weekend_days TEXT DEFAULT '6,0'
);

-- ============================================================================
-- EMAIL SYSTEM TABLES
-- ============================================================================

-- Email senders table
CREATE TABLE IF NOT EXISTS email_senders (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    service TEXT DEFAULT 'gmail',
    smtp_host TEXT,
    smtp_port INTEGER,
    smtp_user TEXT,
    daily_limit INTEGER DEFAULT 500,
    is_active INTEGER DEFAULT 1,
    sent_today INTEGER DEFAULT 0,
    last_reset_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Email templates table
CREATE TABLE IF NOT EXISTS email_templates (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    html_content TEXT NOT NULL,
    text_content TEXT,
    description TEXT,
    category TEXT DEFAULT 'general',
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Email campaigns table
CREATE TABLE IF NOT EXISTS email_campaigns (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    template_id INTEGER,
    target_type TEXT DEFAULT 'all',
    status TEXT DEFAULT 'queued',
    total_recipients INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);

-- Email queue table
CREATE TABLE IF NOT EXISTS email_queue (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER,
    sender_id INTEGER,
    recipient_email TEXT NOT NULL,
    recipient_name TEXT,
    subject TEXT NOT NULL,
    html_content TEXT NOT NULL,
    text_content TEXT,
    status TEXT DEFAULT 'queued',
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    sent_at TIMESTAMP,
    scheduled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Email send log table
CREATE TABLE IF NOT EXISTS email_send_log (
    id SERIAL PRIMARY KEY,
    contact_id INTEGER NOT NULL,
    contact_email TEXT NOT NULL,
    template_id INTEGER,
    campaign_id INTEGER,
    send_type TEXT DEFAULT 'main',
    status TEXT DEFAULT 'sent',
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Email settings table
CREATE TABLE IF NOT EXISTS email_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    label TEXT,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_searches_created_at ON searches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sites_search_id ON sites(search_id);
CREATE INDEX IF NOT EXISTS idx_sites_is_wordpress ON sites(is_wordpress);
CREATE INDEX IF NOT EXISTS idx_sites_ai_status ON sites(ai_status);
CREATE INDEX IF NOT EXISTS idx_sites_country ON sites(country);
CREATE INDEX IF NOT EXISTS idx_sites_checked_at ON sites(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_keywords_status ON keywords(status);
CREATE INDEX IF NOT EXISTS idx_contacts_site_id ON contacts(site_id);
CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type);
CREATE INDEX IF NOT EXISTS idx_contacts_value ON contacts(value);
CREATE INDEX IF NOT EXISTS idx_company_executives_site_id ON company_executives(site_id);
CREATE INDEX IF NOT EXISTS idx_company_executives_role_category ON company_executives(role_category);
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status);
CREATE INDEX IF NOT EXISTS idx_email_queue_status_id ON email_queue(status, id);
CREATE INDEX IF NOT EXISTS idx_email_send_log_contact_id ON email_send_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_email_senders_is_active ON email_senders(id) WHERE is_active = 1;

-- ============================================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_keywords_updated_at ON keywords;
CREATE TRIGGER update_keywords_updated_at
    BEFORE UPDATE ON keywords
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_linkedin_credentials_updated_at ON linkedin_credentials;
CREATE TRIGGER update_linkedin_credentials_updated_at
    BEFORE UPDATE ON linkedin_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

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

DROP TRIGGER IF EXISTS update_email_settings_updated_at ON email_settings;
CREATE TRIGGER update_email_settings_updated_at
    BEFORE UPDATE ON email_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- DEFAULT DATA
-- ============================================================================

INSERT INTO email_settings (key, value, label, description) VALUES
    ('per_email_delay', '60', 'Per-Email Delay (seconds)', 'Seconds to wait between sending each email'),
    ('max_retries', '3', 'Max Retry Attempts', 'Maximum number of retry attempts for failed emails'),
    ('retry_delay', '300', 'Retry Delay (seconds)', 'Seconds to wait before retrying a failed email'),
    ('timezone_scheduling_enabled', 'true', 'Enable Timezone Scheduling', 'Schedule emails based on recipient timezone'),
    ('business_hours_only', 'true', 'Business Hours Only', 'Only send emails during business hours (9-17 local time)')
ON CONFLICT (key) DO NOTHING;
