/**
 * TypeScript interfaces for idempotency and locking system
 * Part of the multi-layer idempotency strategy
 */

/**
 * Context for generating idempotency keys
 * All fields that uniquely identify an email operation
 */
export interface IdempotencyContext {
  /** Queue item ID */
  queueItemId: number;
  /** Contact ID */
  contactId: number;
  /** Recipient email address */
  recipientEmail: string;
  /** Email subject */
  subject: string;
  /** Sequence tag (e.g., 'welcome', 'followup') */
  sequenceTag: string;
  /** Position in sequence (1, 2, 3, etc.) */
  sequencePosition: number;
}

/**
 * Result of checking if an email was already sent
 */
export interface AlreadySentResult {
  /** Whether the email was already sent */
  alreadySent: boolean;
  /** Provider message ID if found */
  messageId: string | null;
  /** When it was sent */
  sentAt: Date | null;
}

/**
 * Configuration for lock acquisition
 */
export interface LockOptions {
  /** Lock timeout in milliseconds (default: 5 minutes) */
  timeoutMs?: number;
  /** Retry interval in milliseconds if lock is held (default: 100ms) */
  retryIntervalMs?: number;
  /** Maximum number of retries (default: 0 = no retry) */
  maxRetries?: number;
}

/**
 * Result of lock acquisition
 */
export interface LockResult {
  /** Whether lock was acquired */
  acquired: boolean;
  /** Lock token if acquired */
  token: string | null;
}

/**
 * Result of lock verification
 */
export interface LockVerifyResult {
  /** Whether we still hold the lock */
  holdsLock: boolean;
  /** Remaining TTL in milliseconds */
  ttlMs: number | null;
}

/**
 * Normalized email data for key generation
 */
interface NormalizedEmailData {
  email: string;
  subject: string;
  tag: string;
  position: number;
}

/**
 * Redis lock information
 */
export interface RedisLockInfo {
  key: string;
  token: string;
  acquiredAt: Date;
  expiresAt: Date;
}
