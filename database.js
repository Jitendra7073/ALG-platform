const Database = require("better-sqlite3");
const path = require("path");

// Database file location
const DB_PATH = path.join(__dirname, "wordpress-detector.db");

// ============ SHARED PERSISTENT DB INSTANCE ============
// Used by email-senders-templates-api.js and email-queue-worker.js
// which call db.run(), db.all(), db.get() directly.
let _sharedDb = null;

function getSharedDb() {
  if (!_sharedDb || !_sharedDb.open) {
    _sharedDb = new Database(DB_PATH);
  }
  return _sharedDb;
}

// Low-level wrappers (sqlite3-style API expected by email modules)
function run(sql, params = []) {
  const db = getSharedDb();
  return db.prepare(sql).run(...params);
}

function all(sql, params = []) {
  const db = getSharedDb();
  return db.prepare(sql).all(...params);
}

function get(sql, params = []) {
  const db = getSharedDb();
  return db.prepare(sql).get(...params);
}

function prepare(sql) {
  const db = getSharedDb();
  return db.prepare(sql);
}

/**
 * Initialize the database and create tables if they don't exist
 */
function initDatabase() {
  const db = new Database(DB_PATH);

  // Create searches table to track each search run
  db.exec(`
    CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      country TEXT DEFAULT 'in',
      total_sites INTEGER NOT NULL,
      wordpress_count INTEGER NOT NULL,
      non_wordpress_count INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create sites table to store individual site checks
  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      country TEXT DEFAULT 'in',
      is_wordpress INTEGER NOT NULL,
      confidence_score INTEGER DEFAULT 0,
      indicators TEXT,
      error TEXT,
      search_query TEXT,
      emails TEXT,
      phones TEXT,
      linkedin_profiles TEXT,
      text_content TEXT,
      ai_processed INTEGER DEFAULT 0,
      ai_status TEXT DEFAULT 'pending',
      ai_verified_wp INTEGER DEFAULT NULL,
      ai_wp_confidence TEXT,
      ai_wp_indicators TEXT,
      ai_content_relevant INTEGER DEFAULT NULL,
      ai_actual_category TEXT,
      ai_content_summary TEXT,
      ai_mismatch_reason TEXT,
      ai_error TEXT,
      ai_processed_at DATETIME,
      classification TEXT,
      relevance_score INTEGER,
      tags TEXT,
      primary_language TEXT,
      value_proposition TEXT,
      ai_reasoning TEXT,
      ai_is_wordpress INTEGER DEFAULT NULL,
      ai_is_genuine_match INTEGER DEFAULT NULL,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (search_id) REFERENCES searches(id)
    )
  `);

  // Create indexes for better query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sites_search_id ON sites(search_id);
    CREATE INDEX IF NOT EXISTS idx_sites_is_wordpress ON sites(is_wordpress);
    CREATE INDEX IF NOT EXISTS idx_searches_created_at ON searches(created_at);
    CREATE INDEX IF NOT EXISTS idx_sites_ai_status ON sites(ai_status);
  `);

  // Migration: Add columns to sites table if they don't exist
  const migrationColumns = [
    { name: "confidence_score", type: "INTEGER DEFAULT 0" },
    { name: "linkedin_profiles", type: "TEXT" },
    { name: "ai_verified_wp", type: "INTEGER DEFAULT NULL" },
    { name: "ai_wp_confidence", type: "TEXT" },
    { name: "ai_wp_indicators", type: "TEXT" },
    { name: "ai_content_relevant", type: "INTEGER DEFAULT NULL" },
    { name: "ai_actual_category", type: "TEXT" },
    { name: "ai_content_summary", type: "TEXT" },
    { name: "ai_mismatch_reason", type: "TEXT" },
    { name: "ai_error", type: "TEXT" },
    { name: "ai_processed_at", type: "DATETIME" },
    { name: "ai_is_wordpress", type: "INTEGER DEFAULT NULL" },
    { name: "ai_is_genuine_match", type: "INTEGER DEFAULT NULL" },
  ];

  for (const col of migrationColumns) {
    try {
      db.prepare(`ALTER TABLE sites ADD COLUMN ${col.name} ${col.type}`).run();
    } catch (e) {
      // Column already exists, ignore error
    }
  }

  // Auto-reset stuck 'processing' sites to 'pending'
  try {
    db.prepare("UPDATE sites SET ai_status = 'pending' WHERE ai_status = 'processing'").run();
  } catch (e) {}

  // Migration: Add country to searches and sites
  try {
    db.exec(`ALTER TABLE searches ADD COLUMN country TEXT DEFAULT 'in'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE sites ADD COLUMN country TEXT DEFAULT 'in'`);
  } catch (e) {}

  // Create keywords table
  db.exec(`
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'pending',
      max_sites INTEGER DEFAULT 20,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_keywords_status ON keywords(status);
  `);

  // Migration: Add max_sites to keywords
  try {
    db.exec(`ALTER TABLE keywords ADD COLUMN max_sites INTEGER DEFAULT 20`);
  } catch (e) {
    /* Ignore */
  }

  // Create excluded_domains table for domain-level scraping exclusion
  db.exec(`
    CREATE TABLE IF NOT EXISTS excluded_domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_excluded_domains_domain ON excluded_domains(domain);
  `);

  // Create ignored_tags table for tag-based filtering during scraping and AI analysis
  db.exec(`
    CREATE TABLE IF NOT EXISTS ignored_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag TEXT NOT NULL UNIQUE,
      match_type TEXT DEFAULT 'contains',
      scope TEXT DEFAULT 'url',
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ignored_tags_tag ON ignored_tags(tag);
  `);

  // Create contacts table (replaces emails/phones columns in sites table)
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      source_page TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_contacts_site_id ON contacts(site_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type);
    CREATE INDEX IF NOT EXISTS idx_contacts_value ON contacts(value);
  `);

  // Create company_executives table for storing LinkedIn company executives
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_executives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      company_url TEXT NOT NULL,
      company_name TEXT,
      profile_url TEXT NOT NULL UNIQUE,
      name TEXT,
      headline TEXT,
      role_category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_company_executives_site_id ON company_executives(site_id);
    CREATE INDEX IF NOT EXISTS idx_company_executives_company_url ON company_executives(company_url);
    CREATE INDEX IF NOT EXISTS idx_company_executives_role_category ON company_executives(role_category);
    CREATE INDEX IF NOT EXISTS idx_company_executives_profile_url ON company_executives(profile_url);
  `);

  // Add LinkedIn type to existing contacts if it doesn't exist
  try {
    db.exec(`INSERT OR IGNORE INTO contacts (site_id, type, value, source_page) 
             SELECT id, 'linkedin', '', '' FROM sites WHERE 0=1`);
  } catch (e) {
    // Ignore if table structure doesn't match
  }

  // Migration: Add emails and phones columns if they don't exist (for backwards compatibility)
  try {
    db.exec(`ALTER TABLE sites ADD COLUMN emails TEXT`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE sites ADD COLUMN phones TEXT`);
  } catch (e) {
    // Column already exists
  }

  // Migrations for AI enrichment columns
  const aiColumns = [
    { name: "text_content", type: "TEXT" },
    { name: "ai_processed", type: "INTEGER DEFAULT 0" },
    { name: "ai_status", type: "TEXT DEFAULT 'pending'" },
    { name: "classification", type: "TEXT" },
    { name: "relevance_score", type: "INTEGER" },
    { name: "tags", type: "TEXT" },
    { name: "primary_language", type: "TEXT" },
    { name: "value_proposition", type: "TEXT" },
    { name: "ai_reasoning", type: "TEXT" },
    { name: "ai_is_wordpress", type: "INTEGER DEFAULT NULL" },
    { name: "ai_is_genuine_match", type: "INTEGER DEFAULT NULL" },
  ];

  for (const col of aiColumns) {
    try {
      db.exec(`ALTER TABLE sites ADD COLUMN ${col.name} ${col.type}`);
    } catch (e) {
      // Column already exists
    }
  }

  // Migration: Cleanup legacy records that have no text_content
  try {
    db.exec(`
      UPDATE sites 
      SET ai_processed = 1, 
          ai_status = 'failed', 
          ai_reasoning = 'No text content extracted during previous scrape.'
      WHERE is_wordpress = 1 
        AND (text_content IS NULL OR text_content = '') 
        AND (ai_processed = 0 OR ai_processed IS NULL)
    `);
  } catch (e) {
    // Ignore errors during migration
  }

  // Migration: Reprocess sites that failed previously but DO have text content (e.g. API Quota Errors)
  try {
    db.exec(`
      UPDATE sites 
      SET ai_processed = 0, 
          ai_status = 'pending',
          ai_reasoning = NULL
      WHERE is_wordpress = 1 
        AND text_content IS NOT NULL 
        AND text_content != ''
        AND ai_status = 'failed'
        AND (ai_reasoning IS NULL OR ai_reasoning != 'No text content extracted during previous scrape.')
    `);
  } catch (e) {
    // Ignore errors during migration
  }

  return db;
}

/**
 * Save search results to database
 * @param {string} query - Search query used
 * @param {Array} results - Array of site check results
 * @returns {number} - The search ID
 */
function saveSearchResults(query, results, country = 'in') {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');

  try {
    const wordpressCount = results.filter((r) => r.isWordPress).length;
    const nonWordpressCount = results.length - wordpressCount;

    // Insert search record
    const insertSearch = db.prepare(`
      INSERT INTO searches (query, country, total_sites, wordpress_count, non_wordpress_count)
      VALUES (?, ?, ?, ?, ?)
    `);

    const searchResult = insertSearch.run(
      query,
      country,
      results.length,
      wordpressCount,
      nonWordpressCount,
    );
    const searchId = searchResult.lastInsertRowid;

    // Insert site records
    const insertSite = db.prepare(`
      INSERT INTO sites (
        search_id, url, country, is_wordpress, confidence_score,
        indicators, error, search_query, emails, phones,
        linkedin_profiles, text_content, page_title, meta_description
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertContact = db.prepare(`
      INSERT INTO contacts (site_id, type, value, source_page)
      VALUES (?, ?, ?, ?)
    `);

    const insertMany = db.transaction((sites) => {
      for (const site of sites) {
        const siteResult = insertSite.run(
          searchId,
          site.url,
          country,
          site.isWordPress ? 1 : 0,
          site.confidenceScore || 0,
          JSON.stringify(site.indicators || []),
          site.error || null,
          query,
          JSON.stringify(site.emails || []),
          JSON.stringify(site.phones || []),
          JSON.stringify(site.linkedin_profiles || []),
          site.text_content || null,
          site.page_title || null,
          site.meta_description || null,
        );

        const siteId = siteResult.lastInsertRowid;

        // Insert contacts (legacy support for contacts table)
        if (site.emails && site.emails.length > 0) {
          for (const email of site.emails) {
            insertContact.run(siteId, "email", email, site.url);
          }
        }
        if (site.phones && site.phones.length > 0) {
          for (const phone of site.phones) {
            insertContact.run(siteId, "phone", phone, site.url);
          }
        }
        if (site.linkedin_profiles && site.linkedin_profiles.length > 0) {
          for (const linkedin of site.linkedin_profiles) {
            insertContact.run(siteId, "linkedin", linkedin, site.url);
          }
        }
      }
    });

    insertMany(results);

    return searchId;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Get all searches
 * @returns {Array} - Array of searches
 */
function getAllSearches() {
  const db = initDatabase();
  const searches = db
    .prepare(
      `
    SELECT
      id,
      query,
      total_sites,
      wordpress_count,
      non_wordpress_count,
      created_at
    FROM searches
    ORDER BY created_at DESC
  `,
    )
    .all();

  db.close();
  return searches;
}

/**
 * Get search by ID with all sites
 * @param {number} searchId - Search ID
 * @returns {Object} - Search with sites
 */
function getSearchById(searchId) {
  const db = initDatabase();

  const search = db
    .prepare(
      `
    SELECT * FROM searches WHERE id = ?
  `,
    )
    .get(searchId);

  if (!search) {
    db.close();
    return null;
  }

  const sites = db
    .prepare(
      `
    SELECT * FROM sites WHERE search_id = ?
  `,
    )
    .all(searchId);

  db.close();

  return {
    ...search,
    sites,
  };
}

/**
 * Get all WordPress sites across all searches
 * @returns {Array} - WordPress sites
 */
function getAllWordpressSites() {
  const db = initDatabase();

  const sites = db
    .prepare(
      `
    SELECT
      s.*,
      sc.query as search_query,
      sc.created_at as search_date
    FROM sites s
    JOIN searches sc ON s.search_id = sc.id
    WHERE s.is_wordpress = 1
    ORDER BY s.checked_at DESC
  `,
    )
    .all();

  db.close();
  return sites;
}

/**
 * Get statistics
 * @returns {Object} - Statistics
 */
function getStatistics() {
  const db = initDatabase();

  const stats = db
    .prepare(
      `
    SELECT
      COUNT(DISTINCT id) as total_searches,
      SUM(total_sites) as total_sites_checked,
      SUM(wordpress_count) as total_wordpress_sites,
      SUM(non_wordpress_count) as total_non_wordpress_sites
    FROM searches
  `,
    )
    .get();

  const topQueries = db
    .prepare(
      `
    SELECT
      query,
      COUNT(*) as search_count,
      SUM(wordpress_count) as wordpress_found
    FROM searches
    GROUP BY query
    ORDER BY search_count DESC
    LIMIT 10
  `,
    )
    .all();

  db.close();

  return {
    ...stats,
    topQueries,
  };
}

/**
 * Export database to JSON
 * @param {string} outputPath - Output file path
 */
function exportToJSON(outputPath) {
  const db = initDatabase();

  const searches = db
    .prepare(
      `
    SELECT * FROM searches ORDER BY created_at DESC
  `,
    )
    .all();

  const data = searches.map((search) => {
    const sites = db
      .prepare(
        `
      SELECT * FROM sites WHERE search_id = ?
    `,
      )
      .all(search.id);

    return {
      ...search,
      sites,
    };
  });

  const fs = require("fs");
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

  db.close();
  console.log(`\n✅ Data exported to ${outputPath}`);
}

// ============ KEYWORD CRUD OPERATIONS ============

/**
 * Get all keywords
 * @returns {Array} - Array of keywords
 */
function getAllKeywords() {
  const db = initDatabase();
  const keywords = db
    .prepare(
      `
    SELECT * FROM keywords ORDER BY created_at DESC
  `,
    )
    .all();
  db.close();
  return keywords;
}

/**
 * Get keyword by ID
 * @param {number} id - Keyword ID
 * @returns {Object} - Keyword
 */
function getKeywordById(id) {
  const db = initDatabase();
  const keyword = db
    .prepare(
      `
    SELECT * FROM keywords WHERE id = ?
  `,
    )
    .get(id);
  db.close();
  return keyword;
}

/**
 * Add a new keyword
 * @param {string} keyword - Keyword to add
 * @param {number} maxSites - Maximum sites to scrape (default 20)
 * @returns {Object} - Created keyword
 */
function addKeyword(keyword, maxSites = 20) {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const result = db
      .prepare(
        `
      INSERT INTO keywords (keyword, status, max_sites)
      VALUES (?, 'pending', ?)
    `,
      )
      .run(keyword.trim(), maxSites);

    const created = getKeywordById(result.lastInsertRowid);
    return created;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Update keyword
 * @param {number} id - Keyword ID
 * @param {string} keyword - New keyword value
 * @returns {Object} - Updated keyword
 */
function updateKeyword(id, keyword) {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.prepare(
      `
      UPDATE keywords
      SET keyword = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    ).run(keyword.trim(), id);
    return getKeywordById(id);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Delete keyword and cascade delete all related data:
 * keyword → searches (by query match) → sites → contacts → executives
 * @param {number} id - Keyword ID
 * @returns {boolean} - Success
 */
function deleteKeyword(id) {
  const db = initDatabase();

  // Disable foreign key constraints to allow force deletion
  db.exec('PRAGMA foreign_keys = OFF');

  try {
    // Get the keyword text to find related searches
    const keyword = db.prepare("SELECT keyword FROM keywords WHERE id = ?").get(id);

    if (keyword) {
      // Find all searches that match this keyword
      const searches = db.prepare("SELECT id FROM searches WHERE query = ?").all(keyword.keyword);
      const searchIds = searches.map(s => s.id);

      if (searchIds.length > 0) {
        const placeholders = searchIds.map(() => '?').join(',');

        // Get all site IDs from those searches
        const sites = db.prepare(`SELECT id FROM sites WHERE search_id IN (${placeholders})`).all(...searchIds);
        const siteIds = sites.map(s => s.id);

        if (siteIds.length > 0) {
          const sitePlaceholders = siteIds.map(() => '?').join(',');
          // Delete contacts for those sites
          db.prepare(`DELETE FROM contacts WHERE site_id IN (${sitePlaceholders})`).run(...siteIds);
          // Delete executives for those sites
          db.prepare(`DELETE FROM company_executives WHERE site_id IN (${sitePlaceholders})`).run(...siteIds);
        }

        // Delete sites for those searches
        db.prepare(`DELETE FROM sites WHERE search_id IN (${placeholders})`).run(...searchIds);
        // Delete the searches themselves
        db.prepare(`DELETE FROM searches WHERE id IN (${placeholders})`).run(...searchIds);
      }
    }

    // Finally delete the keyword
    const result = db.prepare("DELETE FROM keywords WHERE id = ?").run(id);
    return result.changes > 0;
  } finally {
    // Re-enable foreign key constraints
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

// ============ EXCLUDED DOMAINS CRUD OPERATIONS ============

/**
 * Extract and normalize domain from a URL or raw domain string
 * @param {string} input - URL or domain string
 * @returns {string} - Normalized domain (e.g. "youtube.com")
 */
function extractDomain(input) {
  try {
    let domain = input.toLowerCase().trim();
    // Remove protocol
    domain = domain.replace(/^https?:\/\//, '');
    // Remove www.
    domain = domain.replace(/^www\./, '');
    // Remove path, query, hash
    domain = domain.split('/')[0].split('?')[0].split('#')[0];
    return domain;
  } catch (e) {
    return input.toLowerCase().trim();
  }
}

/**
 * Get all excluded domains
 * @returns {Array} - Array of excluded domain objects
 */
function getAllExcludedDomains() {
  const db = initDatabase();
  const domains = db
    .prepare(`SELECT * FROM excluded_domains ORDER BY created_at DESC`)
    .all();
  db.close();
  return domains;
}

/**
 * Get excluded domain by ID
 * @param {number} id - Domain ID
 * @returns {Object|null} - Excluded domain or null
 */
function getExcludedDomainById(id) {
  const db = initDatabase();
  const domain = db
    .prepare(`SELECT * FROM excluded_domains WHERE id = ?`)
    .get(id);
  db.close();
  return domain || null;
}

/**
 * Add a new excluded domain
 * @param {string} domain - Domain to exclude (e.g. "youtube.com" or "https://www.youtube.com/")
 * @param {string} reason - Optional reason for exclusion
 * @returns {Object} - Created excluded domain
 */
function addExcludedDomain(domain, reason = '') {
  const normalized = extractDomain(domain);
  if (!normalized) {
    throw new Error('Invalid domain');
  }
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const result = db
      .prepare(`INSERT INTO excluded_domains (domain, reason) VALUES (?, ?)`)
      .run(normalized, reason.trim() || null);
    return getExcludedDomainById(result.lastInsertRowid);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Update an excluded domain
 * @param {number} id - Domain ID
 * @param {string} domain - New domain value
 * @param {string} reason - New reason
 * @returns {Object|null} - Updated domain or null
 */
function updateExcludedDomain(id, domain, reason) {
  const normalized = extractDomain(domain);
  if (!normalized) {
    throw new Error('Invalid domain');
  }
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.prepare(`UPDATE excluded_domains SET domain = ?, reason = ? WHERE id = ?`)
      .run(normalized, reason ? reason.trim() : null, id);
    return getExcludedDomainById(id);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Delete an excluded domain
 * @param {number} id - Domain ID
 * @returns {boolean} - True if deleted
 */
function deleteExcludedDomain(id) {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const result = db
      .prepare(`DELETE FROM excluded_domains WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Check if a URL should be excluded based on stored excluded domains
 * Matches exact domain and all subdomains (e.g. "youtube.com" blocks "m.youtube.com")
 * @param {string} url - URL to check
 * @param {Array<string>} excludedDomainList - Array of excluded domain strings
 * @returns {boolean} - True if URL should be excluded
 */
function isUrlExcluded(url, excludedDomainList) {
  const urlDomain = extractDomain(url);
  return excludedDomainList.some(excluded => {
    return urlDomain === excluded || urlDomain.endsWith('.' + excluded);
  });
}

/**
 * Filter an array of URLs, removing those matching excluded domains
 * @param {Array<string>} urls - URLs to filter
 * @returns {Object} - { allowed: string[], excluded: string[] }
 */
function filterExcludedUrls(urls) {
  const excludedDomains = getAllExcludedDomains().map(d => d.domain);
  const allowed = [];
  const excluded = [];
  for (const url of urls) {
    if (isUrlExcluded(url, excludedDomains)) {
      excluded.push(url);
    } else {
      allowed.push(url);
    }
  }
  return { allowed, excluded };
}

// =====================================================
// IGNORED TAGS FUNCTIONS
// =====================================================

/**
 * Get all ignored tags
 * @returns {Array} - Array of ignored tag objects
 */
function getAllIgnoredTags() {
  const db = initDatabase();
  const tags = db
    .prepare(`SELECT * FROM ignored_tags ORDER BY created_at DESC`)
    .all();
  db.close();
  return tags;
}

/**
 * Get ignored tag by ID
 * @param {number} id - Tag ID
 * @returns {Object|null} - Ignored tag or null
 */
function getIgnoredTagById(id) {
  const db = initDatabase();
  const tag = db
    .prepare(`SELECT * FROM ignored_tags WHERE id = ?`)
    .get(id);
  db.close();
  return tag || null;
}

/**
 * Add a new ignored tag
 * @param {string} tag - Tag to ignore (e.g., "blog", "/learn/")
 * @param {string} matchType - Match type: 'contains', 'exact', 'regex'
 * @param {string} scope - Where to check: 'url', 'content', 'both'
 * @param {string} reason - Optional reason
 * @returns {Object} - Created ignored tag
 */
function addIgnoredTag(tag, matchType = 'contains', scope = 'url', reason = '') {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const result = db
      .prepare(`INSERT INTO ignored_tags (tag, match_type, scope, reason) VALUES (?, ?, ?, ?)`)
      .run(tag.trim().toLowerCase(), matchType, scope, reason.trim() || null);
    return getIgnoredTagById(result.lastInsertRowid);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Update an ignored tag
 * @param {number} id - Tag ID
 * @param {string} tag - New tag value
 * @param {string} matchType - New match type
 * @param {string} scope - New scope
 * @param {string} reason - New reason
 * @returns {Object} - Updated ignored tag
 */
function updateIgnoredTag(id, tag, matchType, scope, reason) {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.prepare(`UPDATE ignored_tags SET tag = ?, match_type = ?, scope = ?, reason = ? WHERE id = ?`)
      .run(tag.trim().toLowerCase(), matchType, scope, reason ? reason.trim() : null, id);
    return getIgnoredTagById(id);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Delete an ignored tag
 * @param {number} id - Tag ID
 * @returns {boolean} - True if deleted
 */
function deleteIgnoredTag(id) {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const result = db
      .prepare(`DELETE FROM ignored_tags WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Check if a URL should be ignored based on ignored tags
 * @param {string} url - URL to check
 * @param {Array<Object>} ignoredTags - Array of ignored tag objects
 * @returns {boolean} - True if URL should be ignored
 */
function isUrlIgnored(url, ignoredTags) {
  if (!ignoredTags || ignoredTags.length === 0) return false;
  const urlLower = url.toLowerCase();

  return ignoredTags.some(tag => {
    // Skip if scope is 'content' only
    if (tag.scope === 'content') return false;

    const tagValue = tag.tag.toLowerCase();

    switch (tag.match_type) {
      case 'exact':
        return urlLower === tagValue || urlLower === `/${tagValue}` || urlLower.endsWith(`/${tagValue}`);
      case 'regex':
        try {
          const regex = new RegExp(tagValue, 'i');
          return regex.test(urlLower);
        } catch (e) {
          console.error(`Invalid regex in ignored tag: ${tagValue}`);
          return false;
        }
      case 'contains':
      default:
        return urlLower.includes(tagValue);
    }
  });
}

/**
 * Check if content should be ignored based on ignored tags
 * @param {string} content - Content text to check
 * @param {Array<Object>} ignoredTags - Array of ignored tag objects
 * @returns {boolean} - True if content should be ignored
 */
function isContentIgnored(content, ignoredTags) {
  if (!content || !ignoredTags || ignoredTags.length === 0) return false;
  const contentLower = content.toLowerCase();

  return ignoredTags.some(tag => {
    // Skip if scope is 'url' only
    if (tag.scope === 'url') return false;

    const tagValue = tag.tag.toLowerCase();

    switch (tag.match_type) {
      case 'exact':
        return contentLower.includes(tagValue);
      case 'regex':
        try {
          const regex = new RegExp(tagValue, 'i');
          return regex.test(contentLower);
        } catch (e) {
          console.error(`Invalid regex in ignored tag: ${tagValue}`);
          return false;
        }
      case 'contains':
      default:
        return contentLower.includes(tagValue);
    }
  });
}

/**
 * Filter an array of URLs, removing those matching ignored tags
 * @param {Array<string>} urls - URLs to filter
 * @returns {Object} - { allowed: string[], ignored: string[] }
 */
function filterIgnoredUrls(urls) {
  const ignoredTags = getAllIgnoredTags();
  const allowed = [];
  const ignored = [];

  for (const url of urls) {
    if (isUrlIgnored(url, ignoredTags)) {
      ignored.push(url);
    } else {
      allowed.push(url);
    }
  }

  return { allowed, ignored };
}

/**
 * Update keyword status
 * @param {number} id - Keyword ID
 * @param {string} status - New status
 * @returns {Object} - Updated keyword
 */
function updateKeywordStatus(id, status) {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.prepare(
      `
      UPDATE keywords
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    ).run(status, id);
    return getKeywordById(id);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Get sites by WordPress status with pagination
 * @param {boolean} isWordPress - Filter by WordPress status
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @param {string} searchQuery - Optional search filter
 * @returns {Object} - Sites with pagination info
 */
function getSitesByWordpressStatus(
  isWordPress,
  page = 1,
  limit = 50,
  searchQuery = null,
) {
  const db = initDatabase();
  const offset = (page - 1) * limit;

  let sites;
  let countResult;

  if (searchQuery && searchQuery.trim() !== "") {
    sites = db
      .prepare(
        `
      SELECT
        id,
        url,
        is_wordpress,
        confidence_score,
        indicators,
        error,
        search_query,
        emails,
        phones,
        ai_status,
        classification,
        relevance_score,
        tags,
        primary_language,
        value_proposition,
        ai_reasoning,
        ai_verified_wp,
        ai_wp_confidence,
        ai_wp_indicators,
        ai_content_relevant,
        ai_actual_category,
        ai_content_summary,
        ai_mismatch_reason,
        checked_at
      FROM sites
      WHERE is_wordpress = ? AND (url LIKE ? OR search_query LIKE ?)
      ORDER BY checked_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(
        isWordPress ? 1 : 0,
        `%${searchQuery}%`,
        `%${searchQuery}%`,
        limit,
        offset,
      );

    countResult = db
      .prepare(
        `
      SELECT COUNT(*) as total
      FROM sites
      WHERE is_wordpress = ? AND (url LIKE ? OR search_query LIKE ?)
    `,
      )
      .get(isWordPress ? 1 : 0, `%${searchQuery}%`, `%${searchQuery}%`);
  } else {
    sites = db
      .prepare(
        `
      SELECT
        id,
        url,
        is_wordpress,
        confidence_score,
        indicators,
        error,
        search_query,
        emails,
        phones,
        ai_status,
        classification,
        relevance_score,
        tags,
        primary_language,
        value_proposition,
        ai_reasoning,
        ai_verified_wp,
        ai_wp_confidence,
        ai_wp_indicators,
        ai_content_relevant,
        ai_actual_category,
        ai_content_summary,
        ai_mismatch_reason,
        checked_at
      FROM sites
      WHERE is_wordpress = ?
      ORDER BY checked_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(isWordPress ? 1 : 0, limit, offset);

    countResult = db
      .prepare(
        `
      SELECT COUNT(*) as total
      FROM sites
      WHERE is_wordpress = ?
    `,
      )
      .get(isWordPress ? 1 : 0);
  }

  db.close();

  return {
    sites,
    pagination: {
      page,
      limit,
      total: countResult.total,
      totalPages: Math.ceil(countResult.total / limit),
    },
  };
}

/**
 * Get all sites with pagination
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @param {string} searchQuery - Optional search filter
 * @param {string} filter - Filter type
 * @param {string} category - Category filter
 * @returns {Object} - Sites with pagination info
 */
function getAllSites(page = 1, limit = 50, searchQuery = null, filter = "all", category = null) {
  const db = initDatabase();
  const offset = (page - 1) * limit;

  let whereClauses = [];
  let params = [];

  if (searchQuery && searchQuery.trim() !== "") {
    whereClauses.push("(url LIKE ? OR search_query LIKE ?)");
    params.push(`%${searchQuery}%`, `%${searchQuery}%`);
  }

  if (filter === "wordpress") whereClauses.push("is_wordpress = 1");
  else if (filter === "non-wordpress") whereClauses.push("is_wordpress = 0");
  else if (filter === "verified-wp") whereClauses.push("ai_verified_wp = 1");
  else if (filter === "not-wp") whereClauses.push("ai_verified_wp = 0");
  else if (filter === "content-relevant") whereClauses.push("ai_content_relevant = 1");
  else if (filter === "content-mismatch") whereClauses.push("ai_content_relevant = 0");
  else if (filter === "ai-pending") whereClauses.push("is_wordpress = 1 AND (ai_status = 'pending' OR ai_status IS NULL)");

  // Category filter
  if (category && category !== "all") {
    whereClauses.push("ai_actual_category = ?");
    params.push(category);
  }

  const whereSql =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const sites = db
    .prepare(
      `
    SELECT
      id, url, is_wordpress, confidence_score, indicators, error,
      search_query, emails, phones, ai_status, classification,
      relevance_score, tags, primary_language, value_proposition,
      ai_reasoning, ai_verified_wp, ai_wp_confidence, ai_wp_indicators,
      ai_content_relevant, ai_actual_category, ai_content_summary,
      ai_mismatch_reason, checked_at
    FROM sites
    ${whereSql}
    ORDER BY checked_at DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(...params, limit, offset);

  const countResult = db
    .prepare(
      `
    SELECT COUNT(*) as total
    FROM sites
    ${whereSql}
  `,
    )
    .get(...params);

  db.close();

  return {
    sites,
    pagination: {
      page,
      limit,
      total: countResult.total,
      totalPages: Math.ceil(countResult.total / limit),
    },
  };
}

// ============ AI ENRICHMENT OPERATIONS ============

/**
 * Get distinct AI categories
 * @returns {Array} - Array of unique category strings
 */
function getDistinctCategories() {
  const db = initDatabase();
  try {
    const rows = db.prepare(`
      SELECT DISTINCT ai_actual_category 
      FROM sites 
      WHERE ai_actual_category IS NOT NULL AND ai_actual_category != ''
      ORDER BY ai_actual_category ASC
    `).all();
    return rows.map(r => r.ai_actual_category);
  } finally {
    db.close();
  }
}

/**
 * Get sites that are pending AI enrichment
 * @param {number} limit - Maximum number of sites to return
 * @returns {Array} - Array of sites needing AI processing
 */
function getPendingAISites(limit = 10) {
  const db = initDatabase();
  const sites = db
    .prepare(
      `
    SELECT id, url, text_content, search_query
    FROM sites
    WHERE ai_status = 'pending' AND text_content IS NOT NULL AND text_content != ''
    ORDER BY checked_at DESC
    LIMIT ?
  `,
    )
    .all(limit);

  db.close();
  return sites;
}

/**
 * Get a single site by ID
 * @param {number} id - Site ID
 * @returns {Object|null} - Site object or null if not found
 */
function getSiteById(id) {
  const db = initDatabase();
  const site = db
    .prepare(
      `
    SELECT * FROM sites WHERE id = ?
  `,
    )
    .get(id);

  db.close();
  return site || null;
}

/**
 * Update a site with AI classification results
 * @param {number} siteId - The ID of the site
 * @param {Object} aiData - The structured AI response
 * @returns {boolean} - True if successful
 */
function updateSiteAIResults(siteId, aiData) {
  const db = initDatabase();

  try {
    db.exec('PRAGMA foreign_keys = OFF');
    const result = db
      .prepare(
        `
      UPDATE sites
      SET
        ai_status = 'completed',
        classification = ?,
        relevance_score = ?,
        tags = ?,
        primary_language = ?,
        value_proposition = ?,
        ai_reasoning = ?,
        ai_is_wordpress = ?,
        ai_is_genuine_match = ?
      WHERE id = ?
    `,
      )
      .run(
        aiData.classification || null,
        aiData.relevanceScore || 0,
        aiData.tags ? JSON.stringify(aiData.tags) : null,
        aiData.primaryLanguage || null,
        aiData.valueProposition || null,
        aiData.reasoning || null,
        aiData.isLikelyWordPress === true
          ? 1
          : aiData.isLikelyWordPress === false
          ? 0
          : null,
        aiData.isGenuineMatch === true
          ? 1
          : aiData.isGenuineMatch === false
          ? 0
          : null,
        siteId,
      );

    return result.changes > 0;
  } catch (error) {
    console.error(`Error updating AI results for site ${siteId}:`, error);
    return false;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Mark a site's AI status as failed or skipped
 * @param {number} siteId - The ID of the site
 * @param {string} status - 'failed' or 'skipped'
 */
function updateSiteAIStatus(siteId, status) {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.prepare(`UPDATE sites SET ai_status = ? WHERE id = ?`).run(status, siteId);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Get emails with pagination and site info
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @param {string} search - Optional search filter
 * @returns {Object} - Emails with pagination
 */
function getEmails(page = 1, limit = 50, search = null) {
  const db = initDatabase();
  const offset = (page - 1) * limit;

  let emails;
  let countResult;

  if (search && search.trim() !== "") {
    emails = db
      .prepare(
        `
      SELECT
        c.id,
        c.value as email,
        c.source_page,
        c.created_at,
        s.url as site_url,
        s.is_wordpress,
        s.search_query
      FROM contacts c
      INNER JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'email' AND c.value LIKE ?
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(`%${search}%`, limit, offset);

    countResult = db
      .prepare(
        `
      SELECT COUNT(*) as total
      FROM contacts c
      WHERE c.type = 'email' AND c.value LIKE ?
    `,
      )
      .get(`%${search}%`);
  } else {
    emails = db
      .prepare(
        `
      SELECT
        c.id,
        c.value as email,
        c.source_page,
        c.created_at,
        s.url as site_url,
        s.is_wordpress,
        s.search_query
      FROM contacts c
      INNER JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'email'
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(limit, offset);

    countResult = db
      .prepare(
        `
      SELECT COUNT(*) as total
      FROM contacts
      WHERE type = 'email'
    `,
      )
      .get();
  }

  db.close();

  return {
    emails,
    pagination: {
      page,
      limit,
      total: countResult.total,
      totalPages: Math.ceil(countResult.total / limit),
    },
  };
}

/**
 * Get a single email contact by ID
 * @param {number} id - Contact ID
 * @returns {Object|null} - Email contact with site info or null
 */
function getEmailById(id) {
  const db = initDatabase();
  try {
    const email = db.prepare(`
      SELECT
        c.id,
        c.value as email,
        c.source_page,
        c.created_at,
        s.url as site_url,
        s.is_wordpress,
        s.search_query
      FROM contacts c
      INNER JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'email' AND c.id = ?
    `).get(id);

    return email || null;
  } finally {
    db.close();
  }
}

/**
 * Get a single phone contact by ID
 * @param {number} id - Contact ID
 * @returns {Object|null} - Phone contact with site info or null
 */
function getPhoneById(id) {
  const db = initDatabase();
  try {
    const phone = db.prepare(`
      SELECT
        c.id,
        c.value as phone,
        c.source_page,
        c.created_at,
        s.url as site_url,
        s.is_wordpress,
        s.search_query
      FROM contacts c
      INNER JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'phone' AND c.id = ?
    `).get(id);

    return phone || null;
  } finally {
    db.close();
  }
}

/**
 * Get a single LinkedIn contact by ID
 * @param {number} id - Contact ID
 * @returns {Object|null} - LinkedIn contact with site info or null
 */
function getLinkedinById(id) {
  const db = initDatabase();
  try {
    const linkedin = db.prepare(`
      SELECT
        c.id,
        c.value as linkedin_url,
        c.source_page,
        c.created_at,
        s.url as site_url,
        s.is_wordpress,
        s.search_query
      FROM contacts c
      INNER JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'linkedin' AND c.id = ?
    `).get(id);

    return linkedin || null;
  } finally {
    db.close();
  }
}

/**
 * Get phones with pagination and site info
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @param {string} search - Optional search filter
 * @returns {Object} - Phones with pagination
 */
function getPhones(page = 1, limit = 50, search = null) {
  const db = initDatabase();
  const offset = (page - 1) * limit;

  let phones;
  let countResult;

  if (search && search.trim() !== "") {
    phones = db
      .prepare(
        `
      SELECT
        c.id,
        c.value as phone,
        c.source_page,
        c.created_at,
        s.url as site_url,
        s.is_wordpress,
        s.search_query
      FROM contacts c
      INNER JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'phone' AND c.value LIKE ?
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(`%${search}%`, limit, offset);

    countResult = db
      .prepare(
        `
      SELECT COUNT(*) as total
      FROM contacts c
      WHERE c.type = 'phone' AND c.value LIKE ?
    `,
      )
      .get(`%${search}%`);
  } else {
    phones = db
      .prepare(
        `
      SELECT
        c.id,
        c.value as phone,
        c.source_page,
        c.created_at,
        s.url as site_url,
        s.is_wordpress,
        s.search_query
      FROM contacts c
      INNER JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'phone'
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(limit, offset);

    countResult = db
      .prepare(
        `
      SELECT COUNT(*) as total
      FROM contacts
      WHERE type = 'phone'
    `,
      )
      .get();
  }

  db.close();

  return {
    phones,
    pagination: {
      page,
      limit,
      total: countResult.total,
      totalPages: Math.ceil(countResult.total / limit),
    },
  };
}

/**
 * Normalize URL for duplicate detection
 * @param {string} url - URL to normalize
 * @returns {string} - Normalized URL
 */
function normalizeUrl(url) {
  try {
    let normalized = url.toLowerCase().trim();

    // Remove protocol
    normalized = normalized.replace(/^https?:\/\//, "");

    // Remove www
    normalized = normalized.replace(/^www\./, "");

    // Remove trailing slash
    normalized = normalized.replace(/\/$/, "");

    // Remove hash fragments
    normalized = normalized.split("#")[0];

    // Remove query parameters that are common tracking IDs (like srsltid, utm_*, gclid, etc.)
    if (normalized.includes("?")) {
      const [base, query] = normalized.split("?");
      const params = new URLSearchParams(query);
      const trackingParams = ["srsltid", "gclid", "fbclid", "msclkid"];
      
      // Remove specific tracking params
      trackingParams.forEach(p => params.delete(p));
      
      // Remove all utm_ parameters
      const keys = Array.from(params.keys());
      keys.forEach(key => {
        if (key.startsWith("utm_")) {
          params.delete(key);
        }
      });

      const newQuery = params.toString();
      normalized = newQuery ? `${base}?${newQuery}` : base;
    }

    return normalized;
  } catch (e) {
    return url;
  }
}

/**
 * Check if a URL already exists in the database
 * @param {string} url - URL to check
 * @returns {boolean} - True if URL exists
 */
function urlExists(url) {
  const db = initDatabase();
  const normalized = normalizeUrl(url);

  const result = db
    .prepare(
      `
    SELECT url FROM sites
  `,
    )
    .all();

  db.close();

  // Check if any normalized URL matches
  return result.some((site) => normalizeUrl(site.url) === normalized);
}

/**
 * Get all existing URLs from the database (normalized)
 * @returns {Set} - Set of all normalized URLs
 */
function getAllExistingUrls() {
  const db = initDatabase();
  const urls = db
    .prepare(
      `
    SELECT url FROM sites
  `,
    )
    .all();
  db.close();

  // Return a Set of normalized URLs for fast lookup
  const normalizedSet = new Set();
  urls.forEach((u) => {
    normalizedSet.add(normalizeUrl(u.url));
  });

  return normalizedSet;
}

/**
 * Get all contacts with filtering
 * @param {string} type - 'email', 'phone', 'linkedin', or 'all'
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @param {string} search - Optional search filter
 * @returns {Object} - Contacts with pagination
 */
function getAllContacts(type = "all", page = 1, limit = 50, search = null) {
  const db = initDatabase();
  const offset = (page - 1) * limit;

  let contacts;
  let countResult;
  let whereClause = "1=1";
  const params = [];

  if (type !== "all") {
    whereClause = "c.type = ?";
    params.push(type);
  }

  if (search && search.trim() !== "") {
    whereClause += (type !== "all" ? " AND " : "WHERE ") + "c.value LIKE ?";
    params.push(`%${search}%`);
  }

  contacts = db
    .prepare(
      `
    SELECT
      c.id,
      c.type,
      c.value,
      c.source_page,
      c.created_at,
      s.url as site_url,
      s.is_wordpress,
      s.search_query
    FROM contacts c
    INNER JOIN sites s ON c.site_id = s.id
    WHERE ${whereClause}
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(...params, limit, offset);

  // Count query
  const countParams = [...params];
  countResult = db
    .prepare(
      `
    SELECT COUNT(*) as total
    FROM contacts c
    INNER JOIN sites s ON c.site_id = s.id
    WHERE ${whereClause}
  `,
    )
    .get(...countParams);

  db.close();

  return {
    contacts,
    pagination: {
      page,
      limit,
      total: countResult.total,
      totalPages: Math.ceil(countResult.total / limit),
    },
  };
}

/**
 * Get LinkedIn profiles with pagination and site info
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @param {string} search - Optional search filter
 * @returns {Object} - LinkedIn profiles with pagination
 */
function getLinkedinProfiles(page = 1, limit = 50, search = null) {
  const db = initDatabase();
  const offset = (page - 1) * limit;

  let profiles;
  let countResult;

  if (search && search.trim() !== "") {
    profiles = db
      .prepare(
        `
      SELECT
        c.id,
        c.value as linkedin_url,
        c.source_page,
        c.created_at,
        s.url as site_url,
        s.is_wordpress,
        s.search_query
      FROM contacts c
      INNER JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'linkedin' AND c.value LIKE ?
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(`%${search}%`, limit, offset);

    countResult = db
      .prepare(
        `
      SELECT COUNT(*) as total
      FROM contacts c
      WHERE c.type = 'linkedin' AND c.value LIKE ?
    `,
      )
      .get(`%${search}%`);
  } else {
    profiles = db
      .prepare(
        `
      SELECT
        c.id,
        c.value as linkedin_url,
        c.source_page,
        c.created_at,
        s.url as site_url,
        s.is_wordpress,
        s.search_query
      FROM contacts c
      INNER JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'linkedin'
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(limit, offset);

    countResult = db
      .prepare(
        `
      SELECT COUNT(*) as total
      FROM contacts
      WHERE type = 'linkedin'
    `,
      )
      .get();
  }

  db.close();

  return {
    linkedin_profiles: profiles,
    pagination: {
      page,
      limit,
      total: countResult.total,
      totalPages: Math.ceil(countResult.total / limit),
    },
  };
}

/**
 * Get enhanced contact statistics including LinkedIn
 * @returns {Object} - Enhanced contact stats
 */
function getContactStats() {
  const db = initDatabase();

  const stats = db
    .prepare(
      `
    SELECT
      (SELECT COUNT(*) FROM contacts WHERE type = 'email') as total_emails,
      (SELECT COUNT(*) FROM contacts WHERE type = 'phone') as total_phones,
      (SELECT COUNT(*) FROM contacts WHERE type = 'linkedin') as total_linkedin,
      (SELECT COUNT(DISTINCT site_id) FROM contacts WHERE type = 'email') as sites_with_emails,
      (SELECT COUNT(DISTINCT site_id) FROM contacts WHERE type = 'phone') as sites_with_phones,
      (SELECT COUNT(DISTINCT site_id) FROM contacts WHERE type = 'linkedin') as sites_with_linkedin,
      (SELECT COUNT(DISTINCT site_id) FROM contacts) as sites_with_contacts
  `,
    )
    .get();

  db.close();
  return stats;
}

// ============ COMPANY EXECUTIVES OPERATIONS ============

/**
 * Save company executive to database
 * @param {Object} executive - Executive data
 * @returns {Object} - Saved executive
 */
function saveExecutive(executive) {
  const db = initDatabase();

  try {
    db.exec('PRAGMA foreign_keys = OFF');
    const result = db
      .prepare(
        `
      INSERT INTO company_executives (
        site_id,
        company_url,
        company_name,
        profile_url,
        name,
        headline,
        role_category
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        executive.site_id,
        executive.company_url,
        executive.company_name || null,
        executive.profile_url,
        executive.name || null,
        executive.headline || null,
        executive.role_category || null,
      );

    return { success: true, id: result.lastInsertRowid };
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return { success: false, error: "Profile already exists" };
    }
    return { success: false, error: err.message };
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Get all company executives with pagination
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @param {string} search - Optional search filter
 * @param {string} roleCategory - Optional role category filter
 * @returns {Object} - Executives with pagination
 */
function getCompanyExecutives(
  page = 1,
  limit = 50,
  search = null,
  roleCategory = null,
) {
  const db = initDatabase();
  const offset = (page - 1) * limit;

  let executives;
  let countResult;
  let whereClause = "1=1";
  const params = [];

  if (roleCategory && roleCategory !== "all") {
    whereClause = "ce.role_category = ?";
    params.push(roleCategory);
  }

  if (search && search.trim() !== "") {
    whereClause +=
      (roleCategory && roleCategory !== "all" ? " AND " : "WHERE ") +
      "(ce.name LIKE ? OR ce.company_name LIKE ? OR ce.headline LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  executives = db
    .prepare(
      `
    SELECT
      ce.id,
      ce.company_url,
      ce.company_name,
      ce.profile_url,
      ce.name,
      ce.headline,
      ce.role_category,
      ce.created_at,
      s.url as site_url
    FROM company_executives ce
    INNER JOIN sites s ON ce.site_id = s.id
    WHERE ${whereClause}
    ORDER BY ce.created_at DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(...params, limit, offset);

  // Count query
  const countParams = [...params];
  countResult = db
    .prepare(
      `
    SELECT COUNT(*) as total
    FROM company_executives ce
    INNER JOIN sites s ON ce.site_id = s.id
    WHERE ${whereClause}
  `,
    )
    .get(...countParams);

  db.close();

  return {
    executives,
    pagination: {
      page,
      limit,
      total: countResult.total,
      totalPages: Math.ceil(countResult.total / limit),
    },
  };
}

/**
 * Get executives statistics
 * @returns {Object} - Statistics
 */
function getExecutivesStats() {
  const db = initDatabase();

  const stats = db
    .prepare(
      `
    SELECT
      COUNT(*) as total_executives,
      COUNT(DISTINCT company_url) as total_companies,
      COUNT(DISTINCT site_id) as total_sites,
      SUM(CASE WHEN role_category = 'founder' THEN 1 ELSE 0 END) as founders,
      SUM(CASE WHEN role_category = 'co-founder' THEN 1 ELSE 0 END) as co_founders,
      SUM(CASE WHEN role_category = 'ceo' THEN 1 ELSE 0 END) as ceos,
      SUM(CASE WHEN role_category = 'cto' THEN 1 ELSE 0 END) as ctos,
      SUM(CASE WHEN role_category = 'president' THEN 1 ELSE 0 END) as presidents,
      SUM(CASE WHEN role_category = 'owner' THEN 1 ELSE 0 END) as owners
    FROM company_executives
  `,
    )
    .get();

  db.close();
  return stats;
}

/**
 * Get executives by company URL
 * @param {string} companyUrl - LinkedIn company URL
 * @returns {Array} - Array of executives
 */
function getExecutivesByCompany(companyUrl) {
  const db = initDatabase();

  const executives = db
    .prepare(
      `
    SELECT * FROM company_executives
    WHERE company_url = ?
    ORDER BY role_category, name
  `,
    )
    .all(companyUrl);

  db.close();
  return executives;
}

/**
 * Get structured executives grouped by company with fixed 5 role slots:
 * Founder 1, Founder 2, Founder 3, CEO, CTO
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @param {string} search - Optional search filter
 * @returns {Object} - Structured executives with pagination
 */
function getStructuredExecutives(page = 1, limit = 20, search = null) {
  const db = initDatabase();
  const offset = (page - 1) * limit;

  let whereClause = '1=1';
  const params = [];

  if (search && search.trim() !== '') {
    whereClause = '(ce.company_name LIKE ? OR ce.name LIKE ? OR ce.headline LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  // Get distinct companies with pagination
  const countResult = db.prepare(`
    SELECT COUNT(DISTINCT ce.company_url) as total
    FROM company_executives ce
    INNER JOIN sites s ON ce.site_id = s.id
    WHERE ${whereClause}
  `).get(...params);

  const companies = db.prepare(`
    SELECT DISTINCT
      ce.company_url,
      ce.company_name,
      ce.site_id,
      s.url as site_url
    FROM company_executives ce
    INNER JOIN sites s ON ce.site_id = s.id
    WHERE ${whereClause}
    ORDER BY ce.company_name
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // For each company, get all executives and structure into 5 slots
  const founderRoles = ['founder', 'co-founder', 'owner'];
  const structured = companies.map((company) => {
    const execs = db.prepare(`
      SELECT id, name, headline, profile_url, role_category
      FROM company_executives
      WHERE company_url = ?
      ORDER BY 
        CASE role_category
          WHEN 'founder' THEN 1
          WHEN 'co-founder' THEN 2
          WHEN 'owner' THEN 3
          ELSE 4
        END,
        name
    `).all(company.company_url);

    // Pick up to 3 founders (founder > co-founder > owner priority)
    const founders = execs.filter((e) => founderRoles.includes(e.role_category)).slice(0, 3);
    const ceo = execs.find((e) => e.role_category === 'ceo') || null;
    const cto = execs.find((e) => e.role_category === 'cto') || null;

    return {
      company_url: company.company_url,
      company_name: company.company_name || 'Unknown',
      site_id: company.site_id,
      site_url: company.site_url,
      founder1: founders[0] || null,
      founder2: founders[1] || null,
      founder3: founders[2] || null,
      ceo: ceo,
      cto: cto,
    };
  });

  db.close();

  return {
    companies: structured,
    pagination: {
      page,
      limit,
      total: countResult.total,
      totalPages: Math.ceil(countResult.total / limit),
    },
  };
}

// ============ AI ENRICHMENT ============

/**
 * Update a site with AI enrichment results
 * @param {number} siteId - ID of the site
 * @param {Object} aiData - The parsed JSON data from OpenAI
 * @returns {boolean} - True if successful
 */
function updateSiteAIResults(siteId, aiData) {
  const db = initDatabase();

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const result = db
      .prepare(
        `
      UPDATE sites
      SET
        ai_processed = 1,
        ai_status = 'completed',
        classification = ?,
        relevance_score = ?,
        tags = ?,
        primary_language = ?,
        value_proposition = ?,
        ai_reasoning = ?
      WHERE id = ?
    `,
      )
      .run(
        aiData.classification || null,
        aiData.relevanceScore || 0,
        aiData.tags ? JSON.stringify(aiData.tags) : null,
        aiData.primaryLanguage || null,
        aiData.valueProposition || null,
        aiData.reasoning || null,
        siteId,
      );

    return result.changes > 0;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Mark a site's AI status (e.g., if there was an error processing it)
 * @param {number} siteId - ID of the site
 * @param {number} status - Status code (1 = processed, 0 = pending/error)
 * @returns {boolean} - True if successful
 */
function updateSiteAIStatus(siteId, status) {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const result = db
      .prepare("UPDATE sites SET ai_processed = 1, ai_status = ? WHERE id = ?")
      .run(status, siteId);
    return result.changes > 0;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

// ============ NEW CRUD OPERATIONS ============

/**
 * Delete a site and cascade delete its contacts/executives
 * @param {number} id - Site ID
 * @returns {boolean} - Success
 */
function deleteSite(id) {
  const db = initDatabase();
  // Disable foreign key constraints to allow force deletion
  db.exec('PRAGMA foreign_keys = OFF');

  try {
    // Manually delete related data to ensure cascade
    db.prepare("DELETE FROM contacts WHERE site_id = ?").run(id);
    db.prepare("DELETE FROM company_executives WHERE site_id = ?").run(id);
    const result = db.prepare("DELETE FROM sites WHERE id = ?").run(id);
    return result.changes > 0;
  } finally {
    // Re-enable foreign key constraints
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Bulk delete multiple sites
 * @param {number[]} ids - Array of site IDs to delete
 * @returns {number} - Number of deleted sites
 */
function bulkDeleteSites(ids) {
  if (!ids || ids.length === 0) return 0;
  const db = initDatabase();
  // Disable foreign key constraints to allow force deletion
  db.exec('PRAGMA foreign_keys = OFF');

  try {
    const placeholders = ids.map(() => '?').join(',');
    // Manually delete related data to ensure cascade
    db.prepare(`DELETE FROM contacts WHERE site_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM company_executives WHERE site_id IN (${placeholders})`).run(...ids);
    const result = db.prepare(`DELETE FROM sites WHERE id IN (${placeholders})`).run(...ids);
    return result.changes;
  } finally {
    // Re-enable foreign key constraints
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Get deletion preview - counts of related data that will be deleted
 * @param {number[]} ids - Array of site IDs
 * @returns {Object} - Counts of related data
 */
function getSiteDeletionPreview(ids) {
  if (!ids || ids.length === 0) return { sites: 0, emails: 0, phones: 0, linkedins: 0, executives: 0 };
  const db = initDatabase();
  const placeholders = ids.map(() => '?').join(',');
  
  const sites = ids.length;
  const emails = db.prepare(`SELECT COUNT(*) as count FROM contacts WHERE site_id IN (${placeholders}) AND type = 'email'`).get(...ids).count;
  const phones = db.prepare(`SELECT COUNT(*) as count FROM contacts WHERE site_id IN (${placeholders}) AND type = 'phone'`).get(...ids).count;
  const linkedins = db.prepare(`SELECT COUNT(*) as count FROM contacts WHERE site_id IN (${placeholders}) AND type = 'linkedin'`).get(...ids).count;
  const executives = db.prepare(`SELECT COUNT(*) as count FROM company_executives WHERE site_id IN (${placeholders})`).get(...ids).count;
  
  db.close();
  return { sites, emails, phones, linkedins, executives };
}

/**
 * Update a site
 * @param {number} id - Site ID
 * @param {Object} data - Update data
 * @returns {boolean} - Success
 */
function updateSite(id, data) {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const result = db
      .prepare(
        `
      UPDATE sites
      SET confidence_score = ?, indicators = ?
      WHERE id = ?
    `,
      )
      .run(data.confidence_score || 0, data.indicators || "", id);
    return result.changes > 0;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Delete a contact (email/phone/linkedin)
 * @param {number} id - Contact ID
 * @returns {boolean} - Success
 */
function deleteContact(id) {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const result = db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
    return result.changes > 0;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Update a contact
 * @param {number} id - Contact ID
 * @param {Object} data - Update data
 * @returns {boolean} - Success
 */
function updateContact(id, data) {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const result = db
      .prepare(
        `
      UPDATE contacts
      SET value = ?
      WHERE id = ?
    `,
      )
      .run(data.value, id);
    return result.changes > 0;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Delete an executive
 * @param {number} id - Executive ID
 * @returns {boolean} - Success
 */
function deleteExecutive(id) {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const result = db
      .prepare("DELETE FROM company_executives WHERE id = ?")
      .run(id);
    return result.changes > 0;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Update an executive
 * @param {number} id - Executive ID
 * @param {Object} data - Update data
 * @returns {boolean} - Success
 */
function updateExecutive(id, data) {
  const db = initDatabase();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const result = db
      .prepare(
        `
      UPDATE company_executives
      SET name = ?, role_category = ?, headline = ?, profile_url = ?
      WHERE id = ?
    `,
      )
      .run(
        data.name || null,
        data.role_category || null,
        data.headline || null,
        data.profile_url || null,
        id,
      );
    return result.changes > 0;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

/**
 * Delete ALL data from the database (factory reset).
 * Deletes everything in correct order to avoid FK constraints.
 * @returns {Object} - Counts of deleted rows per table
 */
function deleteAllData() {
  const db = initDatabase();
  const counts = {};

  // Disable foreign keys to allow force deletion
  db.exec('PRAGMA foreign_keys = OFF');

  try {
    // Email tables (via shared db, but we'll use this db instance)
    try { counts.email_send_log = db.prepare("DELETE FROM email_send_log").run().changes; } catch (e) { counts.email_send_log = 0; }
    try { counts.email_queue = db.prepare("DELETE FROM email_queue").run().changes; } catch (e) { counts.email_queue = 0; }
    try { counts.email_campaigns = db.prepare("DELETE FROM email_campaigns").run().changes; } catch (e) { counts.email_campaigns = 0; }
    try { counts.email_templates = db.prepare("DELETE FROM email_templates").run().changes; } catch (e) { counts.email_templates = 0; }
    try { counts.email_senders = db.prepare("DELETE FROM email_senders").run().changes; } catch (e) { counts.email_senders = 0; }

    // Core data tables (order matters for FK)
    counts.company_executives = db.prepare("DELETE FROM company_executives").run().changes;
    counts.contacts = db.prepare("DELETE FROM contacts").run().changes;
    counts.sites = db.prepare("DELETE FROM sites").run().changes;
    counts.searches = db.prepare("DELETE FROM searches").run().changes;
    counts.keywords = db.prepare("DELETE FROM keywords").run().changes;
    counts.excluded_domains = db.prepare("DELETE FROM excluded_domains").run().changes;

    return counts;
  } finally {
    // Re-enable foreign keys
    db.exec('PRAGMA foreign_keys = ON');
    db.close();
  }
}

module.exports = {
  initDatabase,
  saveSearchResults,
  getAllSearches,
  getSearchById,
  getAllWordpressSites,
  getStatistics,
  exportToJSON,
  DB_PATH,
  // Keyword CRUD
  getAllKeywords,
  getKeywordById,
  addKeyword,
  updateKeyword,
  deleteKeyword,
  updateKeywordStatus,
  getSitesByWordpressStatus,
  getAllSites,
  getSiteById,
  getDistinctCategories,
  // Contact retrieval
  getEmails,
  getEmailById,
  getPhoneById,
  getPhones,
  getLinkedinById,
  getContactStats,
  getAllContacts,
  getLinkedinProfiles,
  // Duplicate checking
  urlExists,
  getAllExistingUrls,
  normalizeUrl,
  // Company executives
  saveExecutive,
  getCompanyExecutives,
  getExecutivesStats,
  getExecutivesByCompany,
  getStructuredExecutives,
  // AI Enrichment
  getPendingAISites,
  updateSiteAIResults,
  updateSiteAIStatus,
  // New CRUD operations
  deleteSite,
  bulkDeleteSites,
  getSiteDeletionPreview,
  updateSite,
  deleteContact,
  updateContact,
  deleteExecutive,
  updateExecutive,
  // Excluded domains
  getAllExcludedDomains,
  getExcludedDomainById,
  addExcludedDomain,
  updateExcludedDomain,
  deleteExcludedDomain,
  isUrlExcluded,
  filterExcludedUrls,
  extractDomain,
  // Ignored tags
  getAllIgnoredTags,
  getIgnoredTagById,
  addIgnoredTag,
  updateIgnoredTag,
  deleteIgnoredTag,
  isUrlIgnored,
  isContentIgnored,
  filterIgnoredUrls,
  // Reset
  deleteAllData,
  // Low-level SQLite wrappers (used by email-senders-templates-api.js & email-queue-worker.js)
  run,
  all,
  get,
  prepare,
};
