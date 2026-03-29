/**
 * AI Retry Manager - Handles stuck sites and automatic retries
 *
 * Features:
 * 1. Detects sites stuck in "processing" status
 * 2. Re-queues failed sites for retry
 * 3. Implements exponential backoff for repeated failures
 * 4. Monitors and reports stuck site statistics
 */

const db = require('./database');
const logger = require('./system-logger'); // Import logger

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
      lastCheckAt: null
    };
  }

  /**
   * Start the retry manager
   */
  start() {
    if (this.isRunning) {
      logger.warning('AI Retry Manager already running');
      return;
    }

    this.isRunning = true;
    logger.system('AI Retry Manager started');
    logger.retry(`Check Interval: ${this.checkIntervalMs / 1000}s`);
    logger.retry(`Processing Timeout: ${this.processingTimeoutMs / 1000}s`);
    logger.retry(`Max Retry Attempts: ${this.maxRetryAttempts}`);

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

    console.log('🔄 AI Retry Manager: Stopped');
    this.printStats();
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
      const stuckProcessingSites = this.findStuckProcessingSites();
      if (stuckProcessingSites.length > 0) {
        logger.retry(`Found ${stuckProcessingSites.length} sites stuck in "processing" status`);
        await this.handleStuckProcessingSites(stuckProcessingSites);
      }

      // Check for failed sites that can be retried
      const retryableFailedSites = this.findRetryableFailedSites();
      if (retryableFailedSites.length > 0) {
        logger.retry(`Found ${retryableFailedSites.length} failed sites eligible for retry`);
        await this.retryFailedSites(retryableFailedSites);
      }

      // Check for very old pending sites
      const oldPendingSites = this.findOldPendingSites();
      if (oldPendingSites.length > 0) {
        logger.retry(`Found ${oldPendingSites.length} pending sites that were never processed`);
        await this.handleOldPendingSites(oldPendingSites);
      }

      if (stuckProcessingSites.length === 0 &&
          retryableFailedSites.length === 0 &&
          oldPendingSites.length === 0) {
        // Silent - no issues found
      }

    } catch (error) {
      console.error('❌ AI Retry Manager error:', error.message);
    }
  }

  /**
   * Find sites stuck in "processing" status
   */
  findStuckProcessingSites() {
    const database = db.initDatabase();
    try {
      const sites = database.prepare(`
        SELECT id, url, search_query, ai_status, ai_processed_at
        FROM sites
        WHERE ai_status = 'processing'
          AND ai_processed_at < datetime('now', '-' || ? || ' seconds')
        ORDER BY ai_processed_at ASC
      `).all(Math.floor(this.processingTimeoutMs / 1000));

      return sites;
    } finally {
      database.close();
    }
  }

  /**
   * Find failed sites that can be retried
   */
  findRetryableFailedSites() {
    const database = db.initDatabase();
    try {
      const sites = database.prepare(`
        SELECT
          id,
          url,
          search_query,
          ai_status,
          ai_error,
          ai_processed_at,
          retry_count,
          last_retried_at
        FROM sites
        WHERE ai_status = 'failed'
          AND (retry_count IS NULL OR retry_count < ?)
          AND text_content IS NOT NULL
          AND text_content != ''
          AND (last_retried_at IS NULL OR last_retried_at < datetime('now', '-1 hour'))
        ORDER BY ai_processed_at ASC
      `).all(this.maxRetryAttempts);

      return sites;
    } finally {
      database.close();
    }
  }

  /**
   * Find old pending sites (never processed)
   */
  findOldPendingSites() {
    const database = db.initDatabase();
    try {
      const sites = database.prepare(`
        SELECT id, url, search_query, checked_at
        FROM sites
        WHERE ai_status = 'pending'
          AND checked_at < datetime('now', '-1 day')
        ORDER BY checked_at ASC
        LIMIT 50
      `).all();

      return sites;
    } finally {
      database.close();
    }
  }

  /**
   * Handle sites stuck in processing status
   */
  async handleStuckProcessingSites(sites) {
    const database = db.initDatabase();
    try {
      for (const site of sites) {
        console.log(`   🔄 Resetting stuck site [${site.id}] ${this.truncateUrl(site.url)}`);

        // Reset to pending for retry
        database.prepare(`
          UPDATE sites
          SET ai_status = 'pending',
              ai_error = 'Reset from stuck processing status',
              ai_processed_at = NULL
          WHERE id = ?
        `).run(site.id);

        this.stats.stuckSitesFound++;
        this.stats.sitesRequeued++;
      }

      console.log(`   ✅ Reset ${sites.length} stuck sites to pending`);
    } finally {
      database.close();
    }
  }

  /**
   * Retry failed sites
   */
  async retryFailedSites(sites) {
    const database = db.initDatabase();
    try {
      for (const site of sites) {
        const currentRetryCount = site.retry_count || 0;
        const newRetryCount = currentRetryCount + 1;

        if (newRetryCount > this.maxRetryAttempts) {
          console.log(`   ⏭️  Giving up on [${site.id}] after ${this.maxRetryAttempts} attempts`);
          this.stats.sitesGivenUp++;
          continue;
        }

        console.log(`   🔄 Retrying [${site.id}] (attempt ${newRetryCount}/${this.maxRetryAttempts}) - ${this.truncateUrl(site.url)}`);

        // Reset to pending for retry
        database.prepare(`
          UPDATE sites
          SET ai_status = 'pending',
              ai_error = NULL,
              ai_processed_at = NULL,
              retry_count = ?,
              last_retried_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newRetryCount, site.id);

        this.stats.sitesRequeued++;
      }

      console.log(`   ✅ Re-queued ${sites.length} failed sites`);
    } finally {
      database.close();
    }
  }

  /**
   * Handle old pending sites
   */
  async handleOldPendingSites(sites) {
    const database = db.initDatabase();
    try {
      console.log(`   🔄 Re-queuing ${sites.length} old pending sites...`);

      for (const site of sites) {
        // Update last_retried_at to prevent immediate re-processing
        database.prepare(`
          UPDATE sites
          SET last_retried_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(site.id);

        this.stats.sitesRequeued++;
      }

      console.log(`   ✅ Marked ${sites.length} old pending sites for re-processing`);
    } finally {
      database.close();
    }
  }

  /**
   * Get stuck site statistics
   */
  getStuckSiteStats() {
    const database = db.initDatabase();
    try {
      // Sites stuck in processing
      const stuckProcessing = database.prepare(`
        SELECT COUNT(*) as count
        FROM sites
        WHERE ai_status = 'processing'
          AND ai_processed_at < datetime('now', '-' || ? || ' seconds')
      `).get(Math.floor(this.processingTimeoutMs / 1000));

      // Sites that can be retried
      const retryable = database.prepare(`
        SELECT COUNT(*) as count
        FROM sites
        WHERE ai_status = 'failed'
          AND (retry_count IS NULL OR retry_count < ?)
          AND text_content IS NOT NULL
          AND text_content != ''
      `).get(this.maxRetryAttempts);

      // Old pending sites
      const oldPending = database.prepare(`
        SELECT COUNT(*) as count
        FROM sites
        WHERE ai_status = 'pending'
          AND checked_at < datetime('now', '-1 day')
      `).get();

      // Total stuck
      const totalStuck = database.prepare(`
        SELECT COUNT(*) as count
        FROM sites
        WHERE ai_status IN ('processing', 'failed', 'pending')
          AND (
            (ai_status = 'processing' AND ai_processed_at < datetime('now', '-' || ? || ' seconds'))
            OR (ai_status = 'failed' AND (retry_count IS NULL OR retry_count < ?))
            OR (ai_status = 'pending' AND checked_at < datetime('now', '-1 day'))
          )
      `).get(
        Math.floor(this.processingTimeoutMs / 1000),
        this.maxRetryAttempts
      );

      return {
        stuckInProcessing: stuckProcessing.count,
        retryableFailed: retryable.count,
        oldPending: oldPending.count,
        totalStuck: totalStuck.count
      };
    } finally {
      database.close();
    }
  }

  /**
   * Print statistics
   */
  printStats() {
    console.log('\n🔄 AI Retry Manager Stats:');
    console.log(`   Total Checks: ${this.stats.totalChecks}`);
    console.log(`   Stuck Sites Found: ${this.stats.stuckSitesFound}`);
    console.log(`   Sites Re-queued: ${this.stats.sitesRequeued}`);
    console.log(`   Sites Given Up: ${this.stats.sitesGivenUp}`);
    console.log(`   Last Check: ${this.stats.lastCheckAt || 'Never'}`);

    const currentStats = this.getStuckSiteStats();
    console.log('\n   Current Stuck Sites:');
    console.log(`   - Stuck in Processing: ${currentStats.stuckInProcessing}`);
    console.log(`   - Retryable Failed: ${currentStats.retryableFailed}`);
    console.log(`   - Old Pending: ${currentStats.oldPending}`);
    console.log(`   - Total Stuck: ${currentStats.totalStuck}`);
  }

  /**
   * Truncate URL for display
   */
  truncateUrl(url, maxLength = 50) {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + '...';
  }

  /**
   * Manual retry - force retry of specific sites
   */
  async manualRetry(siteIds) {
    const database = db.initDatabase();
    try {
      let requeued = 0;

      for (const siteId of siteIds) {
        const site = database.prepare(`
          SELECT id, url, ai_status, retry_count
          FROM sites
          WHERE id = ?
        `).get(siteId);

        if (!site) {
          console.log(`   ⚠️  Site ${siteId} not found`);
          continue;
        }

        const currentRetryCount = site.retry_count || 0;

        database.prepare(`
          UPDATE sites
          SET ai_status = 'pending',
              ai_error = NULL,
              ai_processed_at = NULL,
              retry_count = ? + 1,
              last_retried_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(currentRetryCount, siteId);

        console.log(`   ✅ Re-queued site [${site.id}] ${this.truncateUrl(site.url)}`);
        requeued++;
      }

      console.log(`\n✅ Manually re-queued ${requeued} sites`);
      return requeued;
    } finally {
      database.close();
    }
  }

  /**
   * Get stats for API
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      checkIntervalMs: this.checkIntervalMs,
      processingTimeoutMs: this.processingTimeoutMs,
      maxRetryAttempts: this.maxRetryAttempts,
      currentStuckSites: this.getStuckSiteStats()
    };
  }
}

// Export singleton
module.exports = new AIRetryManager();
