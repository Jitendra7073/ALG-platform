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
 */
router.post('/sync-to-prod', async (req, res) => {
  try {
    const sqliteDb = db.initDatabase();
    const results = {};

    // 1. Sync Sites Table
    const unsyncedSites = sqliteDb
      .prepare(`SELECT * FROM sites WHERE is_sync_to_prod = 0 LIMIT 100`)
      .all();

    if (unsyncedSites.length > 0) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        const siteIds = [];
        for (const site of unsyncedSites) {
          const query = `
            INSERT INTO sites (
              id, search_id, url, country, is_wordpress, confidence_score, 
              indicators, error, search_query, emails, phones, 
              linkedin_profiles, text_content, page_title, meta_description, created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, 
              $7, $8, $9, $10, $11, 
              $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            ON CONFLICT (id) DO UPDATE SET 
              is_wordpress = EXCLUDED.is_wordpress,
              confidence_score = EXCLUDED.confidence_score,
              updated_at = CURRENT_TIMESTAMP
          `;
          const values = [
            site.id, site.search_id, site.url, site.country, site.is_wordpress === 1,
            site.confidence_score, site.indicators, site.error, site.search_query,
            site.emails, site.phones, site.linkedin_profiles, site.text_content,
            site.page_title, site.meta_description
          ];
          await client.query(query, values);
          siteIds.push(site.id);
        }
        await client.query('COMMIT');
        
        // Mark as synced locally
        const placeholders = siteIds.map(() => "?").join(",");
        sqliteDb.prepare(`UPDATE sites SET is_sync_to_prod = 1 WHERE id IN (${placeholders})`).run(...siteIds);

        results.sitesSynced = siteIds.length;
      } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error syncing sites to Prod", e);
        throw e;
      } finally {
        client.release();
      }
    } else {
      results.sitesSynced = 0;
    }

    // 2. Sync Contacts Table
    const unsyncedContacts = sqliteDb
      .prepare(`SELECT * FROM contacts WHERE is_sync_to_prod = 0 LIMIT 100`)
      .all();

    if (unsyncedContacts.length > 0) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        const contactIds = [];
        for (const contact of unsyncedContacts) {
          const query = `
            INSERT INTO contacts (
              id, site_id, type, value, source_page, created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            ON CONFLICT (id) DO UPDATE SET 
              value = EXCLUDED.value,
              updated_at = CURRENT_TIMESTAMP
          `;
          const values = [
            contact.id, contact.site_id, contact.type, contact.value, contact.source_page
          ];
          await client.query(query, values);
          contactIds.push(contact.id);
        }
        await client.query('COMMIT');
        
        // Mark as synced
        const placeholders = contactIds.map(() => "?").join(",");
        sqliteDb.prepare(`UPDATE contacts SET is_sync_to_prod = 1 WHERE id IN (${placeholders})`).run(...contactIds);

        results.contactsSynced = contactIds.length;
      } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error syncing contacts to Prod", e);
        throw e;
      } finally {
        client.release();
      }
    } else {
      results.contactsSynced = 0;
    }

    sqliteDb.close();

    res.json({
      success: true,
      message: `Sync completed: ${results.sitesSynced} sites, ${results.contactsSynced} contacts.`,
      results
    });

  } catch (error) {
    console.error("Sync API Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
