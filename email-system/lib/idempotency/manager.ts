/**
 * Idempotency Manager
 *
 * Implements multi-layer idempotency strategy:
 *
 * LAYER 1: Database Unique Constraint (idempotency_key)
 *   - Prevents duplicate queue entries
 *   - Catches race conditions at DB level
 *
 * LAYER 2: Email Provider Message ID Tracking
 *   - Before sending, check if we already have a message_id
 *   - If yes, skip sending (already sent)
 *
 * LAYER 3: Distributed Lock with Timeout
 *   - Prevents concurrent processing
 *   - Auto-releases if worker crashes
 *
 * LAYER 4: Transactional Send + Update
 *   - Use database transaction
 *   - If update fails, we can check if email was sent
 */

import { randomUUID, createHash } from 'crypto';
import Redis from 'ioredis';
import type {
  IdempotencyContext,
  AlreadySentResult,
  LockOptions,
  LockResult,
  LockVerifyResult,
} from './types.js';

/**
 * Database transaction interface (abstracted for flexibility)
 */
export interface Transaction {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * Idempotency Manager Class
 *
 * Handles idempotency key generation, duplicate checking, and distributed locking
 */
export class IdempotencyManager {
  /** Default lock timeout: 5 minutes */
  private readonly DEFAULT_LOCK_TIMEOUT = 5 * 60 * 1000;

  /** Default retry interval: 100ms */
  private readonly DEFAULT_RETRY_INTERVAL = 100;

  /** Lock key prefix */
  private readonly LOCK_KEY_PREFIX = 'lock:email:';

  /** Idempotency key prefix */
  private readonly IDEMPOTENCY_KEY_PREFIX = 'email:';

  /** Lua script for safe lock release (only if we hold the lock) */
  private readonly RELEASE_LOCK_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  /** Lua script for lock extension (renew if we still hold it) */
  private readonly EXTEND_LOCK_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("pexpire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  /**
   * Generate a deterministic idempotency key from context
   * Same input always produces the same key
   *
   * @param context - The idempotency context
   * @returns A deterministic idempotency key
   */
  generateKey(context: IdempotencyContext): string {
    const normalized = this.normalizeContext(context);
    const base = `${normalized.email}:${normalized.subject}:${normalized.tag}:${normalized.position}`;

    // Use SHA-256 for consistent, collision-resistant key
    const hash = createHash('sha256').update(base).digest('base64').slice(0, 64);

    return `${this.IDEMPOTENCY_KEY_PREFIX}${hash}`;
  }

  /**
   * Generate an idempotency key from raw parameters
   * Convenience method for when you don't have the full context object
   *
   * @param recipientEmail - Recipient email address
   * @param subject - Email subject
   * @param sequenceTag - Sequence tag
   * @param sequencePosition - Position in sequence
   * @returns A deterministic idempotency key
   */
  generateKeyFromParts(
    recipientEmail: string,
    subject: string,
    sequenceTag: string,
    sequencePosition: number
  ): string {
    return this.generateKey({
      queueItemId: 0,
      contactId: 0,
      recipientEmail,
      subject,
      sequenceTag,
      sequencePosition,
    });
  }

  /**
   * Check if an email was already sent by querying the send log
   *
   * @param trx - Database transaction
   * @param context - Idempotency context
   * @returns Result indicating if email was already sent
   */
  async checkAlreadySent(trx: Transaction, context: IdempotencyContext): Promise<AlreadySentResult> {
    try {
      const result = await trx.query(
        `SELECT provider_message_id, sent_at
         FROM email_send_log
         WHERE queue_id = $1
         LIMIT 1`,
        [context.queueItemId]
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          alreadySent: true,
          messageId: row.provider_message_id || null,
          sentAt: row.sent_at ? new Date(row.sent_at) : null,
        };
      }

      return {
        alreadySent: false,
        messageId: null,
        sentAt: null,
      };
    } catch (error) {
      // Log error but don't throw - allow operation to proceed
      console.error('Error checking if email already sent:', error);
      return {
        alreadySent: false,
        messageId: null,
        sentAt: null,
      };
    }
  }

  /**
   * Check if an email was already sent by idempotency key
   * Useful for preventing duplicates before they reach the queue
   *
   * @param redis - Redis client
   * @param idempotencyKey - The idempotency key to check
   * @returns True if this key was already used
   */
  async checkByKey(redis: Redis, idempotencyKey: string): Promise<boolean> {
    try {
      const exists = await redis.exists(`sent:${idempotencyKey}`);
      return exists === 1;
    } catch (error) {
      console.error('Error checking idempotency key:', error);
      return false;
    }
  }

  /**
   * Mark an email as sent using its idempotency key
   * Stores in Redis for fast lookups
   *
   * @param redis - Redis client
   * @param idempotencyKey - The idempotency key
   * @param messageId - Provider message ID
   * @param ttlSeconds - Time to live in seconds (default: 30 days)
   */
  async markAsSent(
    redis: Redis,
    idempotencyKey: string,
    messageId: string,
    ttlSeconds: number = 30 * 24 * 60 * 60
  ): Promise<void> {
    try {
      await redis.setex(`sent:${idempotencyKey}`, ttlSeconds, messageId);
    } catch (error) {
      console.error('Error marking email as sent:', error);
    }
  }

  /**
   * Acquire a distributed lock for processing a queue item
   * Uses SETNX with expiration for safe locking
   *
   * @param redis - Redis client
   * @param queueItemId - Queue item ID to lock
   * @param options - Lock options
   * @returns Lock result with token if acquired
   */
  async acquireLock(
    redis: Redis,
    queueItemId: number,
    options: LockOptions = {}
  ): Promise<LockResult> {
    const timeoutMs = options.timeoutMs ?? this.DEFAULT_LOCK_TIMEOUT;
    const retryIntervalMs = options.retryIntervalMs ?? this.DEFAULT_RETRY_INTERVAL;
    const maxRetries = options.maxRetries ?? 0;

    const lockKey = `${this.LOCK_KEY_PREFIX}${queueItemId}`;
    const token = randomUUID();

    let attempts = 0;

    while (attempts <= maxRetries) {
      try {
        // SETNX with expiration using ioredis
        const acquired = await redis.set(lockKey, token, 'PX', timeoutMs, 'NX');

        if (acquired === 'OK') {
          return { acquired: true, token };
        }

        // Lock not acquired, retry if configured
        if (attempts < maxRetries) {
          await this.sleep(retryIntervalMs);
        }
      } catch (error) {
        console.error(`Error acquiring lock for queue item ${queueItemId}:`, error);
        // On error, retry if configured
        if (attempts < maxRetries) {
          await this.sleep(retryIntervalMs);
        } else {
          return { acquired: false, token: null };
        }
      }

      attempts++;
    }

    return { acquired: false, token: null };
  }

  /**
   * Verify we still hold the lock
   *
   * @param redis - Redis client
   * @param queueItemId - Queue item ID
   * @param token - Lock token to verify
   * @returns Verification result with TTL
   */
  async verifyLock(
    redis: Redis,
    queueItemId: number,
    token: string
  ): Promise<LockVerifyResult> {
    try {
      const lockKey = `${this.LOCK_KEY_PREFIX}${queueItemId}`;
      const pipeline = redis.pipeline();
      pipeline.get(lockKey);
      pipeline.pttl(lockKey);

      const results = await pipeline.exec();

      if (!results || results.some((r) => r[0])) {
        return { holdsLock: false, ttlMs: null };
      }

      const [currentToken, ttl] = results.map((r) => r[1]) as [string | null, number];

      if (currentToken === token) {
        return {
          holdsLock: true,
          ttlMs: ttl < 0 ? null : ttl, // -1 means no expiry, -2 means key doesn't exist
        };
      }

      return { holdsLock: false, ttlMs: null };
    } catch (error) {
      console.error(`Error verifying lock for queue item ${queueItemId}:`, error);
      return { holdsLock: false, ttlMs: null };
    }
  }

  /**
   * Release the lock using Lua script for atomicity
   * Only releases if we still hold the lock
   *
   * @param redis - Redis client
   * @param queueItemId - Queue item ID
   * @param token - Lock token
   * @returns True if lock was released
   */
  async releaseLock(
    redis: Redis,
    queueItemId: number,
    token: string
  ): Promise<boolean> {
    try {
      const lockKey = `${this.LOCK_KEY_PREFIX}${queueItemId}`;
      const result = await redis.eval(
        this.RELEASE_LOCK_SCRIPT,
        1,
        lockKey,
        token
      );

      return result === 1;
    } catch (error) {
      console.error(`Error releasing lock for queue item ${queueItemId}:`, error);
      return false;
    }
  }

  /**
   * Extend the lock timeout
   * Useful for long-running operations
   *
   * @param redis - Redis client
   * @param queueItemId - Queue item ID
   * @param token - Lock token
   * @param timeoutMs - New timeout in milliseconds
   * @returns True if lock was extended
   */
  async extendLock(
    redis: Redis,
    queueItemId: number,
    token: string,
    timeoutMs: number
  ): Promise<boolean> {
    try {
      const lockKey = `${this.LOCK_KEY_PREFIX}${queueItemId}`;
      const result = await redis.eval(
        this.EXTEND_LOCK_SCRIPT,
        1,
        lockKey,
        token,
        timeoutMs.toString()
      );

      return result === 1;
    } catch (error) {
      console.error(`Error extending lock for queue item ${queueItemId}:`, error);
      return false;
    }
  }

  /**
   * Force release a lock (use with caution)
   * Only use when you know a lock is stale
   *
   * @param redis - Redis client
   * @param queueItemId - Queue item ID
   * @returns True if lock was removed
   */
  async forceReleaseLock(redis: Redis, queueItemId: number): Promise<boolean> {
    try {
      const lockKey = `${this.LOCK_KEY_PREFIX}${queueItemId}`;
      const result = await redis.del(lockKey);
      return result > 0;
    } catch (error) {
      console.error(`Error force releasing lock for queue item ${queueItemId}:`, error);
      return false;
    }
  }

  /**
   * Get information about a lock
   *
   * @param redis - Redis client
   * @param queueItemId - Queue item ID
   * @returns Lock information or null
   */
  async getLockInfo(
    redis: Redis,
    queueItemId: number
  ): Promise<{ token: string | null; ttlMs: number | null } | null> {
    try {
      const lockKey = `${this.LOCK_KEY_PREFIX}${queueItemId}`;
      const pipeline = redis.pipeline();
      pipeline.get(lockKey);
      pipeline.pttl(lockKey);

      const results = await pipeline.exec();

      if (!results || results.some((r) => r[0])) {
        return null;
      }

      const [token, ttl] = results.map((r) => r[1]) as [string | null, number];

      return {
        token,
        ttlMs: ttl < 0 ? null : ttl,
      };
    } catch (error) {
      console.error(`Error getting lock info for queue item ${queueItemId}:`, error);
      return null;
    }
  }

  /**
   * Clean up stale locks (optional maintenance operation)
   *
   * @param redis - Redis client
   * @param pattern - Lock key pattern to scan
   * @returns Number of locks cleaned up
   */
  async cleanupStaleLocks(
    redis: Redis,
    pattern: string = `${this.LOCK_KEY_PREFIX}*`
  ): Promise<number> {
    let cleaned = 0;

    try {
      const keys = await redis.keys(pattern);

      for (const key of keys) {
        const ttl = await redis.pttl(key);
        // TTL of -2 means key doesn't exist (expired), -1 means no expiry
        // If TTL is very short (< 1000ms), consider it stale
        if (ttl >= 0 && ttl < 1000) {
          await redis.del(key);
          cleaned++;
        }
      }
    } catch (error) {
      console.error('Error cleaning up stale locks:', error);
    }

    return cleaned;
  }

  /**
   * Normalize context for consistent key generation
   */
  private normalizeContext(context: IdempotencyContext): {
    email: string;
    subject: string;
    tag: string;
    position: number;
  } {
    return {
      email: context.recipientEmail.toLowerCase().trim(),
      subject: context.subject.trim(),
      tag: context.sequenceTag.trim(),
      position: context.sequencePosition,
    };
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Singleton instance for convenient import
 */
export const idempotency = new IdempotencyManager();

/**
 * Default export for compatibility
 */
export default IdempotencyManager;
