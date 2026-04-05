/**
 * PostgreSQL Database Module
 *
 * Refactored from SQLite to PostgreSQL using db-adapter.
 * All functions are now async and use the PostgreSQL connection pool.
 *
 * IMPORTANT CHANGES FROM SQLite:
 * - All database calls are now async (use await)
 * - Removed db.close() calls (pool manages connections)
 * - lastInsertRowid -> lastInsertId
 * - Result.changes -> Result.rows (but changes also works for compatibility)
 */

const {
  initializePool,
  run,
  get,
  all,
  query,
  transaction,
  healthCheck,
  getPoolStats,
} = require("./db-adapter");

let isInitialized = false;

// ============ INITIALIZATION ============

/**
 * Initialize the database connection pool
 * Call this once at application startup (e.g., in server.js)
 * @param {string} connectionString - PostgreSQL connection string (default: process.env.DATABASE_URL)
 */
function initDatabase(connectionString = process.env.DATABASE_URL) {
  if (!isInitialized) {
    initializePool(connectionString, {
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    isInitialized = true;
  }
  // Return the db functions for convenience
  return { run, get, all, query, transaction };
}

// ============ SEARCH OPERATIONS ============

/**
 * Save search results to database
 * @param {string} query - Search query used
 * @param {Array} results - Array of site check results
 * @param {string} country - Country code (default: 'in')
 * @returns {Promise<number>} - The search ID
 */
async function saveSearchResults(query, results, country = "in") {
  try {
    const wordpressCount = results.filter((r) => r.isWordPress).length;
    const nonWordpressCount = results.length - wordpressCount;

    // Use transaction for atomic insert
    const searchId = await transaction(async (db) => {
      // Insert search record
      const searchResult = await db.run(
        `INSERT INTO searches (query, country, total_sites, wordpress_count, non_wordpress_count)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
        [query, country, results.length, wordpressCount, nonWordpressCount]
      );

      const insertedSearchId = searchResult.lastInsertId;

      // Insert site records and contacts
      for (const site of results) {
        const siteResult = await db.run(
          `INSERT INTO sites (
            search_id, url, country, is_wordpress, confidence_score,
            indicators, error, search_query, emails, phones,
            linkedin_profiles, text_content, page_title, meta_description
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          [
            insertedSearchId,
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
          ]
        );

        const siteId = siteResult.lastInsertId;

        // Insert contacts (legacy support for contacts table)
        if (site.emails && site.emails.length > 0) {
          for (const email of site.emails) {
            await db.run(
              `INSERT INTO contacts (site_id, type, value, source_page) VALUES (?, ?, ?, ?)`,
              [siteId, "email", email, site.url]
            );
          }
        }
        if (site.phones && site.phones.length > 0) {
          for (const phone of site.phones) {
            await db.run(
              `INSERT INTO contacts (site_id, type, value, source_page) VALUES (?, ?, ?, ?)`,
              [siteId, "phone", phone, site.url]
            );
          }
        }
        if (site.linkedin_profiles && site.linkedin_profiles.length > 0) {
          for (const linkedin of site.linkedin_profiles) {
            await db.run(
              `INSERT INTO contacts (site_id, type, value, source_page) VALUES (?, ?, ?, ?)`,
              [siteId, "linkedin", linkedin, site.url]
            );
          }
        }
      }

      return insertedSearchId;
    });

    return searchId;
  } catch (error) {
    console.error("Error saving search results:", error);
    throw error;
  }
}

/**
 * Get all searches
 * @returns {Promise<Array>} - Array of searches
 */
async function getAllSearches() {
  try {
    const searches = await all(
      `SELECT id, query, total_sites, wordpress_count, non_wordpress_count, created_at
       FROM searches
       ORDER BY created_at DESC`
    );
    return searches;
  } catch (error) {
    console.error("Error getting all searches:", error);
    throw error;
  }
}

/**
 * Get search by ID with all sites
 * @param {number} searchId - Search ID
 * @returns {Promise<Object|null>} - Search with sites or null
 */
async function getSearchById(searchId) {
  try {
    const search = await get(`SELECT * FROM searches WHERE id = ?`, [searchId]);

    if (!search) {
      return null;
    }

    const sites = await all(`SELECT * FROM sites WHERE search_id = ?`, [searchId]);

    return {
      ...search,
      sites,
    };
  } catch (error) {
    console.error("Error getting search by ID:", error);
    throw error;
  }
}

/**
 * Get all WordPress sites across all searches
 * @returns {Promise<Array>} - WordPress sites
 */
async function getAllWordpressSites() {
  try {
    const sites = await all(
      `SELECT s.*, sc.query as search_query, sc.created_at as search_date
       FROM sites s
       JOIN searches sc ON s.search_id = sc.id
       WHERE s.is_wordpress = 1
       ORDER BY s.checked_at DESC`
    );
    return sites;
  } catch (error) {
    console.error("Error getting all WordPress sites:", error);
    throw error;
  }
}

/**
 * Get statistics
 * @returns {Promise<Object>} - Statistics
 */
async function getStatistics() {
  try {
    const stats = await get(
      `SELECT
        COUNT(DISTINCT id) as total_searches,
        SUM(total_sites) as total_sites_checked,
        SUM(wordpress_count) as total_wordpress_sites,
        SUM(non_wordpress_count) as total_non_wordpress_sites
       FROM searches`
    );

    const topQueries = await all(
      `SELECT query, COUNT(*) as search_count, SUM(wordpress_count) as wordpress_found
       FROM searches
       GROUP BY query
       ORDER BY search_count DESC
       LIMIT 10`
    );

    return {
      ...stats,
      topQueries,
    };
  } catch (error) {
    console.error("Error getting statistics:", error);
    throw error;
  }
}

/**
 * Export database to JSON
 * @param {string} outputPath - Output file path
 * @returns {Promise<void>}
 */
async function exportToJSON(outputPath) {
  try {
    const searches = await all(`SELECT * FROM searches ORDER BY created_at DESC`);

    const data = await Promise.all(
      searches.map(async (search) => {
        const sites = await all(`SELECT * FROM sites WHERE search_id = ?`, [search.id]);
        return {
          ...search,
          sites,
        };
      })
    );

    const fs = require("fs");
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

    console.log(`\n Data exported to ${outputPath}`);
  } catch (error) {
    console.error("Error exporting to JSON:", error);
    throw error;
  }
}

// ============ KEYWORD CRUD OPERATIONS ============

/**
 * Get all keywords
 * @returns {Promise<Array>} - Array of keywords
 */
async function getAllKeywords() {
  try {
    const keywords = await all(
      `SELECT * FROM keywords ORDER BY created_at DESC`
    );
    return keywords;
  } catch (error) {
    console.error("Error getting all keywords:", error);
    throw error;
  }
}

/**
 * Get keyword by ID
 * @param {number} id - Keyword ID
 * @returns {Promise<Object|null>} - Keyword or null
 */
async function getKeywordById(id) {
  try {
    const keyword = await get(`SELECT * FROM keywords WHERE id = ?`, [id]);
    return keyword || null;
  } catch (error) {
    console.error("Error getting keyword by ID:", error);
    throw error;
  }
}

/**
 * Add a new keyword
 * @param {string} keyword - Keyword to add
 * @param {number} maxSites - Maximum sites to scrape (default 20)
 * @returns {Promise<Object>} - Created keyword
 */
async function addKeyword(keyword, maxSites = 20) {
  try {
    const result = await run(
      `INSERT INTO keywords (keyword, status, max_sites) VALUES (?, 'pending', ?)`,
      [keyword.trim(), maxSites]
    );

    return await getKeywordById(result.lastInsertId);
  } catch (error) {
    console.error("Error adding keyword:", error);
    throw error;
  }
}

/**
 * Update keyword
 * @param {number} id - Keyword ID
 * @param {string} keyword - New keyword value
 * @returns {Promise<Object>} - Updated keyword
 */
async function updateKeyword(id, keyword) {
  try {
    await run(
      `UPDATE keywords SET keyword = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [keyword.trim(), id]
    );
    return await getKeywordById(id);
  } catch (error) {
    console.error("Error updating keyword:", error);
    throw error;
  }
}

/**
 * Delete keyword and cascade delete all related data
 * @param {number} id - Keyword ID
 * @returns {Promise<boolean>} - Success
 */
async function deleteKeyword(id) {
  try {
    // Get the keyword text to find related searches
    const keyword = await get(`SELECT keyword FROM keywords WHERE id = ?`, [id]);

    if (keyword) {
      // Find all searches that match this keyword
      const searches = await all(`SELECT id FROM searches WHERE query = ?`, [keyword.keyword]);
      const searchIds = searches.map((s) => s.id);

      if (searchIds.length > 0) {
        // Get all site IDs from those searches
        const sites = await all(
          `SELECT id FROM sites WHERE search_id = ANY($1::int[])`,
          [searchIds]
        );
        const siteIds = sites.map((s) => s.id);

        if (siteIds.length > 0) {
          // Delete contacts for those sites
          await run(`DELETE FROM contacts WHERE site_id = ANY($1::int[])`, [siteIds]);
          // Delete executives for those sites
          await run(`DELETE FROM company_executives WHERE site_id = ANY($1::int[])`, [siteIds]);
        }

        // Delete sites for those searches
        await run(`DELETE FROM sites WHERE search_id = ANY($1::int[])`, [searchIds]);
        // Delete the searches themselves
        await run(`DELETE FROM searches WHERE id = ANY($1::int[])`, [searchIds]);
      }
    }

    // Finally delete the keyword
    const result = await run(`DELETE FROM keywords WHERE id = ?`, [id]);
    return result.rows > 0;
  } catch (error) {
    console.error("Error deleting keyword:", error);
    throw error;
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
    domain = domain.replace(/^https?:\/\//, "");
    // Remove www.
    domain = domain.replace(/^www\./, "");
    // Remove path, query, hash
    domain = domain.split("/")[0].split("?")[0].split("#")[0];
    return domain;
  } catch (e) {
    return input.toLowerCase().trim();
  }
}

/**
 * Get all excluded domains
 * @returns {Promise<Array>} - Array of excluded domain objects
 */
async function getAllExcludedDomains() {
  try {
    const domains = await all(
      `SELECT * FROM excluded_domains ORDER BY created_at DESC`
    );
    return domains;
  } catch (error) {
    console.error("Error getting all excluded domains:", error);
    throw error;
  }
}

/**
 * Get excluded domain by ID
 * @param {number} id - Domain ID
 * @returns {Promise<Object|null>} - Excluded domain or null
 */
async function getExcludedDomainById(id) {
  try {
    const domain = await get(`SELECT * FROM excluded_domains WHERE id = ?`, [id]);
    return domain || null;
  } catch (error) {
    console.error("Error getting excluded domain by ID:", error);
    throw error;
  }
}

/**
 * Add a new excluded domain
 * @param {string} domain - Domain to exclude (e.g. "youtube.com" or "https://www.youtube.com/")
 * @param {string} reason - Optional reason for exclusion
 * @returns {Promise<Object>} - Created excluded domain
 */
async function addExcludedDomain(domain, reason = "") {
  try {
    const normalized = extractDomain(domain);
    if (!normalized) {
      throw new Error("Invalid domain");
    }

    const result = await run(
      `INSERT INTO excluded_domains (domain, reason) VALUES (?, ?)`,
      [normalized, reason.trim() || null]
    );

    return await getExcludedDomainById(result.lastInsertId);
  } catch (error) {
    console.error("Error adding excluded domain:", error);
    throw error;
  }
}

/**
 * Update an excluded domain
 * @param {number} id - Domain ID
 * @param {string} domain - New domain value
 * @param {string} reason - New reason
 * @returns {Promise<Object|null>} - Updated domain or null
 */
async function updateExcludedDomain(id, domain, reason) {
  try {
    const normalized = extractDomain(domain);
    if (!normalized) {
      throw new Error("Invalid domain");
    }

    await run(
      `UPDATE excluded_domains SET domain = ?, reason = ? WHERE id = ?`,
      [normalized, reason ? reason.trim() : null, id]
    );

    return await getExcludedDomainById(id);
  } catch (error) {
    console.error("Error updating excluded domain:", error);
    throw error;
  }
}

/**
 * Delete an excluded domain
 * @param {number} id - Domain ID
 * @returns {Promise<boolean>} - True if deleted
 */
async function deleteExcludedDomain(id) {
  try {
    const result = await run(`DELETE FROM excluded_domains WHERE id = ?`, [id]);
    return result.rows > 0;
  } catch (error) {
    console.error("Error deleting excluded domain:", error);
    throw error;
  }
}

/**
 * Check if a URL should be excluded based on stored excluded domains
 * @param {string} url - URL to check
 * @param {Array<string>} excludedDomainList - Array of excluded domain strings
 * @returns {boolean} - True if URL should be excluded
 */
function isUrlExcluded(url, excludedDomainList) {
  const urlDomain = extractDomain(url);
  return excludedDomainList.some((excluded) => {
    return urlDomain === excluded || urlDomain.endsWith("." + excluded);
  });
}

/**
 * Filter an array of URLs, removing those matching excluded domains
 * @param {Array<string>} urls - URLs to filter
 * @returns {Promise<Object>} - { allowed: string[], excluded: string[] }
 */
async function filterExcludedUrls(urls) {
  try {
    const excludedDomains = (await getAllExcludedDomains()).map((d) => d.domain);
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
  } catch (error) {
    console.error("Error filtering excluded URLs:", error);
    throw error;
  }
}

// ============ IGNORED TAGS FUNCTIONS ============

/**
 * Get all ignored tags
 * @returns {Promise<Array>} - Array of ignored tag objects
 */
async function getAllIgnoredTags() {
  try {
    const tags = await all(`SELECT * FROM ignored_tags ORDER BY created_at DESC`);
    return tags;
  } catch (error) {
    console.error("Error getting all ignored tags:", error);
    throw error;
  }
}

/**
 * Get ignored tag by ID
 * @param {number} id - Tag ID
 * @returns {Promise<Object|null>} - Ignored tag or null
 */
async function getIgnoredTagById(id) {
  try {
    const tag = await get(`SELECT * FROM ignored_tags WHERE id = ?`, [id]);
    return tag || null;
  } catch (error) {
    console.error("Error getting ignored tag by ID:", error);
    throw error;
  }
}

/**
 * Add a new ignored tag
 * @param {string} tag - Tag to ignore (e.g., "blog", "/learn/")
 * @param {string} matchType - Match type: 'contains', 'exact', 'regex'
 * @param {string} scope - Where to check: 'url', 'content', 'both'
 * @param {string} reason - Optional reason
 * @returns {Promise<Object>} - Created ignored tag
 */
async function addIgnoredTag(
  tag,
  matchType = "contains",
  scope = "url",
  reason = ""
) {
  try {
    const result = await run(
      `INSERT INTO ignored_tags (tag, match_type, scope, reason) VALUES (?, ?, ?, ?)`,
      [tag.trim().toLowerCase(), matchType, scope, reason.trim() || null]
    );

    return await getIgnoredTagById(result.lastInsertId);
  } catch (error) {
    console.error("Error adding ignored tag:", error);
    throw error;
  }
}

/**
 * Update an ignored tag
 * @param {number} id - Tag ID
 * @param {string} tag - New tag value
 * @param {string} matchType - New match type
 * @param {string} scope - New scope
 * @param {string} reason - New reason
 * @returns {Promise<Object>} - Updated ignored tag
 */
async function updateIgnoredTag(id, tag, matchType, scope, reason) {
  try {
    await run(
      `UPDATE ignored_tags SET tag = ?, match_type = ?, scope = ?, reason = ? WHERE id = ?`,
      [
        tag.trim().toLowerCase(),
        matchType,
        scope,
        reason ? reason.trim() : null,
        id,
      ]
    );

    return await getIgnoredTagById(id);
  } catch (error) {
    console.error("Error updating ignored tag:", error);
    throw error;
  }
}

/**
 * Delete an ignored tag
 * @param {number} id - Tag ID
 * @returns {Promise<boolean>} - True if deleted
 */
async function deleteIgnoredTag(id) {
  try {
    const result = await run(`DELETE FROM ignored_tags WHERE id = ?`, [id]);
    return result.rows > 0;
  } catch (error) {
    console.error("Error deleting ignored tag:", error);
    throw error;
  }
}

/**
 * Delete all ignored tags
 * @returns {Promise<number>} - Number of deleted rows
 */
async function deleteAllIgnoredTags() {
  try {
    const result = await run(`DELETE FROM ignored_tags`);
    return result.rows;
  } catch (error) {
    console.error("Error deleting all ignored tags:", error);
    throw error;
  }
}

/**
 * Bulk delete ignored tags by IDs
 * @param {Array<number>} ids - Tag IDs to delete
 * @returns {Promise<number>} - Number of deleted rows
 */
async function bulkDeleteIgnoredTags(ids) {
  try {
    if (!ids || ids.length === 0) return 0;

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
    const result = await run(
      `DELETE FROM ignored_tags WHERE id IN (${placeholders})`,
      ids
    );
    return result.rows;
  } catch (error) {
    console.error("Error bulk deleting ignored tags:", error);
    throw error;
  }
}

/**
 * Check if a URL should be ignored based on ignored tags
 * @param {string} url - URL to check
 * @param {Array} ignoredTags - Array of ignored tag objects
 * @returns {boolean} - True if URL should be ignored
 */
function isUrlIgnored(url, ignoredTags) {
  if (!url || !ignoredTags || ignoredTags.length === 0) return false;

  const urlLower = url.toLowerCase();

  return ignoredTags.some((tag) => {
    // Skip if scope is 'content' only
    if (tag.scope === "content") return false;

    const tagValue = tag.tag.toLowerCase();
    switch (tag.match_type) {
      case "exact":
        return urlLower === tagValue;
      case "regex":
        try {
          return new RegExp(tagValue, "i").test(urlLower);
        } catch (e) {
          return false;
        }
      case "contains":
      default:
        return urlLower.includes(tagValue);
    }
  });
}

/**
 * Check if content should be ignored based on ignored tags
 * @param {string} content - Content text to check
 * @param {Array} ignoredTags - Array of ignored tag objects
 * @returns {boolean} - True if content should be ignored
 */
function isContentIgnored(content, ignoredTags) {
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
 * Filter an array of URLs, removing those matching ignored tags
 * @param {Array<string>} urls - URLs to filter
 * @returns {Promise<Object>} - { allowed: string[], ignored: string[] }
 */
async function filterIgnoredUrls(urls) {
  try {
    const ignoredTags = await getAllIgnoredTags();
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
  } catch (error) {
    console.error("Error filtering ignored URLs:", error);
    throw error;
  }
}

/**
 * Update keyword status
 * @param {number} id - Keyword ID
 * @param {string} status - New status
 * @returns {Promise<boolean>} - Success
 */
async function updateKeywordStatus(id, status) {
  try {
    const result = await run(
      `UPDATE keywords SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, id]
    );
    return result.rows > 0;
  } catch (error) {
    console.error("Error updating keyword status:", error);
    throw error;
  }
}

// ============ SITE OPERATIONS ============

/**
 * Get sites by WordPress status with pagination
 * @param {boolean} isWordpress - Filter by WordPress status
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Results per page
 * @param {string} search - Optional search term
 * @returns {Promise<Object>} - { sites: Array, total: number, page: number, totalPages: number }
 */
async function getSitesByWordpressStatus(
  isWordpress = true,
  page = 1,
  limit = 50,
  search = null
) {
  try {
    let whereClause = "WHERE s.is_wordpress = ?";
    let params = [isWordpress ? 1 : 0];

    if (search) {
      whereClause += " AND (s.url LIKE ? OR s.search_query LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern);
    }

    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await get(
      `SELECT COUNT(*) as count FROM sites s ${whereClause}`,
      params
    );
    const total = countResult ? parseInt(countResult.count) : 0;

    // Get sites
    const sites = await all(
      `SELECT s.*,
              (SELECT COUNT(*) FROM contacts WHERE site_id = s.id AND type = 'email') as email_count,
              (SELECT COUNT(*) FROM contacts WHERE site_id = s.id AND type = 'phone') as phone_count,
              (SELECT COUNT(*) FROM contacts WHERE site_id = s.id AND type = 'linkedin') as linkedin_count
       FROM sites s
       ${whereClause}
       ORDER BY s.checked_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const totalPages = Math.ceil(total / limit);

    return {
      sites,
      total,
      page,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  } catch (error) {
    console.error("Error getting sites by WordPress status:", error);
    throw error;
  }
}

/**
 * Get all sites with optional filters and pagination
 * @param {number} page - Page number (default: 1)
 * @param {number} limit - Results per page (default: 50)
 * @param {string} searchQuery - Optional search term
 * @param {string} filter - Filter type: 'all', 'wordpress', 'non-wordpress', 'relevant', 'not-relevant'
 * @param {string} category - Optional AI category filter
 * @returns {Promise<Object>} - Object with sites array and pagination info
 */
async function getAllSites(page = 1, limit = 50, searchQuery = null, filter = 'all', category = null) {
  try {
    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) as total FROM sites WHERE 1=1`;
    let countParams = [];

    // Build the main query
    let query = `SELECT * FROM sites WHERE 1=1`;
    let params = [];

    // Apply filter
    if (filter === 'wordpress') {
      query += ` AND is_wordpress = 1`;
      countQuery += ` AND is_wordpress = 1`;
    } else if (filter === 'non-wordpress') {
      query += ` AND is_wordpress = 0`;
      countQuery += ` AND is_wordpress = 0`;
    } else if (filter === 'relevant') {
      query += ` AND ai_content_relevant = 1`;
      countQuery += ` AND ai_content_relevant = 1`;
    } else if (filter === 'not-relevant') {
      query += ` AND ai_content_relevant = 0`;
      countQuery += ` AND ai_content_relevant = 0`;
    }

    // Apply category filter
    if (category && category !== 'all') {
      query += ` AND ai_actual_category = ?`;
      params.push(category);
      countQuery += ` AND ai_actual_category = ?`;
      countParams.push(category);
    }

    // Apply search
    if (searchQuery) {
      query += ` AND (url LIKE ? OR search_query LIKE ?)`;
      params.push(`%${searchQuery}%`, `%${searchQuery}%`);
      countQuery += ` AND (url LIKE ? OR search_query LIKE ?)`;
      countParams.push(`%${searchQuery}%`, `%${searchQuery}%`);
    }

    // Get total count
    const countResult = await get(countQuery, countParams);
    const totalSites = countResult.total;
    const totalPages = Math.ceil(totalSites / limit);

    // Apply pagination
    const offset = (page - 1) * limit;
    query += ` ORDER BY checked_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const sites = await all(query, params);

    return {
      sites,
      pagination: {
        page,
        limit,
        total: totalSites,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  } catch (error) {
    console.error("Error getting all sites:", error);
    throw error;
  }
}

/**
 * Get distinct categories from AI classification
 * @returns {Promise<Array>} - Array of category names
 */
async function getDistinctCategories() {
  try {
    const result = await all(
      `SELECT DISTINCT ai_actual_category as category
       FROM sites
       WHERE ai_actual_category IS NOT NULL
       ORDER BY ai_actual_category`
    );
    return result.map((r) => r.category);
  } catch (error) {
    console.error("Error getting distinct categories:", error);
    throw error;
  }
}

/**
 * Get pending AI sites for processing
 * @param {number} limit - Maximum sites to return
 * @returns {Promise<Array>} - Array of sites
 */
async function getPendingAISites(limit = 10) {
  try {
    const sites = await all(
      `SELECT id, url, search_query, text_content, page_title, meta_description
       FROM sites
       WHERE is_wordpress = 1
         AND (ai_status = 'pending' OR ai_status IS NULL)
         AND text_content IS NOT NULL
         AND text_content != ''
       ORDER BY id ASC
       LIMIT ?`,
      [limit]
    );
    return sites;
  } catch (error) {
    console.error("Error getting pending AI sites:", error);
    throw error;
  }
}

/**
 * Get site by ID
 * @param {number} id - Site ID
 * @returns {Promise<Object|null>} - Site or null
 */
async function getSiteById(id) {
  try {
    const site = await get(`SELECT * FROM sites WHERE id = ?`, [id]);
    return site || null;
  } catch (error) {
    console.error("Error getting site by ID:", error);
    throw error;
  }
}

/**
 * Update site AI results (deprecated - use updateSiteAIResults2)
 * @param {number} siteId - Site ID
 * @param {Object} aiData - AI analysis data
 * @returns {Promise<boolean>} - Success
 */
async function updateSiteAIResults(siteId, aiData) {
  try {
    await run(
      `UPDATE sites
       SET ai_status = 'completed',
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
       WHERE id = ?`,
      [
        aiData.wordpressVerification?.isWordPress ? 1 : 0,
        aiData.wordpressVerification?.isWordPress ? 1 : 0,
        aiData.wordpressVerification?.confidence || "medium",
        JSON.stringify(aiData.wordpressVerification?.indicators || []),
        aiData.contentRelevance?.isRelevant ? 1 : 0,
        aiData.contentRelevance?.actualCategory || null,
        aiData.contentRelevance?.summary || null,
        aiData.contentRelevance?.mismatchReason || null,
        siteId,
      ]
    );
    return true;
  } catch (error) {
    console.error("Error updating site AI results:", error);
    throw error;
  }
}

/**
 * Update site AI status
 * @param {number} siteId - Site ID
 * @param {string} status - New status
 * @param {string} errorMessage - Optional error message
 * @returns {Promise<boolean>} - Success
 */
async function updateSiteAIStatus(siteId, status, errorMessage = null) {
  try {
    if (errorMessage) {
      await run(
        `UPDATE sites SET ai_status = ?, ai_error = ? WHERE id = ?`,
        [status, errorMessage, siteId]
      );
    } else {
      await run(`UPDATE sites SET ai_status = ? WHERE id = ?`, [status, siteId]);
    }
    return true;
  } catch (error) {
    console.error("Error updating site AI status:", error);
    throw error;
  }
}

// ============ CONTACT/EMAIL/PHONE OPERATIONS ============

/**
 * Get emails with pagination
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @param {string} search - Optional search term
 * @returns {Promise<Object>} - Paginated emails
 */
async function getEmails(page = 1, limit = 50, search = null) {
  try {
    let whereClause = "WHERE c.type = 'email'";
    let params = [];

    if (search) {
      whereClause += " AND (c.value LIKE ? OR s.url LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern);
    }

    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await get(
      `SELECT COUNT(*) as count FROM contacts c ${whereClause}`,
      params
    );
    const total = countResult ? parseInt(countResult.count) : 0;

    // Get emails
    const emails = await all(
      `SELECT c.*, s.url as site_url, s.country
       FROM contacts c
       LEFT JOIN sites s ON c.site_id = s.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const totalPages = Math.ceil(total / limit);

    return {
      emails,
      total,
      page,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  } catch (error) {
    console.error("Error getting emails:", error);
    throw error;
  }
}

/**
 * Get email by ID
 * @param {number} id - Email ID
 * @returns {Promise<Object|null>} - Email or null
 */
async function getEmailById(id) {
  try {
    const email = await get(
      `SELECT c.*, s.url as site_url FROM contacts c LEFT JOIN sites s ON c.site_id = s.id WHERE c.id = ? AND c.type = 'email'`,
      [id]
    );
    return email || null;
  } catch (error) {
    console.error("Error getting email by ID:", error);
    throw error;
  }
}

/**
 * Get phone by ID
 * @param {number} id - Phone ID
 * @returns {Promise<Object|null>} - Phone or null
 */
async function getPhoneById(id) {
  try {
    const phone = await get(
      `SELECT c.*, s.url as site_url FROM contacts c LEFT JOIN sites s ON c.site_id = s.id WHERE c.id = ? AND c.type = 'phone'`,
      [id]
    );
    return phone || null;
  } catch (error) {
    console.error("Error getting phone by ID:", error);
    throw error;
  }
}

/**
 * Get LinkedIn by ID
 * @param {number} id - LinkedIn ID
 * @returns {Promise<Object|null>} - LinkedIn or null
 */
async function getLinkedinById(id) {
  try {
    const linkedin = await get(
      `SELECT c.*, s.url as site_url FROM contacts c LEFT JOIN sites s ON c.site_id = s.id WHERE c.id = ? AND c.type = 'linkedin'`,
      [id]
    );
    return linkedin || null;
  } catch (error) {
    console.error("Error getting LinkedIn by ID:", error);
    throw error;
  }
}

/**
 * Get phones with pagination
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @param {string} search - Optional search term
 * @returns {Promise<Object>} - Paginated phones
 */
async function getPhones(page = 1, limit = 50, search = null) {
  try {
    let whereClause = "WHERE c.type = 'phone'";
    let params = [];

    if (search) {
      whereClause += " AND (c.value LIKE ? OR s.url LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern);
    }

    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await get(
      `SELECT COUNT(*) as count FROM contacts c ${whereClause}`,
      params
    );
    const total = countResult ? parseInt(countResult.count) : 0;

    // Get phones
    const phones = await all(
      `SELECT c.*, s.url as site_url, s.country
       FROM contacts c
       LEFT JOIN sites s ON c.site_id = s.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const totalPages = Math.ceil(total / limit);

    return {
      phones,
      total,
      page,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  } catch (error) {
    console.error("Error getting phones:", error);
    throw error;
  }
}

/**
 * Normalize URL for comparison
 * @param {string} url - URL to normalize
 * @returns {string} - Normalized URL
 */
function normalizeUrl(url) {
  try {
    let normalized = url.trim().toLowerCase();

    // Remove protocol
    normalized = normalized.replace(/^https?:\/\//, "");

    // Remove www.
    normalized = normalized.replace(/^www\./, "");

    // Remove trailing slash
    normalized = normalized.replace(/\/$/, "");

    // Remove hash fragments
    normalized = normalized.split("#")[0];

    // Remove common tracking parameters
    const urlObj = new URL(url);
    const searchParams = urlObj.searchParams;
    const paramsToRemove = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid"];
    paramsToRemove.forEach((param) => searchParams.delete(param));
    urlObj.search = searchParams.toString();
    normalized = urlObj.href.replace(/^https?:\/\//, "").replace(/^www\./, "");

    return normalized;
  } catch (e) {
    return url.toLowerCase().trim();
  }
}

/**
 * Check if URL already exists in database
 * @param {string} url - URL to check
 * @returns {Promise<boolean>} - True if URL exists
 */
async function urlExists(url) {
  try {
    const normalized = normalizeUrl(url);
    const existingUrls = await getAllExistingUrls();
    return existingUrls.some((existing) => {
      const existingNormalized = normalizeUrl(existing);
      return existingNormalized === normalized;
    });
  } catch (error) {
    console.error("Error checking if URL exists:", error);
    return false;
  }
}

/**
 * Get all existing URLs from database
 * @returns {Promise<Array<string>>} - Array of URLs
 */
async function getAllExistingUrls() {
  try {
    const sites = await all(`SELECT url FROM sites`);
    return sites.map((s) => s.url);
  } catch (error) {
    console.error("Error getting all existing URLs:", error);
    return [];
  }
}

/**
 * Get contacts with pagination
 * @param {string} type - Contact type filter ('all', 'email', 'phone', 'linkedin')
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @param {string} search - Optional search term
 * @returns {Promise<Object>} - Paginated contacts
 */
async function getAllContacts(type = "all", page = 1, limit = 50, search = null) {
  try {
    let whereClause = "WHERE 1=1";
    let params = [];

    if (type !== "all") {
      whereClause += " AND c.type = ?";
      params.push(type);
    }

    if (search) {
      whereClause += " AND (c.value LIKE ? OR s.url LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern);
    }

    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await get(
      `SELECT COUNT(*) as count FROM contacts c LEFT JOIN sites s ON c.site_id = s.id ${whereClause}`,
      params
    );
    const total = countResult ? parseInt(countResult.count) : 0;

    // Get contacts
    const contacts = await all(
      `SELECT c.*, s.url as site_url, s.country
       FROM contacts c
       LEFT JOIN sites s ON c.site_id = s.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const totalPages = Math.ceil(total / limit);

    return {
      contacts,
      total,
      page,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  } catch (error) {
    console.error("Error getting all contacts:", error);
    throw error;
  }
}

/**
 * Get LinkedIn profiles with pagination
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @param {string} search - Optional search term
 * @returns {Promise<Object>} - Paginated LinkedIn profiles
 */
async function getLinkedinProfiles(page = 1, limit = 50, search = null) {
  try {
    let whereClause = "WHERE c.type = 'linkedin'";
    let params = [];

    if (search) {
      whereClause += " AND (c.value LIKE ? OR s.url LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern);
    }

    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await get(
      `SELECT COUNT(*) as count FROM contacts c ${whereClause}`,
      params
    );
    const total = countResult ? parseInt(countResult.count) : 0;

    // Get contacts
    const contacts = await all(
      `SELECT c.*, s.url as site_url, s.country
       FROM contacts c
       LEFT JOIN sites s ON c.site_id = s.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const totalPages = Math.ceil(total / limit);

    return {
      contacts,
      total,
      page,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  } catch (error) {
    console.error("Error getting LinkedIn profiles:", error);
    throw error;
  }
}

/**
 * Get contact statistics
 * @returns {Promise<Object>} - Contact statistics
 */
async function getContactStats() {
  try {
    const stats = await get(
      `SELECT
        COUNT(*) as total,
        COUNT(DISTINCT site_id) as unique_sites,
        SUM(CASE WHEN type = 'email' THEN 1 ELSE 0 END) as emails,
        SUM(CASE WHEN type = 'phone' THEN 1 ELSE 0 END) as phones,
        SUM(CASE WHEN type = 'linkedin' THEN 1 ELSE 0 END) as linkedins
       FROM contacts`
    );
    return stats;
  } catch (error) {
    console.error("Error getting contact stats:", error);
    throw error;
  }
}

// ============ EXECUTIVES OPERATIONS ============

/**
 * Save company executive
 * @param {Object} executive - Executive data
 * @returns {Promise<Object>} - Created executive
 */
async function saveExecutive(executive) {
  try {
    const result = await run(
      `INSERT INTO company_executives (site_id, company_url, company_name, profile_url, name, headline, role_category)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_url) DO UPDATE SET
         site_id = EXCLUDED.site_id,
         company_url = EXCLUDED.company_url,
         company_name = EXCLUDED.company_name,
         name = EXCLUDED.name,
         headline = EXCLUDED.headline,
         role_category = EXCLUDED.role_category
       RETURNING id`,
      [
        executive.site_id,
        executive.company_url,
        executive.company_name || null,
        executive.profile_url,
        executive.name || null,
        executive.headline || null,
        executive.role_category || null,
      ]
    );

    return { ...executive, id: result.lastInsertId };
  } catch (error) {
    console.error("Error saving executive:", error);
    throw error;
  }
}

/**
 * Get company executives
 * @param {number} siteId - Optional site ID filter
 * @param {string} roleCategory - Optional role category filter
 * @returns {Promise<Array>} - Array of executives
 */
async function getCompanyExecutives(siteId = null, roleCategory = null) {
  try {
    let query = `SELECT * FROM company_executives WHERE 1=1`;
    let params = [];

    if (siteId) {
      query += ` AND site_id = ?`;
      params.push(siteId);
    }

    if (roleCategory) {
      query += ` AND role_category = ?`;
      params.push(roleCategory);
    }

    query += ` ORDER BY created_at DESC`;

    return await all(query, params);
  } catch (error) {
    console.error("Error getting company executives:", error);
    throw error;
  }
}

/**
 * Get executives statistics
 * @returns {Promise<Object>} - Statistics
 */
async function getExecutivesStats() {
  try {
    const stats = await get(
      `SELECT
        COUNT(*) as total,
        COUNT(DISTINCT site_id) as unique_sites,
        SUM(CASE WHEN role_category = 'Founder' THEN 1 ELSE 0 END) as founders,
        SUM(CASE WHEN role_category = 'CEO' THEN 1 ELSE 0 END) as ceos,
        SUM(CASE WHEN role_category = 'CTO' THEN 1 ELSE 0 END) as ctos
       FROM company_executives`
    );
    return stats;
  } catch (error) {
    console.error("Error getting executives stats:", error);
    throw error;
  }
}

/**
 * Get executives by company URL
 * @param {string} companyUrl - Company URL
 * @returns {Promise<Array>} - Array of executives
 */
async function getExecutivesByCompany(companyUrl) {
  try {
    return await all(
      `SELECT * FROM company_executives WHERE company_url = ? ORDER BY role_category, name`,
      [companyUrl]
    );
  } catch (error) {
    console.error("Error getting executives by company:", error);
    throw error;
  }
}

/**
 * Get structured executives with pagination
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @param {string} search - Optional search term
 * @returns {Promise<Object>} - Paginated executives
 */
async function getStructuredExecutives(page = 1, limit = 20, search = null) {
  try {
    let whereClause = "WHERE 1=1";
    let params = [];

    if (search) {
      whereClause += " AND (e.name LIKE ? OR e.company_name LIKE ? OR s.url LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await get(
      `SELECT COUNT(*) as count FROM company_executives e LEFT JOIN sites s ON e.site_id = s.id ${whereClause}`,
      params
    );
    const total = countResult ? parseInt(countResult.count) : 0;

    // Get executives
    const executives = await all(
      `SELECT e.*, s.url as site_url
       FROM company_executives e
       LEFT JOIN sites s ON e.site_id = s.id
       ${whereClause}
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const totalPages = Math.ceil(total / limit);

    return {
      executives,
      total,
      page,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  } catch (error) {
    console.error("Error getting structured executives:", error);
    throw error;
  }
}

// ============ SITE MANAGEMENT OPERATIONS ============

/**
 * Update site AI results (newer version)
 * @param {number} siteId - Site ID
 * @param {Object} aiData - AI analysis data
 * @returns {Promise<boolean>} - Success
 */
async function updateSiteAIResults2(siteId, aiData) {
  try {
    await run(
      `UPDATE sites
       SET ai_status = 'completed',
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
       WHERE id = ?`,
      [
        aiData.wordpressVerification?.isWordPress ? 1 : 0,
        aiData.wordpressVerification?.isWordPress ? 1 : 0,
        aiData.wordpressVerification?.confidence || "medium",
        JSON.stringify(aiData.wordpressVerification?.indicators || []),
        aiData.contentRelevance?.isRelevant ? 1 : 0,
        aiData.contentRelevance?.actualCategory || null,
        aiData.contentRelevance?.summary || null,
        aiData.contentRelevance?.mismatchReason || null,
        siteId,
      ]
    );
    return true;
  } catch (error) {
    console.error("Error updating site AI results:", error);
    throw error;
  }
}

/**
 * Update site AI status (newer version)
 * @param {number} siteId - Site ID
 * @param {string} status - New status
 * @param {string} errorMessage - Optional error message
 * @returns {Promise<boolean>} - Success
 */
async function updateSiteAIStatus2(siteId, status, errorMessage = null) {
  try {
    if (errorMessage) {
      await run(
        `UPDATE sites SET ai_status = ?, ai_error = ? WHERE id = ?`,
        [status, errorMessage, siteId]
      );
    } else {
      await run(`UPDATE sites SET ai_status = ? WHERE id = ?`, [status, siteId]);
    }
    return true;
  } catch (error) {
    console.error("Error updating site AI status:", error);
    throw error;
  }
}

/**
 * Delete site and related data
 * @param {number} id - Site ID
 * @returns {Promise<boolean>} - Success
 */
async function deleteSite(id) {
  try {
    await run(`DELETE FROM contacts WHERE site_id = ?`, [id]);
    await run(`DELETE FROM company_executives WHERE site_id = ?`, [id]);
    const result = await run(`DELETE FROM sites WHERE id = ?`, [id]);
    return result.rows > 0;
  } catch (error) {
    console.error("Error deleting site:", error);
    throw error;
  }
}

/**
 * Bulk delete sites
 * @param {Array<number>} ids - Site IDs to delete
 * @returns {Promise<Object>} - Deletion results
 */
async function bulkDeleteSites(ids) {
  try {
    if (!ids || ids.length === 0) {
      return { sites: 0, contacts: 0, executives: 0 };
    }

    // Get all site IDs from searches (for cascading)
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");

    // Delete contacts for those sites
    const contactsResult = await run(
      `DELETE FROM contacts WHERE site_id IN (${placeholders})`,
      ids
    );

    // Delete executives for those sites
    const executivesResult = await run(
      `DELETE FROM company_executives WHERE site_id IN (${placeholders})`,
      ids
    );

    // Delete the sites
    const sitesResult = await run(
      `DELETE FROM sites WHERE id IN (${placeholders})`,
      ids
    );

    return {
      sites: sitesResult.rows,
      contacts: contactsResult.rows,
      executives: executivesResult.rows,
    };
  } catch (error) {
    console.error("Error bulk deleting sites:", error);
    throw error;
  }
}

/**
 * Get site deletion preview
 * @param {Array<number>} ids - Site IDs to preview
 * @returns {Promise<Object>} - Preview data
 */
async function getSiteDeletionPreview(ids) {
  try {
    if (!ids || ids.length === 0) {
      return { sites: 0, contacts: 0, executives: 0, details: [] };
    }

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");

    // Count sites, contacts, executives
    const siteCount = await get(
      `SELECT COUNT(*) as count FROM sites WHERE id IN (${placeholders})`,
      ids
    );

    const contactCount = await get(
      `SELECT COUNT(*) as count, COUNT(DISTINCT site_id) as unique_sites FROM contacts WHERE site_id IN (${placeholders})`,
      ids
    );

    const executiveCount = await get(
      `SELECT COUNT(*) as count, COUNT(DISTINCT site_id) as unique_sites FROM company_executives WHERE site_id IN (${placeholders})`,
      ids
    );

    // Get site details
    const details = await all(
      `SELECT id, url, is_wordpress FROM sites WHERE id IN (${placeholders})`,
      ids
    );

    return {
      sites: parseInt(siteCount?.count || 0),
      contacts: parseInt(contactCount?.count || 0),
      executives: parseInt(executiveCount?.count || 0),
      details,
    };
  } catch (error) {
    console.error("Error getting site deletion preview:", error);
    throw error;
  }
}

/**
 * Update site
 * @param {number} id - Site ID
 * @param {Object} data - Data to update
 * @returns {Promise<boolean>} - Success
 */
async function updateSite(id, data) {
  try {
    const updates = [];
    const params = [];

    for (const [key, value] of Object.entries(data)) {
      if (key !== "id") {
        updates.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (updates.length === 0) {
      return false;
    }

    params.push(id);
    const query = `UPDATE sites SET ${updates.join(", ")} WHERE id = ?`;

    const result = await run(query, params);
    return result.rows > 0;
  } catch (error) {
    console.error("Error updating site:", error);
    throw error;
  }
}

/**
 * Delete contact
 * @param {number} id - Contact ID
 * @returns {Promise<boolean>} - Success
 */
async function deleteContact(id) {
  try {
    const result = await run(`DELETE FROM contacts WHERE id = ?`, [id]);
    return result.rows > 0;
  } catch (error) {
    console.error("Error deleting contact:", error);
    throw error;
  }
}

/**
 * Update contact
 * @param {number} id - Contact ID
 * @param {Object} data - Data to update
 * @returns {Promise<boolean>} - Success
 */
async function updateContact(id, data) {
  try {
    // Only allow valid columns in contacts table
    const validColumns = ['value', 'type', 'site_id', 'source_page'];
    const updates = [];
    const params = [];

    for (const [key, value] of Object.entries(data)) {
      if (key !== "id" && validColumns.includes(key)) {
        updates.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (updates.length === 0) {
      return false;
    }

    params.push(id);
    const query = `UPDATE contacts SET ${updates.join(", ")} WHERE id = ?`;

    const result = await run(query, params);
    return result.rows > 0;
  } catch (error) {
    console.error("Error updating contact:", error);
    throw error;
  }
}

/**
 * Delete executive
 * @param {number} id - Executive ID
 * @returns {Promise<boolean>} - Success
 */
async function deleteExecutive(id) {
  try {
    const result = await run(`DELETE FROM company_executives WHERE id = ?`, [id]);
    return result.rows > 0;
  } catch (error) {
    console.error("Error deleting executive:", error);
    throw error;
  }
}

/**
 * Update executive
 * @param {number} id - Executive ID
 * @param {Object} data - Data to update
 * @returns {Promise<boolean>} - Success
 */
async function updateExecutive(id, data) {
  try {
    const updates = [];
    const params = [];

    for (const [key, value] of Object.entries(data)) {
      if (key !== "id") {
        updates.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (updates.length === 0) {
      return false;
    }

    params.push(id);
    const query = `UPDATE company_executives SET ${updates.join(", ")} WHERE id = ?`;

    const result = await run(query, params);
    return result.rows > 0;
  } catch (error) {
    console.error("Error updating executive:", error);
    throw error;
  }
}

/**
 * Delete all data from database (with table ordering)
 * @returns {Promise<Object>} - Counts of deleted rows
 */
async function deleteAllData() {
  try {
    const counts = {};

    // Delete in order of dependencies
    counts.email_queue = (await run(`DELETE FROM email_queue`)).rows;
    counts.email_send_log = (await run(`DELETE FROM email_send_log`)).rows;
    counts.company_executives = (await run(`DELETE FROM company_executives`)).rows;
    counts.contacts = (await run(`DELETE FROM contacts`)).rows;
    counts.sites = (await run(`DELETE FROM sites`)).rows;
    counts.searches = (await run(`DELETE FROM searches`)).rows;
    counts.keywords = (await run(`DELETE FROM keywords`)).rows;
    counts.ignored_tags = (await run(`DELETE FROM ignored_tags`)).rows;
    counts.excluded_domains = (await run(`DELETE FROM excluded_domains`)).rows;

    return counts;
  } catch (error) {
    console.error("Error deleting all data:", error);
    throw error;
  }
}

// ============ EXPORTS ============

module.exports = {
  // Initialization
  initDatabase,

  // Core async functions (PostgreSQL adapter)
  run,
  get,
  all,
  query,
  transaction,

  // Utilities
  healthCheck,
  getPoolStats,

  // Helper functions (pure JS, no DB)
  extractDomain,
  normalizeUrl,
  urlExists,
  getAllExistingUrls,
  isUrlExcluded,
  isUrlIgnored,
  isContentIgnored,

  // Search operations
  saveSearchResults,
  getAllSearches,
  getSearchById,
  getAllWordpressSites,
  getStatistics,
  exportToJSON,

  // Keyword operations
  getAllKeywords,
  getKeywordById,
  addKeyword,
  updateKeyword,
  deleteKeyword,
  updateKeywordStatus,

  // Excluded domains operations
  getAllExcludedDomains,
  getExcludedDomainById,
  addExcludedDomain,
  updateExcludedDomain,
  deleteExcludedDomain,
  filterExcludedUrls,

  // Ignored tags operations
  getAllIgnoredTags,
  getIgnoredTagById,
  addIgnoredTag,
  updateIgnoredTag,
  deleteIgnoredTag,
  deleteAllIgnoredTags,
  bulkDeleteIgnoredTags,
  filterIgnoredUrls,

  // Site operations
  getSitesByWordpressStatus,
  getAllSites,
  getDistinctCategories,
  getPendingAISites,
  getSiteById,
  updateSiteAIResults,
  updateSiteAIStatus,
  updateSiteAIResults2,
  updateSiteAIStatus2,
  deleteSite,
  bulkDeleteSites,
  getSiteDeletionPreview,
  updateSite,

  // Contact/Email/Phone operations
  getEmails,
  getEmailById,
  getPhoneById,
  getLinkedinById,
  getPhones,
  getAllContacts,
  getLinkedinProfiles,
  getContactStats,
  deleteContact,
  updateContact,

  // Executive operations
  saveExecutive,
  getCompanyExecutives,
  getExecutivesStats,
  getExecutivesByCompany,
  getStructuredExecutives,
  deleteExecutive,
  updateExecutive,

  // Database management
  deleteAllData,
};
