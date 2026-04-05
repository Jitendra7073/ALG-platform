/**
 * AI Retry Manager - Handles stuck sites and automatic retries
 *
 * Features:
 * 1. Detects sites stuck in "processing" status
 * 2. Re-queues failed sites for retry
 * 3. Implements exponential backoff for repeated failures
 * 4. Monitors and reports stuck site statistics
 *
 * REFACTORED: Now uses PostgreSQL adapter with async/await
 */

const db = require("../../database/database.js");
const logger = require("../../utils/logger"); // Compact logger

class AIRetryManager {
  constructor(aiProcessor) {
    this.aiProcessor = aiProcessor;
    this.checkIntervalMs = 60000; // Check every 1 minute
    this.maxRetryAttempts = 3; // Max retry attempts before giving up
    this.processingTimeoutMs = 300000; // 5 minutes - sites stuck in "processing" longer than this are considered stuck
    this.intervalId = null;
    this.isRunning = false;

    this.stats = {
      totalChecks: 0,
      stuckSitesFound: 0,
      sitesRequeued: 0,
      sitesGivenUp: 0,
      lastCheckAt: null,
    };
  }

  /**
   * Start the retry manager
   */
  start() {
    if (this.isRunning) {
      logger.warn('Retry', 'Already running');
      return;
    }

    this.isRunning = true;
    logger.worker('AIRetryManager', 'started', {
      interval: `${this.checkIntervalMs / 1000}s`,
      timeout: `${this.processingTimeoutMs / 1000}s`,
      maxRetries: this.maxRetryAttempts
    });

    // Check immediately on start
    this.checkAndRetryStuckSites();

    // Then set up interval
    this.intervalId = setInterval(() => {
      this.checkAndRetryStuckSites();
    }, this.checkIntervalMs);
  }

  /**
   * Stop the retry manager
   */
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    logger.worker('AIRetryManager', 'stopped', {
      checks: this.stats.totalChecks,
      requeued: this.stats.sitesRequeued,
      givenUp: this.stats.sitesGivenUp
    });
  }

  /**
   * Main check function - finds and re-queues stuck sites
   */
  async checkAndRetryStuckSites() {
    if (!this.isRunning) return;

    this.stats.totalChecks++;
    this.stats.lastCheckAt = new Date().toISOString();

    try {
      // Check for sites stuck in "processing" status
      const stuckProcessingSites = await this.findStuckProcessingSites();
      if (stuckProcessingSites.length > 0) {
        logger.ai('Retrying stuck sites', { count: stuckProcessingSites.length });
        await this.handleStuckProcessingSites(stuckProcessingSites);
      }

      // Check for failed sites that can be retried
      const retryableFailedSites = await this.findRetryableFailedSites();
      if (retryableFailedSites.length > 0) {
        logger.ai('Retrying failed sites', { count: retryableFailedSites.length });
        await this.retryFailedSites(retryableFailedSites);
      }

      // Check for very old pending sites
      const oldPendingSites = await this.findOldPendingSites();
      if (oldPendingSites.length > 0) {
        logger.ai('Retrying old pending sites', { count: oldPendingSites.length });
        await this.handleOldPendingSites(oldPendingSites);
      }
    } catch (error) {
      logger.error('Retry', 'Check failed', { message: error.message });
    }
  }

  /**
   * Find sites stuck in "processing" status
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async findStuckProcessingSites() {
    try {
      const timeoutSeconds = Math.floor(this.processingTimeoutMs / 1000);
      const sites = await db.all(
        `SELECT id, url, search_query, ai_status, ai_processed_at
         FROM sites
         WHERE ai_status = 'processing'
           AND ai_processed_at < CURRENT_TIMESTAMP - INTERVAL '${timeoutSeconds} seconds'
         ORDER BY ai_processed_at ASC`
      );
      return sites;
    } catch (error) {
      logger.error('DB', 'Query failed', { operation: 'findStuckProcessingSites', message: error.message });
      return [];
    }
  }

  /**
   * Find failed sites that can be retried
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async findRetryableFailedSites() {
    try {
      const sites = await db.all(
        `SELECT id, url, search_query, ai_status, ai_error, ai_processed_at, retry_count, last_retried_at
         FROM sites
         WHERE ai_status = 'failed'
           AND (retry_count IS NULL OR retry_count < ?)
           AND text_content IS NOT NULL
           AND text_content != ''
           AND (last_retried_at IS NULL OR last_retried_at < CURRENT_TIMESTAMP - INTERVAL '1 hour')
         ORDER BY ai_processed_at ASC`,
        [this.maxRetryAttempts]
      );
      return sites;
    } catch (error) {
      logger.error('DB', 'Query failed', { operation: 'findRetryableFailedSites', message: error.message });
      return [];
    }
  }

  /**
   * Find old pending sites (never processed)
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async findOldPendingSites() {
    try {
      const sites = await db.all(
        `SELECT id, url, search_query, checked_at
         FROM sites
         WHERE ai_status = 'pending'
           AND checked_at < CURRENT_TIMESTAMP - INTERVAL '1 day'
         ORDER BY checked_at ASC
         LIMIT 50`
      );
      return sites;
    } catch (error) {
      logger.error('DB', 'Query failed', { operation: 'findOldPendingSites', message: error.message });
      return [];
    }
  }

  /**
   * Handle sites stuck in processing status
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async handleStuckProcessingSites(sites) {
    try {
      for (const site of sites) {
        // Reset to pending for retry
        await db.run(
          `UPDATE sites
           SET ai_status = 'pending',
               ai_error = 'Reset from stuck processing status',
               ai_processed_at = NULL
           WHERE id = ?`,
          [site.id]
        );

        this.stats.stuckSitesFound++;
        this.stats.sitesRequeued++;
      }

      logger.ai('Reset stuck sites', { count: sites.length });
    } catch (error) {
      logger.error('Retry', 'Handle stuck failed', { message: error.message });
    }
  }

  /**
   * Retry failed sites
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async retryFailedSites(sites) {
    try {
      for (const site of sites) {
        const currentRetryCount = site.retry_count || 0;
        const newRetryCount = currentRetryCount + 1;

        if (newRetryCount > this.maxRetryAttempts) {
          this.stats.sitesGivenUp++;
          continue;
        }

        // Reset to pending for retry
        await db.run(
          `UPDATE sites
           SET ai_status = 'pending',
               ai_error = NULL,
               ai_processed_at = NULL,
               retry_count = ?,
               last_retried_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [newRetryCount, site.id]
        );

        this.stats.sitesRequeued++;
      }

      logger.ai('Re-queued failed sites', { count: sites.length });
    } catch (error) {
      logger.error('Retry', 'Retry failed', { message: error.message });
    }
  }

  /**
   * Handle old pending sites
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async handleOldPendingSites(sites) {
    try {
      for (const site of sites) {
        // Update last_retried_at to prevent immediate re-processing
        await db.run(
          `UPDATE sites
           SET last_retried_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [site.id]
        );

        this.stats.sitesRequeued++;
      }

      logger.ai('Marked old pending sites', { count: sites.length });
    } catch (error) {
      logger.error('Retry', 'Handle old pending failed', { message: error.message });
    }
  }

  /**
   * Get stuck site statistics
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async getStuckSiteStats() {
    try {
      const timeoutSeconds = Math.floor(this.processingTimeoutMs / 1000);

      // Sites stuck in processing
      const stuckProcessing = await db.get(
        `SELECT COUNT(*) as count
         FROM sites
         WHERE ai_status = 'processing'
           AND ai_processed_at < CURRENT_TIMESTAMP - INTERVAL '${timeoutSeconds} seconds'`
      );

      // Sites that can be retried
      const retryable = await db.get(
        `SELECT COUNT(*) as count
         FROM sites
         WHERE ai_status = 'failed'
           AND (retry_count IS NULL OR retry_count < ?)
           AND text_content IS NOT NULL
           AND text_content != ''`,
        [this.maxRetryAttempts]
      );

      // Old pending sites
      const oldPending = await db.get(
        `SELECT COUNT(*) as count
         FROM sites
         WHERE ai_status = 'pending'
           AND checked_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`
      );

      // Total stuck (sum of individual counts)
      const totalStuck = (stuckProcessing?.count || 0) +
                         (retryable?.count || 0) +
                         (oldPending?.count || 0);

      return {
        stuckInProcessing: stuckProcessing?.count || 0,
        retryableFailed: retryable?.count || 0,
        oldPending: oldPending?.count || 0,
        totalStuck,
      };
    } catch (error) {
      logger.error('DB', 'Query failed', { operation: 'getStuckSiteStats', message: error.message });
      return {
        stuckInProcessing: 0,
        retryableFailed: 0,
        oldPending: 0,
        totalStuck: 0,
      };
    }
  }

  /**
   * Truncate URL for display
   */
  truncateUrl(url, maxLength = 50) {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + "...";
  }

  /**
   * Manual retry - force retry of specific sites
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async manualRetry(siteIds) {
    try {
      let requeued = 0;

      for (const siteId of siteIds) {
        const site = await db.get(
          `SELECT id, url, ai_status, retry_count
           FROM sites
           WHERE id = ?`,
          [siteId]
        );

        if (!site) continue;

        const currentRetryCount = site.retry_count || 0;

        await db.run(
          `UPDATE sites
           SET ai_status = 'pending',
               ai_error = NULL,
               ai_processed_at = NULL,
               retry_count = ? + 1,
               last_retried_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [currentRetryCount, siteId]
        );

        requeued++;
      }

      logger.ai('Manual retry complete', { count: requeued });
      return requeued;
    } catch (error) {
      logger.error('Retry', 'Manual retry failed', { message: error.message });
      return 0;
    }
  }

  /**
   * Get stats for API
   */
  async getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      checkIntervalMs: this.checkIntervalMs,
      processingTimeoutMs: this.processingTimeoutMs,
      maxRetryAttempts: this.maxRetryAttempts,
      currentStuckSites: await this.getStuckSiteStats(),
    };
  }
}

// Export singleton
module.exports = new AIRetryManager();
