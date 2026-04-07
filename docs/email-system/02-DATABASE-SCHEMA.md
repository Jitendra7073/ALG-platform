# Email System - Database Schema

## Complete PostgreSQL Schema (Supabase)

### 1. Template Groups

```sql
CREATE TABLE template_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick group lookup
CREATE INDEX idx_template_groups_name ON template_groups(name);
```

**Purpose**: Organizes templates into campaigns (e.g., "coupon", "newsletter", "welcome")

### 2. Email Templates

```sql
CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  html_content TEXT NOT NULL,
  text_content TEXT,
  description TEXT,
  variable_schema JSONB DEFAULT '{}', -- Available variables: {{first_name}}, {{company}}, etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for template search
CREATE INDEX idx_email_templates_name ON email_templates(name);
```

**Purpose**: Reusable email templates that can belong to multiple groups

### 3. Template Group Memberships (Many-to-Many)

```sql
CREATE TABLE template_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES template_groups(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, -- 1, 2, 3, 4... (sending order)
  
  -- Gap configuration
  gap_days INTEGER DEFAULT 0,
  gap_hours INTEGER DEFAULT 0,
  gap_minutes INTEGER DEFAULT 0,
  send_time TIME, -- Specific time to send (HH:MM format)
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(group_id, position), -- One template per position in a group
  UNIQUE(template_id, group_id), -- Template can only appear once per group
  CHECK (position > 0),
  CHECK (gap_days >= 0),
  CHECK (gap_hours >= 0 AND gap_hours < 24),
  CHECK (gap_minutes >= 0 AND gap_minutes < 60)
);

-- Indexes for group lookups
CREATE INDEX idx_template_group_members_group ON template_group_members(group_id);
CREATE INDEX idx_template_group_members_template ON template_group_members(template_id);
CREATE INDEX idx_template_group_members_position ON template_group_members(group_id, position);
```

**Purpose**: Defines which templates belong to which groups and their sending order

**Example Data**:
```
Group: "coupon"
├── Position 1: Welcome Email (gap: 0 days, 9:00 AM)
├── Position 2: Follow-up 1 (gap: 2 days, 10:30 AM)
├── Position 3: Follow-up 2 (gap: 2 days, 9:00 AM)
└── Position 4: Promotion (gap: 4 days, 2:00 PM)
```

### 4. Email Senders

```sql
CREATE TABLE email_senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER DEFAULT 587,
  smtp_secure BOOLEAN DEFAULT FALSE, -- TRUE for SSL, FALSE for TLS
  app_password TEXT NOT NULL, -- Encrypted
  daily_limit INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Statistics
  total_sent INTEGER DEFAULT 0,
  total_failed INTEGER DEFAULT 0,
  total_bounces INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  
  -- Health metrics
  success_rate DECIMAL(5,2) DEFAULT 100.00, -- Calculated: (sent - failed) / sent * 100
  health_status TEXT DEFAULT 'healthy', -- healthy, warning, critical
  
  -- Reset counters
  today_sent INTEGER DEFAULT 0,
  today_reset_date DATE DEFAULT CURRENT_DATE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for sender selection
CREATE INDEX idx_email_senders_active ON email_senders(is_active, health_status);
CREATE INDEX idx_email_senders_email ON email_senders(email);
```

**Purpose**: SMTP sender accounts with daily limits and health tracking

### 5. Contacts (Synced from Local SQLite)

```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id INTEGER UNIQUE, -- Reference to SQLite contacts.id
  
  -- Contact information
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  linkedin_url TEXT,
  
  -- Source information
  source_url TEXT, -- Website where contact was found
  source_type TEXT DEFAULT 'scraped', -- scraped, manual, import
  country_code TEXT, -- IN, US, UK, etc.
  region TEXT, -- State, province, etc.
  
  -- Company info
  company_name TEXT,
  company_website TEXT,
  
  -- Sync status
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(email)
);

-- Indexes for contact search
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_local_id ON contacts(local_id);
CREATE INDEX idx_contacts_country ON contacts(country_code);
```

**Purpose**: Contact database synced from local SQLite (idempotent sync)

### 6. Email Campaigns

```sql
CREATE TABLE email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  
  -- Campaign configuration
  group_id UUID NOT NULL REFERENCES template_groups(id) ON DELETE CASCADE,
  
  -- Status tracking
  status TEXT DEFAULT 'draft', -- draft, active, paused, completed, cancelled
  total_contacts INTEGER DEFAULT 0,
  total_queued INTEGER DEFAULT 0,
  total_sent INTEGER DEFAULT 0,
  total_failed INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for campaign lookup
CREATE INDEX idx_email_campaigns_status ON email_campaigns(status);
CREATE INDEX idx_email_campaigns_group ON email_campaigns(group_id);
```

**Purpose**: Campaign tracking for a group sent to multiple contacts

### 7. Email Queue

```sql
CREATE TABLE email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Campaign & contact
  campaign_id UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES email_senders(id) ON DELETE SET NULL,
  
  -- Template information
  template_id UUID NOT NULL REFERENCES email_templates(id),
  group_id UUID NOT NULL REFERENCES template_groups(id),
  position INTEGER NOT NULL, -- 1, 2, 3, 4...
  
  -- Dependency chain
  depends_on_email_id UUID REFERENCES email_queue(id), -- Previous email in chain
  dependency_satisfied BOOLEAN DEFAULT FALSE,
  
  -- Scheduling (with timezone awareness)
  recipient_country TEXT,
  recipient_timezone TEXT, -- IANA timezone: America/New_York, Asia/Kolkata
  original_scheduled_at TIMESTAMPTZ, -- Before timezone adjustment
  scheduled_at TIMESTAMPTZ NOT NULL, -- Final scheduled time
  adjusted_for_weekend BOOLEAN DEFAULT FALSE,
  adjusted_for_business_hours BOOLEAN DEFAULT FALSE,
  
  -- Email content (snapshot at time of queue creation)
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_content TEXT NOT NULL,
  text_content TEXT,
  variables JSONB DEFAULT '{}', -- {{first_name}}, {{company}}, etc.
  
  -- Status tracking
  status TEXT DEFAULT 'pending', -- pending, scheduled, sending, sent, failed, cancelled, paused
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  
  -- Sending results
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ, -- If tracking enabled
  clicked_at TIMESTAMPTZ, -- If tracking enabled
  bounced_at TIMESTAMPTZ,
  bounce_reason TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CHECK (position > 0),
  CHECK (retry_count >= 0),
  CHECK (status IN ('pending', 'scheduled', 'sending', 'sent', 'failed', 'cancelled', 'paused'))
);

-- Critical indexes for queue processing
CREATE INDEX idx_email_queue_status ON email_queue(status, scheduled_at);
CREATE INDEX idx_email_queue_campaign ON email_queue(campaign_id);
CREATE INDEX idx_email_queue_contact ON email_queue(contact_id);
CREATE INDEX idx_email_queue_sender ON email_queue(sender_id, status);
CREATE INDEX idx_email_queue_dependency ON email_queue(depends_on_email_id, dependency_satisfied);
CREATE INDEX idx_email_queue_group_contact ON email_queue(group_id, contact_id, status); -- For duplicate prevention
```

**Purpose**: Email queue with dependency chain and timezone-aware scheduling

**Dependency Chain Example**:
```
Email Queue for Campaign #1:
├── Email #1 (Welcome): depends_on_email_id = NULL, dependency_satisfied = TRUE
├── Email #2 (Follow-up 1): depends_on_email_id = [Email #1 ID], dependency_satisfied = FALSE (waiting for #1)
├── Email #3 (Follow-up 2): depends_on_email_id = [Email #2 ID], dependency_satisfied = FALSE (waiting for #2)
└── Email #4 (Promotion): depends_on_email_id = [Email #3 ID], dependency_satisfied = FALSE (waiting for #3)

Processing:
1. Email #1 sent successfully → Mark dependency_satisfied = TRUE for Email #2
2. Email #2 can now send
3. If Email #1 fails → Mark Email #2, #3, #4 as failed (chain reaction)
```

### 8. Email Send Log

```sql
CREATE TABLE email_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  queue_id UUID NOT NULL REFERENCES email_queue(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES email_campaigns(id) ON DELETE SET NULL,
  sender_id UUID NOT NULL REFERENCES email_senders(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
  
  -- Email information
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  
  -- Sending details
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL, -- sent, failed, bounced
  error_message TEXT,
  
  -- SMTP response
  smtp_response TEXT,
  smtp_message_id TEXT, -- For bounce tracking
  
  -- Metadata
  timezone TEXT, -- Recipient's timezone at send time
  scheduled_adjusted BOOLEAN DEFAULT FALSE, -- Was time adjusted for weekend/hours?
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for log analysis
CREATE INDEX idx_email_send_log_campaign ON email_send_log(campaign_id);
CREATE INDEX idx_email_send_log_sender ON email_send_log(sender_id, sent_at);
CREATE INDEX idx_email_send_log_status ON email_send_log(status, sent_at);
CREATE INDEX idx_email_send_log_contact ON email_send_log(contact_id);
```

**Purpose**: Historical log of all email send attempts

### 9. Country Timezones

```sql
CREATE TABLE country_timezones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL UNIQUE, -- IN, US, UK, etc.
  country_name TEXT NOT NULL,
  default_timezone TEXT NOT NULL, -- IANA timezone: Asia/Kolkata, America/New_York
  business_hours_start TIME DEFAULT '09:00',
  business_hours_end TIME DEFAULT '18:00',
  weekend_days TEXT[] DEFAULT ARRAY['Saturday', 'Sunday'],
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick timezone lookup
CREATE INDEX idx_country_timezones_code ON country_timezones(country_code);
```

**Purpose**: Timezone and business hours configuration per country

**Example Data**:
```sql
INSERT INTO country_timezones (country_code, country_name, default_timezone) VALUES
  ('IN', 'India', 'Asia/Kolkata'),
  ('US', 'United States', 'America/New_York'),
  ('UK', 'United Kingdom', 'Europe/London'),
  ('CA', 'Canada', 'America/Toronto'),
  ('AU', 'Australia', 'Australia/Sydney');
```

## Database Relationships

```
template_groups (1) ────< (many) template_group_members >─── (many) email_templates
                                                          |
                                                          |
                                                          V
                                               email_campaigns (group_id)
                                                          |
                                                          |
                                                          V
                                               email_queue (group_id, template_id)
                                                          |
                                  +-------------------------+-------------------------+
                                  |                         |                         |
                                  V                         V                         V
                          contacts                 email_senders              email_send_log
```

## Row Level Security (RLS) Policies

```sql
-- Enable RLS
ALTER TABLE template_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_senders ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_send_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE country_timezones ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (for API routes)
CREATE POLICY "Service role full access" ON ALL TABLES
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read (for client-side queries)
CREATE POLICY "Authenticated read access" ON template_groups
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated read access" ON email_templates
  FOR SELECT
  TO authenticated
  USING (true);

-- Similar policies for other tables...
```

## Migration Strategy

### Phase 1: Create Schema
```sql
-- Run all CREATE TABLE statements above
-- Create indexes
-- Enable RLS
-- Insert default country_timezones data
```

### Phase 2: Contact Sync
```sql
-- One-time sync from SQLite contacts table
INSERT INTO contacts (local_id, email, first_name, last_name, phone, linkedin_url, source_url, source_type, country_code, region, company_name, company_website)
SELECT 
  id as local_id,
  email,
  first_name,
  last_name,
  phone,
  linkedin_url,
  source_url,
  'scraped' as source_type,
  country_code,
  region,
  company_name,
  company_website
FROM sqlite_contacts_table;
```

### Phase 3: Incremental Sync
```sql
-- Check for new contacts since last sync
INSERT INTO contacts (...)
SELECT ...
FROM sqlite_contacts_table
WHERE id NOT IN (SELECT local_id FROM contacts);
```

## Data Retention Policy

```sql
-- Archive sent logs older than 90 days
CREATE TABLE email_send_log_archive AS
SELECT * FROM email_send_log
WHERE sent_at < NOW() - INTERVAL '90 days';

-- Delete from main table
DELETE FROM email_send_log
WHERE sent_at < NOW() - INTERVAL '90 days';

-- Clean up completed campaigns older than 1 year
DELETE FROM email_campaigns
WHERE status = 'completed'
AND completed_at < NOW() - INTERVAL '1 year';
```

## Performance Optimization

### Materialized View for Queue Stats

```sql
CREATE MATERIALIZED VIEW email_queue_stats AS
SELECT 
  campaign_id,
  status,
  COUNT(*) as count,
  MIN(scheduled_at) as next_send_at,
  MAX(scheduled_at) as last_send_at
FROM email_queue
GROUP BY campaign_id, status;

CREATE INDEX idx_email_queue_stats_campaign ON email_queue_stats(campaign_id);

-- Refresh every 5 minutes
CREATE OR REPLACE FUNCTION refresh_queue_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY email_queue_stats;
END;
$$ LANGUAGE plpgsql;
```

### Trigger for Updated At

```sql
-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER update_template_groups_updated_at BEFORE UPDATE ON template_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_email_templates_updated_at BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ... repeat for other tables
```
