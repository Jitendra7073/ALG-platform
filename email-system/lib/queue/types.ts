/**
 * TypeScript types for BullMQ email queue system
 * Defines job types, data structures, and processing interfaces
 */

// =====================================================
// QUEUE NAMES AND JOB TYPES
// =====================================================

/**
 * Queue names used in the system
 */
export const QUEUE_NAMES = {
  EMAIL: 'emails',
  EMAIL_DLQ: 'emails:dlq',
  RECOVERY: 'recovery',
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

/**
 * Email job types
 */
export type EmailJobType =
  | 'send-single'       // Send a single email
  | 'send-batch'        // Send batch emails
  | 'follow-up'         // Follow-up email in sequence
  | 'campaign-blast'    // Campaign mass send
  | 'schedule-send';    // Scheduled send

/**
 * Priority levels for jobs (higher = more important)
 */
export enum JobPriority {
  LOW = 1,
  NORMAL = 5,
  HIGH = 10,
  URGENT = 15,
}

// =====================================================
// JOB DATA TYPES
// =====================================================

/**
 * Base email job data (common fields)
 */
export interface BaseEmailJobData {
  queueItemId: number;
  contactId: number;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  countryCode: string;
  campaignId?: number;
  senderId?: number;
  templateId?: number;
}

/**
 * Single email job data
 */
export interface SendSingleJobData extends BaseEmailJobData {
  type: 'send-single';
}

/**
 * Batch email job data
 */
export interface SendBatchJobData {
  type: 'send-batch';
  emails: Array<{
    queueItemId: number;
    contactId: number;
    recipientEmail: string;
    recipientName?: string;
    subject: string;
    htmlContent: string;
    textContent?: string;
    countryCode: string;
  }>;
}

/**
 * Follow-up email job data
 */
export interface FollowUpJobData extends BaseEmailJobData {
  type: 'follow-up';
  sequenceTag: string;
  sequencePosition: number;
  dependsOnQueueId: number;
}

/**
 * Campaign blast job data
 */
export interface CampaignBlastJobData {
  type: 'campaign-blast';
  campaignId: number;
  targetCriteria?: Record<string, unknown>;
  scheduledAt?: Date;
}

/**
 * Scheduled send job data
 */
export interface ScheduleSendJobData extends BaseEmailJobData {
  type: 'schedule-send';
  scheduledAt: Date;
}

/**
 * Union type of all email job data
 */
export type EmailJobData =
  | SendSingleJobData
  | SendBatchJobData
  | FollowUpJobData
  | CampaignBlastJobData
  | ScheduleSendJobData;

// =====================================================
// JOB OPTIONS
// =====================================================

/**
 * Options for adding jobs to the queue
 */
export interface EmailJobOptions {
  /** Job priority (higher = more important) */
  priority?: JobPriority;
  /** Delay before job starts processing (milliseconds) */
  delay?: number;
  /** Unique job identifier (for deduplication) */
  jobId?: string;
  /** Number of attempts before giving up */
  attempts?: number;
  /** Backoff strategy for retries */
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  /** Remove job after completion */
  removeOnComplete?: number;
  /** Remove job after failure */
  removeOnFail?: number;
  /** Job token for idempotency */
  token?: string;
}

// =====================================================
// JOB RESULT TYPES
// =====================================================

/**
 * Result of email job processing
 */
export interface EmailJobResult {
  success: boolean;
  queueItemId: number;
  messageId?: string;
  providerMessageId?: string;
  sentAt?: Date;
  error?: string;
  errorType?: EmailErrorType;
  shouldRetry?: boolean;
  nextRetryAt?: Date;
}

/**
 * Batch job result
 */
export interface BatchJobResult {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    queueItemId: number;
    success: boolean;
    error?: string;
  }>;
}

// =====================================================
// ERROR CLASSIFICATION
// =====================================================

/**
 * Error types for classification
 */
export enum EmailErrorType {
  /** Temporary error (network timeout, etc) - retry with backoff */
  TEMPORARY = 'temporary',
  /** Permanent failure (invalid email, blocked) - don't retry */
  PERMANENT = 'permanent',
  /** Rate limit exceeded - retry with exponential backoff */
  RATE_LIMIT = 'rate_limit',
  /** Authentication failure - don't retry */
  AUTH = 'auth',
  /** Network-related error - retry */
  NETWORK = 'network',
  /** Business hours violation - reschedule */
  BUSINESS_HOURS = 'business_hours',
  /** Sender limit reached - try different sender */
  SENDER_LIMIT = 'sender_limit',
  /** Unknown error - retry with caution */
  UNKNOWN = 'unknown',
}

/**
 * Error severity level
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Classified error with metadata
 */
export interface ClassifiedError {
  type: EmailErrorType;
  severity: ErrorSeverity;
  retryable: boolean;
  backoffMs?: number;
  message: string;
  originalError?: unknown;
}

// =====================================================
// WORKER EVENTS
// =====================================================

/**
 * Worker event types
 */
export type WorkerEventType =
  | 'active'
  | 'completed'
  | 'failed'
  | 'progress'
  | 'stalled'
  | 'error'
  | 'ready'
  | 'waiting';

/**
 * Worker event data
 */
export interface WorkerEventData {
  eventType: WorkerEventType;
  jobId: string;
  queueItemId?: number;
  timestamp: Date;
  data?: unknown;
  error?: Error;
}

// =====================================================
// QUEUE STATISTICS
// =====================================================

/**
 * Queue statistics
 */
export interface QueueStats {
  queue: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

/**
 * Worker health status
 */
export interface WorkerHealth {
  isRunning: boolean;
  isPaused: boolean;
  queues: QueueStats[];
  uptime: number;
  jobsProcessed: number;
  jobsFailed: number;
  lastActivity: Date;
}

// =====================================================
// LOCK TYPES
// =====================================================

/**
 * Lock information for queue items
 */
export interface QueueItemLock {
  queueItemId: number;
  lockKey: string;
  token: string;
  acquiredAt: Date;
  expiresAt: Date;
  workerId?: string;
}

/**
 * Lock acquisition result
 */
export interface LockResult {
  acquired: boolean;
  token?: string;
  expiresAt?: Date;
}

// =====================================================
// IDEMPOTENCY TYPES
// =====================================================

/**
 * Idempotency check result
 */
export interface IdempotencyCheckResult {
  isDuplicate: boolean;
  existingMessageId?: string;
  existingSentAt?: Date;
}

/**
 * Idempotency key generation context
 */
export interface IdempotencyContext {
  recipientEmail: string;
  subject: string;
  sequenceTag?: string;
  sequencePosition?: number;
  campaignId?: number;
}

// =====================================================
// SCHEDULING TYPES
// =====================================================

/**
 * Scheduling options for jobs
 */
export interface ScheduleOptions {
  /** Specific date/time to send */
  scheduledAt?: Date;
  /** ISO 8601 cron expression */
  cron?: string;
  /** Repeat every N milliseconds */
  every?: number;
  /** Number of times to repeat */
  repeat?: number;
}

/**
 * Business hours validation result
 */
export interface BusinessHoursValidation {
  isValid: boolean;
  currentLocalTime: string;
  isWeekend: boolean;
  isBusinessHours: boolean;
  nextValidTime?: Date;
  reason?: string;
}

// =====================================================
// PROCESSOR CONTEXT
// =====================================================

/**
 * Context passed to job processors
 */
export interface ProcessorContext {
  /** Database connection */
  db: any;
  /** Redis connection */
  redis: any;
  /** Worker ID */
  workerId: string;
  /** Job ID */
  jobId: string;
  /** Processing start time */
  startedAt: Date;
}

/**
 * Processor result
 */
export interface ProcessorResult {
  success: boolean;
  result?: EmailJobResult | BatchJobResult;
  error?: ClassifiedError;
  shouldRetry?: boolean;
  retryDelay?: number;
}
