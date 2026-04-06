/**
 * Email Senders & Templates API
 *
 * REFACTORED: Now uses PostgreSQL adapter with async/await
 *
 * Provides API endpoints for:
 * - Email sender account management
 * - Email template management
 * - Email campaign management
 * - Email queue control
 * - Template variable replacement
 */

const express = require("express");
const router = express.Router();
const db = require("../../database/database.js");
const aiClient = require("../ai/ai-client");
const aiWorker = require("../ai/ai-processor");
const timezoneScheduler = require("./timezone-scheduler");
const emailQueueWorker = require("./email-queue-worker.js");

// ============================================
// DATABASE TABLES SETUP
// ============================================

/**
 * Initialize database tables for email system
 * REFACTORED: Now async
 */
async function initializeEmailTables() {
  try {
    // Email Senders Table
    await db.run(`
      CREATE TABLE IF NOT EXISTS email_senders (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        service TEXT DEFAULT 'gmail',
        smtp_host TEXT,
        smtp_port INTEGER,
        smtp_user TEXT,
        daily_limit INTEGER DEFAULT 500,
        is_active INTEGER DEFAULT 1,
        sent_today INTEGER DEFAULT 0,
        last_reset_date TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: Add smtp_user column if not exists
    try {
      const columnExists = await db.get(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'email_senders' AND column_name = 'smtp_user'
      `);
      if (!columnExists) {
        await db.run("ALTER TABLE email_senders ADD COLUMN smtp_user TEXT");
        console.log(" Added smtp_user column to email_senders table");
      }
    } catch (e) {
      // Column already exists or migration failed
    }

    // Email Templates Table
    await db.run(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        html_content TEXT NOT NULL,
        text_content TEXT,
        description TEXT,
        category TEXT DEFAULT 'general',
        is_active INTEGER DEFAULT 1,
        tags TEXT DEFAULT '',
        sequence_number INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Email Campaigns Table
    await db.run(`
      CREATE TABLE IF NOT EXISTS email_campaigns (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        template_id INTEGER,
        target_type TEXT DEFAULT 'all',
        status TEXT DEFAULT 'queued',
        total_recipients INTEGER DEFAULT 0,
        sent_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES email_templates(id)
      )
    `);

    // Email Queue Table
    await db.run(`
      CREATE TABLE IF NOT EXISTS email_queue (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER,
        sender_id INTEGER,
        contact_id INTEGER,
        recipient_email TEXT NOT NULL,
        recipient_name TEXT,
        subject TEXT NOT NULL,
        html_content TEXT NOT NULL,
        text_content TEXT,
        status TEXT DEFAULT 'queued',
        attempts INTEGER DEFAULT 0,
        error_message TEXT,
        sent_at TIMESTAMP,
        scheduled_at TIMESTAMP,
        tag TEXT,
        sequence_position INTEGER,
        country_code TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id),
        FOREIGN KEY (sender_id) REFERENCES email_senders(id)
      )
    `);

    // Migrate email_queue to include columns if missing
    try {
      const columnExists = await db.get(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'email_queue' AND column_name = 'scheduled_at'
      `);
      if (!columnExists) {
        await db.run("ALTER TABLE email_queue ADD COLUMN scheduled_at TIMESTAMP");
        console.log(" Added scheduled_at column to email_queue table");
      }
    } catch (e) {
      console.warn("⚠️ Could not check/add scheduled_at column", e);
    }

    // Add missing columns for email_queue
    const queueColumns = [
      { name: 'contact_id', type: 'INTEGER' },
      { name: 'tag', type: 'TEXT' },
      { name: 'sequence_position', type: 'INTEGER' },
      { name: 'country_code', type: 'TEXT' },
    ];

    for (const col of queueColumns) {
      try {
        const exists = await db.get(`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'email_queue' AND column_name = '${col.name}'
        `);
        if (!exists) {
          await db.run(`ALTER TABLE email_queue ADD COLUMN ${col.name} ${col.type}`);
          console.log(` Added ${col.name} column to email_queue table`);
        }
      } catch (e) {
        // Column already exists
      }
    }

    // Email Settings Table (key-value store for configurable intervals)
    await db.run(`
      CREATE TABLE IF NOT EXISTS email_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        label TEXT,
        description TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Email Send Log Table (tracks what was sent to each contact)
    await db.run(`
      CREATE TABLE IF NOT EXISTS email_send_log (
        id SERIAL PRIMARY KEY,
        contact_id INTEGER NOT NULL,
        contact_email TEXT NOT NULL,
        template_id INTEGER,
        campaign_id INTEGER,
        send_type TEXT DEFAULT 'main',
        status TEXT DEFAULT 'sent',
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (contact_id) REFERENCES contacts(id),
        FOREIGN KEY (template_id) REFERENCES email_templates(id)
      )
    `);

    // Seed default settings if they don't exist
    const defaults = [
      {
        key: "per_email_delay",
        value: "60",
        label: "Per-Email Delay (seconds)",
        description: "Seconds to wait between sending each email",
      },
      {
        key: "cycle_cooldown_min",
        value: "10",
        label: "Cycle Cooldown Min (minutes)",
        description: "Minimum minutes to wait after a full sender cycle",
      },
      {
        key: "cycle_cooldown_max",
        value: "13",
        label: "Cycle Cooldown Max (minutes)",
        description:
          "Maximum minutes to wait after a full sender cycle (random between min-max)",
      },
      // Follow-up gap settings (days between sequence steps)
      {
        key: "followup_gap_1",
        value: "2",
        label: "Gap before Follow-up 1 (days)",
        description: "Days to wait after main email before sending follow-up 1",
      },
      {
        key: "followup_gap_2",
        value: "5",
        label: "Gap before Follow-up 2 (days)",
        description: "Days to wait after follow-up 1 before sending follow-up 2",
      },
      {
        key: "followup_gap_3",
        value: "5",
        label: "Gap before Follow-up 3 (days)",
        description: "Days to wait after follow-up 2 before sending follow-up 3",
      },
      {
        key: "followup_gap_4",
        value: "5",
        label: "Gap before Follow-up 4 (days)",
        description: "Days to wait after follow-up 3 before sending follow-up 4",
      },
    ];

    for (const s of defaults) {
      await db.run(
        "INSERT INTO email_settings (key, value, label, description) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING",
        [s.key, s.value, s.label, s.description]
      );
    }

    // Add tags column to email_templates if not exists
    try {
      const tagsExists = await db.get(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'email_templates' AND column_name = 'tags'
      `);
      if (!tagsExists) {
        await db.run("ALTER TABLE email_templates ADD COLUMN tags TEXT DEFAULT ''");
      }
    } catch (e) {
      // Column already exists
    }

    // Add sequence_number column if not exists
    try {
      const seqExists = await db.get(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'email_templates' AND column_name = 'sequence_number'
      `);
      if (!seqExists) {
        await db.run("ALTER TABLE email_templates ADD COLUMN sequence_number INTEGER DEFAULT 0");
      }
    } catch (e) {
      // Column already exists
    }

    // Sync follow-up gap settings based on current template counts
    await syncFollowupGapSettings();

    console.log(" Email system tables initialized");
  } catch (error) {
    console.error("Error initializing email tables:", error);
  }
}

/**
 * Get max template count across all tag groups
 * REFACTORED: Now async
 */
async function getMaxSequenceCount() {
  try {
    const templates = await db.all(
      `SELECT tags FROM email_templates WHERE tags IS NOT NULL AND tags != ''`,
    );
    const tagCounts = {};
    templates.forEach((t) => {
      if (t.tags) {
        t.tags.split(",").forEach((tag) => {
          const trimmed = tag.trim();
          if (trimmed) {
            tagCounts[trimmed] = (tagCounts[trimmed] || 0) + 1;
          }
        });
      }
    });
    const counts = Object.values(tagCounts);
    return counts.length > 0 ? Math.max(...counts) : 1;
  } catch (error) {
    console.error("Error getting max sequence count:", error);
    return 1;
  }
}

/**
 * Sync follow-up gap settings in DB to match current max template sequence count.
 * Creates missing gap settings and removes excess ones.
 * REFACTORED: Now async
 */
async function syncFollowupGapSettings() {
  try {
    const maxSeq = await getMaxSequenceCount();
    const neededGaps = Math.max(maxSeq - 1, 0); // N templates need N-1 gaps

    // Insert any missing gap settings
    for (let i = 1; i <= neededGaps; i++) {
      const key = `followup_gap_${i}`;
      const label =
        i === 1
          ? "Gap before Follow-up 1 (days)"
          : `Gap before Follow-up ${i} (days)`;
      const desc =
        i === 1
          ? "Days to wait after main email before sending follow-up 1"
          : `Days to wait after follow-up ${i - 1} before sending follow-up ${i}`;
      await db.run(
        "INSERT INTO email_settings (key, value, label, description) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING",
        [key, i === 1 ? "2" : "5", label, desc]
      );
    }

    // Remove excess gap settings that are beyond current max
    await db.run(
      `DELETE FROM email_settings WHERE key LIKE 'followup_gap_%' AND CAST(REPLACE(key, 'followup_gap_', '') AS INTEGER) > $1`,
      [neededGaps]
    );
  } catch (error) {
    console.error("Error syncing follow-up gap settings:", error);
  }
}

// Export initializeEmailTables function so it can be called after DB pool is ready
router.initializeEmailTables = initializeEmailTables;

// ============================================
// TEMPLATE VARIABLE REPLACEMENT
// ============================================

/**
 * Extract person's name from email address
 * @param {string} email - Email address
 * @returns {string|null} - Extracted name or null if generic email
 */
function extractNameFromEmail(email) {
  if (!email || typeof email !== "string") return null;

  // Get the part before @
  const emailLocal = email.split("@")[0];
  if (!emailLocal) return null;

  // Replace dots and dashes with spaces
  let name = emailLocal
    .replace(/[.-]/g, " ")
    .replace(/_/g, " ") // Also handle underscores
    .trim();

  // Check for generic patterns (no actual person name)
  const genericPatterns = [
    "info",
    "contact",
    "hello",
    "support",
    "admin",
    "sales",
    "enquiry",
    "help",
    "office",
    "team",
    "mail",
    "webmaster",
    "noreply",
    "no-reply",
    "news",
    "jobs",
    "careers",
    "hr",
  ];

  const nameLower = name.toLowerCase().replace(/\s+/g, "");
  if (
    genericPatterns.some(
      (pattern) => nameLower === pattern || nameLower.startsWith(pattern + "."),
    )
  ) {
    return null; // Generic email, no specific person
  }

  // Handle patterns like "first.last" or "first-last"
  const parts = name.split(/\s+/).filter((p) => p.length > 0);

  if (parts.length === 0) return null;

  // Capitalize first letter of each part
  const capitalized = parts
    .map((part) => {
      // Handle common patterns like "mcohen" -> "MCohen" or "mdoe" -> "MDoe"
      if (part.length <= 3 && part.length > 1) {
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");

  return capitalized;
}

/**
 * Extract company name from website content (title/meta tags)
 * @param {string} textContent - Website text content
 * @returns {string|null} - Extracted company name or null
 */
function extractCompanyNameSimple(textContent) {
  if (!textContent) return null;

  try {
    // Look for title tag content
    const titleMatch = textContent.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      let title = titleMatch[1].trim();
      // Remove common suffixes
      title = title
        .replace(
          /\s*[-|]\s*(Home|About|Contact|Welcome|Login|Sign\s+In|Dashboard|Blog|News).*$/i,
          "",
        )
        .replace(/\s*[-|]\s*$/g, "")
        .trim();

      if (title && title.length > 2 && title.length < 100) {
        return title;
      }
    }

    // Look for meta description with company name
    const descMatch = textContent.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
    );
    if (descMatch && descMatch[1]) {
      const desc = descMatch[1].trim();
      // Extract first sentence/capitalized phrase
      const match = desc.match(/^([A-Z][A-Za-z0-9\s&.]{3,50})/);
      if (match) {
        return match[1].trim();
      }
    }

    // Look for h1 tag
    const h1Match = textContent.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (h1Match && h1Match[1]) {
      // Strip HTML tags from h1 content
      const h1Text = h1Match[1].replace(/<[^>]+>/g, "").trim();
      if (h1Text && h1Text.length > 2 && h1Text.length < 80) {
        return h1Text;
      }
    }
  } catch (e) {
    // Extraction failed, return null
  }

  return null;
}

/**
 * Replace template placeholders with actual values
 * @param {string} text - Template text with placeholders
 * @param {Object} data - Data object with values to replace
 * @returns {string} - Text with placeholders replaced
 */
function replaceTemplateVariables(text, data) {
  if (!text) return text;

  let result = text;

  // Convert country code to full name
  const regionFullName = getCountryFullName(data.region);

  // Replace all supported placeholders
  const replacements = {
    "{{name}}": data.name || "there", // Person name from email, fallback to 'there'
    "{{company}}": data.company || "", // Company name (hybrid: LinkedIn > AI > domain)
    "{{email}}": data.email || "", // Email address
    "{{url}}": data.url || "", // Website URL
    "{{domain}}": data.domain || "", // Domain name
    "{{region}}": regionFullName || data.region || "", // Region/country full name
    "{{date}}": new Date().toLocaleDateString(),
    "{{year}}": new Date().getFullYear().toString(),
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.split(placeholder).join(value);
  }

  return result;
}

/**
 * Convert country code to full country name
 * @param {string} code - Country code (e.g., 'in', 'us', 'uk')
 * @returns {string} - Full country name or original code if not found
 */
function getCountryFullName(code) {
  if (!code) return "";

  const countryNames = {
    in: "India",
    us: "United States",
    uk: "United Kingdom",
    ca: "Canada",
    au: "Australia",
    de: "Germany",
    fr: "France",
    ae: "United Arab Emirates",
    sg: "Singapore",
    jp: "Japan",
    br: "Brazil",
    za: "South Africa",
    cn: "China",
    it: "Italy",
    es: "Spain",
    nl: "Netherlands",
    se: "Sweden",
    no: "Norway",
    dk: "Denmark",
    fi: "Finland",
    ch: "Switzerland",
    at: "Austria",
    be: "Belgium",
    pl: "Poland",
    cz: "Czech Republic",
    gr: "Greece",
    pt: "Portugal",
    ru: "Russia",
    mx: "Mexico",
    ar: "Argentina",
    co: "Colombia",
    cl: "Chile",
    pe: "Peru",
    kr: "South Korea",
    tw: "Taiwan",
    th: "Thailand",
    my: "Malaysia",
    id: "Indonesia",
    ph: "Philippines",
    vn: "Vietnam",
    hk: "Hong Kong",
    nz: "New Zealand",
    ie: "Ireland",
    il: "Israel",
    sa: "Saudi Arabia",
    qa: "Qatar",
    kw: "Kuwait",
    tr: "Turkey",
    eg: "Egypt",
    ng: "Nigeria",
    ke: "Kenya",
  };

  return countryNames[code.toLowerCase()] || code;
}

/**
 * Get site data for a contact to use in template replacement
 * Uses hybrid approach for company name: LinkedIn > Page Content > Domain
 * @param {number} siteId - The site ID
 * @param {string} email - Contact email address (for name extraction)
 * @returns {Promise<Object>} - Site data for template replacement
 */
async function getSiteDataForTemplate(siteId, email = null) {
  if (!siteId) return {};

  try {
    const site = await db.get(
      "SELECT url, search_query, text_content, country FROM sites WHERE id = $1",
      [siteId],
    );
    if (!site) return {};

    // Extract domain
    let domain = "";
    try {
      const urlObj = new URL(site.url);
      domain = urlObj.hostname;
    } catch (e) {
      // URL parsing failed
    }

    // HYBRID APPROACH: Get company name
    // Priority 1: LinkedIn company name (from company_executives table)
    let company = null;
    const executiveData = await db.get(
      `
      SELECT company_name
      FROM company_executives
      WHERE site_id = $1
      AND company_name IS NOT NULL
      LIMIT 1
    `,
      [siteId],
    );

    if (executiveData?.company_name) {
      company = executiveData.company_name;
    }

    // Priority 2: Extract from page content (title/meta tags)
    if (!company && site.text_content) {
      company = extractCompanyNameSimple(site.text_content);
    }

    // Priority 3: Fallback to domain-based parsing
    if (!company && domain) {
      company = domain
        .replace(/^www\./, "")
        .replace(
          /\.(com|net|org|io|co|ac|ai|app|dev|info|biz|tech|online|site|website|in|uk|us|ca|au|eu)(\.[a-z]{2})?$/i,
          "",
        )
        .split(".")
        .pop()
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()); // Capitalize first letters
    }

    // Extract person name from email address
    let personName = null;
    if (email) {
      personName = extractNameFromEmail(email);
    }

    return {
      url: site.url,
      domain: domain,
      name: personName, // Person's name (from email) or null
      company: company || "", // Company name (hybrid approach)
      email: email || "", // Email included for convenience
      region: site.country || "", // Region/country for {{region}} variable
    };
  } catch (error) {
    console.error("Error getting site data for template:", error);
    return {};
  }
}

// ============================================
// QUEUE CONTROL ENDPOINTS
// ============================================

/**
 * POST /api/email/queue/trigger
 * Immediately start processing the queue
 */
router.post("/queue/trigger", async (req, res) => {
  try {
    const worker = require("./email-queue-worker");
    const result = worker.triggerNow();
    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/email/queue/pause
 * Pause queue processing
 */
router.post("/queue/pause", async (req, res) => {
  try {
    const worker = require("./email-queue-worker");
    worker.pause();
    res.json({ success: true, message: "Queue paused" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/email/queue/resume
 * Resume queue processing
 */
router.post("/queue/resume", async (req, res) => {
  try {
    const worker = require("./email-queue-worker");
    worker.resume();
    res.json({ success: true, message: "Queue resumed" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/email/queue/schedule
 * Schedule specific queue items to start at a specific date/time
 * Body: { queueIds: [1, 2, 3], dateTime: "2026-02-25T14:00:00" }
 */
router.post("/queue/schedule", async (req, res) => {
  try {
    const { queueIds, dateTime } = req.body;
    if (
      !dateTime ||
      !queueIds ||
      !Array.isArray(queueIds) ||
      queueIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        error: "dateTime and queueIds array are required",
      });
    }

    const placeholders = queueIds.map((_, i) => `$${i + 2}`).join(",");
    const query = `UPDATE email_queue SET scheduled_at = $1 WHERE id IN (${placeholders})`;

    // Scheduled time must be in ISO UTC or whatever format worker compares.
    // We'll store it as ISO string.
    const isoDateTime = new Date(dateTime).toISOString();

    await db.run(query, [isoDateTime, ...queueIds]);

    res.json({
      success: true,
      message: `Scheduled ${queueIds.length} items for ${dateTime}`,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// EMAIL SENDERS CRUD
// ============================================

/**
 * GET /api/email/senders
 * Get all email senders
 */
router.get("/senders", async (req, res) => {
  try {
    const senders = await db.all(`
      SELECT
        id,
        name,
        email,
        service,
        smtp_host,
        smtp_port,
        smtp_user,
        daily_limit,
        is_active,
        sent_today,
        last_reset_date,
        created_at,
        updated_at
      FROM email_senders
      ORDER BY created_at DESC
    `);

    res.json({
      success: true,
      data: senders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/email/senders/:id
 * Get single sender (without password)
 */
router.get("/senders/:id", async (req, res) => {
  try {
    const sender = await db.get(
      `
      SELECT
        id,
        name,
        email,
        service,
        smtp_host,
        smtp_port,
        smtp_user,
        daily_limit,
        is_active,
        sent_today,
        last_reset_date,
        created_at,
        updated_at
      FROM email_senders
      WHERE id = $1
    `,
      [req.params.id],
    );

    if (!sender) {
      return res.status(404).json({
        success: false,
        error: "Sender not found",
      });
    }

    res.json({
      success: true,
      data: sender,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/email/senders
 * Create new email sender
 */
router.post("/senders", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      service = "gmail",
      smtp_host,
      smtp_port,
      smtp_user,
      daily_limit = 500,
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "Name, email, and password are required",
      });
    }

    const result = await db.run(
      `INSERT INTO email_senders (name, email, password, service, smtp_host, smtp_port, smtp_user, daily_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [name, email, password, service, smtp_host || null, smtp_port || null, smtp_user || null, daily_limit]
    );

    const newSender = await db.get(
      `SELECT id, name, email, service, smtp_host, smtp_port, smtp_user, daily_limit, is_active, sent_today, created_at
       FROM email_senders WHERE id = $1`,
      [result.lastInsertId]
    );

    res.json({
      success: true,
      data: newSender,
    });
  } catch (error) {
    // Check for unique constraint violation
    if (error.message.includes("duplicate key") || error.code === '23505') {
      return res.status(400).json({
        success: false,
        error: "Email already exists",
      });
    }
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/email/senders/:id
 * Update email sender
 */
router.put("/senders/:id", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      service,
      smtp_host,
      smtp_port,
      smtp_user,
      daily_limit,
      is_active,
    } = req.body;

    const updates = [];
    const values = [];
    let valueIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${valueIndex++}`);
      values.push(name);
    }
    if (email !== undefined) {
      updates.push(`email = $${valueIndex++}`);
      values.push(email);
    }
    if (password !== undefined) {
      updates.push(`password = $${valueIndex++}`);
      values.push(password);
    }
    if (service !== undefined) {
      updates.push(`service = $${valueIndex++}`);
      values.push(service);
    }
    if (smtp_host !== undefined) {
      updates.push(`smtp_host = $${valueIndex++}`);
      values.push(smtp_host);
    }
    if (smtp_port !== undefined) {
      updates.push(`smtp_port = $${valueIndex++}`);
      values.push(smtp_port);
    }
    if (smtp_user !== undefined) {
      updates.push(`smtp_user = $${valueIndex++}`);
      values.push(smtp_user);
    }
    if (daily_limit !== undefined) {
      updates.push(`daily_limit = $${valueIndex++}`);
      values.push(daily_limit);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${valueIndex++}`);
      values.push(is_active ? 1 : 0);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(req.params.id);

    await db.run(
      `UPDATE email_senders SET ${updates.join(", ")} WHERE id = $${valueIndex}`,
      values
    );

    const updatedSender = await db.get(
      `SELECT id, name, email, service, smtp_host, smtp_port, smtp_user, daily_limit, is_active, sent_today, created_at
       FROM email_senders WHERE id = $1`,
      [req.params.id]
    );

    if (!updatedSender) {
      return res.status(404).json({
        success: false,
        error: "Sender not found",
      });
    }

    res.json({
      success: true,
      data: updatedSender,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/email/senders/:id
 * Delete email sender
 */
router.delete("/senders/:id", async (req, res) => {
  try {
    const result = await db.run(`DELETE FROM email_senders WHERE id = $1`, [req.params.id]);

    if (result.rows === 0) {
      return res.status(404).json({
        success: false,
        error: "Sender not found",
      });
    }

    res.json({
      success: true,
      message: "Sender deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/email/senders/:id/toggle
 * Toggle sender active status
 */
router.post("/senders/:id/toggle", async (req, res) => {
  try {
    const sender = await db.get(
      `SELECT id, is_active FROM email_senders WHERE id = $1`,
      [req.params.id]
    );

    if (!sender) {
      return res.status(404).json({
        success: false,
        error: "Sender not found",
      });
    }

    const newStatus = sender.is_active ? 0 : 1;

    await db.run(
      `UPDATE email_senders SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [newStatus, req.params.id]
    );

    res.json({
      success: true,
      data: { ...sender, is_active: newStatus },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/email/senders/:id/reset
 * Reset daily counter for a sender
 */
router.post("/senders/:id/reset", async (req, res) => {
  try {
    await db.run(
      `UPDATE email_senders SET sent_today = 0, last_reset_date = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [new Date().toDateString(), req.params.id]
    );

    res.json({
      success: true,
      message: "Daily counter reset successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// EMAIL TEMPLATES CRUD
// ============================================

/**
 * GET /api/email/templates
 * Get all email templates
 */
router.get("/templates", async (req, res) => {
  try {
    const templates = await db.all(`
      SELECT * FROM email_templates ORDER BY created_at DESC
    `);

    res.json({
      success: true,
      data: templates,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/email/templates/max-sequence
 * Get the maximum sequence number across all templates
 * IMPORTANT: This route must be defined BEFORE /:id to avoid conflicts
 */
router.get("/templates/max-sequence", async (req, res) => {
  try {
    const result = await db.get(`
      SELECT COALESCE(MAX(sequence_number), 0) as max_sequence
      FROM email_templates
    `);

    res.json({
      success: true,
      data: {
        maxSequence: result.max_sequence
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/email/templates/tags
 * Get all unique tags from templates
 */
router.get("/templates/tags", async (req, res) => {
  try {
    const templates = await db.all(
      `SELECT DISTINCT tags FROM email_templates WHERE tags IS NOT NULL AND tags != ''`
    );

    const allTags = new Set();
    templates.forEach(t => {
      if (t.tags) {
        t.tags.split(',').forEach(tag => {
          const trimmed = tag.trim();
          if (trimmed) allTags.add(trimmed);
        });
      }
    });

    res.json({
      success: true,
      data: Array.from(allTags).sort()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/email/templates/reorder
 * Reorder templates by updating their sequence numbers
 */
router.put("/templates/reorder", async (req, res) => {
  try {
    const { tag, orderedIds } = req.body;

    if (!orderedIds || !Array.isArray(orderedIds)) {
      return res.status(400).json({
        success: false,
        error: "orderedIds array is required",
      });
    }

    // Update sequence_number for each template based on its position in the array
    for (let i = 0; i < orderedIds.length; i++) {
      const templateId = parseInt(orderedIds[i]);
      const sequenceNumber = i + 1; // Start from 1

      await db.run(
        `UPDATE email_templates SET sequence_number = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [sequenceNumber, templateId]
      );
    }

    res.json({
      success: true,
      message: `Reordered ${orderedIds.length} templates successfully`,
    });
  } catch (error) {
    console.error("Template reorder error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/email/templates/:id
 * Get single template
 */
router.get("/templates/:id", async (req, res) => {
  try {
    const template = await db.get(
      `SELECT * FROM email_templates WHERE id = $1`,
      [req.params.id]
    );

    if (!template) {
      return res.status(404).json({
        success: false,
        error: "Template not found",
      });
    }

    res.json({
      success: true,
      data: template,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/email/templates
 * Create new email template
 */
router.post("/templates", async (req, res) => {
  try {
    const {
      name,
      subject,
      html_content,
      text_content,
      description,
      category = "general",
      tags = "",
      sequence_number = 0,
    } = req.body;

    if (!name || !subject) {
      return res.status(400).json({
        success: false,
        error: "Name and subject are required",
      });
    }

    // At least one content type is required
    if (!html_content && !text_content) {
      return res.status(400).json({
        success: false,
        error: "Either HTML content or plain text content is required",
      });
    }

    // If only text_content is provided, create basic HTML
    let finalHtmlContent = html_content;
    let finalTextContent = text_content;
    if (!html_content && text_content) {
      // Convert plain text to basic HTML
      finalHtmlContent = `<!DOCTYPE html>
<html>
<body>
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    ${text_content.split('\n').map(line => `<p style="margin: 0 0 10px 0;">${line || '&nbsp;'}</p>`).join('')}
  </div>
</body>
</html>`;
    }

    const result = await db.run(
      `INSERT INTO email_templates (name, subject, html_content, text_content, description, category, tags, sequence_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [name, subject, finalHtmlContent, finalTextContent || null, description || null, category, tags, sequence_number]
    );

    const newTemplate = await db.get(
      `SELECT * FROM email_templates WHERE id = $1`,
      [result.lastInsertId]
    );

    res.json({
      success: true,
      data: newTemplate,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/email/templates/:id
 * Update email template
 */
router.put("/templates/:id", async (req, res) => {
  try {
    const {
      name,
      subject,
      html_content,
      text_content,
      description,
      category,
      tags,
      is_active,
      sequence_number,
    } = req.body;

    const updates = [];
    const values = [];
    let valueIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${valueIndex++}`);
      values.push(name);
    }
    if (subject !== undefined) {
      updates.push(`subject = $${valueIndex++}`);
      values.push(subject);
    }
    if (html_content !== undefined) {
      updates.push(`html_content = $${valueIndex++}`);
      values.push(html_content);
    }
    if (text_content !== undefined) {
      updates.push(`text_content = $${valueIndex++}`);
      values.push(text_content);
    }
    if (description !== undefined) {
      updates.push(`description = $${valueIndex++}`);
      values.push(description);
    }
    if (category !== undefined) {
      updates.push(`category = $${valueIndex++}`);
      values.push(category);
    }
    if (tags !== undefined) {
      updates.push(`tags = $${valueIndex++}`);
      values.push(tags);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${valueIndex++}`);
      values.push(is_active ? 1 : 0);
    }
    if (sequence_number !== undefined) {
      updates.push(`sequence_number = $${valueIndex++}`);
      values.push(sequence_number);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(req.params.id);

    await db.run(
      `UPDATE email_templates SET ${updates.join(", ")} WHERE id = $${valueIndex}`,
      values
    );

    const updatedTemplate = await db.get(
      `SELECT * FROM email_templates WHERE id = $1`,
      [req.params.id]
    );

    if (!updatedTemplate) {
      return res.status(404).json({
        success: false,
        error: "Template not found",
      });
    }

    res.json({
      success: true,
      data: updatedTemplate,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/email/templates/:id
 * Delete email template
 */
router.delete("/templates/:id", async (req, res) => {
  try {
    const result = await db.run(`DELETE FROM email_templates WHERE id = $1`, [req.params.id]);

    if (result.rows === 0) {
      return res.status(404).json({
        success: false,
        error: "Template not found",
      });
    }

    res.json({
      success: true,
      message: "Template deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/email/templates/by-tag/:tag
 * Get templates by tag
 */
router.get("/templates/by-tag/:tag", async (req, res) => {
  try {
    const tag = req.params.tag;
    const templates = await db.all(
      `SELECT * FROM email_templates WHERE tags LIKE $1 ORDER BY sequence_number, created_at ASC`,
      [`%${tag}%`]
    );

    res.json({
      success: true,
      data: templates,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/email/templates/ai/generate
 * Generate email template with AI
 */
router.post("/templates/ai/generate", async (req, res) => {
  try {
    const { description, category = "general" } = req.body;

    // Validate input
    if (!description || description.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Description is required",
      });
    }

    // Check if AI client is initialized
    if (!aiClient) {
      console.error('[AI] AI client not initialized');
      return res.status(500).json({
        success: false,
        error: "AI client not initialized. Please check OPENROUTER_API_KEY in .env",
        details: "Make sure OPENROUTER_API_KEY is set in .env file"
      });
    }

    // Log request
    console.log(`[AI] Generating email template with description: ${description.substring(0, 100)}...`);

    // Get max sequence number for naming
    const maxSeqResult = await db.get(
      `SELECT COALESCE(MAX(sequence_number), 0) as max_seq FROM email_templates`
    );
    const nextSequence = (maxSeqResult?.max_seq || 0) + 1;

    // Build AI prompt for template generation
    const prompt = `You are an email marketing expert. Generate a professional email template based on the following description:

Description: ${description}
Category: ${category}

Requirements:
1. Create a compelling, concise email subject line (under 50 characters)
2. Generate professional HTML email content with proper formatting
3. Include a plain text version
4. Use personalization variables: {{name}}, {{company}}, {{email}}, {{url}}, {{domain}}, {{region}}, {{sender_name}}, {{receiver_name}}
5. Keep the tone professional but engaging
6. Include a clear call-to-action
7. Use responsive HTML design with inline styles

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
  "name": "Template ${category} ${nextSequence}",
  "subject": "Your subject line here",
  "html_content": "<html>...</html>",
  "text_content": "Plain text version here"
}`;

    const response = await aiClient.chatJSON(
      `You are an email marketing expert. Generate email templates in JSON format.`,
      prompt,
      { temperature: 0.7 }
    );

    // Validate response with detailed error messages
    if (!response) {
      console.error('[AI] Client returned null response');
      return res.status(500).json({
        success: false,
        error: "AI client returned empty response. Please check your API key and try again.",
        details: "Make sure OPENROUTER_API_KEY is set in .env file"
      });
    }

    if (!response.subject || typeof response.subject !== 'string') {
      console.error('[AI] Response missing or invalid subject:', response);
      return res.status(500).json({
        success: false,
        error: "AI response missing valid subject line. Please try again.",
        details: "AI response: " + JSON.stringify(response).substring(0, 200)
      });
    }

    if (!response.html_content || typeof response.html_content !== 'string') {
      console.error('[AI] Response missing or invalid html_content:', response);
      return res.status(500).json({
        success: false,
        error: "AI response missing valid HTML content. Please try again.",
        details: "AI response: " + JSON.stringify(response).substring(0, 200)
      });
    }

    // Log success
    console.log(`[AI] ✓ Generated email template: ${response.subject}`);

    res.json({
      success: true,
      data: {
        name: response.name || `${category} Template ${nextSequence}`,
        subject: response.subject,
        html_content: response.html_content,
        text_content: response.text_content || "",
      },
    });
  } catch (error) {
    // Log full error for debugging
    console.error('[AI] Template generation failed:', {
      error: error.message,
      stack: error.stack,
      description: req.body.description?.substring(0, 100)
    });

    // Check for specific error types
    if (error.message.includes('API key')) {
      return res.status(500).json({
        success: false,
        error: "Invalid or missing OpenRouter API key",
        details: "Please check OPENROUTER_API_KEY in your .env file"
      });
    }

    if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      return res.status(500).json({
        success: false,
        error: "AI request timed out. Please try again.",
        details: "The AI service is taking too long to respond. Try a shorter description."
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to generate template: " + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/email/templates/ai/refine
 * Refine existing email template with AI
 */
router.post("/templates/ai/refine", async (req, res) => {
  try {
    const { subject, html_content, instruction } = req.body;

    if (!instruction || instruction.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Instruction is required",
      });
    }

    if ((!subject && !html_content) || (subject === "" && html_content === "")) {
      return res.status(400).json({
        success: false,
        error: "Either subject or html_content must be provided",
      });
    }

    // Build AI prompt for refinement
    const prompt = `You are an email marketing expert. Refine the following email template based on the user's instruction.

Current Subject: ${subject || "(none)"}
Current HTML Content: ${html_content || "(none)"}

User Instruction: ${instruction}

Requirements:
1. Apply the user's instruction to improve the email
2. Keep the personalization variables: {{name}}, {{company}}, {{email}}, {{url}}, {{domain}}, {{region}}, {{sender_name}}, {{receiver_name}}
3. Maintain professional tone and clear call-to-action
4. Keep HTML responsive with inline styles
5. If no changes needed to a field, return the original value

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
  "subject": "Refined subject line",
  "html_content": "Refined HTML content",
  "text_content": "Corresponding plain text version"
}`;

    const response = await aiClient.chatJSON(
      `You are an email marketing expert. Refine email templates in JSON format.`,
      prompt,
      { temperature: 0.7 }
    );

    res.json({
      success: true,
      data: {
        subject: response?.subject || subject,
        html_content: response?.html_content || html_content,
        text_content: response?.text_content || "",
      },
    });
  } catch (error) {
    console.error("AI template refinement error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "AI refinement failed. Please check your API key and try again.",
    });
  }
});

// ============================================
// EMAIL CAMPAIGNS
// ============================================

/**
 * GET /api/email/campaigns
 * Get all email campaigns
 */
router.get("/campaigns", async (req, res) => {
  try {
    const campaigns = await db.all(`
      SELECT c.*,
        (SELECT COUNT(*) FROM email_queue WHERE campaign_id = c.id AND status = 'queued') as queued_count,
        (SELECT COUNT(*) FROM email_queue WHERE campaign_id = c.id AND status = 'sent') as sent_count,
        (SELECT COUNT(*) FROM email_queue WHERE campaign_id = c.id AND status = 'failed') as failed_count
      FROM email_campaigns c
      ORDER BY c.created_at DESC
    `);

    res.json({
      success: true,
      data: campaigns,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/email/campaigns/:id
 * Get single campaign with details
 */
router.get("/campaigns/:id", async (req, res) => {
  try {
    const campaign = await db.get(
      `SELECT * FROM email_campaigns WHERE id = $1`,
      [req.params.id]
    );

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: "Campaign not found",
      });
    }

    // Get queued emails for this campaign
    const queuedEmails = await db.all(
      `SELECT * FROM email_queue WHERE campaign_id = $1 AND status = 'queued' ORDER BY created_at ASC LIMIT 10`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        ...campaign,
        queued_emails: queuedEmails,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/email/campaigns
 * Create new email campaign
 */
router.post("/campaigns", async (req, res) => {
  try {
    const {
      name,
      template_id,
      target_type = "all",
      target_ids = [],
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    // Create campaign
    const result = await db.run(
      `INSERT INTO email_campaigns (name, template_id, target_type, status)
       VALUES ($1, $2, $3, 'queued') RETURNING id`,
      [name, template_id || null, target_type]
    );

    const campaignId = result.lastInsertId;

    // Queue emails based on target
    let queuedCount = 0;

    if (target_type === "all" || target_type === "wordpress") {
      // Get all WordPress sites with contacts
      const sites = await db.all(`
        SELECT DISTINCT s.id, s.url, s.country
        FROM sites s
        INNER JOIN contacts c ON c.site_id = s.id
        WHERE s.is_wordpress = 1
        ORDER BY s.id ASC
      `);

      for (const site of sites) {
        // Get emails for this site
        const contacts = await db.all(
          `SELECT * FROM contacts WHERE site_id = $1 AND type = 'email'`,
          [site.id]
        );

        for (const contact of contacts) {
          await queueEmailForCampaign(campaignId, contact, site, template_id);
          queuedCount++;
        }
      }
    } else if (target_type === "sites" && Array.isArray(target_ids)) {
      // Queue for specific sites
      for (const siteId of target_ids) {
        const site = await db.get(`SELECT id, url, country FROM sites WHERE id = $1`, [siteId]);
        if (site) {
          const contacts = await db.all(
            `SELECT * FROM contacts WHERE site_id = $1 AND type = 'email'`,
            [siteId]
          );

          for (const contact of contacts) {
            await queueEmailForCampaign(campaignId, contact, site, template_id);
            queuedCount++;
          }
        }
      }
    } else if (target_type === "contacts" && Array.isArray(target_ids)) {
      // Queue for specific contacts
      for (const contactId of target_ids) {
        const contact = await db.get(
          `SELECT c.*, s.country FROM contacts c LEFT JOIN sites s ON c.site_id = s.id WHERE c.id = $1`,
          [contactId]
        );
        if (contact && contact.type === 'email') {
          const site = await db.get(`SELECT id, url FROM sites WHERE id = $1`, [contact.site_id]);
          await queueEmailForCampaign(campaignId, contact, site, template_id);
          queuedCount++;
        }
      }
    }

    // Update campaign with recipient count
    await db.run(
      `UPDATE email_campaigns SET total_recipients = $1 WHERE id = $2`,
      [queuedCount, campaignId]
    );

    res.json({
      success: true,
      data: {
        id: campaignId,
        name,
        total_recipients: queuedCount,
        status: "queued",
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Helper function to queue an email for a campaign
 */
/**
 * Queue a single email for a campaign
 * FIXED: Now includes text_content field and proper status initialization
 */
async function queueEmailForCampaign(campaignId, contact, site, templateId) {
  try {
    let subject = "Hello from {{company}}";
    let htmlContent = "<p>Hello {{name}},</p><p>This is a test email.</p>";
    let textContent = "Hello {{name}},\n\nThis is a test email.";

    if (templateId) {
      const template = await db.get(
        `SELECT subject, html_content, text_content FROM email_templates WHERE id = $1`,
        [templateId]
      );
      if (template) {
        subject = template.subject;
        htmlContent = template.html_content;
        textContent = template.text_content || textContent;
      }
    }

    // Get site data for template replacement
    const siteData = await getSiteDataForTemplate(site.id, contact.value);

    // Replace variables
    const finalSubject = replaceTemplateVariables(subject, siteData);
    const finalHtmlContent = replaceTemplateVariables(htmlContent, siteData);
    const finalTextContent = replaceTemplateVariables(textContent, siteData);

    // Extract name from email
    const recipientName = extractNameFromEmail(contact.value);

    const result = await db.run(
      `INSERT INTO email_queue (
        campaign_id,
        recipient_email, recipient_name,
        subject, html_content, text_content,
        country_code, status, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', CURRENT_TIMESTAMP)
      RETURNING id`,
      [
        campaignId,
        contact.value,
        recipientName,
        finalSubject,
        finalHtmlContent,
        finalTextContent,
        site.country || 'in'
      ]
    );

    console.log(`✅ Queued email #${result.lastInsertId} for ${contact.value} (campaign: ${campaignId})`);
    return result.lastInsertId;
  } catch (error) {
    console.error("❌ Error queuing email for campaign:", error);
    throw error;
  }
}

/**
 * POST /api/email/campaigns/:id/start
 * Start a campaign (mark as started)
 */
router.post("/campaigns/:id/start", async (req, res) => {
  try {
    await db.run(
      `UPDATE email_campaigns SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [req.params.id]
    );

    // Trigger queue processing
    const worker = require("./email-queue-worker");
    worker.triggerNow();

    res.json({
      success: true,
      message: "Campaign started",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/email/campaigns/:id/pause
 * Pause a campaign
 */
router.post("/campaigns/:id/pause", async (req, res) => {
  try {
    await db.run(
      `UPDATE email_campaigns SET status = 'paused' WHERE id = $1`,
      [req.params.id]
    );

    res.json({
      success: true,
      message: "Campaign paused",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/email/campaigns/:id
 * Delete a campaign and its queued emails
 */
router.delete("/campaigns/:id", async (req, res) => {
  try {
    // Delete queued emails for this campaign
    await db.run(
      `DELETE FROM email_queue WHERE campaign_id = $1 AND status = 'queued'`,
      [req.params.id]
    );

    // Delete the campaign
    await db.run(`DELETE FROM email_campaigns WHERE id = $1`, [req.params.id]);

    res.json({
      success: true,
      message: "Campaign deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// EMAIL QUEUE MANAGEMENT
// ============================================

/**
 * GET /api/email/queue
 * Get email queue with filtering
 */
router.get("/queue", async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;

    let query = `SELECT eq.*, s.url as site_url FROM email_queue eq LEFT JOIN sites s ON eq.contact_id = (SELECT site_id FROM contacts WHERE id = eq.contact_id LIMIT 1) WHERE 1=1`;
    const params = [];

    if (status) {
      query += ` AND eq.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY eq.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const queue = await db.all(query, params);

    res.json({
      success: true,
      data: queue,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/email/queue/:id
 * Delete a queued email
 */
router.delete("/queue/:id", async (req, res) => {
  try {
    await db.run(`DELETE FROM email_queue WHERE id = $1`, [req.params.id]);

    res.json({
      success: true,
      message: "Email removed from queue",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/email/queue/:id/retry
 * Retry a failed email
 */
router.post("/queue/:id/retry", async (req, res) => {
  try {
    await db.run(
      `UPDATE email_queue SET status = 'queued', error_message = NULL, attempts = 0 WHERE id = $1`,
      [req.params.id]
    );

    res.json({
      success: true,
      message: "Email queued for retry",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// EMAIL SETTINGS
// ============================================

/**
 * GET /api/email/settings
 * Get all email settings
 */
router.get("/settings", async (req, res) => {
  try {
    const settings = await db.all(`SELECT * FROM email_settings ORDER BY key ASC`);

    res.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/email/settings/:key
 * Update email setting
 */
router.put("/settings/:key", async (req, res) => {
  try {
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({
        success: false,
        error: "Value is required",
      });
    }

    await db.run(
      `UPDATE email_settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2`,
      [value.toString(), req.params.key]
    );

    res.json({
      success: true,
      message: "Setting updated",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// EMAIL STATS
// ============================================

/**
 * GET /api/email/stats
 * Get email system statistics
 */
router.get("/stats", async (req, res) => {
  try {
    const worker = require("./email-queue-worker");
    const stats = await worker.getStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// MISSING ENDPOINTS FOR FRONTEND COMPATIBILITY
// ============================================

/**
 * GET /api/email/templates/max-sequence
 * Get the maximum sequence number across all templates
 */
router.get("/templates/max-sequence", async (req, res) => {
  try {
    const result = await db.get(`
      SELECT COALESCE(MAX(sequence_number), 0) as max_sequence
      FROM email_templates
    `);

    res.json({
      success: true,
      data: {
        maxSequence: result.max_sequence
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/email/send-log
 * Get email send log with pagination
 */
router.get("/send-log", async (req, res) => {
  try {
    const { page = 1, limit = 50, status, template_id, campaign_id } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `SELECT esl.*,
                  et.name as template_name,
                  ec.name as campaign_name,
                  c.value as contact_email
                 FROM email_send_log esl
                 LEFT JOIN email_templates et ON esl.template_id = et.id
                 LEFT JOIN email_campaigns ec ON esl.campaign_id = ec.id
                 LEFT JOIN contacts c ON esl.contact_id = c.id
                 WHERE 1=1`;
    const params = [];
    let countQuery = `SELECT COUNT(*) as total FROM email_send_log WHERE 1=1`;
    const countParams = [];

    if (status) {
      query += ` AND esl.status = $${params.length + 1}`;
      params.push(status);
      countQuery += ` AND status = $${countParams.length + 1}`;
      countParams.push(status);
    }

    if (template_id) {
      query += ` AND esl.template_id = $${params.length + 1}`;
      params.push(template_id);
      countQuery += ` AND template_id = $${countParams.length + 1}`;
      countParams.push(template_id);
    }

    if (campaign_id) {
      query += ` AND esl.campaign_id = $${params.length + 1}`;
      params.push(campaign_id);
      countQuery += ` AND campaign_id = $${countParams.length + 1}`;
      countParams.push(campaign_id);
    }

    // Get total count
    const countResult = await db.get(countQuery, countParams);
    const total = countResult.total;
    const totalPages = Math.ceil(total / parseInt(limit));

    // Add pagination and ordering
    query += ` ORDER BY esl.sent_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), offset);

    const logs = await db.all(query, params);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/email/queue/stats
 * Get email queue statistics
 */
router.get("/queue/stats", async (req, res) => {
  try {
    // Use the worker's getStats() method which returns the expected structure
    const stats = await emailQueueWorker.getStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /queue/detailed-stats
 * Get detailed email queue statistics for a period
 */
router.get("/queue/detailed-stats", async (req, res) => {
  try {
    const { period = 'today', startDate, endDate } = req.query;

    let dateFilter = '';
    let params = [];

    if (startDate && endDate) {
      dateFilter = ` AND sent_at >= ? AND sent_at <= ?`;
      params = [startDate, endDate];
    } else if (period === 'today') {
      dateFilter = ` AND DATE(sent_at) = CURRENT_DATE`;
    } else if (period === 'week') {
      dateFilter = ` AND sent_at >= NOW() - INTERVAL '7 days'`;
    } else if (period === 'month') {
      dateFilter = ` AND sent_at >= NOW() - INTERVAL '30 days'`;
    }

    // Get basic stats
    const stats = await db.get(`
      SELECT
        COUNT(*) as total_sent,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'sent') as successful_deliveries
      FROM email_queue
      WHERE sent_at IS NOT NULL ${dateFilter}
    `, params);

    // Get by template
    const byTemplate = await db.all(`
      SELECT
        et.name as template_name,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM email_queue eq
      LEFT JOIN email_templates et ON eq.template_id = et.id
      WHERE eq.sent_at IS NOT NULL ${dateFilter}
      GROUP BY et.id, et.name
      ORDER BY count DESC
      LIMIT 10
    `, params);

    // Get hourly breakdown for today
    let hourlyBreakdown = [];
    if (period === 'today' || (!startDate && !endDate)) {
      hourlyBreakdown = await db.all(`
        SELECT
          EXTRACT(HOUR FROM sent_at) as hour,
          COUNT(*) as count,
          COUNT(*) FILTER (WHERE status = 'sent') as sent,
          COUNT(*) FILTER (WHERE status = 'failed') as failed
        FROM email_queue
        WHERE DATE(sent_at) = CURRENT_DATE
        GROUP BY EXTRACT(HOUR FROM sent_at)
        ORDER BY hour
      `);
    }

    res.json({
      success: true,
      data: {
        period: startDate && endDate ? 'custom' : period,
        stats: stats,
        byTemplate,
        hourlyBreakdown
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /contact/:id/history
 * Get email history for a specific contact
 */
router.get('/contact/:id/history', async (req, res) => {
  try {
    const contactId = req.params.id;
    const { limit = 50, offset = 0 } = req.query;

    const history = await db.all(`
      SELECT esl.*, et.name as template_name, ec.name as campaign_name
      FROM email_send_log esl
      LEFT JOIN email_templates et ON esl.template_id = et.id
      LEFT JOIN email_campaigns ec ON esl.campaign_id = ec.id
      WHERE esl.contact_id = ?
      ORDER BY esl.sent_at DESC
      LIMIT ? OFFSET ?
    `, [contactId, limit, offset]);

    const count = await db.get(`
      SELECT COUNT(*) as total FROM email_send_log WHERE contact_id = ?
    `, [contactId]);

    res.json({
      success: true,
      data: history,
      total: count.total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /queue/add-by-tag
 * Bulk queue emails by tag or specific contact IDs
 * FIXED: Now supports both tag-based and contact_ids-based queuing
 */
router.post('/queue/add-by-tag', async (req, res) => {
  try {
    const { tag, template_id, campaign_id, contact_ids } = req.body;

    if (!tag && !contact_ids) {
      return res.status(400).json({
        success: false,
        error: 'Either tag or contact_ids is required'
      });
    }

    let contacts = [];

    // If contact_ids provided, use those directly
    if (contact_ids && Array.isArray(contact_ids) && contact_ids.length > 0) {
      console.log(`📧 Processing ${contact_ids.length} specific contact IDs`);

      // Create placeholders for PostgreSQL IN clause
      const placeholders = contact_ids.map((_, i) => `$${i + 1}`).join(',');
      contacts = await db.all(`
        SELECT c.id, c.value, c.site_id, s.url, s.country
        FROM contacts c
        LEFT JOIN sites s ON c.site_id = s.id
        WHERE c.id IN (${placeholders}) AND c.type = 'email'
      `, contact_ids);
    } else if (tag) {
      // Original tag-based logic
      console.log(`📧 Processing contacts with tag: ${tag}`);

      // Find sites with matching tag
      const sites = await db.all(`
        SELECT id, url, country FROM sites WHERE tags LIKE $1
      `, [`%${tag}%`]);

      if (sites.length === 0) {
        return res.json({
          success: true,
          message: 'No sites found with this tag',
          queued: 0
        });
      }

      // Get contacts from these sites with proper PostgreSQL syntax
      const siteIds = sites.map(s => s.id);

      // Build IN clause with proper placeholders
      const sitePlaceholders = siteIds.map((_, i) => `$${i + 1}`).join(',');
      contacts = await db.all(`
        SELECT c.id, c.value, c.site_id, s.url, s.country
        FROM contacts c
        LEFT JOIN sites s ON c.site_id = s.id
        WHERE c.site_id IN (${sitePlaceholders}) AND c.type = 'email'
      `, siteIds);
    }

    if (contacts.length === 0) {
      return res.json({
        success: true,
        message: contact_ids ? 'No valid email contacts found for given contact IDs' : 'No email contacts found for sites with this tag',
        queued: 0
      });
    }

    console.log(`✅ Found ${contacts.length} contacts to queue`);

    // Get template if specified
    let template = null;
    if (template_id) {
      template = await db.get(
        `SELECT subject, html_content, text_content FROM email_templates WHERE id = $1`,
        [template_id]
      );
    }

    // Use default template if none specified
    const subject = template?.subject || 'Hello from {{company}}';
    const htmlContent = template?.html_content || '<p>Hello {{name}},</p><p>This is a test email.</p>';
    const textContent = template?.text_content || 'Hello {{name}},\n\nThis is a test email.';

    // Queue emails for each contact with all required fields
    let queuedCount = 0;
    const queuedIds = [];

    for (const contact of contacts) {
      try {
        // Get site data for template replacement
        const siteData = await getSiteDataForTemplate(contact.site_id, contact.value);

        // Replace template variables
        const finalSubject = replaceTemplateVariables(subject, siteData);
        const finalHtmlContent = replaceTemplateVariables(htmlContent, siteData);
        const finalTextContent = replaceTemplateVariables(textContent, siteData);

        // Extract name from email
        const recipientName = extractNameFromEmail(contact.value);

        // Insert with required fields (matching actual schema)
        const result = await db.run(`
          INSERT INTO email_queue (
            campaign_id,
            recipient_email, recipient_name,
            subject, html_content, text_content,
            country_code, status, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', CURRENT_TIMESTAMP)
          RETURNING id
        `, [
          campaign_id,
          contact.value,
          recipientName,
          finalSubject,
          finalHtmlContent,
          finalTextContent,
          contact.country || 'in'
        ]);

        queuedCount++;
        queuedIds.push(result.lastInsertId);

        console.log(`✅ Queued email #${result.lastInsertId} for ${contact.value} (tag: ${tag || 'direct'})`);
      } catch (err) {
        // Skip duplicates or errors
        console.error(`❌ Error queueing email for contact ${contact.id}:`, err.message);
      }
    }

    res.json({
      success: true,
      message: `Successfully queued ${queuedCount} emails`,
      queued: queuedCount,
      queue_ids: queuedIds
    });
  } catch (error) {
    console.error('❌ Error in /queue/add-by-tag:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /queue/bulk/pause
 * Bulk pause queue items
 */
router.post('/queue/bulk/pause', async (req, res) => {
  try {
    // Handle both body and query parameters for flexibility
    let ids;
    if (req.body && req.body.ids) {
      ids = req.body.ids;
    } else if (req.query.ids) {
      // Parse comma-separated IDs from query string
      ids = req.query.ids.split(',').map(id => parseInt(id.trim()));
    } else {
      return res.status(400).json({
        success: false,
        error: 'IDs array is required (send as body.ids or query string ?ids=1,2,3)'
      });
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'IDs array is required'
      });
    }

    const placeholders = ids.map(() => '?').join(',');
    const result = await db.run(`
      UPDATE email_queue SET status = 'paused' WHERE id IN (${placeholders})
    `, ids);

    res.json({
      success: true,
      message: `Paused ${result.changes} queue items`,
      updated: result.changes
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /queue/bulk/resume
 * Bulk resume queue items
 */
router.post('/queue/bulk/resume', async (req, res) => {
  try {
    // Handle both body and query parameters for flexibility
    let ids;
    if (req.body && req.body.ids) {
      ids = req.body.ids;
    } else if (req.query.ids) {
      // Parse comma-separated IDs from query string
      ids = req.query.ids.split(',').map(id => parseInt(id.trim()));
    } else {
      return res.status(400).json({
        success: false,
        error: 'IDs array is required (send as body.ids or query string ?ids=1,2,3)'
      });
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'IDs array is required'
      });
    }

    const placeholders = ids.map(() => '?').join(',');
    const result = await db.run(`
      UPDATE email_queue SET status = 'queued' WHERE id IN (${placeholders})
    `, ids);

    res.json({
      success: true,
      message: `Resumed ${result.changes} queue items`,
      updated: result.changes
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /queue/bulk/cancel
 * Bulk cancel queue items
 */
router.post('/queue/bulk/cancel', async (req, res) => {
  try {
    // Handle both body and query parameters for flexibility
    let ids;
    if (req.body && req.body.ids) {
      ids = req.body.ids;
    } else if (req.query.ids) {
      // Parse comma-separated IDs from query string
      ids = req.query.ids.split(',').map(id => parseInt(id.trim()));
    } else {
      return res.status(400).json({
        success: false,
        error: 'IDs array is required (send as body.ids or query string ?ids=1,2,3)'
      });
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'IDs array is required'
      });
    }

    const placeholders = ids.map(() => '?').join(',');
    const result = await db.run(`
      UPDATE email_queue SET status = 'cancelled' WHERE id IN (${placeholders})
    `, ids);

    res.json({
      success: true,
      message: `Cancelled ${result.changes} queue items`,
      updated: result.changes
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /queue/bulk/retry-failed
 * Bulk retry failed queue items
 */
router.post('/queue/bulk/retry-failed', async (req, res) => {
  try {
    // Handle both body and query parameters for flexibility
    let ids;
    if (req.body && req.body.ids) {
      ids = req.body.ids;
    } else if (req.query.ids) {
      // Parse comma-separated IDs from query string
      ids = req.query.ids.split(',').map(id => parseInt(id.trim()));
    } else {
      return res.status(400).json({
        success: false,
        error: 'IDs array is required (send as body.ids or query string ?ids=1,2,3)'
      });
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'IDs array is required'
      });
    }

    const placeholders = ids.map(() => '?').join(',');
    const result = await db.run(`
      UPDATE email_queue
      SET status = 'queued', error_message = NULL, attempt_count = 0
      WHERE id IN (${placeholders})
    `, ids);

    res.json({
      success: true,
      message: `Retried ${result.changes} queue items`,
      updated: result.changes
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /queue/history
 * Get queue history with filters
 */
router.get('/queue/history', async (req, res) => {
  try {
    const { status, template_id, campaign_id, limit = 50, offset = 0 } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (status) {
      whereClause += ' AND esl.status = ?';
      params.push(status);
    }

    if (template_id) {
      whereClause += ' AND esl.template_id = ?';
      params.push(template_id);
    }

    if (campaign_id) {
      whereClause += ' AND esl.campaign_id = ?';
      params.push(campaign_id);
    }

    params.push(parseInt(limit));
    params.push(parseInt(offset));

    const history = await db.all(`
      SELECT esl.*,
             et.name as template_name,
             ec.name as campaign_name,
             es.from_name as sender_name
      FROM email_send_log esl
      LEFT JOIN email_templates et ON esl.template_id = et.id
      LEFT JOIN email_campaigns ec ON esl.campaign_id = ec.id
      LEFT JOIN email_senders es ON esl.sender_id = es.id
      ${whereClause}
      ORDER BY esl.sent_at DESC
      LIMIT ? OFFSET ?
    `, params);

    // Get total count
    const countParams = params.slice(0, -2);
    const count = await db.get(`
      SELECT COUNT(*) as total FROM email_send_log esl ${whereClause}
    `, countParams);

    res.json({
      success: true,
      data: history,
      total: count.total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /senders/:id/test
 * Test email sender
 */
router.post('/senders/:id/test', async (req, res) => {
  try {
    const senderId = req.params.id;
    const { test_email } = req.body;

    // Get sender
    const sender = await db.get(`
      SELECT * FROM email_senders WHERE id = ?
    `, [senderId]);

    if (!sender) {
      return res.status(404).json({
        success: false,
        error: 'Sender not found'
      });
    }

    // Use provided test email or sender's email
    const toEmail = test_email || sender.email;

    // Create nodemailer transporter
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: sender.smtp_host,
      port: sender.smtp_port,
      secure: sender.smtp_secure === 1,
      auth: {
        user: sender.smtp_user,
        pass: sender.smtp_password
      }
    });

    // Send test email
    const info = await transporter.sendMail({
      from: `${sender.from_name} <${sender.email}>`,
      to: toEmail,
      subject: 'Test Email',
      html: '<p>This is a test email from your email sender configuration.</p>'
    });

    res.json({
      success: true,
      message: 'Test email sent successfully',
      messageId: info.messageId,
      to: toEmail
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /templates/:id/toggle
 * Toggle template active status
 */
router.patch('/templates/:id/toggle', async (req, res) => {
  try {
    const templateId = req.params.id;

    // Get current status
    const template = await db.get(`
      SELECT is_active FROM email_templates WHERE id = ?
    `, [templateId]);

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // Toggle status
    const newStatus = template.is_active === 1 ? 0 : 1;

    await db.run(`
      UPDATE email_templates SET is_active = ? WHERE id = ?
    `, [newStatus, templateId]);

    res.json({
      success: true,
      message: `Template ${newStatus === 1 ? 'activated' : 'deactivated'}`,
      is_active: newStatus
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /templates/test
 * Test email template
 */
router.post('/templates/test', async (req, res) => {
  try {
    const { template_id, test_email, variables = {} } = req.body;

    if (!template_id) {
      return res.status(400).json({
        success: false,
        error: 'Template ID is required'
      });
    }

    // Get template
    const template = await db.get(`
      SELECT * FROM email_templates WHERE id = ?
    `, [template_id]);

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // Get active sender
    const sender = await db.get(`
      SELECT * FROM email_senders WHERE is_active = 1 LIMIT 1
    `);

    if (!sender) {
      return res.status(400).json({
        success: false,
        error: 'No active email sender found'
      });
    }

    // Replace variables in template
    let htmlContent = template.html_content;
    let subject = template.subject;

    Object.keys(variables).forEach(key => {
      const placeholder = `{{${key}}}`;
      const value = variables[key];
      htmlContent = htmlContent.replace(new RegExp(placeholder, 'g'), value);
      subject = subject.replace(new RegExp(placeholder, 'g'), value);
    });

    // Create nodemailer transporter
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: sender.smtp_host,
      port: sender.smtp_port,
      secure: sender.smtp_secure === 1,
      auth: {
        user: sender.smtp_user,
        pass: sender.smtp_password
      }
    });

    // Send test email
    const toEmail = test_email || sender.email;
    const info = await transporter.sendMail({
      from: `${sender.from_name} <${sender.email}>`,
      to: toEmail,
      subject: subject,
      html: htmlContent
    });

    res.json({
      success: true,
      message: 'Test template email sent successfully',
      messageId: info.messageId,
      to: toEmail
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
