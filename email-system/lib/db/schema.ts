/**
 * Database Schema TypeScript Types
 * Types matching all tables in the email system
 */

// =====================================================
// READ-ONLY TABLES (From existing scraper system)
// =====================================================

/**
 * Sites table (from scraper, read-only for email system)
 */
export interface Site {
  id: number;
  url: string;
  country: string;
  is_wordpress: number;
  confidence_score: number;
  indicators: string | null;
  error: string | null;
  search_query: string | null;
  emails: string | null;
  phones: string | null;
  linkedin_profiles: string | null;
  text_content: string | null;
  ai_processed: number;
  ai_status: string;
  ai_verified_wp: number | null;
  ai_wp_confidence: string | null;
  ai_wp_indicators: string | null;
  ai_content_relevant: number | null;
  ai_actual_category: string | null;
  ai_content_summary: string | null;
  ai_mismatch_reason: string | null;
  ai_error: string | null;
  ai_processed_at: string | null;
  classification: string | null;
  relevance_score: number | null;
  tags: string | null;
  primary_language: string | null;
  value_proposition: string | null;
  ai_reasoning: string | null;
  ai_is_wordpress: number | null;
  ai_is_genuine_match: number | null;
  page_title: string | null;
  meta_description: string | null;
  retry_count: number;
  last_retried_at: string | null;
  checked_at: string;
  search_id: number;
  created_at: string;
}

/**
 * Contacts table (from scraper, read-only for email system)
 */
export interface Contact {
  id: number;
  site_id: number;
  type: 'email' | 'phone' | 'linkedin';
  value: string;
  is_bouncing: boolean;
  bounce_reason: string | null;
  created_at: string;
}

/**
 * Company executives table (from LinkedIn scraper, read-only)
 */
export interface CompanyExecutive {
  id: number;
  site_id: number;
  name: string;
  headline: string | null;
  role_category: 'founder_1' | 'founder_2' | 'founder_3' | 'ceo' | 'cto';
  profile_url: string | null;
  created_at: string;
}

/**
 * Searches table (metadata, read-only)
 */
export interface Search {
  id: number;
  query: string;
  country: string;
  total_sites: number;
  wordpress_count: number;
  non_wordpress_count: number;
  created_at: string;
}

/**
 * Keywords table (read-only)
 */
export interface Keyword {
  id: number;
  keyword: string;
  status: string;
  max_sites: number;
  created_at: string;
  updated_at: string;
}

// =====================================================
// EMAIL SYSTEM TABLES (Write-Heavy)
// =====================================================

/**
 * Email senders table
 */
export interface EmailSender {
  id: number;
  name: string;
  email: string;
  password_encrypted: string;
  service: 'gmail' | 'smtp' | 'resend' | 'sendgrid';
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  daily_limit: number;
  hourly_limit: number;
  is_active: boolean;
  sent_today: number;
  sent_hour: number;
  last_reset_date: string | null; // DATE
  last_reset_hour: string | null; // TIMESTAMPTZ
  created_at: string; // TIMESTAMPTZ
  updated_at: string; // TIMESTAMPTZ
}

/**
 * Email templates table
 */
export interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  html_content: string;
  text_content: string | null;
  category: string;
  tags: string[];
  sequence_number: number;
  is_active: boolean;
  version: number;
  parent_template_id: number | null;
  created_at: string; // TIMESTAMPTZ
  updated_at: string; // TIMESTAMPTZ
}

/**
 * Email campaigns table
 */
export interface EmailCampaign {
  id: number;
  name: string;
  description: string | null;
  template_tag: string;
  template_ids: number[];
  target_criteria: Record<string, unknown>; // JSONB
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed';
  total_recipients: number;
  queued_count: number;
  sent_count: number;
  failed_count: number;
  start_after: string | null; // TIMESTAMPTZ
  started_at: string | null; // TIMESTAMPTZ
  completed_at: string | null; // TIMESTAMPTZ
  created_at: string; // TIMESTAMPTZ
  updated_at: string; // TIMESTAMPTZ
}

/**
 * Email queue table
 */
export interface EmailQueue {
  id: number;
  campaign_id: number | null;
  sender_id: number | null;
  contact_id: number;
  recipient_email: string;
  recipient_name: string | null;
  template_id: number;
  subject: string;
  html_content: string;
  text_content: string | null;
  sequence_tag: string;
  sequence_position: number;
  depends_on_queue_id: number | null;
  status: 'pending' | 'scheduled' | 'acquired' | 'sent' | 'failed' | 'failed_permanent' | 'cancelled';
  priority: number;
  scheduled_at: string | null; // TIMESTAMPTZ
  started_at: string | null; // TIMESTAMPTZ
  completed_at: string | null; // TIMESTAMPTZ
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  last_error_at: string | null; // TIMESTAMPTZ
  idempotency_key: string;
  processing_token: string | null;
  country_code: string;
  created_at: string; // TIMESTAMPTZ
  updated_at: string; // TIMESTAMPTZ
}

/**
 * Email sequence state table
 */
export interface EmailSequenceState {
  id: number;
  contact_id: number;
  campaign_id: number;
  sequence_tag: string;
  current_position: number;
  max_position: number;
  status: 'active' | 'paused' | 'completed' | 'failed';
  current_queue_id: number | null;
  last_failed_position: number | null;
  last_failed_at: string | null; // TIMESTAMPTZ
  failure_reason: string | null;
  created_at: string; // TIMESTAMPTZ
  updated_at: string; // TIMESTAMPTZ
}

/**
 * Email send log table (append-only)
 */
export interface EmailSendLog {
  id: number;
  queue_id: number;
  contact_id: number;
  template_id: number | null;
  sender_id: number | null;
  campaign_id: number | null;
  to_email: string;
  from_email: string;
  subject: string;
  provider: string;
  provider_message_id: string | null;
  status: 'sent' | 'bounced' | 'opened' | 'clicked' | 'complained';
  error_message: string | null;
  sent_at: string; // TIMESTAMPTZ
  delivered_at: string | null; // TIMESTAMPTZ
  opened_at: string | null; // TIMESTAMPTZ
  clicked_at: string | null; // TIMESTAMPTZ
  created_at: string; // TIMESTAMPTZ
}

/**
 * Email settings table (key-value store)
 */
export interface EmailSetting {
  key: string;
  value: unknown; // JSONB
  description: string | null;
  updated_at: string; // TIMESTAMPTZ
}

/**
 * Country timezones table
 */
export interface CountryTimezone {
  id: number;
  country: string;
  country_name: string;
  timezone: string;
  business_hours_start: string; // HH:MM format
  business_hours_end: string; // HH:MM format
  business_days: string[]; // ['mon', 'tue', 'wed', 'thu', 'fri']
  created_at: string; // TIMESTAMPTZ
  updated_at: string; // TIMESTAMPTZ
}

// =====================================================
// INPUT TYPES (for creating records)
// =====================================================

export type CreateEmailSender = Omit<
  EmailSender,
  'id' | 'sent_today' | 'sent_hour' | 'last_reset_date' | 'last_reset_hour' | 'created_at' | 'updated_at'
>;

export type CreateEmailTemplate = Omit<
  EmailTemplate,
  'id' | 'version' | 'created_at' | 'updated_at'
>;

export type CreateEmailCampaign = Omit<
  EmailCampaign,
  'id' | 'queued_count' | 'sent_count' | 'failed_count' | 'started_at' | 'completed_at' | 'created_at' | 'updated_at'
>;

export type CreateEmailQueue = Omit<
  EmailQueue,
  'id' | 'status' | 'started_at' | 'completed_at' | 'attempts' | 'last_error' | 'last_error_at' | 'processing_token' | 'created_at' | 'updated_at'
>;

export type CreateEmailSequenceState = Omit<
  EmailSequenceState,
  'id' | 'last_failed_position' | 'last_failed_at' | 'failure_reason' | 'created_at' | 'updated_at'
>;

// =====================================================
// UPDATE TYPES (partial updates)
// =====================================================

export type UpdateEmailSender = Partial<Omit<
  EmailSender,
  'id' | 'created_at'
>>;

export type UpdateEmailQueue = Partial<Omit<
  EmailQueue,
  'id' | 'contact_id' | 'created_at'
>>;

export type UpdateEmailCampaign = Partial<Omit<
  EmailCampaign,
  'id' | 'created_at'
>>;

// =====================================================
// QUERY RESULT TYPES
// =====================================================

/**
 * Queue item with joined data for processing
 */
export interface QueueItemForProcessing extends EmailQueue {
  site_country?: string;
  site_url?: string;
  contact_type?: string;
  template_tags?: string[];
}

/**
 * Queue statistics
 */
export interface QueueStats {
  total: number;
  pending: number;
  scheduled: number;
  acquired: number;
  sent: number;
  failed: number;
  byCountry: Array<{
    country: string;
    count: number;
    inBusinessHours: boolean;
  }>;
}

/**
 * Sender availability info
 */
export interface SenderAvailability {
  id: number;
  name: string;
  email: string;
  sent_today: number;
  sent_hour: number;
  daily_limit: number;
  hourly_limit: number;
  available: boolean;
}

/**
 * Email send result
 */
export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  alreadySent?: boolean;
  rescheduled?: boolean;
}
