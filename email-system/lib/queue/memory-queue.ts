/**
 * In-Memory Queue for Development
 * Simple queue implementation that doesn't require Redis
 */

export interface MemoryJob {
  id: string;
  data: any;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  attempts: number;
  maxAttempts: number;
  error?: string;
}

class MemoryQueue {
  private jobs: Map<string, MemoryJob> = new Map();
  private processing: Set<string> = new Set();
  private processors: Map<string, (job: MemoryJob) => Promise<any>> = new Map();

  /**
   * Add job to queue
   */
  async add(name: string, data: any, options?: { delay?: number; jobId?: string }): Promise<string> {
    const jobId = options?.jobId || `${name}-${Date.now()}-${Math.random()}`;

    const job: MemoryJob = {
      id: jobId,
      data,
      status: 'pending',
      createdAt: new Date(),
      attempts: 0,
      maxAttempts: 3,
    };

    this.jobs.set(jobId, job);

    // If delay specified, schedule for later
    if (options?.delay && options.delay > 0) {
      setTimeout(() => this.processJob(jobId), options.delay);
    } else {
      // Process immediately
      setImmediate(() => this.processJob(jobId));
    }

    return jobId;
  }

  /**
   * Register processor for job type
   */
  process(name: string, handler: (job: MemoryJob) => Promise<any>): void {
    this.processors.set(name, handler);
  }

  /**
   * Process a single job
   */
  private async processJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'pending') return;

    const processor = this.processors.get('email');
    if (!processor) {
      console.error('No processor registered for email jobs');
      return;
    }

    // Mark as processing
    job.status = 'processing';
    job.attempts++;
    this.processing.add(jobId);

    try {
      await processor(job);
      job.status = 'completed';
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);
      job.status = job.attempts >= job.maxAttempts ? 'failed' : 'pending';
      if (job.status === 'pending') {
        // Retry after delay
        setTimeout(() => {
          job.status = 'pending';
          this.processJob(jobId);
        }, 5000 * job.attempts);
      }
    } finally {
      this.processing.delete(jobId);
    }
  }

  /**
   * Get queue stats
   */
  getStats() {
    return {
      pending: Array.from(this.jobs.values()).filter(j => j.status === 'pending').length,
      processing: this.processing.size,
      completed: Array.from(this.jobs.values()).filter(j => j.status === 'completed').length,
      failed: Array.from(this.jobs.values()).filter(j => j.status === 'failed').length,
    };
  }

  /**
   * Get all jobs
   */
  getAllJobs(): MemoryJob[] {
    return Array.from(this.jobs.values());
  }
}

// Singleton instance
export const memoryQueue = new MemoryQueue();
