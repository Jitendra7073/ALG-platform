-- =====================================================
-- Email System Seed Data
-- Migration: 002_seed_data.sql
-- =====================================================

-- =====================================================
-- EMAIL SETTINGS
-- Default email system configuration
-- =====================================================

INSERT INTO email_settings (key, value, description) VALUES
(
    'per_email_delay',
    '{"value": 2000, "unit": "milliseconds"}',
    'Delay between consecutive emails from the same sender'
),
(
    'followup_gap_1',
    '{"value": 2, "unit": "days"}',
    'Days to wait before sending first follow-up email'
),
(
    'followup_gap_2',
    '{"value": 3, "unit": "days"}',
    'Days to wait between first and second follow-up emails'
),
(
    'followup_gap_3',
    '{"value": 4, "unit": "days"}',
    'Days to wait between second and third follow-up emails'
),
(
    'max_followups',
    '{"value": 3}',
    'Maximum number of follow-up emails to send per sequence'
),
(
    'respect_business_hours',
    '{"value": true}',
    'Whether to respect business hours when scheduling emails'
),
(
    'default_sender_priority',
    '{"value": "round_robin"}',
    'Sender selection strategy: round_robin, least_used, random'
),
(
    'retry_delays',
    '{"attempts": [300000, 900000, 3600000, 7200000], "unit": "milliseconds"}',
    'Retry delays for failed emails: 5min, 15min, 1hr, 2hr'
),
(
    'queue_processing_interval',
    '{"value": 30, "unit": "seconds"}',
    'How often the queue processor checks for new emails'
),
(
    'batch_size',
    '{"value": 10}',
    'Number of emails to process in a single batch'
),
(
    'bounce_handling',
    '{"max_bounces": 3, "action": "mark_invalid"}',
    'Bounce handling: mark contact as invalid after max bounces'
),
(
    'timezone_check_enabled',
    '{"value": true}',
    'Enable timezone-based scheduling'
),
(
    'idempotency_ttl',
    '{"value": 7, "unit": "days"}',
    'Time to keep idempotency records'
)
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- COUNTRY TIMEZONES
-- Comprehensive timezone and business hours data
-- =====================================================

-- === ASIA ===

INSERT INTO country_timezones (country, country_name, timezone, business_hours_start, business_hours_end, business_days) VALUES
('in', 'India', 'Asia/Kolkata', '09:00', '18:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('sg', 'Singapore', 'Asia/Singapore', '09:00', '18:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('jp', 'Japan', 'Asia/Tokyo', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('kr', 'South Korea', 'Asia/Seoul', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('cn', 'China', 'Asia/Shanghai', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('tw', 'Taiwan', 'Asia/Taipei', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('th', 'Thailand', 'Asia/Bangkok', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('my', 'Malaysia', 'Asia/Kuala_Lumpur', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('id', 'Indonesia', 'Asia/Jakarta', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('ph', 'Philippines', 'Asia/Manila', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('vn', 'Vietnam', 'Asia/Ho_Chi_Minh', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('hk', 'Hong Kong', 'Asia/Hong_Kong', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('ae', 'United Arab Emirates', 'Asia/Dubai', '09:00', '17:00', ARRAY['sun', 'mon', 'tue', 'wed', 'thu']),
('sa', 'Saudi Arabia', 'Asia/Riyadh', '09:00', '17:00', ARRAY['sun', 'mon', 'tue', 'wed', 'thu']),
('qa', 'Qatar', 'Asia/Qatar', '09:00', '17:00', ARRAY['sun', 'mon', 'tue', 'wed', 'thu']),
('kw', 'Kuwait', 'Asia/Kuwait', '09:00', '17:00', ARRAY['sun', 'mon', 'tue', 'wed', 'thu']),
('il', 'Israel', 'Asia/Jerusalem', '09:00', '17:00', ARRAY['sun', 'mon', 'tue', 'wed', 'thu']),
('tr', 'Turkey', 'Europe/Istanbul', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('pk', 'Pakistan', 'Asia/Karachi', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('bd', 'Bangladesh', 'Asia/Dhaka', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('lk', 'Sri Lanka', 'Asia/Colombo', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('np', 'Nepal', 'Asia/Kathmandu', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri'])

ON CONFLICT (country) DO NOTHING;

-- === EUROPE ===

INSERT INTO country_timezones (country, country_name, timezone, business_hours_start, business_hours_end, business_days) VALUES
('uk', 'United Kingdom', 'Europe/London', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('gb', 'United Kingdom', 'Europe/London', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('de', 'Germany', 'Europe/Berlin', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('fr', 'France', 'Europe/Paris', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('it', 'Italy', 'Europe/Rome', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('es', 'Spain', 'Europe/Madrid', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('nl', 'Netherlands', 'Europe/Amsterdam', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('se', 'Sweden', 'Europe/Stockholm', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('no', 'Norway', 'Europe/Oslo', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('dk', 'Denmark', 'Europe/Copenhagen', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('fi', 'Finland', 'Europe/Helsinki', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('ch', 'Switzerland', 'Europe/Zurich', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('at', 'Austria', 'Europe/Vienna', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('be', 'Belgium', 'Europe/Brussels', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('pl', 'Poland', 'Europe/Warsaw', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('cz', 'Czech Republic', 'Europe/Prague', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('gr', 'Greece', 'Europe/Athens', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('pt', 'Portugal', 'Europe/Lisbon', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('ie', 'Ireland', 'Europe/Dublin', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('ru', 'Russia', 'Europe/Moscow', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('hu', 'Hungary', 'Europe/Budapest', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('ro', 'Romania', 'Europe/Bucharest', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('bg', 'Bulgaria', 'Europe/Sofia', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('hr', 'Croatia', 'Europe/Zagreb', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('ua', 'Ukraine', 'Europe/Kyiv', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri'])

ON CONFLICT (country) DO NOTHING;

-- === NORTH AMERICA ===

INSERT INTO country_timezones (country, country_name, timezone, business_hours_start, business_hours_end, business_days) VALUES
('us', 'United States', 'America/New_York', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('ca', 'Canada', 'America/Toronto', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('mx', 'Mexico', 'America/Mexico_City', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri'])

ON CONFLICT (country) DO NOTHING;

-- === SOUTH AMERICA ===

INSERT INTO country_timezones (country, country_name, timezone, business_hours_start, business_hours_end, business_days) VALUES
('br', 'Brazil', 'America/Sao_Paulo', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('ar', 'Argentina', 'America/Argentina/Buenos_Aires', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('co', 'Colombia', 'America/Bogota', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('cl', 'Chile', 'America/Santiago', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('pe', 'Peru', 'America/Lima', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('ve', 'Venezuela', 'America/Caracas', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('ec', 'Ecuador', 'America/Guayaquil', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri'])

ON CONFLICT (country) DO NOTHING;

-- === OCEANIA ===

INSERT INTO country_timezones (country, country_name, timezone, business_hours_start, business_hours_end, business_days) VALUES
('au', 'Australia', 'Australia/Sydney', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('nz', 'New Zealand', 'Pacific/Auckland', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('fj', 'Fiji', 'Pacific/Fiji', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri'])

ON CONFLICT (country) DO NOTHING;

-- === AFRICA ===

INSERT INTO country_timezones (country, country_name, timezone, business_hours_start, business_hours_end, business_days) VALUES
('za', 'South Africa', 'Africa/Johannesburg', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('ng', 'Nigeria', 'Africa/Lagos', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('ke', 'Kenya', 'Africa/Nairobi', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('eg', 'Egypt', 'Africa/Cairo', '09:00', '17:00', ARRAY['sun', 'mon', 'tue', 'wed', 'thu']),
('ma', 'Morocco', 'Africa/Casablanca', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('gh', 'Ghana', 'Africa/Accra', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri']),
('tn', 'Tunisia', 'Africa/Tunis', '09:00', '17:00', ARRAY['mon', 'tue', 'wed', 'thu', 'fri'])

ON CONFLICT (country) DO NOTHING;

-- =====================================================
-- SAMPLE EMAIL TEMPLATES (Optional - for testing)
-- =====================================================

INSERT INTO email_templates (name, subject, html_content, text_content, category, tags, sequence_number) VALUES
(
    'Initial Outreach',
    'Quick question about {{company}}',
    '<html><body><p>Hi {{name}},</p><p>I noticed you''re using WordPress for {{company}} and wanted to reach out.</p><p>Best regards,<br>{{sender_name}}</p></body></html>',
    'Hi {{name}},

I noticed you''re using WordPress for {{company}} and wanted to reach out.

Best regards,
{{sender_name}}',
    'outreach',
    ARRAY['initial', 'wordpress'],
    1
),
(
    'Follow-up 1',
    'Re: Quick question about {{company}}',
    '<html><body><p>Hi {{name}},</p><p>Just following up on my previous email about {{company}}.</p><p>Best regards,<br>{{sender_name}}</p></body></html>',
    'Hi {{name}},

Just following up on my previous email about {{company}}.

Best regards,
{{sender_name}}',
    'followup',
    ARRAY['followup', 'wordpress'],
    2
),
(
    'Follow-up 2',
    'Re: Quick question about {{company}}',
    '<html><body><p>Hi {{name}},</p><p>I wanted to check if you had a chance to review my previous email.</p><p>Best regards,<br>{{sender_name}}</p></body></html>',
    'Hi {{name}},

I wanted to check if you had a chance to review my previous email.

Best regards,
{{sender_name}}',
    'followup',
    ARRAY['followup', 'wordpress'],
    3
)

ON CONFLICT DO NOTHING;
