/**
 * BullMQ Recovery Worker
 * Recovers stuck, stalled, or orphaned jobs in the email queue
 */

import { Worker, Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { EmailJobData } from '../lib/queue/types';

// =====================================================
// RECOVERY CONFIGURATION
// =====================================================

interface RecoveryConfig {
  queueName?: string;
  redis?: Redis;
  stuckJobTimeout?: number;    // Jobs stuck longer than this (ms) are recovered
  maxRecoveryAttempts?: number;
  recoveryInterval?: number;    // How often to run recovery (ms)
}

const DEFAULT_RECOVERY_CONFIG: Required<Omit<RecoveryConfig, 'queueName' | 'recoveryInterval'>> = {
  redis: new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
  }),
  stuckJobTimeout: 30 * 60 * 1000, // 30 minutes
  maxRecoveryAttempts: 3,
};

// =====================================================
// RECOVERY WORKER CLASS
// =====================================================

export class RecoveryWorker {
  private queue: Queue<EmailJobData>;
  private redis: Redis;
  private stuckJobTimeout: number;
  private maxRecoveryAttempts: number;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private stats: {
    runs: number;
    jobsRecovered: number;
    jobsFailed: number;
    lastRunAt: Date | null;
  };

  constructor(config: RecoveryConfig = {}) {
    const fullConfig = { ...DEFAULT_RECOVERY_CONFIG, ...config };

    this.queue = new Queue<EmailJobData>(fullConfig.queueName || 'emails', {
      connection: fullConfig.redis!,
    });

    this.redis = fullConfig.redis!;
    this.stuckJobTimeout = fullConfig.stuckJobTimeout;
    this.maxRecoveryAttempts = fullConfig.maxRecoveryAttempts;

    this.stats = {
      runs: 0,
      jobsRecovered: 0,
      jobsFailed: 0,
      lastRunAt: null,
    };
  }

  // =====================================================
  // RECOVERY OPERATIONS
  // =====================================================

  /**
   * Run recovery operation
   */
  async recover(): Promise<{
    recovered: number;
    failed: number;
    skipped: number;
    details: Array<{
      jobId: string;
      queueItemId: number;
      action: string;
      reason: string;
    }>;
  }> {
    console.log('[RecoveryWorker] Starting recovery operation...');
    const startTime = Date.now();

    const recovered: Array<{
      jobId: string;
      queueItemId: number;
      action: string;
      reason: string;
    }> = [];
    const failed: Array<{
      jobId: string;
      queueItemId: number;
      action: string;
      reason: string;
    }> = [];
    let skipped = 0;

    try {
      // Step 1: Recover stuck jobs in 'acquired' status
      const stuckAcquiredJobs = await this.findStuckAcquiredJobs();

      for (const job of stuckAcquiredJobs) {
        try {
          const result = await this.recoverStuckAcquiredJob(job);
          recovered.push(result);
          this.stats.jobsRecovered++;
        } catch (error) {
          failed.push({
            jobId: job.id!,
            queueItemId: job.data.queueItemId,
            action: 'acquired_recovery',
            reason: error instanceof Error ? error.message : String(error),
          });
          this.stats.jobsFailed++;
        }
      }

      // Step 2: Recover stuck jobs in 'active' status (BullMQ stuck jobs)
      const stuckActiveJobs = await this.findStuckActiveJobs();

      for (const job of stuckActiveJobs) {
        try {
          const result = await this.recoverStuckActiveJob(job);
          recovered.push(result);
          this.stats.jobsRecovered++;
        } catch (error) {
          failed.push({
            jobId: job.id!,
            queueItemId: job.data.queueItemId,
            action: 'active_recovery',
            reason: error instanceof Error ? error.message : String(error),
          });
          this.stats.jobsFailed++;
        }
      }

      // Step 3: Clean up orphaned locks in Redis
      await this.cleanupOrphanedLocks();

      // Step 4: Clean up orphaned sender locks
      await this.cleanupOrphanedSenderLocks();

      // Step 5: Reschedule jobs that have been delayed too long
      const rescheduled = await this.rescheduleOverdueDelayedJobs();
      recovered.push(...rescheduled);

      // Update stats
      this.stats.runs++;
      this.stats.lastRunAt = new Date();

      const duration = Date.now() - startTime;
      console.log(
        `[RecoveryWorker] Recovery completed in ${duration}ms:`,
        `${recovered.length} recovered, ${failed.length} failed, ${skipped} skipped`
      );

      return {
        recovered: recovered.length,
        failed: failed.length,
        skipped,
        details: [...recovered, ...failed],
      };
    } catch (error) {
      console.error('[RecoveryWorker] Recovery operation failed:', error);
      throw error;
    }
  }

  /**
   * Find jobs stuck in 'acquired' status (database-level lock)
   */
  private async findStuckAcquiredJobs(): Promise<Job<EmailJobData>[]> {
    // Get jobs from BullMQ that are in active/processing state
    const activeJobs = await this.queue.getJobs(['active'], 0, 100);

    // Filter for jobs that have been processing too long
    const now = Date.now();
    const stuckJobs = activeJobs.filter((job) => {
      const processingTime = now - job.processedOn!;
      return processingTime > this.stuckJobTimeout;
    });

    return stuckJobs;
  }

  /**
   * Recover a job stuck in 'acquired' status
   */
  private async recoverStuckAcquiredJob(
    job: Job<EmailJobData>
  ): Promise<{
    jobId: string;
    queueItemId: number;
    action: string;
    reason: string;
  }> {
    const { queueItemId } = job.data;
    const db = await this.getDb();

    // Check current status in database
    const result = await db.query(
      'SELECT status, processing_token, started_at FROM email_queue WHERE id = $1',
      [queueItemId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Queue item ${queueItemId} not found in database`);
    }

    const queueItem = result.rows[0];

    // Only recover if still in 'acquired' status
    if (queueItem.status !== 'acquired') {
      return {
        jobId: job.id!,
        queueItemId,
        action: 'skipped',
        reason: `Status is '${queueItem.status}', not 'acquired'`,
      };
    }

    // Check if processing token lock still exists
    const lockKey = `email:lock:${queueItemId}`;
    const lockExists = await this.redis.exists(lockKey);

    // Update database status back to pending
    await db.query(
      `UPDATE email_queue
       SET status = 'pending',
           processing_token = NULL,
           started_at = NULL,
           attempts = attempts + 1,
           last_error = 'Recovered from stuck state',
           last_error_at = NOW()
       WHERE id = $1`,
      [queueItemId]
    );

    // Clear the lock if it exists
    if (lockExists) {
      await this.redis.del(lockKey);
    }

    // Move job back to waiting in BullMQ
    await job.moveToWaiting('Recovered from stuck state');

    console.log(`[RecoveryWorker] Recovered stuck job ${job.id} (queue item ${queueItemId})`);

    return {
      jobId: job.id!,
      queueItemId,
      action: 'recovered',
      reason: 'Job was stuck in acquired status',
    };
  }

  /**
   * Find jobs stuck in 'active' status (BullMQ level)
   */
  private async findStuckActiveJobs(): Promise<Job<EmailJobData>[]> {
    const activeJobs = await this.queue.getJobs(['active'], 0, 100);

    const now = Date.now();
    const stuckJobs = activeJobs.filter((job) => {
      const processingTime = now - (job.processedOn || job.timestamp);
      return processingTime > this.stuckJobTimeout;
    });

    return stuckJobs;
  }

  /**
   * Recover a job stuck in 'active' status
   */
  private async recoverStuckActiveJob(
    job: Job<EmailJobData>
  ): Promise<{
    jobId: string;
    queueItemId: number;
    action: string;
    reason: string;
  }> {
    const { queueItemId } = job.data;

    // Update database
    const db = await this.getDb();
    await db.query(
      `UPDATE email_queue
       SET status = 'pending',
           processing_token = NULL,
           attempts = attempts + 1,
           last_error = 'Recovered from stalled state',
           last_error_at = NOW()
       WHERE id = $1`,
      [queueItemId]
    );

    // Move job back to waiting
    await job.moveToWaiting('Recovered from stalled state');

    console.log(`[RecoveryWorker] Recovered stalled job ${job.id} (queue item ${queueItemId})`);

    return {
      jobId: job.id!,
      queueItemId,
      action: 'recovered',
      reason: 'Job was stalled in active status',
    };
  }

  /**
   * Clean up orphaned locks in Redis
   */
  private async cleanupOrphanedLocks(): Promise<number> {
    const pattern = 'email:lock:*';
    const keys = await this.redis.keys(pattern);

    let cleaned = 0;

    for (const key of keys) {
      // Check if the corresponding queue item exists and is not in 'acquired' status
      const queueItemId = key.replace('email:lock:', '');
      const db = await this.getDb();

      const result = await db.query(
        'SELECT status FROM email_queue WHERE id = $1',
        [queueItemId]
      );

      if (result.rows.length === 0 || result.rows[0].status !== 'acquired') {
        await this.redis.del(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[RecoveryWorker] Cleaned up ${cleaned} orphaned locks`);
    }

    return cleaned;
  }

  /**
   * Clean up orphaned sender locks
   */
  private async cleanupOrphanedSenderLocks(): Promise<number> {
    const pattern = 'email:sender:lock:*';
    const keys = await this.redis.keys(pattern);

    let cleaned = 0;

    for (const key of keys) {
      // Check TTL and remove expired locks
      const ttl = await this.redis.pttl(key);

      if (ttl === -2) {
        // Key doesn't exist (shouldn't happen)
        await this.redis.del(key);
        cleaned++;
      } else if (ttl === -1) {
        // Key exists but has no expiry - check if sender is actually sending
        const senderId = key.replace('email:sender:lock:', '');
        const db = await this.getDb();

        const result = await db.query(
          'SELECT COUNT(*) as count FROM email_queue WHERE sender_id = $1 AND status = $2',
          [senderId, 'acquired']
        );

        if (parseInt(result.rows[0].count) === 0) {
          // No active jobs for this sender, clear the lock
          await this.redis.del(key);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[RecoveryWorker] Cleaned up ${cleaned} orphaned sender locks`);
    }

    return cleaned;
  }

  /**
   * Reschedule delayed jobs that are overdue
   */
  private async rescheduleOverdueDelayedJobs(): Promise<Array<{
    jobId: string;
    queueItemId: number;
    action: string;
    reason: string;
  }>> {
    const delayedJobs = await this.queue.getJobs(['delayed'], 0, 100);

    const rescheduled: Array<{
      jobId: string;
      queueItemId: number;
      action: string;
      reason: string;
    }> = [];

    for (const job of delayedJobs) {
      // Check if scheduled time has passed
      if (job.delay && job.delay > 0) {
        const scheduledFor = job.timestamp + job.delay;
        const now = Date.now();

        if (now > scheduledFor) {
          // Job should have been processed by now
          await job.promote();
          rescheduled.push({
            jobId: job.id!,
            queueItemId: job.data.queueItemId,
            action: 'promoted',
            reason: 'Delayed job was overdue',
          });
        }
      }
    }

    if (rescheduled.length > 0) {
      console.log(`[RecoveryWorker] Promoted ${rescheduled.length} overdue delayed jobs`);
    }

    return rescheduled;
  }

  // =====================================================
  // SCHEDULING
  // =====================================================

  /**
   * Start periodic recovery
   */
  start(intervalMs: number = 5 * 60 * 1000): void {
    if (this.isRunning) {
      console.log('[RecoveryWorker] Already running');
      return;
    }

    this.isRunning = true;

    // Run immediately
    this.recover().catch((error) => {
      console.error('[RecoveryWorker] Initial recovery failed:', error);
    });

    // Schedule periodic runs
    this.intervalId = setInterval(() => {
      this.recover().catch((error) => {
        console.error('[RecoveryWorker] Scheduled recovery failed:', error);
      });
    }, intervalMs);

    console.log(`[RecoveryWorker] Started with ${intervalMs}ms interval`);
  }

  /**
   * Stop periodic recovery
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    console.log('[RecoveryWorker] Stopped');
  }

  // =====================================================
  // STATUS
  // =====================================================

  /**
   * Get recovery worker stats
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
    };
  }

  // =====================================================
  // HELPERS
  // =====================================================

  /**
   * Get database connection
   */
  private async getDb() {
    const { getDb } = await import('../lib/db/client');
    return getDb();
  }
}

// =====================================================
// RECOVERY WORKER FACTORY
// =====================================================

let _recoveryWorker: RecoveryWorker | null = null;

/**
 * Create or get the singleton recovery worker
 */
export function createRecoveryWorker(config?: RecoveryConfig): RecoveryWorker {
  if (!_recoveryWorker) {
    _recoveryWorker = new RecoveryWorker(config);
  }
  return _recoveryWorker;
}

/**
 * Get the existing recovery worker instance
 */
export function getRecoveryWorker(): RecoveryWorker | null {
  return _recoveryWorker;
}

/**
 * Stop and cleanup the recovery worker
 */
export function stopRecoveryWorker(): void {
  if (_recoveryWorker) {
    _recoveryWorker.stop();
    _recoveryWorker = null;
  }
}

// =====================================================
// CLI ENTRY POINT
// =====================================================

/**
 * Run recovery once and exit
 */
export async function runRecoveryOnce(): Promise<void> {
  const worker = createRecoveryWorker();
  const result = await worker.recover();

  console.log('\n[Recovery] Results:');
  console.log(`  Recovered: ${result.recovered}`);
  console.log(`  Failed: ${result.failed}`);
  console.log(`  Skipped: ${result.skipped}`);

  if (result.details.length > 0) {
    console.log('\n[Recovery] Details:');
    for (const detail of result.details) {
      console.log(`  [${detail.action}] Job ${detail.jobId}: ${detail.reason}`);
    }
  }

  process.exit(result.failed > 0 ? 1 : 0);
}

/**
 * Start recovery worker daemon
 */
export async function startRecoveryDaemon(): Promise<void> {
  const interval = parseInt(process.env.RECOVERY_INTERVAL || '300000'); // 5 minutes default
  const worker = createRecoveryWorker();

  worker.start(interval);

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[RecoveryWorker] Received ${signal}, shutting down...`);
    worker.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.log('[RecoveryWorker] Running. Press Ctrl+C to stop.');
}

// Run if called directly
if (require.main === module) {
  const command = process.argv[2] || 'daemon';

  if (command === 'once') {
    runRecoveryOnce().catch((error) => {
      console.error('[RecoveryWorker] Failed:', error);
      process.exit(1);
    });
  } else {
    startRecoveryDaemon().catch((error) => {
      console.error('[RecoveryWorker] Failed to start:', error);
      process.exit(1);
    });
  }
}
