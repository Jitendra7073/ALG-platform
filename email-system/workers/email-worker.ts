/**
 * BullMQ Email Worker
 * Manages email processing workers with proper event handling and error classification
 */

import { Worker, Job, JobError } from 'bullmq';
import { Redis } from 'ioredis';
import { processEmailJob } from '../lib/queue/processors';
import { EmailJobData, EmailJobResult, WorkerEventData, EmailErrorType } from '../lib/queue/types';
import { classifyError, shouldSendToDLQ } from '../lib/queue/retry-config';
import { randomUUID } from 'crypto';

// =====================================================
// WORKER CONFIGURATION
// =====================================================

interface WorkerConfig {
  queueName?: string;
  concurrency?: number;
  redis?: Redis;
  limiter?: {
    max: number;
    duration: number;
  };
}

const DEFAULT_WORKER_CONFIG: Required<WorkerConfig> = {
  queueName: 'emails',
  concurrency: 5,
  redis: new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
  }),
  limiter: {
    max: 10,
    duration: 1000, // 10 emails per second max
  },
};

// =====================================================
// WORKER CLASS
// =====================================================

export class EmailWorker {
  private worker: Worker<EmailJobData, EmailJobResult, string>;
  private workerId: string;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private jobsProcessed: number = 0;
  private jobsFailed: number = 0;
  private startTime: Date | null = null;
  private lastActivity: Date | null = null;
  private eventHandlers: Map<string, (data: WorkerEventData) => void> = new Map();

  constructor(config: WorkerConfig = {}) {
    const fullConfig = { ...DEFAULT_WORKER_CONFIG, ...config };
    this.workerId = `worker-${randomUUID().slice(0, 8)}`;

    this.worker = new Worker<EmailJobData, EmailJobResult, string>(
      fullConfig.queueName,
      this.processJob.bind(this),
      {
        connection: fullConfig.redis,
        concurrency: fullConfig.concurrency,
        limiter: fullConfig.limiter,
        removeOnComplete: {
          count: 1000,
          age: 7 * 24 * 3600, // 7 days
        },
        removeOnFail: {
          count: 5000,
          age: 30 * 24 * 3600, // 30 days
        },
      }
    );

    this.setupEventHandlers();
  }

  // =====================================================
  // JOB PROCESSING
  // =====================================================

  /**
   * Main job processor wrapper with error handling
   */
  private async processJob(
    job: Job<EmailJobData>,
    token?: string
  ): Promise<EmailJobResult> {
    const jobStart = Date.now();
    this.lastActivity = new Date();
    this.emit('active', {
      eventType: 'active',
      jobId: job.id,
      queueItemId: job.data.queueItemId,
      timestamp: new Date(),
      data: job.data,
    });

    try {
      // Update job progress
      await job.updateProgress(0);

      // Process the email job
      const result = await processEmailJob(job);

      // Update job progress to complete
      await job.updateProgress(100);

      const duration = Date.now() - jobStart;
      console.log(
        `[Worker:${this.workerId}] Job ${job.id} completed in ${duration}ms`,
        result.success ? 'SUCCESS' : 'FAILED'
      );

      this.jobsProcessed++;
      this.emit('completed', {
        eventType: 'completed',
        jobId: job.id,
        queueItemId: job.data.queueItemId,
        timestamp: new Date(),
        data: result,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - jobStart;
      const classification = classifyError(error);

      console.error(
        `[Worker:${this.workerId}] Job ${job.id} failed after ${duration}ms:`,
        classification.type,
        error
      );

      this.jobsFailed++;
      this.emit('failed', {
        eventType: 'failed',
        jobId: job.id,
        queueItemId: job.data.queueItemId,
        timestamp: new Date(),
        error: error instanceof Error ? error : new Error(String(error)),
      });

      // Check if should send to DLQ
      if (shouldSendToDLQ(
        job.attemptsMade + 1,
        Date.now() - job.timestamp,
        1 // consecutive failures (simplified)
      )) {
        console.warn(`[Worker:${this.workerId}] Job ${job.id} sending to DLQ`);
        await job.moveToDLQ(classification.type);
      }

      // Re-throw with classification for BullMQ retry logic
      const enhancedError = error instanceof Error
        ? error
        : new Error(String(error));

      (enhancedError as any).errorType = classification.type;
      (enhancedError as any).retryable = classification.retryable;

      throw enhancedError;
    }
  }

  // =====================================================
  // EVENT HANDLERS
  // =====================================================

  /**
   * Set up BullMQ worker event handlers
   */
  private setupEventHandlers(): void {
    // Job started
    this.worker.on('active', (job) => {
      console.log(`[Worker:${this.workerId}] Job ${job.id} started processing`);
      this.lastActivity = new Date();
      this.emit('active', {
        eventType: 'active',
        jobId: job.id,
        queueItemId: job.data.queueItemId,
        timestamp: new Date(),
        data: job.data,
      });
    });

    // Job completed
    this.worker.on('completed', (job, result) => {
      console.log(
        `[Worker:${this.workerId}] Job ${job.id} completed:`,
        result.success ? 'SUCCESS' : 'FAILED'
      );
      this.emit('completed', {
        eventType: 'completed',
        jobId: job.id,
        queueItemId: job.data.queueItemId,
        timestamp: new Date(),
        data: result,
      });
    });

    // Job failed
    this.worker.on('failed', (job, error) => {
      if (job) {
        console.error(
          `[Worker:${this.workerId}] Job ${job.id} failed:`,
          error.message
        );
        this.emit('failed', {
          eventType: 'failed',
          jobId: job.id,
          queueItemId: job.data.queueItemId,
          timestamp: new Date(),
          error,
        });
      } else {
        console.error(`[Worker:${this.workerId}] Job failed (no job object):`, error.message);
      }
    });

    // Job progress
    this.worker.on('progress', (job, progress) => {
      this.emit('progress', {
        eventType: 'progress',
        jobId: job.id,
        queueItemId: job.data.queueItemId,
        timestamp: new Date(),
        data: progress,
      });
    });

    // Job stalled (taken too long)
    this.worker.on('stalled', (jobId) => {
      console.warn(`[Worker:${this.workerId}] Job ${jobId} stalled`);
      this.emit('stalled', {
        eventType: 'stalled',
        jobId,
        timestamp: new Date(),
      });
    });

    // Worker error
    this.worker.on('error', (error) => {
      console.error(`[Worker:${this.workerId}] Worker error:`, error);
      this.emit('error', {
        eventType: 'error',
        jobId: 'worker',
        timestamp: new Date(),
        error,
      });
    });

    // Worker ready
    this.worker.on('ready', () => {
      console.log(`[Worker:${this.workerId}] Worker ready`);
      this.emit('ready', {
        eventType: 'ready',
        jobId: 'worker',
        timestamp: new Date(),
      });
    });

    // Worker waiting for jobs
    this.worker.on('waiting', (jobId) => {
      this.emit('waiting', {
        eventType: 'waiting',
        jobId: jobId?.toString() || 'unknown',
        timestamp: new Date(),
      });
    });
  }

  // =====================================================
  // CUSTOM EVENT EMITTER
  // =====================================================

  /**
   * Register a custom event handler
   */
  on(event: string, handler: (data: WorkerEventData) => void): void {
    this.eventHandlers.set(event, handler);
  }

  /**
   * Remove an event handler
   */
  off(event: string): void {
    this.eventHandlers.delete(event);
  }

  /**
   * Emit an event to registered handlers
   */
  private emit(event: string, data: WorkerEventData): void {
    const handler = this.eventHandlers.get(event);
    if (handler) {
      try {
        handler(data);
      } catch (error) {
        console.error(`[Worker:${this.workerId}] Event handler error for ${event}:`, error);
      }
    }
  }

  // =====================================================
  // WORKER CONTROL
  // =====================================================

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`[Worker:${this.workerId}] Already running`);
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.startTime = new Date();
    this.jobsProcessed = 0;
    this.jobsFailed = 0;

    console.log(`[Worker:${this.workerId}] Started`);
  }

  /**
   * Stop the worker (graceful shutdown)
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log(`[Worker:${this.workerId}] Stopping...`);
    this.isRunning = false;

    // Wait for active jobs to complete
    await this.worker.close();
    console.log(`[Worker:${this.workerId}] Stopped`);
  }

  /**
   * Pause the worker (stop picking new jobs, finish current)
   */
  async pause(): Promise<void> {
    await this.worker.pause();
    this.isPaused = true;
    console.log(`[Worker:${this.workerId}] Paused`);
  }

  /**
   * Resume the worker
   */
  async resume(): Promise<void> {
    await this.worker.resume();
    this.isPaused = false;
    console.log(`[Worker:${this.workerId}] Resumed`);
  }

  // =====================================================
  // HEALTH AND STATUS
  // =====================================================

  /**
   * Get worker health status
   */
  getHealth() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      workerId: this.workerId,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      jobsProcessed: this.jobsProcessed,
      jobsFailed: this.jobsFailed,
      lastActivity: this.lastActivity,
    };
  }

  /**
   * Get worker instance (for advanced usage)
   */
  getWorker(): Worker<EmailJobData, EmailJobResult, string> {
    return this.worker;
  }
}

// =====================================================
// WORKER FACTORY
// =====================================================

let _worker: EmailWorker | null = null;

/**
 * Create or get the singleton email worker
 */
export function createEmailWorker(config?: WorkerConfig): EmailWorker {
  if (!_worker) {
    _worker = new EmailWorker(config);
  }
  return _worker;
}

/**
 * Get the existing worker instance
 */
export function getEmailWorker(): EmailWorker | null {
  return _worker;
}

/**
 * Stop and cleanup the worker
 */
export async function stopEmailWorker(): Promise<void> {
  if (_worker) {
    await _worker.stop();
    _worker = null;
  }
}

// =====================================================
// CLI ENTRY POINT
// =====================================================

/**
 * Start worker from command line
 */
export async function startWorkerCli(): Promise<void> {
  const worker = createEmailWorker({
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5'),
  });

  await worker.start();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Worker] Received ${signal}, shutting down gracefully...`);
    await worker.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Keep process alive
  console.log('[Worker] Running. Press Ctrl+C to stop.');
}

// Run if called directly
if (require.main === module) {
  startWorkerCli().catch((error) => {
    console.error('[Worker] Failed to start:', error);
    process.exit(1);
  });
}
