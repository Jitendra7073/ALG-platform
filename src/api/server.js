const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("../database/database.js");
const { chromium } = require("playwright");
const {
  LinkedInCompanyScraper,
} = require("../scrapers/linkedin-company-scraper.js");
const emailRouter = require("../services/email/email-senders-templates-api.js");
const timezoneAwareApi = require("../services/email/timezone-aware-api");
const worker = require("../services/email/email-queue-worker.js");
const aiWorker = require("../services/ai/ai-processor.js"); // Import new AI classification worker
const aiRetryManager = require("../services/ai/ai-retry-manager.js"); // Import AI retry manager
const logger = require("../utils/system-logger.js"); // Import system logger

const app = express();
const PORT = 8080;
const userDataDir = "C:\\automation_chrome";

// Intercept console to capture all logs (before starting workers)
logger.interceptConsole();

// Start background workers (silent - no console spam)
aiWorker.start();
aiRetryManager.start();

// Track executive scraper status
let executiveScraperStatus = { running: false, progress: 0, total: 0 };

// ========== CONTACT EXTRACTION FUNCTIONS ==========

/**
 * Find contact page link
 * @param {Page} page - Playwright page object
 * @param {string} baseUrl - The website URL
 * @returns {string|null} - Contact page URL or null
 */
async function findContactPage(page, baseUrl) {
  try {
    const contactLink = await page.evaluate(() => {
      const contactSelectors = [
        'a[href*="contact"]',
        'a[href*="contact-us"]',
        'a[href*="contactus"]',
        'a[href*="get-in-touch"]',
        'a[href*="about"]',
        'a[href*="team"]',
      ];

      const links = Array.from(document.querySelectorAll("a"));

      // Priority: exact "contact" matches first
      for (const selector of contactSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const text = el.textContent.toLowerCase().trim();
          const href = el.href;
          if (
            href &&
            (text.includes("contact") || text.includes("get in touch"))
          ) {
            return href;
          }
        }
      }

      // Fallback: any link containing "contact"
      for (const link of links) {
        const href = link.href?.toLowerCase();
        if (href && href.includes("contact")) {
          return link.href;
        }
      }

      return null;
    });

    return contactLink;
  } catch (error) {
    console.error(`Error finding contact page: ${error.message}`);
    return null;
  }
}

/**
 * Extract emails from text content
 */
function extractEmails(content) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
  const matches = content.match(emailRegex) || [];

  const falsePositives = [
    /example\.com/i,
    /test\.com/i,
    /localhost/i,
    /127\.0\.0\.1/i,
    /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i,
    /@.*\.(png|jpg|jpeg|gif|svg|ico)$/i,
    /noreply|no-reply|donotreply/i,
    /privacy|terms|legal|abuse/i,
    /postmaster|webmaster/i,
  ];

  const uniqueEmails = [...new Set(matches)]
    .map((email) => email.toLowerCase())
    .filter((email) => !falsePositives.some((pattern) => pattern.test(email)));

  return uniqueEmails;
}

/**
 * Extract phone numbers from text content
 */
function extractPhones(content) {
  const phoneRegexes = [
    /\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    /\+?\d{1,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ];

  const allMatches = [];
  for (const regex of phoneRegexes) {
    const matches = content.match(regex) || [];
    allMatches.push(...matches);
  }

  const falsePositives = [
    /123[-.\s]?\d{3}[-.\s]?\d{4}/,
    /000[-.\s]?\d{3}[-.\s]?\d{4}/,
    /111[-.\s]?\d{3}[-.\s]?\d{4}/,
    /999[-.\s]?\d{3}[-.\s]?\d{4}/,
    /\d{10}/,
  ];

  const uniquePhones = [...new Set(allMatches)]
    .map((phone) => phone.replace(/[^\d+]/g, "").substring(0, 15))
    .filter(
      (phone) =>
        phone.length >= 10 &&
        phone.length <= 15 &&
        !falsePositives.some((pattern) => pattern.test(phone)),
    );

  return uniquePhones;
}

/**
 * Extract LinkedIn profile URLs from content
 * Matches company pages, showcase pages, and personal profiles
 */
function extractLinkedIn(content) {
  const linkedinRegexes = [
    // LinkedIn company pages
    /https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9-]+/gi,
    // LinkedIn showcase pages
    /https?:\/\/(?:www\.)?linkedin\.com\/showcase\/[a-zA-Z0-9-]+/gi,
    // LinkedIn personal profiles (optional - can be enabled if needed)
    // /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9-]+/gi,
    // LinkedIn school/university pages
    /https?:\/\/(?:www\.)?linkedin\.com\/school\/[a-zA-Z0-9-]+/gi,
  ];

  const allMatches = [];
  for (const regex of linkedinRegexes) {
    const matches = content.match(regex) || [];
    allMatches.push(...matches);
  }

  // Clean and dedupe URLs
  const uniqueLinkedIns = [...new Set(allMatches)]
    .map((url) => url.split("?")[0]) // Remove query parameters
    .filter((url) => {
      // Filter out false positives and generic links
      const falsePositives = [
        /linkedin\.com\/\/$/,
        /linkedin\.com\/company\/$/,
      ];
      return !falsePositives.some((pattern) => pattern.test(url));
    });

  return uniqueLinkedIns;
}

// Middleware
app.use(cors());
app.use(express.json());
// Serve static files with cache-busting headers to prevent browser caching
app.use(express.static("public", {
  cacheControl: false,
  etag: false,
  setHeaders: (res, filePath) => {
    // No caching for HTML and JS files - always load fresh
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html' || ext === '.js') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Store running scrapers
const runningScrapers = new Map();

// Import Email API router
const emailApiRouter = require("../services/email/email-senders-templates-api.js");
const linkedinCredentialsRouter = require("../scrapers/linkedin-credentials-api.js");

// Mount email API routes
app.use("/api/email", emailApiRouter);
app.use("/api/email", timezoneAwareApi);

// Mount LinkedIn credentials API routes
app.use("/api/linkedin/credentials", linkedinCredentialsRouter);

// ============ API ROUTES ============

// =====================================================
// EXCLUDED DOMAINS ENDPOINTS
// =====================================================

// Get all excluded domains
app.get("/api/excluded-domains", (req, res) => {
  try {
    const domains = db.getAllExcludedDomains();
    res.json({ success: true, data: domains });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add excluded domain
app.post("/api/excluded-domains", (req, res) => {
  try {
    const { domain, reason } = req.body;
    if (!domain || domain.trim() === "") {
      return res
        .status(400)
        .json({ success: false, error: "Domain is required" });
    }
    const result = db.addExcludedDomain(domain, reason || "");
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message.includes("UNIQUE")) {
      res
        .status(400)
        .json({ success: false, error: "Domain already excluded" });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Update excluded domain
app.put("/api/excluded-domains/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { domain, reason } = req.body;
    if (!domain || domain.trim() === "") {
      return res
        .status(400)
        .json({ success: false, error: "Domain is required" });
    }
    const result = db.updateExcludedDomain(parseInt(id), domain, reason || "");
    if (!result) {
      return res
        .status(404)
        .json({ success: false, error: "Excluded domain not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message.includes("UNIQUE")) {
      res
        .status(400)
        .json({ success: false, error: "Domain already excluded" });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Delete excluded domain
app.delete("/api/excluded-domains/:id", (req, res) => {
  try {
    const { id } = req.params;
    const result = db.deleteExcludedDomain(parseInt(id));
    if (!result) {
      return res
        .status(404)
        .json({ success: false, error: "Excluded domain not found" });
    }
    res.json({ success: true, data: { deleted: result } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// IGNORED TAGS ENDPOINTS
// =====================================================

// Get all ignored tags
app.get("/api/ignored-tags", (req, res) => {
  try {
    const tags = db.getAllIgnoredTags();
    res.json({ success: true, data: tags });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add ignored tag
app.post("/api/ignored-tags", (req, res) => {
  try {
    const { tag, match_type, scope, reason } = req.body;
    if (!tag || tag.trim() === "") {
      return res.status(400).json({ success: false, error: "Tag is required" });
    }

    const result = db.addIgnoredTag(tag, match_type, scope, reason);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message.includes("UNIQUE")) {
      res.status(400).json({ success: false, error: "Tag already exists" });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Update ignored tag
app.put("/api/ignored-tags/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { tag, match_type, scope, reason } = req.body;
    if (!tag || tag.trim() === "") {
      return res.status(400).json({ success: false, error: "Tag is required" });
    }

    const result = db.updateIgnoredTag(
      parseInt(id),
      tag,
      match_type,
      scope,
      reason,
    );
    if (!result) {
      return res.status(404).json({ success: false, error: "Tag not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message.includes("UNIQUE")) {
      res.status(400).json({ success: false, error: "Tag already exists" });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Delete all ignored tags
app.delete("/api/ignored-tags", (req, res) => {
  try {
    const deletedCount = db.deleteAllIgnoredTags();
    res.json({
      success: true,
      message: `Deleted ${deletedCount} ignored tags successfully`,
      count: deletedCount,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete ignored tag
app.delete("/api/ignored-tags/:id", (req, res) => {
  try {
    const { id } = req.params;
    const result = db.deleteIgnoredTag(parseInt(id));
    if (!result) {
      return res.status(404).json({ success: false, error: "Tag not found" });
    }
    res.json({ success: true, message: "Tag deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk delete ignored tags
app.post("/api/ignored-tags-bulk", (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      console.error(" Bulk delete failed: No IDs provided");
      return res
        .status(400)
        .json({ success: false, error: "IDs must be a non-empty array" });
    }
    const deletedCount = db.bulkDeleteIgnoredTags(ids);
    res.json({
      success: true,
      message: `Deleted ${deletedCount} ignored tags successfully`,
      count: deletedCount,
    });
  } catch (error) {
    console.error(" Bulk delete error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all keywords
app.get("/api/keywords", (req, res) => {
  try {
    const keywords = db.getAllKeywords();
    res.json({ success: true, data: keywords });
  } catch (error) {
    console.error("Error fetching keywords:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add keyword
app.post("/api/keywords", (req, res) => {
  try {
    const { keyword, max_sites } = req.body;
    if (!keyword || keyword.trim() === "") {
      return res
        .status(400)
        .json({ success: false, error: "Keyword is required" });
    }
    // Parse max_sites: 0 means unlimited (10000), negative/invalid defaults to 20
    let limit;
    const parsed = parseInt(max_sites);
    if (parsed === 0 || max_sites === "unlimited") {
      limit = 10000; // Unlimited mode
    } else if (parsed > 0) {
      limit = parsed;
    } else {
      limit = 20; // Default
    }
    const result = db.addKeyword(keyword, limit);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message.includes("UNIQUE")) {
      res.status(400).json({ success: false, error: "Keyword already exists" });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Update keyword
app.put("/api/keywords/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { keyword } = req.body;
    if (!keyword || keyword.trim() === "") {
      return res
        .status(400)
        .json({ success: false, error: "Keyword is required" });
    }
    const result = db.updateKeyword(parseInt(id), keyword);
    if (!result) {
      return res
        .status(404)
        .json({ success: false, error: "Keyword not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete keyword
app.delete("/api/keywords/:id", (req, res) => {
  try {
    const { id } = req.params;
    const result = db.deleteKeyword(parseInt(id));
    res.json({ success: true, data: { deleted: result } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get statistics
app.get("/api/stats", (req, res) => {
  try {
    const stats = db.getStatistics();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// AI STATUS ENDPOINTS
// =====================================================

const aiClient = require("../services/ai/ai-client.js");

// Get AI statistics (formatted for UI)
app.get("/api/ai/stats", (req, res) => {
  try {
    const clientStats = aiClient.getStats();
    const processorStats = aiWorker.getStats();

    // Format for UI compatibility
    const stats = {
      availableProviders: clientStats.configured ? 1 : 0,
      totalProviders: 1,
      successRate:
        clientStats.totalRequests > 0
          ? Math.round(
              ((clientStats.totalRequests - clientStats.errors) /
                clientStats.totalRequests) *
                100,
            )
          : 100,
      totalRequests: clientStats.totalRequests,
      totalCost: "0.00", // OpenRouter free tier
      totalTokens: clientStats.totalTokens,
      model: clientStats.model,
      lastRequest: clientStats.lastRequest,
      processor: processorStats,
    };
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get AI providers list
app.get("/api/ai/providers", (req, res) => {
  try {
    const clientStats = aiClient.getStats();
    const providers = [
      {
        name: "OpenRouter",
        model: clientStats.model,
        status: clientStats.configured ? "healthy" : "down",
        enabled: true,
        healthScore: clientStats.configured ? 100 : 0,
        successCount: clientStats.totalRequests - clientStats.errors,
        failureCount: clientStats.errors,
        averageResponseTime: 2000,
        totalCost: "0.00",
        rateLimitRemaining: 60,
      },
    ];
    res.json({ success: true, data: providers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get AI request history
app.get("/api/ai/history", (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const history = aiWorker.getHistory(limit);
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get AI processor stats
app.get("/api/ai/processor/stats", (req, res) => {
  try {
    const stats = aiWorker.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get AI verification breakdown for dashboard
app.get("/api/sites/ai-breakdown", (req, res) => {
  try {
    const database = db.initDatabase();

    const breakdown = database
      .prepare(
        `
      SELECT
        COUNT(CASE WHEN ai_verified_wp = 1 THEN 1 END) as verified,
        COUNT(CASE WHEN ai_verified_wp = 0 THEN 1 END) as not_verified,
        COUNT(CASE WHEN ai_status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN ai_status = 'completed' THEN 1 END) as completed
      FROM sites
      WHERE is_wordpress = 1
    `,
      )
      .get();

    database.close();
    res.json({ success: true, data: breakdown });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get content categories distribution for dashboard
// Requeue WordPress sites for AI verification
// Resets ai_status to 'pending' for sites that need re-verification
app.post("/api/ai/requeue", (req, res) => {
  try {
    const database = db.initDatabase();

    // Option 1: Requeue all sites with ai_verified_wp = null but ai_status = 'completed'
    const requeueIncomplete = database
      .prepare(
        `
      UPDATE sites 
      SET ai_status = 'pending', 
          ai_verified_wp = NULL,
          ai_content_relevant = NULL,
          ai_actual_category = NULL,
          ai_content_summary = NULL,
          ai_mismatch_reason = NULL,
          ai_error = NULL
      WHERE is_wordpress = 1 
        AND ai_status = 'completed' 
        AND ai_verified_wp IS NULL
        AND text_content IS NOT NULL
    `,
      )
      .run();

    database.close();

    const requeued = requeueIncomplete.changes;

    if (requeued > 0) {
      console.log(` Requeued ${requeued} sites for AI re-verification`);
    }

    res.json({
      success: true,
      message: `Requeued ${requeued} sites for AI verification`,
      requeued,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Requeue ALL WordPress sites for fresh AI verification
app.post("/api/ai/requeue-all", (req, res) => {
  try {
    const database = db.initDatabase();

    const result = database
      .prepare(
        `
      UPDATE sites
      SET ai_status = 'pending',
          ai_verified_wp = NULL,
          ai_content_relevant = NULL,
          ai_actual_category = NULL,
          ai_content_summary = NULL,
          ai_mismatch_reason = NULL,
          ai_error = NULL
      WHERE is_wordpress = 1
        AND text_content IS NOT NULL
    `,
      )
      .run();

    database.close();

    const requeued = result.changes;
    console.log(
      ` Requeued ALL ${requeued} WordPress sites for fresh AI verification`,
    );

    res.json({
      success: true,
      message: `Requeued ${requeued} WordPress sites for fresh AI verification`,
      requeued,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// AI RETRY MANAGER ENDPOINTS
// =====================================================

// Get retry manager statistics
app.get("/api/ai/retry/stats", (req, res) => {
  try {
    const stats = aiRetryManager.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manually retry specific sites
app.post("/api/ai/retry/manual", (req, res) => {
  try {
    const { siteIds } = req.body;

    if (!Array.isArray(siteIds) || siteIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "siteIds must be a non-empty array",
      });
    }

    aiRetryManager
      .manualRetry(siteIds)
      .then((requeued) => {
        res.json({
          success: true,
          message: `Re-queued ${requeued} sites for AI processing`,
          requeued,
        });
      })
      .catch((error) => {
        res.status(500).json({ success: false, error: error.message });
      });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get stuck sites details
app.get("/api/ai/retry/stuck-sites", (req, res) => {
  try {
    const database = db.initDatabase();

    // Sites stuck in processing
    const stuckProcessing = database
      .prepare(
        `
      SELECT id, url, search_query, ai_processed_at
      FROM sites
      WHERE ai_status = 'processing'
        AND ai_processed_at < datetime('now', '-5 minutes')
      ORDER BY ai_processed_at ASC
      LIMIT 20
    `,
      )
      .all();

    // Failed sites that can be retried
    const retryableFailed = database
      .prepare(
        `
      SELECT id, url, search_query, ai_error, retry_count, last_retried_at
      FROM sites
      WHERE ai_status = 'failed'
        AND (retry_count IS NULL OR retry_count < 3)
        AND text_content IS NOT NULL
      ORDER BY ai_processed_at ASC
      LIMIT 20
    `,
      )
      .all();

    // Old pending sites
    const oldPending = database
      .prepare(
        `
      SELECT id, url, search_query, checked_at
      FROM sites
      WHERE ai_status = 'pending'
        AND checked_at < datetime('now', '-1 day')
      ORDER BY checked_at ASC
      LIMIT 20
    `,
      )
      .all();

    database.close();

    res.json({
      success: true,
      data: {
        stuckInProcessing: stuckProcessing,
        retryableFailed: retryableFailed,
        oldPending: oldPending,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Trigger immediate retry check
app.post("/api/ai/retry/check-now", (req, res) => {
  try {
    aiRetryManager.checkAndRetryStuckSites();

    res.json({
      success: true,
      message: "Retry check triggered successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// SITE ENDPOINTS
// =====================================================

// Get WordPress sites
app.get("/api/sites/wordpress", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const searchQuery = req.query.search || null;
    const result = db.getSitesByWordpressStatus(true, page, limit, searchQuery);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get non-WordPress sites
app.get("/api/sites/non-wordpress", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const searchQuery = req.query.search || null;
    const result = db.getSitesByWordpressStatus(
      false,
      page,
      limit,
      searchQuery,
    );
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get distinct AI categories
app.get("/api/sites/categories", (req, res) => {
  try {
    const categories = db.getDistinctCategories();
    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all sites with optional search filter and dynamic category filter
app.get("/api/sites/all", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const searchQuery = req.query.search || null;
    const filter = req.query.filter || "all";
    const category = req.query.category || null;
    const result = db.getAllSites(page, limit, searchQuery, filter, category);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single site by ID
app.get("/api/sites/:id", (req, res) => {
  try {
    const { id } = req.params;
    const site = db.getSiteById(parseInt(id));
    if (!site) {
      return res.status(404).json({ success: false, error: "Site not found" });
    }
    res.json({ success: true, data: site });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get scraper status
app.get("/api/scraper/status", (req, res) => {
  const status = Array.from(runningScrapers.entries()).map(
    ([keywordId, data]) => ({
      keywordId,
      keyword: data.keyword,
      status: data.status,
      progress: data.progress,
      total: data.total,
    }),
  );
  res.json({ success: true, data: status });
});

// Start scraping for a single keyword
app.post("/api/scraper/start/:keywordId", async (req, res) => {
  try {
    const { keywordId } = req.params;
    const { country, customCountrySettings } = req.body; // New: optional country and custom settings
    const keyword = db.getKeywordById(parseInt(keywordId));

    if (!keyword) {
      return res
        .status(404)
        .json({ success: false, error: "Keyword not found" });
    }

    if (runningScrapers.has(parseInt(keywordId))) {
      return res.status(400).json({
        success: false,
        error: "Scraper already running for this keyword",
      });
    }

    // Update keyword status to running
    db.updateKeywordStatus(parseInt(keywordId), "running");

    // Start scraper in background
    runScraper(
      parseInt(keywordId),
      keyword.keyword,
      keyword.max_sites,
      country || "in",
      customCountrySettings || null,
    );

    res.json({ success: true, message: "Scraper started" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start scraping for all keywords (sequentially, one by one)
app.post("/api/scraper/start-all", async (req, res) => {
  try {
    const keywords = db.getAllKeywords().filter((k) => k.status !== "running");

    if (keywords.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No keywords available to scrape" });
    }

    // Respond immediately that we're starting
    res.json({
      success: true,
      message: `Started scraping ${keywords.length} keywords one by one`,
    });

    // Run scrapers sequentially (one by one)
    for (const keyword of keywords) {
      if (!runningScrapers.has(keyword.id)) {
        console.log(
          `\n[${keyword.id}] Starting scraper for: ${keyword.keyword}`,
        );
        db.updateKeywordStatus(keyword.id, "running");

        // Wait for this scraper to complete before starting the next
        await runScraper(keyword.id, keyword.keyword, keyword.max_sites);

        console.log(`[${keyword.id}] Completed: ${keyword.keyword}`);
      }
    }

    console.log("\n All scrapers completed!");
  } catch (error) {
    console.error("Error in start-all:", error);
  }
});

// Stop scraper for a single keyword
app.post("/api/scraper/stop/:keywordId", async (req, res) => {
  try {
    const { keywordId } = req.params;

    if (!runningScrapers.has(parseInt(keywordId))) {
      return res
        .status(400)
        .json({ success: false, error: "No scraper running for this keyword" });
    }

    // Remove from running scrapers - the cleanup in runScraper will handle the rest
    runningScrapers.delete(parseInt(keywordId));
    db.updateKeywordStatus(parseInt(keywordId), "pending");

    res.json({ success: true, message: "Scraper stopped" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get search history
app.get("/api/searches", (req, res) => {
  try {
    const searches = db.getAllSearches();
    res.json({ success: true, data: searches });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get search by ID with sites
app.get("/api/searches/:id", (req, res) => {
  try {
    const { id } = req.params;
    const search = db.getSearchById(parseInt(id));
    if (!search) {
      return res
        .status(404)
        .json({ success: false, error: "Search not found" });
    }
    res.json({ success: true, data: search });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export all data to JSON
app.get("/api/export", (req, res) => {
  try {
    const searches = db.getAllSearches();

    const data = searches.map((search) => {
      const searchWithSites = db.getSearchById(search.id);
      return {
        ...search,
        sites: searchWithSites ? searchWithSites.sites : [],
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Comprehensive export - relational data (one record per site)
app.get("/api/export-all", (req, res) => {
  try {
    const database = db.initDatabase();

    // Sites
    const sites = database
      .prepare(
        `
      SELECT id, url, is_wordpress, confidence_score, search_query, checked_at,
             ai_status, ai_verified_wp, ai_content_relevant, ai_actual_category,
             ai_content_summary, ai_mismatch_reason, classification, relevance_score,
             tags, primary_language, value_proposition
      FROM sites ORDER BY id DESC
    `,
      )
      .all();

    // Contacts grouped by site_id
    const allContacts = database
      .prepare(
        `
      SELECT site_id, type, value, source_page FROM contacts ORDER BY id ASC
    `,
      )
      .all();

    // Executives grouped by site_id
    const allExecutives = database
      .prepare(
        `
      SELECT site_id, company_name, name, headline, role_category, profile_url, company_url
      FROM company_executives ORDER BY id ASC
    `,
      )
      .all();

    // Keywords
    const keywords = database
      .prepare(
        `
      SELECT id, keyword, status, max_sites, created_at
      FROM keywords ORDER BY id DESC
    `,
      )
      .all();

    database.close();

    // Group contacts and executives by site_id
    const contactsBySite = {};
    allContacts.forEach((c) => {
      if (!contactsBySite[c.site_id]) contactsBySite[c.site_id] = [];
      contactsBySite[c.site_id].push(c);
    });

    const execsBySite = {};
    allExecutives.forEach((e) => {
      if (!execsBySite[e.site_id]) execsBySite[e.site_id] = [];
      execsBySite[e.site_id].push(e);
    });

    // Build flat records: one per site with related data embedded
    const records = sites.map((site) => {
      const siteContacts = contactsBySite[site.id] || [];
      const siteExecs = execsBySite[site.id] || [];

      return {
        url: site.url,
        is_wordpress: site.is_wordpress,
        confidence_score: site.confidence_score,
        search_query: site.search_query,
        checked_at: site.checked_at,
        ai_verified_wp: site.ai_verified_wp,
        ai_content_relevant: site.ai_content_relevant,
        ai_actual_category: site.ai_actual_category,
        ai_content_summary: site.ai_content_summary,
        emails: siteContacts
          .filter((c) => c.type === "email")
          .map((c) => c.value),
        phones: siteContacts
          .filter((c) => c.type === "phone")
          .map((c) => c.value),
        linkedin_urls: siteContacts
          .filter((c) => c.type === "linkedin")
          .map((c) => c.value),
        executive_names: siteExecs.map((e) => e.name || ""),
        executive_titles: siteExecs.map((e) => e.headline || ""),
        executive_roles: siteExecs.map((e) => e.role_category || ""),
        executive_profiles: siteExecs.map((e) => e.profile_url || ""),
        company_name:
          siteExecs.length > 0 ? siteExecs[0].company_name || "" : "",
      };
    });

    res.json({
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        records,
        keywords,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ SITE API ROUTES ============

// Update site
app.put("/api/sites/:id", (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const result = db.updateSite(parseInt(id), data);
    if (!result) {
      return res.status(404).json({ success: false, error: "Site not found" });
    }
    res.json({ success: true, message: "Site updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get site deletion preview
app.post("/api/sites/deletion-preview", (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No site IDs provided" });
    }
    const preview = db.getSiteDeletionPreview(ids);
    res.json({ success: true, data: preview });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ DELETE ALL DATA ============
// Factory reset - delete everything from all tables
app.delete("/api/delete-all", (req, res) => {
  try {
    const counts = db.deleteAllData();
    console.log("🗑️ All data deleted:", counts);
    res.json({
      success: true,
      message: "All data has been deleted successfully",
      data: counts,
    });
  } catch (error) {
    console.error(" Error deleting all data:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk delete sites (must be before :id route)
app.delete("/api/sites/bulk", (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No site IDs provided" });
    }
    const deletedCount = db.bulkDeleteSites(ids);
    res.json({
      success: true,
      deletedCount,
      message: `Deleted ${deletedCount} site(s)`,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete site
app.delete("/api/sites/:id", (req, res) => {
  try {
    const { id } = req.params;
    const result = db.deleteSite(parseInt(id));
    if (!result) {
      return res.status(404).json({ success: false, error: "Site not found" });
    }
    res.json({ success: true, message: "Site deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ CONTACT API ROUTES ============

// Get contact statistics
app.get("/api/contacts/stats", (req, res) => {
  try {
    const stats = db.getContactStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get emails with pagination
app.get("/api/contacts/emails", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || null;
    const result = db.getEmails(page, limit, search);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single email by ID
app.get("/api/contacts/emails/:id", (req, res) => {
  try {
    const { id } = req.params;
    const email = db.getEmailById(parseInt(id));
    if (!email) {
      return res.status(404).json({ success: false, error: "Email not found" });
    }
    res.json({ success: true, data: email });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get phones with pagination
app.get("/api/contacts/phones", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || null;
    const result = db.getPhones(page, limit, search);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single phone by ID
app.get("/api/contacts/phones/:id", (req, res) => {
  try {
    const { id } = req.params;
    const phone = db.getPhoneById(parseInt(id));
    if (!phone) {
      return res.status(404).json({ success: false, error: "Phone not found" });
    }
    res.json({ success: true, data: phone });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all contacts with filtering
app.get("/api/contacts/all", (req, res) => {
  try {
    const type = req.query.type || "all";
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || null;
    const result = db.getAllContacts(type, page, limit, search);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get LinkedIn profiles with pagination
app.get("/api/contacts/linkedin", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || null;
    const result = db.getLinkedinProfiles(page, limit, search);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single LinkedIn profile by ID
app.get("/api/contacts/linkedin/:id", (req, res) => {
  try {
    const { id } = req.params;
    const linkedin = db.getLinkedinById(parseInt(id));
    if (!linkedin) {
      return res
        .status(404)
        .json({ success: false, error: "LinkedIn profile not found" });
    }
    res.json({ success: true, data: linkedin });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update contact
app.put("/api/contacts/:id", (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    if (!data.value || data.value.trim() === "") {
      return res
        .status(400)
        .json({ success: false, error: "Value is required" });
    }
    const result = db.updateContact(parseInt(id), data);
    if (!result) {
      return res
        .status(404)
        .json({ success: false, error: "Contact not found" });
    }
    res.json({ success: true, message: "Contact updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete contact
app.delete("/api/contacts/:id", (req, res) => {
  try {
    const { id } = req.params;
    const result = db.deleteContact(parseInt(id));
    if (!result) {
      return res
        .status(404)
        .json({ success: false, error: "Contact not found" });
    }
    res.json({ success: true, message: "Contact deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ COMPANY EXECUTIVES ROUTES ============

// Get executives statistics
app.get("/api/executives/stats", (req, res) => {
  try {
    const stats = db.getExecutivesStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get company executives with pagination and filtering
app.get("/api/executives", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || null;
    const role = req.query.role || "all";
    const result = db.getCompanyExecutives(page, limit, search, role);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get structured executives grouped by company (Founder 1,2,3 + CEO + CTO)
app.get("/api/executives/structured", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || null;
    const result = db.getStructuredExecutives(page, limit, search);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update executive
app.put("/api/executives/:id", (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const result = db.updateExecutive(parseInt(id), data);
    if (!result) {
      return res
        .status(404)
        .json({ success: false, error: "Executive not found" });
    }
    res.json({ success: true, message: "Executive updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete executive
app.delete("/api/executives/:id", (req, res) => {
  try {
    const { id } = req.params;
    const result = db.deleteExecutive(parseInt(id));
    if (!result) {
      return res
        .status(404)
        .json({ success: false, error: "Executive not found" });
    }
    res.json({ success: true, message: "Executive deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk delete executives
app.delete("/api/executives/bulk", (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid IDs array" });
    }

    let deletedCount = 0;
    for (const id of ids) {
      const result = db.deleteExecutive(parseInt(id));
      if (result) deletedCount++;
    }

    res.json({ success: true, data: { deleted: deletedCount } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk delete keywords
app.delete("/api/keywords/bulk", (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid IDs array" });
    }

    let deletedCount = 0;
    for (const id of ids) {
      const result = db.deleteKeyword(parseInt(id));
      if (result) deletedCount++;
    }

    res.json({ success: true, data: { deleted: deletedCount } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ EXECUTIVE SCRAPER API ROUTES ============

// Get executive scraper status
app.get("/api/executives/scraper/status", (req, res) => {
  res.json({ success: true, data: executiveScraperStatus });
});

// Manually trigger executive scraping
app.post("/api/executives/scraper/start", async (req, res) => {
  if (executiveScraperStatus.running) {
    return res
      .status(400)
      .json({ success: false, error: "Executive scraper already running" });
  }

  // Start scraping in background
  scrapeExecutives().catch((err) =>
    console.error("[Executive Scraper] Error:", err),
  );

  res.json({ success: true, message: "Executive scraping started" });
});

// ============ SCRAPER FUNCTION ============

/**
 * Scrape executives from all LinkedIn company URLs in database
 */
async function scrapeExecutives() {
  if (executiveScraperStatus.running) {
    console.log("[Executive Scraper] Already running, skipping...");
    return;
  }

  executiveScraperStatus.running = true;
  executiveScraperStatus.progress = 0;
  executiveScraperStatus.total = 0;

  try {
    const database = db.initDatabase();

    // Get all LinkedIn URLs from contacts table, excluding those that already have executives
    const companyUrls = database
      .prepare(
        `
      SELECT DISTINCT
        c.value as linkedin_url,
        c.site_id,
        s.url as site_url
      FROM contacts c
      INNER JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'linkedin'
        AND NOT EXISTS (
          SELECT 1 FROM company_executives ce
          WHERE ce.company_url = c.value
        )
    `,
      )
      .all();

    database.close();

    console.log(
      `\n[Executive Scraper]  Found ${
        companyUrls.length
      } LinkedIn company URLs to process (skipping ${
        companyUrls.length === 0
          ? "all - already scraped!"
          : "companies with existing executives"
      }`,
    );
    executiveScraperStatus.total = companyUrls.length;

    if (companyUrls.length === 0) {
      console.log(
        `[Executive Scraper]  All companies already have executives scraped!`,
      );
      return;
    }

    const scraper = new LinkedInCompanyScraper();
    await scraper.init();

    let executivesFound = 0;
    let executivesSaved = 0;

    for (let i = 0; i < companyUrls.length; i++) {
      const company = companyUrls[i];
      executiveScraperStatus.progress = i + 1;

      console.log(
        `\n[Executive Scraper] [${i + 1}/${companyUrls.length}] Processing: ${
          company.linkedin_url
        }`,
      );

      try {
        const result = await scraper.scrapeCompanyPage(
          company.linkedin_url,
          company.site_id,
        );
        if (result.success) {
          executivesFound += result.executivesFound || 0;
          executivesSaved += result.executivesSaved || 0;
        }
      } catch (err) {
        console.error(
          `[Executive Scraper] Error processing ${company.linkedin_url}:`,
          err.message,
        );
        // Try to reinitialize if context was closed
        if (err.message.includes("closed")) {
          try {
            console.log(
              `[Executive Scraper] Browser was closed, reinitializing...`,
            );
            await scraper.init();
          } catch (initErr) {
            console.error(
              `[Executive Scraper] Failed to reinitialize browser:`,
              initErr.message,
            );
            break;
          }
        }
      }

      // Delay between companies
      if (i < companyUrls.length - 1) {
        const delay = Math.floor(Math.random() * 3000) + 5000; // 5-8 seconds
        try {
          await scraper.page.waitForTimeout(delay);
        } catch (waitErr) {
          console.error(
            `[Executive Scraper] Delay interrupted:`,
            waitErr.message,
          );
        }
      }
    }

    // Only close if scraper is still valid
    try {
      await scraper.close();
    } catch (closeErr) {
      console.log(
        `[Executive Scraper] Browser already closed: ${closeErr.message}`,
      );
    }

    console.log(`\n[Executive Scraper]  SUMMARY:`);
    console.log(`   Companies processed: ${companyUrls.length}`);
    console.log(`   Executives found: ${executivesFound}`);
    console.log(`   Executives saved: ${executivesSaved}`);
  } catch (error) {
    console.error(`[Executive Scraper] Error:`, error);
  } finally {
    executiveScraperStatus.running = false;
  }
}

async function runScraper(
  keywordId,
  keyword,
  maxSites = 20,
  countryCode = "in",
  customCountrySettings = null,
) {
  const scraperData = {
    keyword,
    status: "running",
    progress: 0,
    total: 0,
    country: countryCode,
  };
  runningScrapers.set(keywordId, scraperData);

  // Regional settings mapping
  const regionalSettings = {
    in: {
      gl: "in",
      hl: "en",
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      domain: "google.co.in",
    },
    us: {
      gl: "us",
      hl: "en",
      locale: "en-US",
      timezoneId: "America/New_York",
      domain: "google.com",
    },
    uk: {
      gl: "uk",
      hl: "en",
      locale: "en-GB",
      timezoneId: "Europe/London",
      domain: "google.co.uk",
    },
    ca: {
      gl: "ca",
      hl: "en",
      locale: "en-CA",
      timezoneId: "America/Toronto",
      domain: "google.ca",
    },
    au: {
      gl: "au",
      hl: "en",
      locale: "en-AU",
      timezoneId: "Australia/Sydney",
      domain: "google.com.au",
    },
    de: {
      gl: "de",
      hl: "de",
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
      domain: "google.de",
    },
    fr: {
      gl: "fr",
      hl: "fr",
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
      domain: "google.fr",
    },
    ae: {
      gl: "ae",
      hl: "en",
      locale: "en-AE",
      timezoneId: "Asia/Dubai",
      domain: "google.ae",
    },
    sg: {
      gl: "sg",
      hl: "en",
      locale: "en-SG",
      timezoneId: "Asia/Singapore",
      domain: "google.com.sg",
    },
  };

  // Use custom settings if provided, otherwise use predefined settings, otherwise default to India
  let settings;
  if (customCountrySettings && customCountrySettings.domain) {
    // Custom country settings
    settings = {
      gl: customCountrySettings.gl || countryCode,
      hl: customCountrySettings.hl || "en",
      locale: customCountrySettings.locale || "en-US",
      timezoneId: customCountrySettings.timezoneId || "America/New_York",
      domain: customCountrySettings.domain,
    };
  } else {
    settings =
      regionalSettings[countryCode.toLowerCase()] || regionalSettings["in"];
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath:
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: false, // Must be false for persistent context
    channel: "chrome", // Use actual Chrome browser instead of Chromium
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-infobars",
      "--profile-directory=Default",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-site-isolation-trials",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--start-maximized",
      "--disable-extensions-except=",
      "--disable-plugins-discovery",
      "--disable-default-apps",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-popup-blocking",
    ],
    ignoreDefaultArgs: ["--disable-extensions", "--enable-automation"],
    viewport: { width: 1920, height: 1080 },
    locale: settings.locale,
    timezoneId: settings.timezoneId,
    permissions: ["geolocation"],
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  try {
    const page = await context.newPage();

    // ========== ANTI-DETECTION MEASURES ==========
    // Set realistic user agent
    await page.setExtraHTTPHeaders({
      "Accept-Language": `${settings.locale},en;q=0.9`,
      "Accept-Encoding": "gzip, deflate, br",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Cache-Control": "max-age=0",
    });

    // Inject anti-detection scripts to hide automation
    await page.addInitScript(() => {
      // Hide webdriver property
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });

      // Override navigator plugins
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });

      // Override navigator languages
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });

      // Override platform
      Object.defineProperty(navigator, "platform", {
        get: () => "Win32",
      });

      // Override chrome runtime
      window.chrome = {
        runtime: {},
      };

      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);

      // Remove automation indicators
      delete navigator.__proto__.webdriver;
    });

    // Navigate to Google with regional parameters
    const searchUrl = `https://www.${settings.domain}/search?q=${encodeURIComponent(keyword)}&gl=${settings.gl}&hl=${settings.hl}`;

    console.log(`[Scraper] Navigating to: ${searchUrl}`);

    // ========== ROBUST PAGE LOADING STRATEGY ==========
    // Try multiple approaches to load the page with increasing timeouts
    let pageLoaded = false;
    let loadAttempts = 0;
    const maxLoadAttempts = 3;

    while (!pageLoaded && loadAttempts < maxLoadAttempts) {
      loadAttempts++;
      const timeout = 10000 + loadAttempts * 10000; // 10s, 20s, 30s

      try {
        console.log(
          `[Scraper] Load attempt ${loadAttempts}/${maxLoadAttempts} (timeout: ${timeout}ms)`,
        );

        // Try different wait conditions based on attempt
        const waitConditions = ["commit", "domcontentloaded", "load"];
        const waitCondition =
          waitConditions[loadAttempts - 1] || "domcontentloaded";

        await page.goto(searchUrl, {
          waitUntil: waitCondition,
          timeout: timeout,
        });

        // If we got here, page loaded successfully
        pageLoaded = true;
        console.log(`[Scraper]  Page loaded successfully (${waitCondition})`);
      } catch (error) {
        console.log(
          `[Scraper] ⚠️  Attempt ${loadAttempts} failed: ${error.message}`,
        );

        if (loadAttempts < maxLoadAttempts) {
          console.log(`[Scraper] Retrying...`);

          // Small delay before retry
          await page.waitForTimeout(2000);

          // Try to navigate to Google homepage first as fallback
          if (loadAttempts === 2) {
            try {
              console.log(
                `[Scraper] Trying alternative approach: Navigate to Google homepage first...`,
              );
              await page.goto(`https://www.${settings.domain}/`, {
                waitUntil: "domcontentloaded",
                timeout: 10000,
              });
              await page.waitForTimeout(1000);

              // Now try typing the search query
              const searchBox = await page.$(
                'textarea[name="q"], input[name="q"]',
              );
              if (searchBox) {
                await page.waitForTimeout(Math.random() * 1000 + 500);
                await searchBox.fill(keyword);
                await page.waitForTimeout(Math.random() * 500 + 200);
                await searchBox.press("Enter");

                // Wait for search results
                await page.waitForSelector("div#search", { timeout: 15000 });
                pageLoaded = true;
                console.log(
                  `[Scraper]  Search completed via alternative approach`,
                );
                continue;
              }
            } catch (fallbackError) {
              console.log(
                `[Scraper] Alternative approach also failed: ${fallbackError.message}`,
              );
            }
          }
        } else {
          // Final attempt failed - throw the error
          throw new Error(
            `Failed to load page after ${maxLoadAttempts} attempts. Last error: ${error.message}`,
          );
        }
      }
    }

    // Additional wait to ensure page is fully settled
    await page.waitForTimeout(1500);

    // ========== EARLY CAPTCHA DETECTION ==========
    // Check for CAPTCHA immediately after page load
    let captchaDetected = false;

    // Validate page context before attempting operations
    try {
      if (!page || page.isClosed()) {
        throw new Error("Page is closed or context was destroyed");
      }

      const captchaSelectors = [
        'form[action*="captcha"]',
        'iframe[src*="captcha"]',
        'div[class*="captcha"]',
        '[id*="captcha"]',
        'textarea[name="captcha"]',
      ];

      for (const selector of captchaSelectors) {
        // Check if page is still valid before each query
        if (page.isClosed()) {
          throw new Error("Page context destroyed during CAPTCHA detection");
        }
        const captcha = await page.$(selector);
        if (captcha) {
          captchaDetected = true;
          break;
        }
      }

      // Also check for CAPTCHA in page text
      if (!captchaDetected) {
        if (page.isClosed()) {
          throw new Error("Page context destroyed before text evaluation");
        }
        const pageText = await page.evaluate(() => document.body.innerText);
        if (
          pageText.toLowerCase().includes("captcha") ||
          pageText.toLowerCase().includes("verify you are human") ||
          pageText.toLowerCase().includes("unusual traffic")
        ) {
          captchaDetected = true;
        }
      }
    } catch (error) {
      // If context was destroyed, check if page is still accessible
      if (error.message.includes("context") || error.message.includes("closed")) {
        console.log("[Scraper] ⚠️  Page context destroyed, attempting to continue...");
        // Don't throw - continue without CAPTCHA detection if page is unstable
        captchaDetected = false;
      } else {
        // Re-throw other errors
        throw error;
      }
    }

    if (captchaDetected) {
      console.log(
        "[Scraper] ⚠️  CAPTCHA detected! Please solve it in the browser window.",
      );
      console.log(
        "[Scraper] Waiting for you to solve the CAPTCHA (max 60 seconds)...",
      );

      // Wait for CAPTCHA to be solved (check every 2 seconds, max 60 seconds)
      let captchaSolved = false;
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(2000);

        // Validate page context before checking CAPTCHA status
        if (page.isClosed()) {
          throw new Error("Page context destroyed while waiting for CAPTCHA to be solved");
        }

        // Check if CAPTCHA is gone
        const stillHasCaptcha = await page.evaluate(() => {
          const captchaElements = document.querySelectorAll(
            'form[action*="captcha"], iframe[src*="captcha"], [class*="captcha"], [id*="captcha"]',
          );
          const text = document.body.innerText.toLowerCase();
          return (
            captchaElements.length > 0 ||
            text.includes("captcha") ||
            text.includes("verify you are human")
          );
        });

        if (!stillHasCaptcha) {
          captchaSolved = true;
          console.log("[Scraper]  CAPTCHA solved! Continuing...");
          break;
        }

        console.log(
          `[Scraper] Still waiting for CAPTCHA... (${(i + 1) * 2}s elapsed)`,
        );
      }

      if (!captchaSolved) {
        throw new Error(
          "CAPTCHA not solved within 60 seconds. Please try again later.",
        );
      }
    }

    // Accept cookies if needed
    try {
      if (!page.isClosed()) {
        const acceptButton = await page.$(
          'button:has-text("Accept all"), button:has-text("I agree")',
        );
        if (acceptButton) {
          await acceptButton.click();
          await page.waitForTimeout(1000);
        }
      }
    } catch (e) {
      // Silently ignore cookie acceptance failures - not critical
      if (e.message.includes("context") || e.message.includes("closed")) {
        console.log("[Scraper] ⚠️  Page context destroyed during cookie acceptance, continuing...");
      }
    }

    // Check if we're already on search results page (from alternative approach)
    // Validate page is still accessible before proceeding
    if (page.isClosed()) {
      throw new Error("Page context destroyed before URL check");
    }
    const currentUrl = page.url();
    const isSearchResultsPage =
      currentUrl.includes("/search?") && currentUrl.includes("q=");

    // Only type search query if not already on search results
    if (!isSearchResultsPage) {
      // Check context stability before each operation
      if (page.isClosed()) {
        throw new Error("Page context destroyed before search box lookup");
      }

      const searchBox = await page.$('textarea[name="q"], input[name="q"]');
      if (searchBox) {
        // Random delay to appear more human
        await page.waitForTimeout(Math.random() * 1000 + 500);

        // Type with random delays between characters
        await searchBox.fill(keyword);
        await page.waitForTimeout(Math.random() * 500 + 200);
        await searchBox.press("Enter");

        // Wait for search results with error handling
        try {
          await page.waitForSelector("div#search", { timeout: 15000 });

          // Scroll down to load more results naturally
          await page.evaluate(() => {
            window.scrollBy(0, window.innerHeight);
          });
          await page.waitForTimeout(1000);
        } catch (e) {
          if (e.message.includes("context") || e.message.includes("closed")) {
            throw new Error("Page context destroyed during search results wait");
          }
          // Continue even if scroll fails
          console.log("[Scraper] ⚠️  Could not wait for search results div:", e.message);
        }
      } else {
        console.log(
          "[Scraper] ⚠️  Search box not found, may already be on results page",
        );
      }
    } else {
      console.log(
        "[Scraper]  Already on search results page, skipping search box",
      );
    }

    // Wait for search results to be loaded
    try {
      if (page.isClosed()) {
        throw new Error("Page context destroyed before results wait");
      }
      await page.waitForSelector("div#search", { timeout: 5000 });
    } catch (e) {
      console.log(
        "[Scraper] ⚠️  Search results div not found, page may not have loaded properly",
      );
    }

    // Scroll down to load more results naturally
    try {
      if (!page.isClosed()) {
        await page.evaluate(() => {
          window.scrollBy(0, window.innerHeight);
        });
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      if (e.message.includes("context") || e.message.includes("closed")) {
        throw new Error("Page context destroyed during scroll operation");
      }
      console.log("[Scraper] ⚠️  Could not scroll page:", e.message);
    }

    // Extract URLs from multiple pages
    const urls = [];
    const seenUrls = new Set();
    const seenDomains = new Set(); // Track unique domains
    let pageNum = 0;

    // Calculate how many Google pages to turn (assume ~10 results per page, cap at 10 pages)
    // Increased cap to ensure we get enough sites AFTER filtering
    const maxPages = Math.min(Math.ceil(maxSites / 5) + 2, 10);

    // Keep fetching pages until we have enough URLs (before filtering)
    // We'll apply the maxSites limit AFTER filtering out domains/tags
    while (pageNum < maxPages && urls.length < maxSites * 1.5) {
      console.log(`[Scraper] Scraping Google page ${pageNum + 1}...`);

      // Extract URLs from current page
      let pageUrls = [];
      try {
        pageUrls = await page.evaluate(() => {
          const results = [];
          const links = document.querySelectorAll("div#search a[href]");

          for (const link of links) {
            const href = link.getAttribute("href");
            if (
              href &&
              !href.includes("google.") &&
              !href.startsWith("#") &&
              !href.startsWith("/url?q=")
            ) {
              if (href.startsWith("http")) {
                const urlWithoutHash = href.split("#")[0];
                results.push(urlWithoutHash);
              }
            }
          }
          return results;
        });
      } catch (e) {
        console.log(
          `[Scraper] ⚠️  Could not extract URLs from page: ${e.message}`,
        );
        console.log(`[Scraper] Trying alternative URL extraction...`);

        // Try alternative approach - just get all links
        try {
          pageUrls = await page.evaluate(() => {
            const results = [];
            const links = document.querySelectorAll("a[href]");

            for (const link of links) {
              const href = link.getAttribute("href");
              if (
                href &&
                href.startsWith("http") &&
                !href.includes("google.") &&
                !href.includes("facebook.") &&
                !href.includes("twitter.") &&
                !href.includes("linkedin.")
              ) {
                results.push(href.split("#")[0]);
              }
            }
            return results;
          });
        } catch (e2) {
          console.log(
            `[Scraper]  Alternative URL extraction also failed: ${e2.message}`,
          );
          break; // Exit the while loop if we can't extract URLs
        }
      }

      // Add new URLs with domain-level uniqueness
      for (const url of pageUrls) {
        try {
          const domain = new URL(url).hostname
            .replace(/^www\./, "")
            .toLowerCase();

          if (!seenUrls.has(url) && !seenDomains.has(domain)) {
            seenUrls.add(url);
            seenDomains.add(domain);
            urls.push(url);
          } else if (seenDomains.has(domain)) {
            // Optional: log or track skipped duplicates for debugging
            // console.log(`[Scraper] Skipping duplicate domain: ${domain} (${url})`);
          }
        } catch (e) {
          // Invalid URL, skip
        }
      }

      console.log(
        `[Scraper] Page ${pageNum + 1}: Found ${
          pageUrls.length
        } URLs (Collected: ${urls.length} unique domains)`,
      );

      // If we got very few results, wait a bit (Google might be rate limiting)
      if (pageUrls.length < 5 && pageNum === 0) {
        console.log(
          `[Scraper] ⚠️  Low result count. Google might be rate limiting. Waiting 5 seconds...`,
        );
        await page.waitForTimeout(5000);
      }

      // Check if there's a "Next" button or More results link
      const nextButton = await page.$(
        'a#pnnext, a[aria-label="Next"], a[aria-label="More results"]',
      );

      if (!nextButton || pageNum >= maxPages - 1) {
        console.log(`[Scraper] No more pages available or reached max pages`);
        break;
      }

      // Click next button with random delay
      try {
        await page.waitForTimeout(Math.random() * 2000 + 1000); // Random delay 1-3 seconds
        await nextButton.click();
        await page.waitForTimeout(2000); // Wait for page to load

        // Scroll a bit to appear human
        await page.evaluate(() => {
          window.scrollBy(0, 200);
        });

        await page
          .waitForSelector("div#search", { timeout: 15000 })
          .catch(() => {
            console.log(`[Scraper] Page loaded (no explicit #search element)`);
          });
        pageNum++;
      } catch (e) {
        console.log(`[Scraper] Could not navigate to next page: ${e.message}`);
        break;
      }
    }

    // Filter out URLs that already exist in the database
    const existingUrls = db.getAllExistingUrls();

    // Track duplicates for logging
    const duplicates = [];
    let newUrls = urls.filter((url) => {
      const normalized = db.normalizeUrl(url);
      if (existingUrls.has(normalized)) {
        duplicates.push(url);
        return false;
      }
      return true;
    });

    // Filter out URLs from excluded domains
    const excludedDomains = db.getAllExcludedDomains().map((d) => d.domain);
    let domainExcludedCount = 0;
    if (excludedDomains.length > 0) {
      const domainExcluded = [];
      newUrls = newUrls.filter((url) => {
        if (db.isUrlExcluded(url, excludedDomains)) {
          domainExcluded.push(url);
          return false;
        }
        return true;
      });
      domainExcludedCount = domainExcluded.length;
      if (domainExcluded.length > 0) {
        console.log(
          `[Scraper] ⛔ Excluded ${domainExcluded.length} URLs (blocked domains):`,
        );
        domainExcluded.forEach((u) => console.log(`  ⛔ ${u}`));
      }
    }

    // Filter out URLs with ignored tags
    const ignoredTags = db.getAllIgnoredTags();
    let tagIgnoredCount = 0;
    if (ignoredTags.length > 0) {
      const tagIgnored = [];
      newUrls = newUrls.filter((url) => {
        if (db.isUrlIgnored(url, ignoredTags)) {
          tagIgnored.push(url);
          return false;
        }
        return true;
      });
      tagIgnoredCount = tagIgnored.length;
      if (tagIgnored.length > 0) {
        console.log(
          `[Scraper] 🏷️  Ignored ${tagIgnored.length} URLs (blocked tags):`,
        );
        tagIgnored.forEach((u) => console.log(`  🏷️  ${u}`));
      }
    }

    //  Apply maxSites limit AFTER all filtering (domains + tags + duplicates)
    // This ensures we always scrape maxSites sites, even after exclusions
    if (newUrls.length > maxSites) {
      const before = newUrls.length;
      newUrls = newUrls.slice(0, maxSites);
      console.log(
        `[Scraper]  Limited to ${maxSites} sites (had ${before} after filtering)`,
      );
    }

    console.log(
      `[Scraper] Found ${urls.length} URLs from Google, ${newUrls.length} after filtering (${duplicates.length} duplicates, ${domainExcludedCount} excluded domains, ${tagIgnoredCount} ignored tags)`,
    );
    if (duplicates.length > 0) {
      console.log(
        `[Scraper] Skipped duplicates:`,
        duplicates.slice(0, 5).join(", ") +
          (duplicates.length > 5 ? "..." : ""),
      );
    }

    scraperData.total = newUrls.length;

    // Check each site with proper logging
    const results = [];
    console.log(
      `\n[Scraper] Starting WordPress detection for ${newUrls.length} sites...`,
    );
    for (let i = 0; i < newUrls.length; i++) {
      scraperData.progress = i + 1;
      console.log(
        `\n================================================================================`,
      );
      console.log(
        `[Scraper] [${i + 1}/${newUrls.length}] Checking: ${newUrls[i]}`,
      );
      const result = await checkWordPress(page, newUrls[i]);
      results.push(result);
    }

    // Save to database
    db.saveSearchResults(keyword, results, countryCode);

    // Update keyword status
    db.updateKeywordStatus(keywordId, "completed");
    scraperData.status = "completed";

    // Automatically trigger executive scraping
    console.log(
      `\n[Scraper]  Main scraping completed. Starting executive scraping...`,
    );
    setTimeout(() => {
      scrapeExecutives().catch((err) =>
        console.error("[Scraper] Executive scraping error:", err),
      );
    }, 2000); // Start after 2 seconds
  } catch (error) {
    console.error(`Scraper error for keyword ${keyword}:`, error);
    db.updateKeywordStatus(keywordId, "error");
    scraperData.status = "error";
  } finally {
    await context.close();
    runningScrapers.delete(keywordId);
  }
}

/**
 * Wappalyzer-style WordPress detection with advanced confidence scoring
 * Implements multi-layered detection similar to Wappalyzer methodology
 */
async function checkWordPress(page, url) {
  const result = {
    url,
    isWordPress: false,
    confidenceScore: 0,
    confidenceLevel: "LOW",
    indicators: [],
    emails: [],
    phones: [],
    linkedin_profiles: [],
  };

  // Clean URL - remove hash fragment and trailing slash
  let cleanUrl = url.split("#")[0].replace(/\/$/, "");

  // Skip non-HTML resources
  const skipExtensions = [
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".mp4",
    ".mp3",
    ".zip",
    ".xml",
  ];
  if (skipExtensions.some((ext) => cleanUrl.toLowerCase().endsWith(ext))) {
    result.error = "Skipped: Non-HTML resource";
    return result;
  }

  // Wappalyzer-style confidence thresholds
  const CONFIDENCE_THRESHOLDS = {
    IMMEDIATE: 8, // Instant WordPress detection
    HIGH: 6, // Very confident
    MEDIUM: 4, // Moderately confident
    LOW: 2, // Some evidence
    MINIMUM: 5, // Current threshold for positive detection
  };

  // Helper function to add indicator with confidence score
  const addIndicator = (name, score, category = "DETECTION") => {
    result.indicators.push({
      name,
      score,
      category,
      timestamp: new Date().toISOString(),
    });
    result.confidenceScore += score;
  };

  // Helper function to calculate confidence level
  const calculateConfidenceLevel = () => {
    const totalScore = result.confidenceScore;
    const strongEvidence = result.indicators.filter((i) => i.score >= 4).length;
    const multipleEvidence = result.indicators.length >= 3;

    // Immediate detection for very strong evidence
    if (strongEvidence >= 2 || totalScore >= CONFIDENCE_THRESHOLDS.IMMEDIATE) {
      return "IMMEDIATE";
    }

    // High confidence with multiple strong indicators
    if (
      strongEvidence >= 1 &&
      multipleEvidence &&
      totalScore >= CONFIDENCE_THRESHOLDS.HIGH
    ) {
      return "HIGH";
    }

    // Medium confidence
    if (totalScore >= CONFIDENCE_THRESHOLDS.MEDIUM) {
      return "MEDIUM";
    }

    return "LOW";
  };

  // URL path check - only MEDIUM confidence (not immediate detection)
  const urlWordPressPatterns = [
    { pattern: /\/wp-content\//i, score: 2 },
    { pattern: /\/wp-includes\//i, score: 2 },
    { pattern: /\/wp-admin\//i, score: 2 },
    { pattern: /\/wp-json\//i, score: 1 },
    { pattern: /\/wp-login\.php/i, score: 2 },
  ];

  for (const { pattern, score } of urlWordPressPatterns) {
    if (pattern.test(cleanUrl)) {
      addIndicator(`WordPress path in URL (${pattern.source})`, score);
      break; // Only count URL path once
    }
  }

  try {
    // ========== CHECK 1: robots.txt (WEAK indicator - can be copied) ==========
    try {
      const robotsUrl = new URL("/robots.txt", cleanUrl).href;
      const robotsResponse = await page.goto(robotsUrl, {
        waitUntil: "domcontentloaded",
        timeout: 5000,
      });
      if (robotsResponse && robotsResponse.status() === 200) {
        const robotsContent = await robotsResponse.text();
        // More specific patterns - require disallow directives
        if (
          /Disallow:\s*\/wp-admin/i.test(robotsContent) ||
          /Disallow:\s*\/wp-includes/i.test(robotsContent) ||
          /Disallow:\s*\/wp-content/i.test(robotsContent)
        ) {
          addIndicator("WordPress paths in robots.txt", 1);
        }
      }
    } catch (e) {
      // robots.txt check failed, continue with other checks
    }

    // ========== CHECK 2: /wp-json endpoint with proper validation (STRONG) ==========
    try {
      const wpJsonUrl = new URL("/wp-json", cleanUrl).href;
      const wpJsonResponse = await page.goto(wpJsonUrl, {
        waitUntil: "domcontentloaded",
        timeout: 5000,
      });
      if (wpJsonResponse) {
        const contentType = wpJsonResponse.headers()["content-type"] || "";
        if (
          wpJsonResponse.status() === 200 &&
          contentType.includes("application/json")
        ) {
          try {
            const jsonContent = await wpJsonResponse.json();
            // Validate it's actual WordPress REST API structure
            if (
              jsonContent &&
              jsonContent.name &&
              jsonContent.url &&
              jsonContent.routes
            ) {
              addIndicator("WordPress REST API endpoint (validated)", 4);
            } else if (
              jsonContent &&
              jsonContent.description &&
              typeof jsonContent.routes === "object"
            ) {
              addIndicator("WordPress REST API endpoint (partial)", 2);
            }
          } catch (e) {
            // Can't parse JSON - might not be WordPress
            // Just having /wp-json return 200 is weak indicator
            addIndicator("WordPress REST API endpoint (unvalidated)", 1);
          }
        }
      }
    } catch (e) {
      // wp-json check failed, continue
    }

    // Navigate to the site
    const response = await page.goto(cleanUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    if (!response) {
      return result;
    }

    // ========== CHECK 3: Server Headers (MEDIUM - can be faked) ==========
    const headers = response.headers();
    const server = headers["server"] || "";
    const poweredBy = headers["x-powered-by"] || "";

    // More specific WordPress hosting signatures
    if (/wp-engine/i.test(server)) {
      addIndicator(`WP Engine hosting (${server})`, 3);
    } else if (/kinsta|pagely/i.test(server)) {
      addIndicator(`WordPress hosting (${server})`, 2);
    } else if (/flywheel/i.test(server)) {
      addIndicator(`Flywheel hosting (${server})`, 2);
    }

    // Check for REST API in Link header (STRONG)
    if (headers["link"] && headers["link"].includes("wp-json")) {
      addIndicator("WordPress REST API in Link header", 3);
    }

    // Check content type - skip non-HTML
    const contentType = headers["content-type"] || "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      result.error = `Skipped: Non-HTML content type (${contentType})`;
      return result;
    }

    // Get the page HTML
    const content = await page.content();

    // ========== CHECK 4: JavaScript Runtime Detection (Wappalyzer-style) ==========
    try {
      const jsIndicators = await detectWordPressRuntime(page);
      jsIndicators.forEach((indicator) => {
        addIndicator(indicator.name, indicator.score, "JAVASCRIPT");
      });
    } catch (e) {
      // JavaScript detection failed, continue with other checks
    }

    // ========== CHECK 5: DOM Structure Detection (Wappalyzer-style) ==========
    try {
      const domIndicators = await detectWordPressDOM(page);
      domIndicators.forEach((indicator) => {
        addIndicator(indicator.name, indicator.score, "DOM");
      });
    } catch (e) {
      // DOM detection failed, continue with other checks
    }

    // ========== CHECK 6: Network Request Monitoring (Wappalyzer-style) ==========
    try {
      const networkIndicators = await detectWordPressNetworkRequests(page);
      networkIndicators.forEach((indicator) => {
        addIndicator(indicator.name, indicator.score, "NETWORK");
      });
    } catch (e) {
      // Network monitoring failed, continue with other checks
    }

    // ========== CHECK 7: WordPress Cookies (WEAK - third-party cookies) ==========
    const cookies = await page.context().cookies();
    let foundWordPressCookie = false;
    for (const cookie of cookies) {
      // Only count first-party cookies (same domain)
      if (
        cookie.domain &&
        (cookie.domain.includes("wordpress") ||
          cookie.name === "wp-settings-time" ||
          cookie.name.startsWith("wordpress_logged_in_") ||
          cookie.name.startsWith("wp_"))
      ) {
        // Check it's for the current domain, not third-party
        const cookieDomain = cookie.domain.replace(/^\./, "");
        const urlDomain = new URL(cleanUrl).hostname;
        if (
          urlDomain.endsWith(cookieDomain) ||
          cookieDomain.endsWith(urlDomain)
        ) {
          addIndicator(`WordPress cookie (${cookie.name})`, 1);
          foundWordPressCookie = true;
          break; // Only count once
        }
      }
    }

    // ========== CHECK 8: HTML Content Indicators (Wappalyzer-style) ==========
    // Each indicator has specific patterns and confidence scores

    const wordpressIndicators = [
      // STRONG indicators (3-4 points)
      {
        name: "WordPress meta generator tag",
        score: 4,
        check: () =>
          /<meta\s+name=["']generator["']\s+content=["']WordPress\s+\d/i.test(
            content,
          ),
      },
      {
        name: "WordPress REST API discovery link",
        score: 3,
        check: () => /rel=["']https:\/\/api\.w\.org\/["']/i.test(content),
      },
      {
        name: "WordPress oEmbed discovery",
        score: 3,
        check: () =>
          /rel=["']alternate["']\s+type=["']application\/json\+oembed\+embed["']/i.test(
            content,
          ) ||
          /rel=["']alternate["']\s+type=["']application\/json\+oembed["']/i.test(
            content,
          ),
      },
      {
        name: "WordPress Gutenberg blocks",
        score: 3,
        check: () =>
          /class=["']wp-block-|has-medium-font-size|has-large-font-size|is-layout-constrained|is-layout-flow["']/i.test(
            content,
          ),
      },
      {
        name: "wp-emoji-release.min.js",
        score: 3,
        check: () => /wp-emoji-release\.min\.js/i.test(content),
      },

      // MEDIUM indicators (2 points)
      {
        name: "wp-includes in source",
        score: 2,
        check: () => /\/wp-includes\//i.test(content),
      },
      {
        name: "wp-content in source",
        score: 2,
        check: () => /\/wp-content\//i.test(content),
      },
      {
        name: "WordPress admin link",
        score: 2,
        check: () => /href=["'][^"']*\/wp-admin\//i.test(content),
      },
      {
        name: "WordPress inline scripts",
        score: 2,
        check: () => /wp-embed\.min\.js|wp-util\.js|wp-i18n\.js/i.test(content),
      },
      {
        name: "WordPress RSS feeds",
        score: 2,
        check: () =>
          /href=["'][^"']*\/feed\/\?["']/i.test(content) ||
          /type=["']application\/rss\+xml["']/i.test(content),
      },
      {
        name: "Classic WordPress theme classes",
        score: 2,
        check: () =>
          /wp-caption\s+align|wp-post-image|gallery-item|wp-gallery/i.test(
            content,
          ),
      },
      {
        name: "wlwmanifest.xml link",
        score: 2,
        check: () => /href=["'][^"']*wlwmanifest\.xml["']/i.test(content),
      },

      // WEAK indicators (1 point)
      {
        name: "WordPress shortlink",
        score: 1,
        check: () =>
          /rel=["']shortlink["']/i.test(content) ||
          /href=["']\?p=\d+["']/i.test(content),
      },
      {
        name: "Generic wp- patterns",
        score: 1,
        check: () =>
          /wp-|wordpress/i.test(content) &&
          !/<iframe|<object|embed|third-party/i.test(content),
      },
    ];

    // Check each indicator and add score
    for (const indicator of wordpressIndicators) {
      if (indicator.check()) {
        addIndicator(indicator.name, indicator.score);
      }
    }

    // Negative patterns - subtract confidence if found
    const negativePatterns = [
      {
        name: "Explicitly NOT WordPress",
        pattern:
          /powered by (joomla|drupal|magento|shopify|squarespace|wix|blogger|tumblr)/i,
        penalty: 10,
      },
      {
        name: "Generator tag shows different CMS",
        pattern:
          /<meta\s+name=["']generator["']\s+content=["'](?!WordPress)([^"']+)/i,
        penalty: 8,
      },
      {
        name: "Static site generator",
        pattern: /static|gatsby|next\.js|nuxt|vuepress|hugo|jekyll/i,
        penalty: 5,
      },
    ];

    for (const { name, pattern, penalty } of negativePatterns) {
      if (pattern.test(content)) {
        result.indicators.push(`NEGATIVE: ${name}`);
        result.confidenceScore -= penalty;
      }
    }

    // Final determination based on enhanced confidence scoring
    result.confidenceLevel = calculateConfidenceLevel();
    result.isWordPress =
      result.confidenceScore >= CONFIDENCE_THRESHOLDS.MINIMUM;

    // ========== CONTACT EXTRACTION (ONLY FOR WORDPRESS SITES) ==========
    if (result.isWordPress) {
      console.log(
        `      ✓ WordPress detected (score: ${result.confidenceScore}) - extracting contacts & text...`,
      );

      // Extract text content for AI processing
      try {
        const pageText = await page.evaluate(() => {
          // Remove scripts and styles before getting text
          const scripts = document.querySelectorAll("script, style, noscript");
          scripts.forEach((s) => s.remove());

          return document.body.innerText || document.body.textContent || "";
        });

        // Clean up text and limit to ~3000 chars to save tokens
        result.text_content = pageText
          .replace(/[\r\n\t]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 3000);
      } catch (e) {
        console.log(`      ⚠️  Could not extract text content: ${e.message}`);
      }

      const allEmails = new Set();
      const allPhones = new Set();
      const allLinkedIns = new Set();

      // Extract from homepage
      const homepageEmails = extractEmails(content);
      const homepagePhones = extractPhones(content);
      const homepageLinkedIns = extractLinkedIn(content);

      homepageEmails.forEach((email) => allEmails.add(email));
      homepagePhones.forEach((phone) => allPhones.add(phone));
      homepageLinkedIns.forEach((linkedin) => allLinkedIns.add(linkedin));

      // Find and visit contact page for more contacts
      const contactUrl = await findContactPage(page, cleanUrl);
      if (contactUrl && contactUrl !== cleanUrl) {
        console.log(`      → Visiting contact page: ${contactUrl}`);
        try {
          const contactResponse = await page.goto(contactUrl, {
            waitUntil: "domcontentloaded",
            timeout: 10000,
          });

          if (contactResponse) {
            const contactContent = await page.content();

            const contactEmails = extractEmails(contactContent);
            const contactPhones = extractPhones(contactContent);
            const contactLinkedIns = extractLinkedIn(contactContent);

            contactEmails.forEach((email) => allEmails.add(email));
            contactPhones.forEach((phone) => allPhones.add(phone));
            contactLinkedIns.forEach((linkedin) => allLinkedIns.add(linkedin));
          }
        } catch (e) {
          console.log(`      ⚠️  Could not load contact page: ${e.message}`);
        }
      }

      result.emails = Array.from(allEmails);
      result.phones = Array.from(allPhones);
      result.linkedin_profiles = Array.from(allLinkedIns);

      if (
        result.emails.length > 0 ||
        result.phones.length > 0 ||
        result.linkedin_profiles.length > 0
      ) {
        console.log(
          `       Found ${result.emails.length} emails, ${result.phones.length} phones, ${result.linkedin_profiles.length} LinkedIn profiles`,
        );
      }
    } else {
      if (result.confidenceScore > 0) {
        console.log(
          `      ✗ Not WordPress (score: ${result.confidenceScore}/${CONFIDENCE_THRESHOLDS.MINIMUM}) - insufficient confidence`,
        );
      } else {
        console.log(
          `      ✗ Not WordPress (score: 0) - no specific indicators found`,
        );
      }
    }
  } catch (error) {
    result.error = error.message;
    // Don't log every timeout error since many sites blocking headless browsers will timeout
    if (!error.message.includes("Timeout")) {
      console.log(`      ⚠️  Check failed: ${error.message}`);
    }
  }

  return result;
}

/**
 * Wappalyzer-style JavaScript runtime detection for WordPress
 * Checks for global JavaScript variables and objects exposed by WordPress
 * @param {Page} page - Playwright page object
 * @returns {Promise<Array>} - Array of detected JavaScript indicators
 */
async function detectWordPressRuntime(page) {
  const jsIndicators = [];

  try {
    // Check for WordPress global objects and variables
    const jsChecks = [
      {
        name: "WordPress global object (window.wp)",
        check: () => page.evaluate(() => typeof window.wp !== "undefined"),
        score: 4,
      },
      {
        name: "WordPress jQuery",
        check: () =>
          page.evaluate(
            () =>
              typeof window.jQuery !== "undefined" && window.jQuery.fn.jquery,
          ),
        score: 3,
      },
      {
        name: "WordPress REST API settings",
        check: () =>
          page.evaluate(() => typeof window.wpApiSettings !== "undefined"),
        score: 3,
      },
      {
        name: "WordPress admin bar",
        check: () =>
          page.evaluate(() => document.getElementById("wpadminbar") !== null),
        score: 2,
      },
      {
        name: "WordPress localized scripts",
        check: () =>
          page.evaluate(
            () =>
              typeof window.wp_json !== "undefined" ||
              typeof window.wpApiSettings !== "undefined",
          ),
        score: 3,
      },
      {
        name: "WordPress nonce",
        check: () =>
          page.evaluate(
            () =>
              document.querySelector("[data-wp-nonce]") !== null ||
              document.querySelector('input[name="_wpnonce"]') !== null,
          ),
        score: 2,
      },
      {
        name: "WordPress comment form",
        check: () =>
          page.evaluate(() => document.querySelector("#commentform") !== null),
        score: 1,
      },
      {
        name: "WordPress shortcodes",
        check: () =>
          page.evaluate(
            () => document.querySelector("[data-wp-shortcode]") !== null,
          ),
        score: 2,
      },
    ];

    // Execute all JavaScript checks in parallel for better performance
    const results = await Promise.all(
      jsChecks.map(async (check) => {
        try {
          const detected = await check.check();
          return detected ? { name: check.name, score: check.score } : null;
        } catch (e) {
          return null;
        }
      }),
    );

    // Filter out null results and add to indicators
    results.forEach((result) => {
      if (result) {
        jsIndicators.push(result);
      }
    });
  } catch (error) {
    console.log(`  ⚠️  JavaScript detection failed: ${error.message}`);
  }

  return jsIndicators;
}

/**
 * Wappalyzer-style DOM structure detection for WordPress
 * Checks for specific DOM patterns and structures unique to WordPress
 * @param {Page} page - Playwright page object
 * @returns {Promise<Array>} - Array of detected DOM indicators
 */
async function detectWordPressDOM(page) {
  const domIndicators = [];

  try {
    const domChecks = [
      {
        name: "Gutenberg blocks",
        check: () =>
          page.evaluate(() => document.querySelector(".wp-block-") !== null),
        score: 3,
      },
      {
        name: "WordPress shortcodes",
        check: () =>
          page.evaluate(
            () => document.querySelector("[data-wp-shortcode]") !== null,
          ),
        score: 2,
      },
      {
        name: "WordPress nonce",
        check: () =>
          page.evaluate(
            () => document.querySelector("[data-wp-nonce]") !== null,
          ),
        score: 2,
      },
      {
        name: "WordPress comment form",
        check: () =>
          page.evaluate(() => document.querySelector("#commentform") !== null),
        score: 1,
      },
      {
        name: "WordPress gallery",
        check: () =>
          page.evaluate(() => document.querySelector(".gallery-item") !== null),
        score: 2,
      },
      {
        name: "WordPress caption",
        check: () =>
          page.evaluate(() => document.querySelector(".wp-caption") !== null),
        score: 1,
      },
    ];

    // Execute all DOM checks in parallel
    const results = await Promise.all(
      domChecks.map(async (check) => {
        try {
          const detected = await check.check();
          return detected ? { name: check.name, score: check.score } : null;
        } catch (e) {
          return null;
        }
      }),
    );

    // Filter out null results and add to indicators
    results.forEach((result) => {
      if (result) {
        domIndicators.push(result);
      }
    });
  } catch (error) {
    console.log(`  ⚠️  DOM detection failed: ${error.message}`);
  }

  return domIndicators;
}

/**
 * Wappalyzer-style network request monitoring for WordPress
 * Monitors outgoing network requests for WordPress-specific patterns
 * @param {Page} page - Playwright page object
 * @returns {Promise<Array>} - Array of detected network indicators
 */
async function detectWordPressNetworkRequests(page) {
  const networkIndicators = [];
  let networkMonitoringActive = false;

  try {
    // Start monitoring network requests
    page.on("response", (response) => {
      if (!networkMonitoringActive) return;

      const url = response.url();
      const status = response.status();

      if (url.includes("/wp-admin/admin-ajax.php") && status === 200) {
        networkIndicators.push({ name: "WordPress AJAX endpoint", score: 3 });
      }

      if (url.includes("/wp-json/") && status === 200) {
        networkIndicators.push({ name: "WordPress REST API call", score: 4 });
      }

      if (url.includes("/wp-content/uploads/") && status === 200) {
        networkIndicators.push({ name: "WordPress media request", score: 2 });
      }
    });

    // Activate monitoring
    networkMonitoringActive = true;

    // Wait for page to load and network to settle
    await page.waitForLoadState("networkidle", { timeout: 10000 });

    // Deactivate monitoring after a short delay
    setTimeout(() => {
      networkMonitoringActive = false;
    }, 2000);
  } catch (error) {
    if (!error.message.includes("Timeout")) {
      // Don't log timeouts as they're common and expected on many sites
      console.log(`  ⚠️  Network monitoring error: ${error.message}`);
    }
  }

  return networkIndicators;
}

/**
 * Wappalyzer-style advanced cookie analysis for WordPress
 * Analyzes cookies for WordPress-specific patterns and signatures
 * @param {Page} page - Playwright page object
 * @returns {Promise<Array>} - Array of detected cookie indicators
 */
async function detectWordPressCookies(page) {
  const cookieIndicators = [];

  try {
    const cookies = await page.context().cookies();

    const wordpressCookiePatterns = [
      {
        pattern: /^wordpress_logged_in_/,
        name: "WordPress login cookie",
        score: 3,
      },
      { pattern: /^wp-settings-/, name: "WordPress settings cookie", score: 2 },
      { pattern: /^wp-postpass_/, name: "WordPress password cookie", score: 2 },
      {
        pattern: /^comment_author_/,
        name: "WordPress comment cookie",
        score: 1,
      },
      { pattern: /^wp_/, name: "WordPress generic cookie", score: 1 },
    ];

    for (const cookie of cookies) {
      for (const pattern of wordpressCookiePatterns) {
        if (pattern.pattern.test(cookie.name)) {
          cookieIndicators.push({
            name: pattern.name,
            score: pattern.score,
            cookie: cookie.name,
          });
          break; // Only count each cookie once
        }
      }
    }
  } catch (error) {
    console.log(`  ⚠️  Cookie analysis failed: ${error.message}`);
  }

  return cookieIndicators;
}

// Mount email system routes (already mounted above)
// app.use("/api/email", emailRouter);

// Start email queue worker
worker.start();

// Serve frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =====================================================
// SYSTEM LOGS ENDPOINTS
// =====================================================

// Get recent logs
app.get("/api/logs", (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const type = req.query.type || "all";
    const search = req.query.search || null;

    const logs = logger.getFormattedLogs(limit, type, search);

    res.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get log statistics
app.get("/api/logs/stats", (req, res) => {
  try {
    const stats = logger.getStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get recent activity
app.get("/api/logs/recent", (req, res) => {
  try {
    const minutes = parseInt(req.query.minutes) || 5;
    const activity = logger.getRecentActivity(minutes);

    res.json({
      success: true,
      data: activity,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear logs
app.post("/api/logs/clear", (req, res) => {
  try {
    logger.clear();

    res.json({
      success: true,
      message: "Logs cleared successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export logs
app.get("/api/logs/export", (req, res) => {
  try {
    const logs = logger.export();

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=system-logs.json",
    );
    res.send(logs);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get log types info
app.get("/api/logs/types", (req, res) => {
  try {
    const types = logger.logTypes;

    res.json({
      success: true,
      data: types,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  // Clear any previous console output
  console.clear();

  // Get worker statuses
  const aiStats = aiWorker.getStats();
  const retryStats = aiRetryManager.getStats();

  // Build the startup display
  console.log('\n' + '─'.repeat(50));
  console.log('         LEAD GENERATION SYSTEM');
  console.log('─'.repeat(50));

  // Database status
  console.log('\n  ✓ Database Connected');

  // Worker status checklist
  console.log('\n  WORKERS:');
  console.log('  ┌────────────────────────────────────────────┐');
  console.log('  │  AI Processor        ' + (aiStats.isRunning ? '✓ Active' : '✗ Inactive') + '                │');
  console.log('  │  AI Retry Manager    ' + (retryStats.isRunning ? '✓ Active' : '✗ Inactive') + '                │');
  console.log('  │  Email Queue Worker  ✓ Active                │');
  console.log('  └────────────────────────────────────────────┘');

  // Stats table
  console.log('\n  STATISTICS:');
  console.log('  ┌──────────────────────┬──────────────────┐');
  console.log('  │  Pending Sites       │  ' + String(aiStats.pendingCount || 0).padStart(14) + ' │');
  console.log('  │  Processed Today     │  ' + String(aiStats.totalProcessed || 0).padStart(14) + ' │');
  console.log('  │  AI Model            │  ' + String(aiStats.aiClient?.model || 'N/A').substring(0, 14).padStart(14) + ' │');
  console.log('  └──────────────────────┴──────────────────┘');

  console.log('\n  🌐 Admin Panel: http://localhost:' + PORT);
  console.log('─'.repeat(50) + '\n');
});
