#!/usr/bin/env node
/**
 * ============================================================================
 * SQLite → PostgreSQL Migration - Step 1: EXPORT FROM SQLITE
 * ============================================================================
 *
 * PRODUCTION-SAFE EXPORT SCRIPT
 *
 * This script exports ALL data from the SQLite database to JSON files.
 * It performs NO modifications to the source database - READ ONLY.
 *
 * Usage:
 *   node src/database/migration/export-sqlite.js
 *
 * Output:
 *   Creates ./migration-data/ directory with:
 *   - searches.json
 *   - sites.json
 *   - keywords.json
 *   - excluded_domains.json
 *   - ignored_tags.json
 *   - contacts.json
 *   - company_executives.json
 *   - linkedin_credentials.json
 *   - country_timezones.json
 *   - email_senders.json
 *   - email_templates.json
 *   - email_campaigns.json
 *   - email_queue.json
 *   - email_send_log.json
 *   - email_settings.json
 *   - export-manifest.json (summary with counts and checksums)
 * ============================================================================
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Configuration
const SQLITE_DB_PATH = path.join(__dirname, '../../../wordpress-detector.db');
const EXPORT_DIR = path.join(__dirname, '../../../migration-data');

// Tables to export (in dependency order - parents before children)
const TABLES = [
  'searches',
  'keywords',
  'excluded_domains',
  'ignored_tags',
  'sites',
  'contacts',
  'company_executives',
  'linkedin_credentials',
  'country_timezones',
  'email_senders',
  'email_templates',
  'email_campaigns',
  'email_queue',
  'email_send_log',
  'email_settings'
];

/**
 * Calculate MD5 hash of data for integrity verification
 */
function calculateChecksum(data) {
  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
}

/**
 * Export a single table to JSON
 */
function exportTable(db, tableName) {
  console.log(`\n[EXPORT] ${tableName}...`);

  try {
    // Get all rows from the table
    const rows = db.prepare(`SELECT * FROM ${tableName}`).all();

    // Get table schema info
    const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const columns = tableInfo.map(col => col.name);

    console.log(`  Columns: ${columns.join(', ')}`);
    console.log(`  Rows: ${rows.length}`);

    // Check for NULL values in critical columns
    if (rows.length > 0) {
      const nullChecks = columns.filter(col => {
        return rows.some(row => row[col] === null || row[col] === undefined);
      });
      if (nullChecks.length > 0) {
        console.log(`  Columns with NULLs: ${nullChecks.join(', ')}`);
      }
    }

    // Save to JSON file
    const filename = path.join(EXPORT_DIR, `${tableName}.json`);
    fs.writeFileSync(filename, JSON.stringify(rows, null, 2), 'utf8');

    return {
      tableName,
      rowCount: rows.length,
      columns,
      checksum: calculateChecksum(rows),
      hasNulls: rows.some(row => Object.values(row).some(v => v === null))
    };
  } catch (error) {
    if (error.message.includes('no such table')) {
      console.log(`  Table does not exist - skipping`);
      return {
        tableName,
        rowCount: 0,
        columns: [],
        checksum: null,
        skipped: true,
        reason: 'Table does not exist'
      };
    }
    throw error;
  }
}

/**
 * Export email_queue with special handling for critical data
 */
function exportEmailQueue(db) {
  console.log('\n[EXPORT] email_queue (CRITICAL TABLE)...');

  try {
    const rows = db.prepare(`SELECT * FROM email_queue`).all();

    // Analyze queue status distribution
    const statusCounts = {};
    rows.forEach(row => {
      statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    });

    console.log(`  Total: ${rows.length} rows`);
    console.log(`  Status distribution:`, statusCounts);

    // Check for scheduled emails
    const scheduled = rows.filter(r => r.status === 'scheduled' && r.scheduled_at);
    console.log(`  Scheduled emails: ${scheduled.length}`);

    // Check for failed emails
    const failed = rows.filter(r => r.status === 'failed');
    console.log(`  Failed emails: ${failed.length}`);

    const filename = path.join(EXPORT_DIR, 'email_queue.json');
    fs.writeFileSync(filename, JSON.stringify(rows, null, 2), 'utf8');

    return {
      tableName: 'email_queue',
      rowCount: rows.length,
      statusCounts,
      scheduledCount: scheduled.length,
      failedCount: failed.length,
      checksum: calculateChecksum(rows)
    };
  } catch (error) {
    if (error.message.includes('no such table')) {
      return {
        tableName: 'email_queue',
        rowCount: 0,
        skipped: true,
        reason: 'Table does not exist'
      };
    }
    throw error;
  }
}

/**
 * Main export function
 */
function main() {
  console.log('='.repeat(70));
  console.log('SQLite → PostgreSQL Migration - EXPORT');
  console.log('='.repeat(70));
  console.log(`\nSource Database: ${SQLITE_DB_PATH}`);
  console.log(`Export Directory: ${EXPORT_DIR}\n`);

  // Create export directory
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    console.log(`[CREATE] Export directory created: ${EXPORT_DIR}\n`);
  } else {
    console.log(`[INFO] Export directory exists: ${EXPORT_DIR}`);
    // Backup existing export if present
    const backupDir = EXPORT_DIR + '.backup.' + Date.now();
    try {
      fs.renameSync(EXPORT_DIR, backupDir);
      fs.mkdirSync(EXPORT_DIR, { recursive: true });
      console.log(`[BACKUP] Previous export backed up to: ${backupDir}`);
    } catch (e) {
      console.log(`[WARN] Could not backup existing directory`);
    }
  }

  // Connect to SQLite (READ ONLY)
  const db = new Database(SQLITE_DB_PATH, { readonly: true, fileMustExist: true });
  console.log(`[CONNECT] Connected to SQLite database\n`);

  const manifest = {
    exportDate: new Date().toISOString(),
    sqliteFile: SQLITE_DB_PATH,
    tables: []
  };

  let totalRows = 0;

  // Export each table
  for (const tableName of TABLES) {
    let result;
    if (tableName === 'email_queue') {
      result = exportEmailQueue(db);
    } else {
      result = exportTable(db, tableName);
    }
    manifest.tables.push(result);
    if (!result.skipped) {
      totalRows += result.rowCount;
    }
  }

  // Close database
  db.close();
  console.log('\n[CLOSE] Database connection closed');

  // Save manifest
  const manifestPath = path.join(EXPORT_DIR, 'export-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('EXPORT COMPLETE');
  console.log('='.repeat(70));
  console.log(`\nTotal tables exported: ${manifest.tables.filter(t => !t.skipped).length}`);
  console.log(`Total rows exported: ${totalRows}`);
  console.log(`Manifest saved to: export-manifest.json`);
  console.log(`\nExport location: ${EXPORT_DIR}\n`);

  // Critical tables summary
  console.log('[CRITICAL TABLES]');
  manifest.tables.filter(t => ['email_queue', 'sites', 'contacts', 'email_send_log'].includes(t.tableName)).forEach(t => {
    console.log(`  ${t.tableName}: ${t.rowCount} rows (checksum: ${t.checksum?.substring(0, 16)}...)`);
  });

  console.log('\n[IMPORTANT]');
  console.log('  1. Review the exported data in migration-data/');
  console.log('  2. Verify checksums match after PostgreSQL import');
  console.log('  3. Keep this backup until PostgreSQL migration is verified\n');
}

// Run if called directly
if (require.main === module) {
  try {
    main();
    process.exit(0);
  } catch (error) {
    console.error('\n[FATAL ERROR]', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

module.exports = { exportTable, exportEmailQueue };
