/**
 * BullMQ Job Processors for Email Queue
 * Main email processing logic with idempotency, locking, and business hours validation
 */

import { Job, Processor } from 'bullmq';
import { Redis } from 'ioredis';
import { getDb } from '../db/client';
import {
  EmailJobData,
  EmailJobResult,
  ProcessorContext,
  IdempotencyContext,
  LockResult,
  BusinessHoursValidation,
  EmailErrorType,
} from './types';
import {
  classifyError,
  shouldRetry,
  getRetryDelay,
  shouldSendToDLQ,
} from './retry-config';
import { randomUUID } from 'crypto';

// =====================================================
// IDEMPOTENCY CHECKS
// =====================================================

/**
 * Generate idempotency key for email operation
 */
function generateIdempotencyKey(context: IdempotencyContext): string {
  const parts = [
    context.recipientEmail.toLowerCase(),
    context.subject.toLowerCase(),
    context.sequenceTag || 'none',
    context.sequencePosition || 1,
    context.campaignId || 'none',
  ];

  const normalized = parts.join(':');
  return `email:idemp:${Buffer.from(normalized).toString('base64').slice(0, 64)}`;
}

/**
 * Check if email was already sent (idempotency check)
 */
async function checkIdempotency(
  redis: Redis,
  context: IdempotencyContext
): Promise<{ alreadySent: boolean; messageId?: string; sentAt?: Date }> {
  const key = generateIdempotencyKey(context);
  const result = await redis.get(key);

  if (result) {
    const data = JSON.parse(result);
    return {
      alreadySent: true,
      messageId: data.messageId,
      sentAt: new Date(data.sentAt),
    };
  }

  return { alreadySent: false };
}

/**
 * Mark email as sent (store idempotency record)
 */
async function markAsSent(
  redis: Redis,
  context: IdempotencyContext,
  messageId: string,
  ttl: number = 30 * 24 * 60 * 60 * 1000 // 30 days
): Promise<void> {
  const key = generateIdempotencyKey(context);
  const data = {
    messageId,
    sentAt: new Date().toISOString(),
  };

  await redis.set(key, JSON.stringify(data), 'PX', ttl);
}

// =====================================================
// DISTRIBUTED LOCKING
// =====================================================

/**
 * Acquire a lock for processing a queue item
 */
async function acquireLock(
  redis: Redis,
  queueItemId: number,
  timeoutMs: number = 5 * 60 * 1000 // 5 minutes
): Promise<LockResult> {
  const lockKey = `email:lock:${queueItemId}`;
  const token = randomUUID();
  const acquired = await redis.set(
    lockKey,
    token,
    'PX',
    timeoutMs,
    'NX'
  );

  if (acquired === 'OK') {
    return {
      acquired: true,
      token,
      expiresAt: new Date(Date.now() + timeoutMs),
    };
  }

  return { acquired: false };
}

/**
 * Release a lock for a queue item
 */
async function releaseLock(
  redis: Redis,
  queueItemId: number,
  token: string
): Promise<boolean> {
  const lockKey = `email:lock:${queueItemId}`;

  // Use Lua script to ensure we only release our own lock
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  const result = await redis.eval(script, 1, lockKey, token);
  return result === 1;
}

// =====================================================
// BUSINESS HOURS VALIDATION
// =====================================================

/**
 * Country timezone configurations (simplified version)
 */
const COUNTRY_TIMEZONES: Record<string, {
  timezone: string;
  businessStart: number;
  businessEnd: number;
  weekendDays: number[];
}> = {
  'in': { timezone: 'Asia/Kolkata', businessStart: 9, businessEnd: 17, weekendDays: [0, 6] },
  'us': { timezone: 'America/New_York', businessStart: 9, businessEnd: 17, weekendDays: [0, 6] },
  'uk': { timezone: 'Europe/London', businessStart: 9, businessEnd: 17, weekendDays: [0, 6] },
  'ca': { timezone: 'America/Toronto', businessStart: 9, businessEnd: 17, weekendDays: [0, 6] },
  'au': { timezone: 'Australia/Sydney', businessStart: 9, businessEnd: 17, weekendDays: [0, 6] },
  'de': { timezone: 'Europe/Berlin', businessStart: 9, businessEnd: 17, weekendDays: [0, 6] },
  'fr': { timezone: 'Europe/Paris', businessStart: 9, businessEnd: 17, weekendDays: [0, 6] },
  'jp': { timezone: 'Asia/Tokyo', businessStart: 9, businessEnd: 17, weekendDays: [0, 6] },
  'sg': { timezone: 'Asia/Singapore', businessStart: 9, businessEnd: 18, weekendDays: [0, 6] },
  'ae': { timezone: 'Asia/Dubai', businessStart: 9, businessEnd: 17, weekendDays: [5, 6] },
};

/**
 * Check if current time is within business hours for a country
 */
function isBusinessHour(date: Date, countryCode: string): boolean {
  const config = COUNTRY_TIMEZONES[countryCode.toLowerCase()] || COUNTRY_TIMEZONES['us'];

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour: 'numeric',
    hour12: false,
    weekday: 'long',
  });

  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const dayName = parts.find(p => p.type === 'weekday')?.value.toLowerCase() || '';

  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const day = dayMap[dayName] ?? 0;

  if (config.weekendDays.includes(day)) {
    return false;
  }

  return hour >= config.businessStart && hour < config.businessEnd;
}

/**
 * Calculate next business hours time
 */
function calculateNextBusinessTime(date: Date, countryCode: string): Date {
  const config = COUNTRY_TIMEZONES[countryCode.toLowerCase()] || COUNTRY_TIMEZONES['us'];
  let checkDate = new Date(date);

  // Check up to 7 days ahead
  for (let i = 0; i < 7 * 24; i++) {
    checkDate = new Date(date.getTime() + i * 60 * 60 * 1000);

    if (isBusinessHour(checkDate, countryCode)) {
      return checkDate;
    }
  }

  // Fallback: next business day morning
  const fallback = new Date(date);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(config.businessStart, 0, 0, 0);
  return fallback;
}

/**
 * Validate business hours for sending
 */
async function validateBusinessHours(
  queueItemId: number,
  countryCode: string,
  db: any
): Promise<BusinessHoursValidation> {
  const now = new Date();
  const config = COUNTRY_TIMEZONES[countryCode.toLowerCase()] || COUNTRY_TIMEZONES['us'];

  // Get current local time
  const localTimeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const currentLocalTime = localTimeFormatter.format(now);

  // Get day of week
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    weekday: 'long',
  });
  const dayName = dayFormatter.format(now).toLowerCase();

  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const day = dayMap[dayName] ?? 0;
  const isWeekend = config.weekendDays.includes(day);

  if (isWeekend) {
    const nextValidTime = calculateNextBusinessTime(now, countryCode);
    return {
      isValid: false,
      currentLocalTime,
      isWeekend: true,
      isBusinessHours: false,
      nextValidTime,
      reason: 'weekend',
    };
  }

  const isBusinessHours = isBusinessHour(now, countryCode);

  if (!isBusinessHours) {
    const nextValidTime = calculateNextBusinessTime(now, countryCode);
    return {
      isValid: false,
      currentLocalTime,
      isWeekend: false,
      isBusinessHours: false,
      nextValidTime,
      reason: 'outside_hours',
    };
  }

  return {
    isValid: true,
    currentLocalTime,
    isWeekend: false,
    isBusinessHours: true,
  };
}

// =====================================================
// SENDER SELECTION
// =====================================================

/**
 * Get next available sender using round-robin with rate limiting
 */
async function selectSender(db: any, redis: Redis): Promise<{
  sender: any;
  available: boolean;
  reason?: string;
}> {
  const now = new Date();
  const today = now.toDateString();
  const currentHour = now.getHours();

  // Get active senders
  const senders = await db.query(`
    SELECT * FROM email_senders
    WHERE is_active = true
    ORDER BY last_used_at ASC NULLS FIRST
  `);

  if (senders.rows.length === 0) {
    return { sender: null, available: false, reason: 'No active senders' };
  }

  // Check each sender for availability
  for (const sender of senders.rows) {
    // Reset daily counter if needed
    if (sender.last_reset_date !== today) {
      await db.query(
        'UPDATE email_senders SET sent_today = 0, last_reset_date = $1 WHERE id = $2',
        [today, sender.id]
      );
      sender.sent_today = 0;
    }

    // Check daily limit
    if (sender.sent_today >= sender.daily_limit) {
      continue;
    }

    // Check hourly limit (if implemented)
    if (sender.sent_hour >= (sender.hourly_limit || sender.daily_limit / 8)) {
      // Check if we need to reset hourly counter
      const lastResetHour = sender.last_reset_hour
        ? new Date(sender.last_reset_hour).getHours()
        : -1;

      if (lastResetHour !== currentHour) {
        await db.query(
          'UPDATE email_senders SET sent_hour = 0, last_reset_hour = NOW() WHERE id = $1',
          [sender.id]
        );
        sender.sent_hour = 0;
      } else {
        continue; // Hourly limit reached
      }
    }

    // Check if sender is not locked (concurrent send protection)
    const lockKey = `email:sender:lock:${sender.id}`;
    const isLocked = await redis.exists(lockKey);

    if (isLocked) {
      continue;
    }

    return { sender, available: true };
  }

  return { sender: null, available: false, reason: 'All senders at capacity' };
}

/**
 * Mark sender as in use
 */
async function lockSender(redis: Redis, senderId: number, timeoutMs: number = 60000): Promise<string> {
  const lockKey = `email:sender:lock:${senderId}`;
  const token = randomUUID();
  await redis.set(lockKey, token, 'PX', timeoutMs, 'NX');
  return token;
}

/**
 * Release sender lock
 */
async function unlockSender(redis: Redis, senderId: number, token: string): Promise<void> {
  const lockKey = `email:sender:lock:${senderId}`;

  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  await redis.eval(script, 1, lockKey, token);
}

// =====================================================
// EMAIL SENDING
// =====================================================

/**
 * Send email via provider
 */
async function sendEmail(sender: any, data: any): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  // Import email sender dynamically
  const { sendEmailViaProvider } = await import('../email/sender');

  return sendEmailViaProvider(sender, {
    to: data.recipientEmail,
    toName: data.recipientName,
    subject: data.subject,
    html: data.htmlContent,
    text: data.textContent,
  });
}

// =====================================================
// MAIN EMAIL JOB PROCESSOR
// =====================================================

/**
 * Process email job with full idempotency and locking
 */
export const processEmailJob: Processor<EmailJobData, EmailJobResult, string> = async (
  job: Job<EmailJobData>
): Promise<EmailJobResult> => {
  const { data } = job;
  const db = getDb();
  const redis = createRedisConnection();

  const queueItemId = data.queueItemId;
  const startTime = Date.now();

  console.log(`[EmailJob:${queueItemId}] Processing job ${job.id}`);

  try {
    // Step 1: Acquire distributed lock
    const lockResult = await acquireLock(redis, queueItemId);
    if (!lockResult.acquired) {
      console.log(`[EmailJob:${queueItemId}] Lock not acquired, skipping`);
      return {
        success: false,
        queueItemId,
        error: 'Lock not acquired (job already processing)',
        errorType: EmailErrorType.TEMPORARY,
        shouldRetry: false,
      };
    }

    const lockToken = lockResult.token!;

    try {
      // Step 2: Update job status to 'acquired' in database
      await db.query(
        `UPDATE email_queue
         SET status = 'acquired', processing_token = $1, started_at = NOW()
         WHERE id = $2`,
        [lockToken, queueItemId]
      );

      // Step 3: Business hours validation
      const businessHoursValidation = await validateBusinessHours(
        queueItemId,
        data.countryCode,
        db
      );

      if (!businessHoursValidation.isValid) {
        // Reschedule to next business time
        const nextValidTime = businessHoursValidation.nextValidTime!;
        await db.query(
          `UPDATE email_queue
           SET status = 'scheduled', scheduled_at = $1, started_at = NULL, processing_token = NULL
           WHERE id = $2`,
          [nextValidTime, queueItemId]
        );

        // Release lock
        await releaseLock(redis, queueItemId, lockToken);

        return {
          success: false,
          queueItemId,
          error: `Outside business hours: ${businessHoursValidation.reason}`,
          errorType: EmailErrorType.BUSINESS_HOURS,
          shouldRetry: false,
          nextRetryAt: nextValidTime,
        };
      }

      // Step 4: Idempotency check
      const idempotencyContext: IdempotencyContext = {
        recipientEmail: data.recipientEmail,
        subject: data.subject,
        sequenceTag: (data as any).sequenceTag,
        sequencePosition: (data as any).sequencePosition,
        campaignId: data.campaignId,
      };

      const idempotencyCheck = await checkIdempotency(redis, idempotencyContext);

      if (idempotencyCheck.alreadySent) {
        console.log(`[EmailJob:${queueItemId}] Email already sent (idempotent)`);

        await db.query(
          `UPDATE email_queue
           SET status = 'sent', sent_at = $1, processing_token = NULL
           WHERE id = $2`,
          [idempotencyCheck.sentAt, queueItemId]
        );

        await releaseLock(redis, queueItemId, lockToken);

        return {
          success: true,
          queueItemId,
          messageId: idempotencyCheck.messageId,
          sentAt: idempotencyCheck.sentAt,
        };
      }

      // Step 5: Select sender
      const senderSelection = await selectSender(db, redis);

      if (!senderSelection.available) {
        await db.query(
          `UPDATE email_queue
           SET status = 'pending', started_at = NULL, processing_token = NULL,
               last_error = $1, last_error_at = NOW()
           WHERE id = $2`,
          [senderSelection.reason || 'Sender unavailable', queueItemId]
        );

        await releaseLock(redis, queueItemId, lockToken);

        return {
          success: false,
          queueItemId,
          error: senderSelection.reason,
          errorType: EmailErrorType.SENDER_LIMIT,
          shouldRetry: true,
        };
      }

      const sender = senderSelection.sender;
      const senderLockToken = await lockSender(redis, sender.id);

      try {
        // Step 6: Send email
        const sendResult = await sendEmail(sender, data);

        if (sendResult.success) {
          // Step 7a: Update queue item status
          await db.query(
            `UPDATE email_queue
             SET status = 'sent',
                 sender_id = $1,
                 sent_at = NOW(),
                 completed_at = NOW(),
                 processing_token = NULL,
                 attempts = attempts + 1
             WHERE id = $2`,
            [sender.id, queueItemId]
          );

          // Step 7b: Update sender counters
          await db.query(
            `UPDATE email_senders
             SET sent_today = sent_today + 1,
                 sent_hour = sent_hour + 1,
                 last_used_at = NOW()
             WHERE id = $1`,
            [sender.id]
          );

          // Step 7c: Store idempotency record
          await markAsSent(
            redis,
            idempotencyContext,
            sendResult.messageId || job.id
          );

          // Step 7d: Schedule follow-up if applicable
          if ((data as any).sequenceTag && (data as any).sequencePosition) {
            await scheduleFollowUp(db, redis, data, queueItemId);
          }

          console.log(`[EmailJob:${queueItemId}] Sent successfully in ${Date.now() - startTime}ms`);

          return {
            success: true,
            queueItemId,
            messageId: sendResult.messageId,
            providerMessageId: sendResult.messageId,
            sentAt: new Date(),
          };
        } else {
          // Handle send failure
          const classification = classifyError(sendResult.error || 'Unknown error');
          const newAttempts = (job.attemptsMade || 0) + 1;
          const shouldRetryError = shouldRetry(
            sendResult.error || new Error(sendResult.error || 'Unknown'),
            newAttempts,
            data.type || 'send-single'
          );

          if (shouldRetryError && newAttempts < (job.opts.attempts || 3)) {
            const retryDelay = getRetryDelay(
              sendResult.error || new Error(sendResult.error || 'Unknown'),
              newAttempts,
              data.type || 'send-single'
            );

            await db.query(
              `UPDATE email_queue
               SET status = 'pending',
                   started_at = NULL,
                   processing_token = NULL,
                   attempts = $1,
                   last_error = $2,
                   last_error_at = NOW(),
                   scheduled_at = NOW() + INTERVAL '1 millisecond' * $3
               WHERE id = $4`,
              [newAttempts, sendResult.error, retryDelay, queueItemId]
            );

            throw sendResult.error || new Error(sendResult.error || 'Unknown error');
          } else {
            // Mark as permanently failed
            await db.query(
              `UPDATE email_queue
               SET status = 'failed_permanent',
                   processing_token = NULL,
                   attempts = $1,
                   last_error = $2,
                   last_error_at = NOW()
               WHERE id = $3`,
              [newAttempts, sendResult.error, queueItemId]
            );

            return {
              success: false,
              queueItemId,
              error: sendResult.error,
              errorType: classification.type,
              shouldRetry: false,
            };
          }
        }
      } finally {
        await unlockSender(redis, sender.id, senderLockToken);
      }
    } finally {
      await releaseLock(redis, queueItemId, lockToken);
    }
  } catch (error) {
    console.error(`[EmailJob:${queueItemId}] Error:`, error);

    const classification = classifyError(error);

    return {
      success: false,
      queueItemId,
      error: error instanceof Error ? error.message : String(error),
      errorType: classification.type,
      shouldRetry: classification.retryable,
    };
  } finally {
    await redis.quit();
  }
};

/**
 * Schedule follow-up email in sequence
 */
async function scheduleFollowUp(
  db: any,
  redis: Redis,
  data: any,
  parentQueueItemId: number
): Promise<void> {
  const sequenceTag = (data as any).sequenceTag;
  const currentPosition = (data as any).sequencePosition || 1;

  // Get follow-up gap from settings
  const gapSetting = await db.query(
    'SELECT value FROM email_settings WHERE key = $1',
    [`followup_gap_${currentPosition}`]
  );

  const gapDays = gapSetting.rows[0]
    ? parseInt(gapSetting.rows[0].value)
    : (currentPosition === 1 ? 2 : 5);

  // Calculate follow-up date
  const scheduledAt = calculateNextBusinessTime(
    new Date(Date.now() + gapDays * 24 * 60 * 60 * 1000),
    data.countryCode
  );

  // Create follow-up queue item
  const result = await db.query(
    `INSERT INTO email_queue
     (contact_id, campaign_id, recipient_email, recipient_name, subject,
      html_content, text_content, sequence_tag, sequence_position,
      depends_on_queue_id, status, scheduled_at, country_code, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'scheduled', $11, $12, 5)
     RETURNING id`,
    [
      data.contactId,
      data.campaignId,
      data.recipientEmail,
      data.recipientName,
      data.subject,
      data.htmlContent,
      data.textContent,
      sequenceTag,
      currentPosition + 1,
      parentQueueItemId,
      scheduledAt,
      data.countryCode,
    ]
  );

  const newQueueItemId = result.rows[0].id;

  // Add to BullMQ with delay
  const { getEmailQueue } = await import('./client');
  const emailQueue = getEmailQueue(redis);

  await emailQueue.addFollowUp(
    {
      queueItemId: newQueueItemId,
      contactId: data.contactId,
      recipientEmail: data.recipientEmail,
      recipientName: data.recipientName,
      subject: data.subject,
      htmlContent: data.htmlContent,
      textContent: data.textContent,
      countryCode: data.countryCode,
      campaignId: data.campaignId,
      sequenceTag,
      sequencePosition: currentPosition + 1,
      dependsOnQueueId: parentQueueItemId,
    },
    {
      delay: scheduledAt.getTime() - Date.now(),
      priority: 5,
    }
  );

  console.log(`[FollowUp:${newQueueItemId}] Scheduled for ${scheduledAt.toISOString()}`);
}

/**
 * Helper function to create Redis connection
 */
function createRedisConnection(): Redis {
  const Redis = require('ioredis');
  return new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
  });
}
