/**
 * Retry configuration for BullMQ email queue
 * Defines retry strategies by error type and job type
 */

import { EmailErrorType, EmailJobType } from './types';

// =====================================================
// RETRY STRATEGY CONFIGURATION
// =====================================================

/**
 * Base retry strategy (defaults)
 */
export const BASE_RETRY_CONFIG = {
  maxAttempts: 3,
  initialBackoffMs: 1000,      // 1 second
  maxBackoffMs: 15 * 60 * 1000, // 15 minutes
  backoffMultiplier: 2,
} as const;

/**
 * Retry strategy by error type
 */
export const RETRY_BY_ERROR_TYPE: Record<EmailErrorType, {
  retryable: boolean;
  maxAttempts: number;
  initialBackoffMs: number;
  backoffType: 'exponential' | 'fixed';
  strategy: 'immediate' | 'backoff' | 'reschedule';
}> = {
  // Temporary errors - retry with exponential backoff
  [EmailErrorType.TEMPORARY]: {
    retryable: true,
    maxAttempts: 5,
    initialBackoffMs: 5000,     // 5 seconds
    backoffType: 'exponential',
    strategy: 'backoff',
  },

  // Permanent failures - don't retry
  [EmailErrorType.PERMANENT]: {
    retryable: false,
    maxAttempts: 1,
    initialBackoffMs: 0,
    backoffType: 'fixed',
    strategy: 'immediate',
  },

  // Rate limits - exponential backoff with longer delays
  [EmailErrorType.RATE_LIMIT]: {
    retryable: true,
    maxAttempts: 8,
    initialBackoffMs: 60000,    // 1 minute
    backoffType: 'exponential',
    strategy: 'backoff',
  },

  // Auth failures - don't retry (credentials need fixing)
  [EmailErrorType.AUTH]: {
    retryable: false,
    maxAttempts: 1,
    initialBackoffMs: 0,
    backoffType: 'fixed',
    strategy: 'immediate',
  },

  // Network errors - retry with exponential backoff
  [EmailErrorType.NETWORK]: {
    retryable: true,
    maxAttempts: 4,
    initialBackoffMs: 2000,     // 2 seconds
    backoffType: 'exponential',
    strategy: 'backoff',
  },

  // Business hours violation - reschedule to next business time
  [EmailErrorType.BUSINESS_HOURS]: {
    retryable: true,
    maxAttempts: 1,             // Only reschedule once
    initialBackoffMs: 0,        // Calculated dynamically
    backoffType: 'fixed',
    strategy: 'reschedule',
  },

  // Sender limit - retry immediately with different sender
  [EmailErrorType.SENDER_LIMIT]: {
    retryable: true,
    maxAttempts: 3,             // Try 3 different senders
    initialBackoffMs: 100,      // Minimal delay
    backoffType: 'fixed',
    strategy: 'immediate',
  },

  // Unknown errors - retry with caution
  [EmailErrorType.UNKNOWN]: {
    retryable: true,
    maxAttempts: 3,
    initialBackoffMs: 10000,    // 10 seconds
    backoffType: 'exponential',
    strategy: 'backoff',
  },
};

/**
 * Retry strategy by job type
 */
export const RETRY_BY_JOB_TYPE: Record<EmailJobType, {
  maxAttempts: number;
  initialBackoffMs: number;
  backoffType: 'exponential' | 'fixed';
}> = {
  'send-single': {
    maxAttempts: 3,
    initialBackoffMs: 5000,
    backoffType: 'exponential',
  },
  'send-batch': {
    maxAttempts: 2,             // Fewer retries for batches
    initialBackoffMs: 10000,
    backoffType: 'exponential',
  },
  'follow-up': {
    maxAttempts: 5,             // More retries for follow-ups
    initialBackoffMs: 5000,
    backoffType: 'exponential',
  },
  'campaign-blast': {
    maxAttempts: 2,
    initialBackoffMs: 30000,    // Longer delay for campaigns
    backoffType: 'exponential',
  },
  'schedule-send': {
    maxAttempts: 3,
    initialBackoffMs: 5000,
    backoffType: 'exponential',
  },
};

// =====================================================
// BACKOFF CALCULATION
// =====================================================

/**
 * Calculate backoff delay for a retry attempt
 * Uses exponential backoff with jitter
 */
export function calculateBackoff(
  errorType: EmailErrorType,
  attemptNumber: number,
  jobType?: EmailJobType
): number {
  const errorConfig = RETRY_BY_ERROR_TYPE[errorType];
  const jobConfig = jobType ? RETRY_BY_JOB_TYPE[jobType] : null;

  // Use the more conservative (higher) backoff
  const baseBackoff = Math.max(
    errorConfig.initialBackoffMs,
    jobConfig?.initialBackoffMs || 0
  );

  // Calculate exponential backoff
  let delay: number;
  if (errorConfig.backoffType === 'exponential') {
    delay = baseBackoff * Math.pow(2, attemptNumber - 1);
  } else {
    delay = baseBackoff;
  }

  // Add jitter (±25%) to avoid thundering herd
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  delay += jitter;

  // Cap at maximum backoff
  const maxBackoff = Math.min(
    BASE_RETRY_CONFIG.maxBackoffMs,
    jobType ? RETRY_BY_JOB_TYPE[jobType].initialBackoffMs * 8 : BASE_RETRY_CONFIG.maxBackoffMs
  );

  return Math.min(Math.max(delay, 0), maxBackoff);
}

/**
 * Calculate maximum attempts for a job
 */
export function getMaxAttempts(
  errorType: EmailErrorType,
  jobType: EmailJobType
): number {
  const errorConfig = RETRY_BY_ERROR_TYPE[errorType];
  const jobConfig = RETRY_BY_JOB_TYPE[jobType];

  // Use the lower (more conservative) max attempts
  return Math.min(errorConfig.maxAttempts, jobConfig.maxAttempts);
}

// =====================================================
// ERROR CLASSIFICATION HELPERS
// =====================================================

/**
 * Error patterns for classification
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  type: EmailErrorType;
  severity: 'low' | 'medium' | 'high' | 'critical';
}> = [
  // Rate limit errors
  { pattern: /rate limit|too many requests|429/i, type: EmailErrorType.RATE_LIMIT, severity: 'medium' },
  { pattern: /throttl/i, type: EmailErrorType.RATE_LIMIT, severity: 'medium' },

  // Authentication errors
  { pattern: /authenticat|invalid credential|unauthorized|401|403/i, type: EmailErrorType.AUTH, severity: 'critical' },
  { pattern: /api key|token/i, type: EmailErrorType.AUTH, severity: 'critical' },

  // Permanent failures
  { pattern: /permanent|hard bounce|invalid email|does not exist|550/i, type: EmailErrorType.PERMANENT, severity: 'high' },
  { pattern: /blocked|blacklist|reject/i, type: EmailErrorType.PERMANENT, severity: 'high' },

  // Network errors
  { pattern: /etimedout|econnrefused|network|socket|dns/i, type: EmailErrorType.NETWORK, severity: 'low' },
  { pattern: /timeout/i, type: EmailErrorType.NETWORK, severity: 'low' },
  { pattern: /connection/i, type: EmailErrorType.NETWORK, severity: 'low' },

  // Temporary errors
  { pattern: /temporary|try again later|service unavailable|503/i, type: EmailErrorType.TEMPORARY, severity: 'medium' },
  { pattern: /temporarily/i, type: EmailErrorType.TEMPORARY, severity: 'medium' },

  // Sender limits
  { pattern: /daily limit|hourly limit|sender limit|quota/i, type: EmailErrorType.SENDER_LIMIT, severity: 'medium' },
];

/**
 * Classify an error into an EmailErrorType
 */
export function classifyError(error: unknown): {
  type: EmailErrorType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  retryable: boolean;
  message: string;
} {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Try to match against known patterns
  for (const { pattern, type, severity } of ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      const config = RETRY_BY_ERROR_TYPE[type];
      return {
        type,
        severity,
        retryable: config.retryable,
        message: errorMessage,
      };
    }
  }

  // Default to unknown error
  return {
    type: EmailErrorType.UNKNOWN,
    severity: 'medium',
    retryable: RETRY_BY_ERROR_TYPE[EmailErrorType.UNKNOWN].retryable,
    message: errorMessage,
  };
}

/**
 * Check if an error should be retried based on attempt count
 */
export function shouldRetry(
  error: unknown,
  currentAttempt: number,
  jobType: EmailJobType
): boolean {
  const classification = classifyError(error);
  const maxAttempts = getMaxAttempts(classification.type, jobType);

  return classification.retryable && currentAttempt < maxAttempts;
}

/**
 * Get delay before next retry
 */
export function getRetryDelay(
  error: unknown,
  currentAttempt: number,
  jobType: EmailJobType
): number {
  const classification = classifyError(error);
  return calculateBackoff(classification.type, currentAttempt, jobType);
}

// =====================================================
// DEAD LETTER QUEUE CONFIGURATION
// =====================================================

/**
 * Jobs that exceed these thresholds go to DLQ
 */
export const DLQ_THRESHOLDS = {
  maxAttempts: 5,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxFailures: 3,
} as const;

/**
 * Check if a job should go to dead letter queue
 */
export function shouldSendToDLQ(
  attemptsMade: number,
  jobAgeMs: number,
  consecutiveFailures: number
): boolean {
  return (
    attemptsMade >= DLQ_THRESHOLDS.maxAttempts ||
    jobAgeMs >= DLQ_THRESHOLDS.maxAgeMs ||
    consecutiveFailures >= DLQ_THRESHOLDS.maxFailures
  );
}

// =====================================================
// BULLMQ JOB OPTIONS GENERATOR
// =====================================================

/**
 * Generate BullMQ job options based on job type and priority
 */
export function generateJobOptions(
  jobType: EmailJobType,
  priority: number = 5,
  delay: number = 0
): {
  attempts: number;
  backoff: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  priority: number;
  delay: number;
  removeOnComplete: number;
  removeOnFail: number;
} {
  const config = RETRY_BY_JOB_TYPE[jobType];

  return {
    attempts: config.maxAttempts,
    backoff: {
      type: config.backoffType,
      delay: config.initialBackoffMs,
    },
    priority,
    delay,
    removeOnComplete: 1000,   // Keep last 1000 completed jobs
    removeOnFail: 5000,       // Keep last 5000 failed jobs
  };
}
