/**
 * Database Migration: Simplify AI Fields
 *
 * This migration:
 * 1. Adds new focused AI columns for WordPress verification & content relevance
 * 2. Resets AI status for WordPress sites to be re-processed
 *
 * New columns added to sites table:
 * - ai_verified_wp: AI confirms it's WordPress (1=yes, 0=no)
 * - ai_wp_confidence: high/medium/low
 * - ai_wp_indicators: JSON array of indicators found
 * - ai_content_relevant: Content matches keyword intent (1=yes, 0=no)
 * - ai_actual_category: What the site actually is
 * - ai_content_summary: 2-3 sentence description
 * - ai_mismatch_reason: Why content doesn't match (if not relevant)
 * - ai_error: Error message if processing failed
 * - ai_processed_at: Timestamp of AI processing
 *
 * Old columns (kept for backwards compatibility):
 * - classification, relevance_score, tags, primary_language, value_proposition, ai_reasoning
 *
 * Usage:
 *   node migrate-ai-fields.js           # Run migration
 *   node migrate-ai-fields.js --reset   # Reset all WordPress sites for re-processing
 *   node migrate-ai-fields.js --status  # Show migration status
 */

const { run, get, all, query, healthCheck, initializePool } = require("../db-adapter.js");
require("dotenv").config();

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Add new AI columns to sites table
 */
async function addNewColumns() {
  const newColumns = [
    { name: "ai_verified_wp", type: "INTEGER DEFAULT NULL" },
    { name: "ai_wp_confidence", type: "TEXT" },
    { name: "ai_wp_indicators", type: "TEXT" },
    { name: "ai_content_relevant", type: "INTEGER DEFAULT NULL" },
    { name: "ai_actual_category", type: "TEXT" },
    { name: "ai_content_summary", type: "TEXT" },
    { name: "ai_mismatch_reason", type: "TEXT" },
    { name: "ai_error", type: "TEXT" },
    { name: "ai_processed_at", type: "TIMESTAMP" },
  ];

  let added = 0;
  let skipped = 0;

  for (const col of newColumns) {
    try {
      await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
      log(`    Added column: ${col.name}`, "green");
      added++;
    } catch (e) {
      if (e.message.includes("duplicate column") || e.code === "42701") {
        skipped++;
      } else {
        log(`    Failed to add ${col.name}: ${e.message}`, "red");
      }
    }
  }

  log(
    `\n   Added: ${added} columns, Skipped (already exist): ${skipped}`,
    "cyan",
  );
}

/**
 * Create index for faster AI queries
 */
async function createIndexes() {
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_sites_ai_status ON sites(ai_status)",
    "CREATE INDEX IF NOT EXISTS idx_sites_ai_verified_wp ON sites(ai_verified_wp)",
    "CREATE INDEX IF NOT EXISTS idx_sites_ai_content_relevant ON sites(ai_content_relevant)",
  ];

  for (const sql of indexes) {
    try {
      await query(sql);
    } catch (e) {
      // Index may already exist
    }
  }
  log("    Indexes created/verified", "green");
}

/**
 * Reset WordPress sites for AI re-processing
 */
async function resetForReprocessing() {
  const result = await run(
    `
    UPDATE sites
    SET
      ai_status = 'pending',
      ai_verified_wp = NULL,
      ai_wp_confidence = NULL,
      ai_wp_indicators = NULL,
      ai_content_relevant = NULL,
      ai_actual_category = NULL,
      ai_content_summary = NULL,
      ai_mismatch_reason = NULL,
      ai_error = NULL,
      ai_processed_at = NULL
    WHERE is_wordpress = 1
      AND text_content IS NOT NULL
      AND text_content != ''
  `,
  );

  log(
    `\n Reset ${result.changes} WordPress sites for AI re-processing`,
    "green",
  );
}

/**
 * Show current status
 */
async function showStatus() {
  log("\n AI Processing Status:", "cyan");
  log("═".repeat(50), "cyan");

  // Total sites
  const total = (await get("SELECT COUNT(*) as count FROM sites")).count;
  const wordpress = (await get("SELECT COUNT(*) as count FROM sites WHERE is_wordpress = 1")).count;
  const withContent = (await get(
    "SELECT COUNT(*) as count FROM sites WHERE is_wordpress = 1 AND text_content IS NOT NULL AND text_content != ''",
  )).count;

  log(`\n   Total sites: ${total}`, "reset");
  log(`   WordPress sites: ${wordpress}`, "reset");
  log(`   WordPress with content: ${withContent}`, "reset");

  // AI status breakdown
  log("\n   AI Processing Status:", "blue");

  const pending = (await get(
    "SELECT COUNT(*) as count FROM sites WHERE is_wordpress = 1 AND (ai_status = 'pending' OR ai_status IS NULL)",
  )).count;
  const completed = (await get(
    "SELECT COUNT(*) as count FROM sites WHERE is_wordpress = 1 AND ai_status = 'completed'",
  )).count;
  const failed = (await get(
    "SELECT COUNT(*) as count FROM sites WHERE is_wordpress = 1 AND ai_status = 'failed'",
  )).count;

  log(`   • Pending: ${pending}`, "yellow");
  log(`   • Completed: ${completed}`, "green");
  log(`   • Failed: ${failed}`, "red");

  // New AI fields status
  log("\n   AI Verification Results:", "blue");

  const verifiedWP = (await get("SELECT COUNT(*) as count FROM sites WHERE ai_verified_wp = 1")).count;
  const notWP = (await get("SELECT COUNT(*) as count FROM sites WHERE ai_verified_wp = 0")).count;
  const relevant = (await get(
    "SELECT COUNT(*) as count FROM sites WHERE ai_content_relevant = 1",
  )).count;
  const notRelevant = (await get(
    "SELECT COUNT(*) as count FROM sites WHERE ai_content_relevant = 0",
  )).count;

  log(`   • AI Verified WordPress: ${verifiedWP}`, "green");
  log(`   • AI Says Not WordPress: ${notWP}`, "red");
  log(`   • Content Relevant: ${relevant}`, "green");
  log(`   • Content Not Relevant: ${notRelevant}`, "yellow");

  log("\n" + "═".repeat(50), "cyan");
}

/**
 * Main migration function
 */
async function migrate() {
  log("\n AI Fields Migration", "cyan");
  log("═".repeat(50), "cyan");

  // Initialize PostgreSQL pool
  await initializePool();

  try {
    log("\n📦 Adding new AI columns...", "blue");
    await addNewColumns();

    log("\n📇 Creating indexes...", "blue");
    await createIndexes();

    await showStatus();

    log("\n Migration complete!", "green");
    log("\n Next steps:", "cyan");
    log(
      "   1. Run: node migrate-ai-fields.js --reset  (to queue sites for processing)",
      "reset",
    );
    log("   2. Start server: npm run admin", "reset");
    log("   3. AI processor will automatically process pending sites", "reset");
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Initialize pool for all commands
  await initializePool();

  if (args.includes("--status")) {
    await showStatus();
  } else if (args.includes("--reset")) {
    await addNewColumns();
    await createIndexes();
    await resetForReprocessing();
    await showStatus();
  } else if (args.includes("--help") || args.includes("-h")) {
    log(
      `
AI Fields Migration Tool

Usage:
  node migrate-ai-fields.js           # Run migration (add new columns)
  node migrate-ai-fields.js --reset   # Reset WordPress sites for re-processing
  node migrate-ai-fields.js --status  # Show current status
  node migrate-ai-fields.js --help    # Show this help

New AI Fields:
  • ai_verified_wp      - AI confirms it's WordPress (1=yes, 0=no)
  • ai_wp_confidence    - Confidence level (high/medium/low)
  • ai_wp_indicators    - JSON array of WordPress indicators found
  • ai_content_relevant - Content matches search intent (1=yes, 0=no)
  • ai_actual_category  - What the site actually is
  • ai_content_summary  - 2-3 sentence description
  • ai_mismatch_reason  - Why content doesn't match keyword
    `,
      "reset",
    );
  } else {
    await migrate();
  }
}

main().catch(console.error);
