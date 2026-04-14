const express = require('express');
const router = express.Router();
const db = require('../database/database.js');
const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("⚠️ DATABASE_URL is not set in the environment variables!");
}

const pgPool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

/**
 * Endpoint to manually trigger synchronization of unsynced data to Supabase.
 * Syncs sites, contacts, and keywords tables.
 * Handles both new inserts and updates to existing records.
 */
router.post('/sync-to-prod', async (req, res) => {
  try {
    const sqliteDb = db.initDatabase();
    const results = {};

    // 1. Sync Sites Table
    const unsyncedSites = sqliteDb
      .prepare(`SELECT * FROM sites WHERE is_sync_to_prod = 0`)
      .all();

    if (unsyncedSites.length > 0) {
      console.log(`📡 Syncing ${unsyncedSites.length} sites to production...`);
      const client = await pgPool.connect();
      const syncedIds = [];
      try {
        for (const site of unsyncedSites) {
          try {
            // First, try to match by URL (Business Primary Key)
            const existingRes = await client.query('SELECT id FROM sites WHERE url = $1', [site.url]);

            if (existingRes.rows.length > 0) {
              const prodId = existingRes.rows[0].id;
              await client.query(`
                UPDATE sites SET
                  search_id = $2, is_wordpress = $3, confidence_score = $4,
                  indicators = $5, error = $6, search_query = $7, emails = $8,
                  phones = $9, linkedin_profiles = $10, text_content = $11,
                  page_title = $12, meta_description = $13, updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
              `, [
                prodId, site.search_id, site.is_wordpress === 1, site.confidence_score,
                site.indicators, site.error, site.search_query, site.emails, site.phones,
                site.linkedin_profiles, site.text_content, site.page_title, site.meta_description
              ]);
              syncedIds.push(site.id);
            } else {
              // Try inserting with local ID
              try {
                await client.query(`
                  INSERT INTO sites (
                    id, search_id, url, country, is_wordpress, confidence_score,
                    indicators, error, search_query, emails, phones,
                    linkedin_profiles, text_content, page_title, meta_description,
                    created_at, updated_at
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                `, [
                  site.id, site.search_id, site.url, site.country, site.is_wordpress === 1,
                  site.confidence_score, site.indicators, site.error, site.search_query,
                  site.emails, site.phones, site.linkedin_profiles, site.text_content,
                  site.page_title, site.meta_description, site.created_at, site.updated_at
                ]);
                syncedIds.push(site.id);
              } catch (insErr) {
                if (insErr.code === '23505') {
                  // ID already taken in Prod! Use a dynamic ID from Prod's sequence/max
                  await client.query(`
                    INSERT INTO sites (
                      id, search_id, url, country, is_wordpress, confidence_score,
                      indicators, error, search_query, emails, phones,
                      linkedin_profiles, text_content, page_title, meta_description,
                      created_at, updated_at
                    ) VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM sites), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                  `, [
                    site.search_id, site.url, site.country, site.is_wordpress === 1,
                    site.confidence_score, site.indicators, site.error, site.search_query,
                    site.emails, site.phones, site.linkedin_profiles, site.text_content,
                    site.page_title, site.meta_description, site.created_at, site.updated_at
                  ]);
                  syncedIds.push(site.id);
                } else {
                  throw insErr;
                }
              }
            }
          } catch (rowError) {
            console.error(`❌ Sync failed for site ${site.url}:`, rowError.message);
          }
        }

        if (syncedIds.length > 0) {
          const placeholders = syncedIds.map(() => "?").join(",");
          sqliteDb.prepare(`UPDATE sites SET is_sync_to_prod = 1 WHERE id IN (${placeholders})`).run(...syncedIds);
          console.log(`✅ Successfully synced ${syncedIds.length} sites.`);
        }
        results.sitesSynced = syncedIds.length;
      } finally {
        client.release();
      }
    } else {
      results.sitesSynced = 0;
    }

    // 2. Sync Contacts Table (Only after sites are attempt to sync)
    const unsyncedContacts = sqliteDb
      .prepare(`
        SELECT contacts.*, sites.url as site_url 
        FROM contacts 
        JOIN sites ON contacts.site_id = sites.id 
        WHERE contacts.is_sync_to_prod = 0
      `)
      .all();

    if (unsyncedContacts.length > 0) {
      console.log(`📡 Syncing ${unsyncedContacts.length} contacts to production...`);
      const client = await pgPool.connect();
      const syncedContactIds = [];
      try {
        for (const contact of unsyncedContacts) {
          try {
            // Find the correct site ID in Production using the Site URL
            const siteRes = await client.query('SELECT id FROM sites WHERE url = $1', [contact.site_url]);
            if (siteRes.rows.length === 0) {
              console.warn(`⚠️ Skipping contact ${contact.id}: Site ${contact.site_url} not found in Prod.`);
              continue;
            }
            const prodSiteId = siteRes.rows[0].id;

            await client.query(`
              INSERT INTO contacts (id, site_id, type, value, source_page, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (id) DO UPDATE SET
                site_id = EXCLUDED.site_id,
                type = EXCLUDED.type,
                value = EXCLUDED.value,
                source_page = EXCLUDED.source_page,
                updated_at = EXCLUDED.updated_at
            `, [contact.id, prodSiteId, contact.type, contact.value, contact.source_page, contact.created_at, contact.updated_at]);

            syncedContactIds.push(contact.id);
          } catch (rowError) {
            console.warn(`⚠️ Sync error for contact ${contact.id}:`, rowError.message);
          }
        }

        if (syncedContactIds.length > 0) {
          const placeholders = syncedContactIds.map(() => "?").join(",");
          sqliteDb.prepare(`UPDATE contacts SET is_sync_to_prod = 1 WHERE id IN (${placeholders})`).run(...syncedContactIds);
          console.log(`✅ Successfully synced ${syncedContactIds.length} contacts.`);
        }
        results.contactsSynced = syncedContactIds.length;
      } finally {
        client.release();
      }
    } else {
      results.contactsSynced = 0;
    }

    // 3. Sync Keywords Table
    const unsyncedKeywords = sqliteDb
      .prepare(`SELECT * FROM keywords WHERE is_sync_to_prod = 0`)
      .all();

    if (unsyncedKeywords.length > 0) {
      console.log(`📡 Syncing ${unsyncedKeywords.length} keywords to production...`);
      const client = await pgPool.connect();
      const syncedKeywordIds = [];
      try {
        for (const keyword of unsyncedKeywords) {
          try {
            await client.query(`
              INSERT INTO keywords (id, keyword, status, max_sites, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (id) DO UPDATE SET
                keyword = EXCLUDED.keyword,
                status = EXCLUDED.status,
                max_sites = EXCLUDED.max_sites,
                updated_at = EXCLUDED.updated_at
            `, [keyword.id, keyword.keyword, keyword.status, keyword.max_sites, keyword.created_at, keyword.updated_at]);

            syncedKeywordIds.push(keyword.id);
          } catch (rowError) {
            console.warn(`⚠️ Sync error for keyword ${keyword.keyword}:`, rowError.message);
          }
        }

        if (syncedKeywordIds.length > 0) {
          const placeholders = syncedKeywordIds.map(() => "?").join(",");
          sqliteDb.prepare(`UPDATE keywords SET is_sync_to_prod = 1 WHERE id IN (${placeholders})`).run(...syncedKeywordIds);
          console.log(`✅ Successfully synced ${syncedKeywordIds.length} keywords.`);
        }
        results.keywordsSynced = syncedKeywordIds.length;
      } finally {
        client.release();
      }
    } else {
      results.keywordsSynced = 0;
    }

    sqliteDb.close();

    res.json({
      success: true,
      message: `Sync completed: ${results.sitesSynced} sites, ${results.contactsSynced} contacts, ${results.keywordsSynced} keywords.`,
      results
    });

  } catch (error) {
    console.error("Sync API Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
