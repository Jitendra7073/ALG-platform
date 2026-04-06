/**
 * TypeScript Type Definitions for Email System
 * Shared types used across email providers, senders, and templates
 */

// =====================================================
// EMAIL PROVIDER TYPES
// =====================================================

/**
 * Supported email providers
 */
export type EmailProviderType = 'resend' | 'sendgrid' | 'smtp' | 'gmail';

/**
 * Email delivery status
 */
export type EmailDeliveryStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'deferred'
  | 'failed'
  | 'permanent_failure'
  | 'cancelled';

/**
 * Error classification for retry logic
 */
export type EmailErrorType =
  | 'temporary'      // Retryable (rate limits, temporary failures)
  | 'permanent'      // Not retryable (invalid email, blocked)
  | 'rate_limit'     // Rate limit - needs backoff
  | 'auth'           // Authentication failure
  | 'network'        // Network-related issue
  | 'unknown';

/**
 * Email provider configuration
 */
export interface EmailProviderConfig {
  type: EmailProviderType;
  apiKey?: string;
  apiUrl?: string;

  // SMTP specific
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;

  // Rate limiting
  rateLimitPerSecond?: number;
  rateLimitPerMinute?: number;
}

/**
 * Email message to be sent
 */
export interface EmailMessage {
  to: string;
  toName?: string;
  from: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

/**
 * Result of email send attempt
 */
export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  providerMessageId?: string;
  error?: string;
  errorType?: EmailErrorType;
  statusCode?: number;
  retryable?: boolean;
  rawResponse?: unknown;
}

/**
 * Provider-specific error details
 */
export interface ProviderError extends Error {
  type: EmailErrorType;
  statusCode?: number;
  retryable: boolean;
  details?: Record<string, unknown>;
}

// =====================================================
// SENDER TYPES
// =====================================================

/**
 * Email sender account configuration
 */
export interface EmailSender {
  id: number;
  name: string;
  email: string;
  password?: string; // Encrypted in storage
  service: EmailProviderType;

  // SMTP settings for custom service
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;

  // Rate limiting
  dailyLimit: number;
  hourlyLimit: number;
  sentToday: number;
  sentHour: number;

  // Status tracking
  isActive: boolean;
  lastResetDate?: Date;
  lastResetHour?: Date;
  lastUsedAt?: Date;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Sender selection result
 */
export interface SenderSelectionResult {
  sender: EmailSender | null;
  available: boolean;
  reason?: string;
  waitTime?: number; // milliseconds until next available
}

/**
 * Sender statistics
 */
export interface SenderStats {
  id: number;
  name: string;
  email: string;
  sentToday: number;
  sentHour: number;
  dailyLimit: number;
  hourlyLimit: number;
  dailyRemaining: number;
  hourlyRemaining: number;
  isActive: boolean;
  lastUsed?: Date;
}

// =====================================================
// TEMPLATE TYPES
// =====================================================

/**
 * Email template configuration
 */
export interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  description?: string;
  category: string;
  tags: string[];
  sequenceNumber: number;
  isActive: boolean;
  version: number;
  parentTemplateId?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Template variable context
 * All available variables for template substitution
 */
export interface TemplateVariables {
  // Recipient info
  name?: string;
  email?: string;
  company?: string;

  // Sender info
  sender_name?: string;
  sender_email?: string;

  // Site/URL info
  url?: string;
  domain?: string;

  // Campaign info
  campaign_name?: string;

  // Custom variables
  [key: string]: string | number | boolean | undefined;
}

/**
 * Template rendering result
 */
export interface TemplateRenderResult {
  subject: string;
  html: string;
  text?: string;
  previewUrl?: string;
  errors?: string[];
}

// =====================================================
// QUEUE TYPES
// =====================================================

/**
 * Email queue item
 */
export interface EmailQueueItem {
  id: number;
  campaignId?: number;
  senderId?: number;
  contactId: number;
  recipientEmail: string;
  recipientName?: string;
  templateId: number;
  subject: string;
  htmlContent: string;
  textContent?: string;

  // Sequence tracking
  sequenceTag: string;
  sequencePosition: number;
  dependsOnQueueId?: number;

  // Status
  status: EmailDeliveryStatus;
  priority: number;
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;

  // Retry tracking
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  lastErrorAt?: Date;

  // Idempotency
  idempotencyKey: string;
  processingToken?: string;

  // Timezone
  countryCode: string;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Queue processing options
 */
export interface QueueProcessingOptions {
  batchSize?: number;
  maxParallelPerSender?: number;
  respectBusinessHours?: boolean;
  respectRateLimits?: boolean;
  retryDelay?: number; // milliseconds
}

// =====================================================
// VALIDATION TYPES
// =====================================================

/**
 * Email validation result
 */
export interface EmailValidationResult {
  valid: boolean;
  email: string;
  normalized?: string;
  error?: string;
  warnings?: string[];
  type?: 'professional' | 'personal' | 'disposable' | 'role' | 'unknown';
  domain?: string;
  mxRecords?: string[];
}

/**
 * Domain reputation score
 */
export interface DomainReputation {
  domain: string;
  score: number; // 0-100
  isDisposable: boolean;
  isFreeProvider: boolean;
  isRoleAddress: boolean;
  riskLevel: 'low' | 'medium' | 'high';
}

// =====================================================
// TIMEZONE TYPES
// =====================================================

/**
 * Country timezone configuration
 */
export interface CountryTimezoneConfig {
  timezone: string;
  name: string;
  offset: string;
  businessStart: number;
  businessEnd: number;
  weekendDays: number[];
  preferredTimes: string[];
}

/**
 * Business hours check result
 */
export interface BusinessHoursStatus {
  inBusinessHours: boolean;
  currentLocalTime: string;
  nextBusinessTime?: Date;
  reason?: 'weekend' | 'outside_hours' | 'open';
}

// =====================================================
// CAMPAIGN TYPES
// =====================================================

/**
 * Email campaign configuration
 */
export interface EmailCampaign {
  id: number;
  name: string;
  description?: string;
  templateTag: string;
  templateIds: number[];
  targetCriteria?: Record<string, unknown>;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed';
  totalRecipients: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  startAfter?: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// =====================================================
// SEND LOG TYPES
// =====================================================

/**
 * Email send log entry
 */
export interface EmailSendLog {
  id: number;
  queueId: number;
  contactId: number;
  templateId?: number;
  senderId?: number;
  campaignId?: number;
  toEmail: string;
  fromEmail: string;
  subject: string;
  provider: EmailProviderType;
  providerMessageId?: string;
  status: EmailDeliveryStatus;
  errorMessage?: string;
  sentAt: Date;
  deliveredAt?: Date;
  openedAt?: Date;
  clickedAt?: Date;
  createdAt: Date;
}

// =====================================================
// ERROR TYPES
// =====================================================

/**
 * Email system error
 */
export class EmailSystemError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'EmailSystemError';
  }
}

/**
 * Provider error
 */
export class EmailProviderError extends Error {
  constructor(
    message: string,
    public provider: EmailProviderType,
    public type: EmailErrorType,
    public statusCode?: number,
    public retryable: boolean = true
  ) {
    super(message);
    this.name = 'EmailProviderError';
  }
}

/**
 * Sender limit error
 */
export class SenderLimitError extends Error {
  constructor(
    message: string,
    public senderId: number,
    public limitType: 'daily' | 'hourly',
    public waitTime?: number
  ) {
    super(message);
    this.name = 'SenderLimitError';
  }
}

/**
 * Template error
 */
export class TemplateError extends Error {
  constructor(
    message: string,
    public templateId?: number,
    public variable?: string
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}

/**
 * Validation error
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
    public value?: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
