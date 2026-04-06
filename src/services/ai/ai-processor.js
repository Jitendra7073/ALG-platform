/**
 * AI Processor Worker - Simplified
 *
 * Processes WordPress-labeled sites with AI to:
 * 1. Verify if it's actually WordPress
 * 2. Check if content is relevant to the search keyword
 * 3. Generate a short content summary
 *
 * Only processes sites where is_wordpress = 1
 *
 * Auto-polling: Checks for pending sites every POLL_INTERVAL_MS.
 * Conflict prevention: While processing a batch, polling is paused.
 */

require("dotenv").config();
const db = require("../../database/database.js");
const aiClient = require("./ai-client");
const logger = require("../../utils/system-logger"); // Import logger

const BATCH_SIZE = 5; // Sites per batch
const POLL_INTERVAL_MS = 30000; // Check for pending sites every 30 seconds
const SITE_DELAY_MS = 2000; // 2 seconds between sites (rate limit protection)
const MAX_HISTORY_SIZE = 100; // Keep last 100 AI requests

class AIProcessor {
  constructor() {
    this.isRunning = false;
    this.isProcessing = false; // Prevents overlapping batch processing
    this.pollIntervalId = null;
    this.requestHistory = []; // Track recent AI requests
    this.stats = {
      totalProcessed: 0,
      relevant: 0,
      notRelevant: 0,
      failed: 0,
      lastPollAt: null,
      lastProcessedAt: null,
    };
  }

  /**
   * Add a request to history
   */
  addToHistory(entry) {
    this.requestHistory.unshift({
      ...entry,
      timestamp: new Date().toISOString(),
    });
    // Keep only the most recent entries
    if (this.requestHistory.length > MAX_HISTORY_SIZE) {
      this.requestHistory = this.requestHistory.slice(0, MAX_HISTORY_SIZE);
    }
  }

  /**
   * Get request history
   */
  getHistory(limit = 20) {
    return this.requestHistory.slice(0, limit);
  }

  /**
   * Validate if search keyword appears in page metadata (pre-AI filter)
   * This saves API costs by filtering obviously irrelevant sites
   *
   * @param {Object} site - Site object with url, search_query, text_content, page_title, meta_description
   * @returns {Object} - { passed: boolean, reason: string }
   */
  validateKeywordPresence(site) {
    if (!site.search_query || !site.search_query.trim()) {
      return { passed: true, reason: null }; // No keyword to validate
    }

    const keyword = site.search_query.toLowerCase().trim();
    const url = site.url.toLowerCase();
    const title = (site.page_title || "").toLowerCase();
    const metaDesc = (site.meta_description || "").toLowerCase();
    const content = (site.text_content || "").toLowerCase().substring(0, 2000); // Check first 2000 chars

    // Extract key terms from search query (remove common words)
    const stopWords = [
      "and",
      "or",
      "the",
      "in",
      "at",
      "for",
      "with",
      "amp",
      "&",
    ];
    const keyTerms = keyword
      .split(/[\s&]+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 2 && !stopWords.includes(term));

    if (keyTerms.length === 0) {
      return { passed: true, reason: null }; // No valid key terms to check
    }

    // Check if ANY key term appears in important places
    let foundInUrl = false;
    let foundInTitle = false;
    let foundInMeta = false;
    let foundInContent = false;

    for (const term of keyTerms) {
      if (url.includes(term)) foundInUrl = true;
      if (title.includes(term)) foundInTitle = true;
      if (metaDesc.includes(term)) foundInMeta = true;
      if (content.includes(term)) foundInContent = true;
    }

    // Pass validation if keyword found in at least 2 places
    const foundCount = [
      foundInUrl,
      foundInTitle,
      foundInMeta,
      foundInContent,
    ].filter(Boolean).length;

    if (foundCount >= 2) {
      return { passed: true, reason: null };
    }

    // Failed validation - explain why
    const reasons = [];
    if (!foundInUrl && !foundInTitle && !foundInMeta && !foundInContent) {
      return {
        passed: false,
        reason: `Keyword "${site.search_query}" not found in URL, title, meta description, or content`,
      };
    }

    if (foundCount === 1) {
      const location = foundInUrl
        ? "URL"
        : foundInTitle
          ? "title"
          : foundInMeta
            ? "meta description"
            : "content";
      return {
        passed: false,
        reason: `Keyword "${site.search_query}" only found in ${location} (requires presence in multiple places)`,
      };
    }

    return { passed: true, reason: null };
  }

  /**
   * Start the background worker with auto-polling
   */
  start() {
    if (this.isRunning) {
      return; // Silent return
    }

    if (!aiClient.isConfigured()) {
      return; // Silent return - no API key
    }

    this.isRunning = true;
    // Silent start - no console spam

    // Start polling loop
    this.startPolling();
  }

  /**
   * Start the polling loop
   */
  startPolling() {
    // Process immediately on start
    this.checkAndProcess();

    // Then set up interval for future checks
    this.pollIntervalId = setInterval(() => {
      this.checkAndProcess();
    }, POLL_INTERVAL_MS);
  }

  /**
   * Check for pending sites and process if found
   * This is the main polling function called every POLL_INTERVAL_MS
   */
  async checkAndProcess() {
    if (!this.isRunning) return;

    // Skip if already processing a batch (conflict prevention)
    if (this.isProcessing) {
      return; // Silent skip
    }

    this.stats.lastPollAt = new Date().toISOString();
    const pendingCount = this.getPendingCount();

    if (pendingCount === 0) {
      return; // Silent - no work to do
    }

    await this.processBatch();
  }

  /**
   * Process a batch of pending sites
   */
  async processBatch() {
    if (this.isProcessing) return;

    this.isProcessing = true;

    try {
      const pendingSites = this.getPendingSites(BATCH_SIZE);

      if (pendingSites.length === 0) {
        return;
      }

      // Silent batch processing

      for (const site of pendingSites) {
        if (!this.isRunning) break;
        await this.processSite(site);

        // Rate limit protection between sites
        await this.sleep(SITE_DELAY_MS);
      }

      this.stats.lastProcessedAt = new Date().toISOString();
    } catch (error) {
      // Silent error handling
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Stop the worker
   */
  stop() {
    this.isRunning = false;
    this.isProcessing = false;

    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    // Silent stop
  }

  /**
   * Print processing statistics
   */
  printStats() {
    // Silent stats - only available via API
  }

  /**
   * Get count of pending sites
   */
  getPendingCount() {
    const database = db.initDatabase();
    try {
      const result = database
        .prepare(
          `
        SELECT COUNT(*) as count
        FROM sites 
        WHERE is_wordpress = 1 
          AND (ai_status = 'pending' OR ai_status IS NULL)
          AND text_content IS NOT NULL 
          AND text_content != ''
      `,
        )
        .get();
      return result.count;
    } finally {
      database.close();
    }
  }

  /**
   * Get pending WordPress sites that need AI verification
   * Only gets sites where:
   * - is_wordpress = 1 (labeled as WordPress)
   * - ai_status = 'pending' (not yet processed)
   * - text_content is not empty
   * - content does not match ignored tags
   */
  getPendingSites(limit = BATCH_SIZE) {
    const database = db.initDatabase();
    try {
      const sites = database
        .prepare(
          `
        SELECT id, url, search_query, text_content, page_title, meta_description
        FROM sites
        WHERE is_wordpress = 1
          AND (ai_status = 'pending' OR ai_status IS NULL)
          AND text_content IS NOT NULL
          AND text_content != ''
        ORDER BY id ASC
        LIMIT ?
      `,
        )
        .all(limit);

      // Filter out sites with ignored tags in content
      const ignoredTags = this.getIgnoredTags();
      const filtered = sites.filter((site) => {
        if (!ignoredTags.length) return true;
        return !this.isContentIgnored(site.text_content, ignoredTags);
      });

      return filtered;
    } finally {
      database.close();
    }
  }

  /**
   * Get all ignored tags from database
   * @returns {Array} - Array of ignored tag objects
   */
  getIgnoredTags() {
    const database = db.initDatabase();
    try {
      return database.prepare(`SELECT * FROM ignored_tags`).all();
    } finally {
      database.close();
    }
  }

  /**
   * Check if content should be ignored based on ignored tags
   * @param {string} content - Content text to check
   * @param {Array} ignoredTags - Array of ignored tag objects
   * @returns {boolean} - True if content should be ignored
   */
  isContentIgnored(content, ignoredTags) {
    if (!content || !ignoredTags || ignoredTags.length === 0) return false;
    const contentLower = content.toLowerCase();

    return ignoredTags.some((tag) => {
      // Skip if scope is 'url' only
      if (tag.scope === "url") return false;

      const tagValue = tag.tag.toLowerCase();
      switch (tag.match_type) {
        case "exact":
          return contentLower.includes(tagValue);
        case "regex":
          try {
            return new RegExp(tagValue, "i").test(contentLower);
          } catch (e) {
            return false;
          }
        case "contains":
        default:
          return contentLower.includes(tagValue);
      }
    });
  }

  /**
   * Process a single site with AI
   */
  async processSite(site) {
    const startTime = Date.now();

    try {
      // Pre-AI keyword validation: Check if keyword appears in page metadata
      const keywordValidated = this.validateKeywordPresence(site);

      if (!keywordValidated.passed) {
        // Mark as not relevant without calling AI
        const elapsed = Date.now() - startTime;

        this.addToHistory({
          type: "site_analysis",
          provider: "Pre-AI Filter",
          model: "keyword_validation",
          success: true,
          responseTime: elapsed,
          tokens: 0,
          siteUrl: site.url,
          isRelevant: false,
          filterReason: keywordValidated.reason,
        });

        // Save as not relevant
        this.saveAIResults(site.id, {
          wordpressVerification: {
            isWordPress: true,
            confidence: "high",
            indicators: [
              "Skipped WordPress verification - filtered by keyword validation",
            ],
          },
          contentRelevance: {
            isRelevant: false,
            actualCategory: "Other",
            summary:
              "Site content does not appear to match search keyword based on URL, title, and content analysis.",
            mismatchReason: keywordValidated.reason,
          },
        });

        this.stats.totalProcessed++;
        this.stats.notRelevant++;
        return;
      }

      // Mark as processing
      this.updateSiteStatus(site.id, "processing");

      // Run AI analysis
      const result = await aiClient.analyzeSite(
        site.search_query,
        site.url,
        site.text_content,
        site.page_title || "",
        site.meta_description || "",
      );

      const elapsed = Date.now() - startTime;

      // Track this request in history
      this.addToHistory({
        type: "site_analysis",
        provider: "OpenRouter",
        model: aiClient.getStats().model,
        success: true,
        responseTime: elapsed,
        tokens: result.tokensUsed || 0,
        siteUrl: site.url,
        isWordPress: result.wordpressVerification?.isWordPress,
        wpConfidence: result.wordpressVerification?.confidence,
        isRelevant: result.contentRelevance?.isRelevant,
      });

      // Save results
      this.saveAIResults(site.id, result);

      // Update stats
      this.stats.totalProcessed++;
      if (result.contentRelevance?.isRelevant) {
        this.stats.relevant++;
      } else {
        this.stats.notRelevant++;
      }
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.stats.totalProcessed++;
      this.stats.failed++;
      this.updateSiteStatus(site.id, "failed", error.message);

      // Track failed request in history
      this.addToHistory({
        type: "site_analysis",
        provider: "OpenRouter",
        model: aiClient.getStats().model,
        success: false,
        responseTime: elapsed,
        tokens: 0,
        siteUrl: site.url,
        error: error.message,
      });
    }
  }

  /**
   * Update site AI status
   */
  updateSiteStatus(siteId, status, errorMessage = null) {
    const database = db.initDatabase();
    try {
      if (errorMessage) {
        database
          .prepare(
            `
          UPDATE sites 
          SET ai_status = ?, ai_error = ?
          WHERE id = ?
        `,
          )
          .run(status, errorMessage, siteId);
      } else {
        database
          .prepare(
            `
          UPDATE sites SET ai_status = ? WHERE id = ?
        `,
          )
          .run(status, siteId);
      }
    } finally {
      database.close();
    }
  }

  /**
   * Save AI analysis results to database
   * Uses actual AI results for WordPress verification instead of hardcoded values
   */
  saveAIResults(siteId, result) {
    const database = db.initDatabase();
    try {
      // Extract WordPress verification data
      const wpVerified = result.wordpressVerification?.isWordPress ? 1 : 0;
      const wpConfidence = result.wordpressVerification?.confidence || "medium";
      const wpIndicators = result.wordpressVerification?.indicators || [];

      // Extract content relevance data
      const isRelevant = result.contentRelevance?.isRelevant ? 1 : 0;
      const actualCategory = result.contentRelevance?.actualCategory || null;
      const contentSummary = result.contentRelevance?.summary || null;
      const mismatchReason = result.contentRelevance?.mismatchReason || null;

      database
        .prepare(
          `
        UPDATE sites SET
          ai_status = 'completed',
          ai_error = NULL,
          is_wordpress = ?,
          ai_verified_wp = ?,
          ai_wp_confidence = ?,
          ai_wp_indicators = ?,
          ai_content_relevant = ?,
          ai_actual_category = ?,
          ai_content_summary = ?,
          ai_mismatch_reason = ?,
          ai_processed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
        )
        .run(
          // Update original WordPress detection based on AI verification
          wpVerified,
          // AI verification fields from actual AI analysis
          wpVerified,
          wpConfidence,
          JSON.stringify(wpIndicators),
          // Content relevance fields
          isRelevant,
          actualCategory,
          contentSummary,
          mismatchReason,
          siteId,
        );
    } finally {
      database.close();
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
   * Sleep utility
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current stats (for API)
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
      pendingCount: this.getPendingCount(),
      pollIntervalMs: POLL_INTERVAL_MS,
      batchSize: BATCH_SIZE,
      aiClient: aiClient.getStats(),
    };
  }
}

// Export singleton
module.exports = new AIProcessor();
