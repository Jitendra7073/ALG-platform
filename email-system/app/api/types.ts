/**
 * TypeScript types for the Email System API
 * Shared types used across all API routes
 */

// ============================================================================
// Email Queue Types
// ============================================================================

export type EmailQueueStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface EmailQueueItem {
  id: number;
  campaign_id: number | null;
  sender_id: number | null;
  contact_id: number | null;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  html_content: string;
  text_content: string | null;
  status: EmailQueueStatus;
  attempts: number;
  error_message: string | null;
  sent_at: string | null;
  scheduled_at: string | null;
  tag: string | null;
  sequence_position: number | null;
  country_code: string | null;
  created_at: string;
}

export interface QueueStats {
  total: number;
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  cancelled: number;
  byCountry: Array<{
    country: string;
    count: number;
    inBusinessHours: boolean;
  }>;
}

export interface AddToQueueRequest {
  contact_id?: number;
  recipient_email?: string;
  template_id?: number;
  subject?: string;
  html_content?: string;
  text_content?: string;
  campaign_id?: number;
  tag?: string;
  sequence_position?: number;
  country_code?: string;
  scheduled_at?: string;
}

export interface BulkQueueRequest {
  queue_ids: number[];
}

// ============================================================================
// Contact Types
// ============================================================================

export type ContactType = 'email' | 'phone' | 'linkedin';

/**
 * Published contact data from WordPress detector
 * Used by /api/publish endpoint
 */
export interface PublishedContact {
  id: number;
  email: string;
  name?: string;
  site_id: number;
  site_url: string;
  country?: string;
  company_name?: string;
}

/**
 * Request body for publish endpoint
 */
export interface PublishRequest {
  contacts: PublishedContact[];
}

/**
 * Response from publish endpoint with statistics
 */
export interface PublishResponse {
  total_received: number;
  processed: number;
  added: number;
  skipped: {
    duplicates: number;
    invalid: number;
  };
  errors: Array<{
    email: string;
    reason: string;
  }>;
}

export interface Contact {
  id: number;
  site_id: number;
  type: ContactType;
  value: string;
  source_page: string | null;
  created_at: string;
}

export interface ContactWithSite extends Contact {
  site_url: string;
  site_country: string;
}

export interface EmailSendLog {
  id: number;
  contact_id: number;
  contact_email: string;
  template_id: number | null;
  campaign_id: number | null;
  send_type: string;
  status: string;
  sent_at: string;
}

export interface Lead {
  id: number;
  site_id: number;
  site_url: string;
  site_country: string;
  contacts: Contact[];
  total_emails: number;
  total_phones: number;
  total_linkedin: number;
  email_count?: number;
  last_emailed_at?: string;
}

// ============================================================================
// Template Types
// ============================================================================

export type TemplateCategory = 'general' | 'outreach' | 'welcome' | 'promotion' | 'followup';

export interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  html_content: string;
  text_content: string | null;
  description: string | null;
  category: TemplateCategory;
  tags: string;
  sequence_number: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateRequest {
  name: string;
  subject: string;
  html_content: string;
  text_content?: string;
  description?: string;
  category?: TemplateCategory;
  tags?: string;
  sequence_number?: number;
}

export interface UpdateTemplateRequest {
  name?: string;
  subject?: string;
  html_content?: string;
  text_content?: string;
  description?: string;
  category?: TemplateCategory;
  tags?: string;
  sequence_number?: number;
  is_active?: boolean;
}

export interface ReorderTemplatesRequest {
  tag: string;
  ordered_ids: number[];
}

// ============================================================================
// Campaign Types
// ============================================================================

export type CampaignStatus = 'draft' | 'queued' | 'running' | 'paused' | 'completed' | 'failed';
export type CampaignTargetType = 'all' | 'wordpress' | 'ai_verified' | 'tagged';

export interface EmailCampaign {
  id: number;
  name: string;
  template_id: number | null;
  target_type: CampaignTargetType;
  status: CampaignStatus;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface CreateCampaignRequest {
  name: string;
  template_id?: number;
  target_type?: CampaignTargetType;
  tag_filter?: string;
  site_ids?: number[];
  contact_ids?: number[];
}

export interface StartCampaignRequest {
  send_immediately?: boolean;
  scheduled_at?: string;
}

// ============================================================================
// Sender Types
// ============================================================================

export type SenderService = 'gmail' | 'outlook' | 'custom' | 'smtp' | 'sendgrid' | 'mailgun' | 'ses';

export interface EmailSender {
  id: number;
  name: string;
  email: string;
  service: SenderService;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  daily_limit: number;
  is_active: boolean;
  sent_today: number;
  last_reset_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSenderRequest {
  name: string;
  email: string;
  password: string;
  service?: SenderService;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  daily_limit?: number;
}

export interface UpdateSenderRequest {
  name?: string;
  email?: string;
  password?: string;
  service?: SenderService;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  daily_limit?: number;
}

// ============================================================================
// Settings Types
// ============================================================================

export interface EmailSetting {
  key: string;
  value: string;
  label: string | null;
  description: string | null;
  updated_at: string;
}

export interface SystemSettings {
  per_email_delay: number;
  cycle_cooldown_min: number;
  cycle_cooldown_max: number;
  followup_gap_1: number;
  followup_gap_2: number;
  followup_gap_3: number;
  followup_gap_4: number;
}

// ============================================================================
// Worker/Health Types
// ============================================================================

export interface WorkerHealthStatus {
  is_running: boolean;
  is_paused: boolean;
  active_senders: number;
  queued_emails: number;
  uptime: string;
  last_check: string;
  countries_in_business: Array<{
    code: string;
    name: string;
    timezone: string;
  }>;
  parallel_mode: boolean;
  recent_errors: Array<{
    id: number;
    error_type: string;
    error_message: string;
    created_at: string;
  }>;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

// ============================================================================
// Query/Filter Types
// ============================================================================

export interface QueueQueryParams {
  status?: EmailQueueStatus;
  campaign_id?: number;
  sender_id?: number;
  contact_id?: number;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface ContactsQueryParams {
  site_id?: number;
  type?: ContactType;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CampaignsQueryParams {
  status?: CampaignStatus;
  limit?: number;
  offset?: number;
}
