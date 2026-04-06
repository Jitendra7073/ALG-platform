/**
 * BullMQ Queue Client
 * Provides queue management for email processing with Redis backend
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import {
  QUEUE_NAMES,
  EmailJobData,
  EmailJobOptions,
  JobPriority,
  QueueStats,
  EmailJobType,
} from './types';
import { generateJobOptions } from './retry-config';

// =====================================================
// REDIS CONNECTION
// =====================================================

/**
 * Redis configuration
 */
interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest?: number;
  enableReadyCheck?: boolean;
}

/**
 * Get Redis configuration from environment
 */
function getRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0'),
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,    // Required for BullMQ
  };
}

/**
 * Create a Redis connection for BullMQ
 */
export function createRedisConnection(config?: RedisConfig): Redis {
  const redisConfig = config || getRedisConfig();
  const redis = new Redis({
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password,
    db: redisConfig.db || 0,
    maxRetriesPerRequest: redisConfig.maxRetriesPerRequest ?? null,
    enableReadyCheck: redisConfig.enableReadyCheck ?? false,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

  redis.on('error', (err) => {
    console.error('[Redis] Error:', err);
  });

  redis.on('connect', () => {
    console.log('[Redis] Connected');
  });

  return redis;
}

// =====================================================
// QUEUE SINGLETON
// =====================================================

interface QueueInstance {
  queue: Queue<EmailJobData>;
  events: QueueEvents;
}

const queues: Map<string, QueueInstance> = new Map();

/**
 * Get or create a queue instance
 */
export function getQueue(
  queueName: string = QUEUE_NAMES.EMAIL,
  redis?: Redis
): Queue<EmailJobData> {
  if (!queues.has(queueName)) {
    const connection = redis || createRedisConnection();

    const queue = new Queue<EmailJobData>(queueName, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    });

    const events = new QueueEvents(queueName, { connection });

    queues.set(queueName, { queue, events });

    // Set up event logging
    events.on('waiting', ({ jobId }) => {
      console.debug(`[Queue:${queueName}] Job ${jobId} is waiting`);
    });

    events.on('active', ({ jobId }) => {
      console.debug(`[Queue:${queueName}] Job ${jobId} is now active`);
    });

    events.on('completed', ({ jobId, returnvalue }) => {
      console.debug(`[Queue:${queueName}] Job ${jobId} completed`);
    });

    events.on('failed', ({ jobId, failedReason }) => {
      console.error(`[Queue:${queueName}] Job ${jobId} failed:`, failedReason);
    });

    events.on('stalled', ({ jobId }) => {
      console.warn(`[Queue:${queueName}] Job ${jobId} is stalled`);
    });
  }

  return queues.get(queueName)!.queue;
}

/**
 * Get queue events instance
 */
export function getQueueEvents(
  queueName: string = QUEUE_NAMES.EMAIL
): QueueEvents | undefined {
  return queues.get(queueName)?.events;
}

/**
 * Close all queue connections
 */
export async function closeAllQueues(): Promise<void> {
  const closingPromises: Promise<void>[] = [];

  for (const [name, instance] of queues.entries()) {
    closingPromises.push(
      instance.queue.close().then(() => instance.events.close())
    );
  }

  await Promise.all(closingPromises);
  queues.clear();
}

// =====================================================
// EMAIL QUEUE CLIENT
// =====================================================

/**
 * Email queue client with typed methods
 */
export class EmailQueueClient {
  private queue: Queue<EmailJobData>;
  private dlq: Queue<EmailJobData>;

  constructor(redis?: Redis) {
    this.queue = getQueue(QUEUE_NAMES.EMAIL, redis);
    this.dlq = getQueue(QUEUE_NAMES.EMAIL_DLQ, redis);
  }

  // =====================================================
  // JOB ADDITION METHODS
  // =====================================================

  /**
   * Add a single email job to the queue
   */
  async addSingle(
    data: Omit<EmailJobData, 'type'> & { type?: 'send-single' },
    options?: Partial<EmailJobOptions>
  ): Promise<Job<EmailJobData>> {
    const jobData: EmailJobData = {
      type: 'send-single',
      ...data,
    };

    const opts = this.buildOptions(options);
    const jobId = options?.jobId || `email:${data.queueItemId}`;

    return this.queue.add(jobData.type, jobData, {
      ...opts,
      jobId,
    });
  }

  /**
   * Add a batch email job
   */
  async addBatch(
    emails: Array<{
      queueItemId: number;
      contactId: number;
      recipientEmail: string;
      recipientName?: string;
      subject: string;
      htmlContent: string;
      textContent?: string;
      countryCode: string;
    }>,
    options?: Partial<EmailJobOptions>
  ): Promise<Job<EmailJobData>> {
    const jobData: EmailJobData = {
      type: 'send-batch',
      emails,
    };

    const opts = this.buildOptions(options);
    const jobId = options?.jobId || `batch:${Date.now()}`;

    return this.queue.add('send-batch', jobData, {
      ...opts,
      jobId,
    });
  }

  /**
   * Add a follow-up email job
   */
  async addFollowUp(
    data: Omit<EmailJobData, 'type'> & {
      type?: 'follow-up';
      sequenceTag: string;
      sequencePosition: number;
      dependsOnQueueId: number;
    },
    options?: Partial<EmailJobOptions>
  ): Promise<Job<EmailJobData>> {
    const jobData: EmailJobData = {
      type: 'follow-up',
      ...data,
    };

    const opts = this.buildOptions(options);
    const jobId = options?.jobId || `followup:${data.queueItemId}`;

    return this.queue.add('follow-up', jobData, {
      ...opts,
      jobId,
    });
  }

  /**
   * Add a campaign blast job
   */
  async addCampaignBlast(
    campaignId: number,
    targetCriteria?: Record<string, unknown>,
    options?: Partial<EmailJobOptions>
  ): Promise<Job<EmailJobData>> {
    const jobData: EmailJobData = {
      type: 'campaign-blast',
      campaignId,
      targetCriteria,
    } as any;

    const opts = this.buildOptions(options);
    const jobId = options?.jobId || `campaign:${campaignId}`;

    return this.queue.add('campaign-blast', jobData, {
      ...opts,
      jobId,
    });
  }

  /**
   * Add a scheduled send job
   */
  async addScheduled(
    data: Omit<EmailJobData, 'type'> & { type?: 'schedule-send'; scheduledAt: Date },
    options?: Partial<EmailJobOptions>
  ): Promise<Job<EmailJobData>> {
    const jobData: EmailJobData = {
      type: 'schedule-send',
      ...data,
    } as any;

    const opts = this.buildOptions(options);
    const delay = data.scheduledAt.getTime() - Date.now();

    const jobId = options?.jobId || `scheduled:${data.queueItemId}`;

    return this.queue.add('schedule-send', jobData, {
      ...opts,
      delay: Math.max(0, delay),
      jobId,
    });
  }

  /**
   * Add bulk jobs from array
   */
  async addBulk(
    jobs: Array<{
      name: string;
      data: EmailJobData;
      opts?: EmailJobOptions;
    }>
  ): Promise<Job<EmailJobData>[]> {
    const bulkJobs = jobs.map((job) => ({
      name: job.name,
      data: job.data,
      opts: job.opts ? this.buildOptions(job.opts) : this.buildOptions(),
    }));

    return this.queue.addBulk(bulkJobs);
  }

  // =====================================================
  // JOB MANAGEMENT
  // =====================================================

  /**
   * Get a job by ID
   */
  async getJob(jobId: string): Promise<Job<EmailJobData> | undefined> {
    return this.queue.getJob(jobId);
  }

  /**
   * Remove a job from the queue
   */
  async removeJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job) {
      await job.remove();
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job) {
      await job.retry();
    }
  }

  /**
   * Move a job to DLQ
   */
  async moveToDLQ(jobId: string, reason: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job) {
      await job.moveToFailed(new Error(reason), this.dlq);
    }
  }

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    await this.queue.pause();
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.queue.resume();
  }

  /**
   * Check if queue is paused
   */
  async isPaused(): Promise<boolean> {
    return this.queue.isPaused();
  }

  // =====================================================
  // QUEUE STATISTICS
  // =====================================================

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStats> {
    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed'
    );

    return {
      queue: QUEUE_NAMES.EMAIL,
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
      paused: await this.queue.isPaused(),
    };
  }

  /**
   * Get jobs by state
   */
  async getJobsByState(
    state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed',
    start = 0,
    end = 10
  ): Promise<Job<EmailJobData>[]> {
    return this.queue.getJobs([state], start, end);
  }

  /**
   * Clean old jobs from queue
   */
  async clean(
    grace: number,
    limit: number,
    type: 'completed' | 'failed' = 'completed'
  ): Promise<number[]> {
    return this.queue.clean(grace, limit, type);
  }

  // =====================================================
  // HELPER METHODS
  // =====================================================

  /**
   * Build BullMQ job options from EmailJobOptions
   */
  private buildOptions(options?: Partial<EmailJobOptions>) {
    const priority = options?.priority ?? JobPriority.NORMAL;
    const delay = options?.delay ?? 0;
    const jobType: EmailJobType = 'send-single'; // Default type

    const baseOptions = generateJobOptions(jobType, priority, delay);

    return {
      ...baseOptions,
      priority: options?.priority ?? baseOptions.priority,
      delay: options?.delay ?? baseOptions.delay,
      jobId: options?.jobId,
    };
  }

  /**
   * Drain the queue (remove all jobs)
   */
  async drain(): Promise<void> {
    await this.queue.drain();
  }

  /**
   * Obliterate the queue (remove all jobs and metadata)
   */
  async obliterate(): Promise<void> {
    await this.queue.obliterate({ force: true });
  }
}

// =====================================================
// QUEUE FACTORY
// =====================================================

/**
 * Get the email queue client singleton
 */
let _emailQueueClient: EmailQueueClient | null = null;

export function getEmailQueue(redis?: Redis): EmailQueueClient {
  if (!_emailQueueClient) {
    _emailQueueClient = new EmailQueueClient(redis);
  }
  return _emailQueueClient;
}

/**
 * Reset the email queue client (useful for testing)
 */
export function resetEmailQueue(): void {
  _emailQueueClient = null;
}
