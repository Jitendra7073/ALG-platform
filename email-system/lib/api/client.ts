/**
 * Frontend API client for Email System
 * Matches the Next.js backend API routes
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

// ============================================================================
// API Response Types
// ============================================================================

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface PaginatedResponse<T> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
  [key: number]: T; // Array items indexed by number
  length: number;
}

// ============================================================================
// API Request Helper
// ============================================================================

export async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  const result: ApiResponse<T> = await response.json().catch(() => ({
    success: false,
    error: "Invalid response from server",
  }));

  if (!result.success) {
    throw new Error(result.error || `HTTP ${response.status}`);
  }

  return (result.data as T) ?? (result as T);
}

// ============================================================================
// Domain Types (matching backend types.ts)
// ============================================================================

export type EmailQueueStatus = "queued" | "sending" | "sent" | "failed" | "cancelled";
export type ContactType = "email" | "phone" | "linkedin";
export type TemplateCategory = "general" | "outreach" | "welcome" | "promotion" | "followup";
export type CampaignStatus = "draft" | "queued" | "running" | "paused" | "completed" | "failed";
export type CampaignTargetType = "all" | "wordpress" | "ai_verified" | "tagged";
export type SenderService = "gmail" | "outlook" | "custom" | "smtp" | "sendgrid" | "mailgun" | "ses";

// ============================================================================
// Email Queue Types
// ============================================================================

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
  site_url?: string;
  site_country?: string;
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

export interface QueueResponse {
  items: EmailQueueItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface QueueQuery {
  page?: number;
  limit?: number;
  status?: EmailQueueStatus;
  campaign_id?: number;
  sender_id?: number;
  contact_id?: number;
  tag?: string;
}

// ============================================================================
// Contact Types
// ============================================================================

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

export interface LeadsResponse {
  items: Lead[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface LeadsQuery {
  page?: number;
  limit?: number;
  country?: string;
  relevant_only?: boolean;
  tag?: string;
  with_email?: boolean;
}

// ============================================================================
// Template Types
// ============================================================================

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

// ============================================================================
// Campaign Types
// ============================================================================

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
  template_name?: string;
  template_subject?: string;
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
  smtp_port?: string;
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

export interface SettingsResponse {
  settings: EmailSetting[];
  values: Record<string, string>;
}

// ============================================================================
// Health/Worker Types
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
// API Functions
// ============================================================================

// Dashboard/Health API
export const healthApi = {
  getStatus: () => apiRequest<WorkerHealthStatus>("/health"),
};

// Leads API
export const leadsApi = {
  list: (params?: LeadsQuery) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.append("page", params.page.toString());
    if (params?.limit) searchParams.append("limit", params.limit.toString());
    if (params?.country) searchParams.append("country", params.country);
    if (params?.relevant_only) searchParams.append("relevant_only", "true");
    if (params?.tag) searchParams.append("tag", params.tag);
    if (params?.with_email === false) searchParams.append("with_email", "false");

    return apiRequest<LeadsResponse>(`/leads?${searchParams.toString()}`);
  },
};

// Queue API
export const queueApi = {
  list: (params?: QueueQuery) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.append("page", params.page.toString());
    if (params?.limit) searchParams.append("limit", params.limit.toString());
    if (params?.status) searchParams.append("status", params.status);
    if (params?.campaign_id) searchParams.append("campaign_id", params.campaign_id.toString());
    if (params?.sender_id) searchParams.append("sender_id", params.sender_id.toString());
    if (params?.contact_id) searchParams.append("contact_id", params.contact_id.toString());
    if (params?.tag) searchParams.append("tag", params.tag);

    return apiRequest<QueueResponse>(`/queue?${searchParams.toString()}`);
  },
  getById: (id: number) => apiRequest<EmailQueueItem>(`/queue/${id}`),
  cancel: (id: number) => apiRequest<{ success: boolean }>(`/queue/${id}`, { method: "DELETE" }),
  retry: (id: number) => apiRequest<{ success: boolean }>(`/queue/${id}/retry`, { method: "POST" }),
  getStats: () => apiRequest<QueueStats>("/queue/stats"),
  bulkCancel: (ids: number[]) => apiRequest<{ success: boolean }>("/queue/bulk/cancel", {
    method: "POST",
    body: JSON.stringify({ queue_ids: ids }),
  }),
  bulkRetry: (ids: number[]) => apiRequest<{ success: boolean }>("/queue/bulk/retry", {
    method: "POST",
    body: JSON.stringify({ queue_ids: ids }),
  }),
  pause: () => apiRequest<{ success: boolean }>("/queue/pause", { method: "POST" }),
  resume: () => apiRequest<{ success: boolean }>("/queue/resume", { method: "POST" }),
  trigger: () => apiRequest<{ success: boolean }>("/queue/trigger", { method: "POST" }),
  addToQueue: (data: {
    recipient_email: string;
    template_id?: number;
    subject?: string;
    html_content?: string;
    text_content?: string;
    campaign_id?: number;
    contact_id?: number;
    tag?: string;
    sequence_position?: number;
    country_code?: string;
    scheduled_at?: string;
  }) => apiRequest<{ id: number; status: string }>("/queue", {
    method: "POST",
    body: JSON.stringify(data),
  }),
};

// Templates API
export const templatesApi = {
  list: (params?: { tag?: string; category?: string; active?: boolean }) => {
    const searchParams = new URLSearchParams();
    if (params?.tag) searchParams.append("tag", params.tag);
    if (params?.category) searchParams.append("category", params.category);
    if (params?.active) searchParams.append("active", "true");

    return apiRequest<EmailTemplate[]>(`/templates?${searchParams.toString()}`);
  },
  getById: (id: number) => apiRequest<EmailTemplate>(`/templates/${id}`),
  create: (data: CreateTemplateRequest) =>
    apiRequest<EmailTemplate>("/templates", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: UpdateTemplateRequest) =>
    apiRequest<EmailTemplate>(`/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: number) => apiRequest<{ success: boolean }>(`/templates/${id}`, { method: "DELETE" }),
  getTags: () => apiRequest<string[]>("/templates/tags"),
};

// Campaigns API
export const campaignsApi = {
  list: (params?: { status?: CampaignStatus; page?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append("status", params.status);
    if (params?.page) searchParams.append("page", params.page.toString());
    if (params?.limit) searchParams.append("limit", params.limit.toString());

    return apiRequest<EmailCampaign[]>(`/campaigns?${searchParams.toString()}`);
  },
  getById: (id: number) => apiRequest<EmailCampaign>(`/campaigns/${id}`),
  create: (data: CreateCampaignRequest) =>
    apiRequest<EmailCampaign>("/campaigns", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Partial<CreateCampaignRequest>) =>
    apiRequest<EmailCampaign>(`/campaigns/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: number) => apiRequest<{ success: boolean }>(`/campaigns/${id}`, { method: "DELETE" }),
  start: (id: number, data?: StartCampaignRequest) =>
    apiRequest<{ success: boolean }>(`/campaigns/${id}/start`, {
      method: "POST",
      body: JSON.stringify(data || {}),
    }),
};

// Senders API
export const sendersApi = {
  list: () => apiRequest<EmailSender[]>("/senders"),
  getById: (id: number) => apiRequest<EmailSender>(`/senders/${id}`),
  create: (data: CreateSenderRequest) =>
    apiRequest<EmailSender>("/senders", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: UpdateSenderRequest) =>
    apiRequest<EmailSender>(`/senders/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: number) => apiRequest<{ success: boolean }>(`/senders/${id}`, { method: "DELETE" }),
  toggle: (id: number) => apiRequest<EmailSender>(`/senders/${id}/toggle`, { method: "POST" }),
  test: (id: number) => apiRequest<{ success: boolean; message?: string }>(`/senders/${id}/test`, { method: "POST" }),
};

// Settings API
export const settingsApi = {
  get: () => apiRequest<SettingsResponse>("/settings"),
  update: (settings: Record<string, string | number>) =>
    apiRequest<{ updated: number }>("/settings", {
      method: "PUT",
      body: JSON.stringify({ settings }),
    }),
};

// Contacts API
export const contactsApi = {
  list: (params?: { site_id?: number; type?: ContactType; search?: string; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.site_id) searchParams.append("site_id", params.site_id.toString());
    if (params?.type) searchParams.append("type", params.type);
    if (params?.search) searchParams.append("search", params.search);
    if (params?.limit) searchParams.append("limit", params.limit.toString());

    return apiRequest<Contact[]>(`/contacts?${searchParams.toString()}`);
  },
  getHistory: (id: number) => apiRequest<any[]>(`/contacts/${id}/history`),
};
