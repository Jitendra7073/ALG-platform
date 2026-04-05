/**
 * Database Reset Script
 * Clears all data or resets the database to a clean state
 *
 * Usage:
 *   node reset-db.js                 # Interactive mode
 *   node reset-db.js --all           # Clear all data (keeps tables)
 *   node reset-db.js --leads         # Clear only leads data (sites, contacts, executives)
 *   node reset-db.js --email         # Clear only email system data
 *   node reset-db.js --keywords      # Clear only keywords
 *   node reset-db.js --full          # Delete database file completely (nuclear option)
 */

const { run, get, all, query, healthCheck, initializePool, closePool } = require("../../database/db-adapter.js");
const fs = require("fs");
const readline = require("readline");
require("dotenv").config();

// ANSI colors for terminal
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Get current database statistics
 */
async function getStats() {
  // Check database connection first
  const isHealthy = await healthCheck().catch(() => false);
  if (!isHealthy) {
    return null;
  }

  const stats = {};

  try {
    stats.searches = (await get("SELECT COUNT(*) as count FROM searches"))?.count || 0;
    stats.sites = (await get("SELECT COUNT(*) as count FROM sites"))?.count || 0;
    stats.wordpressSites = (await get("SELECT COUNT(*) as count FROM sites WHERE is_wordpress = 1"))?.count || 0;
    stats.contacts = (await get("SELECT COUNT(*) as count FROM contacts"))?.count || 0;
    stats.keywords = (await get("SELECT COUNT(*) as count FROM keywords"))?.count || 0;
    stats.executives = (await get("SELECT COUNT(*) as count FROM company_executives"))?.count || 0;

    // Email system tables (may not exist)
    try {
      stats.emailSenders = (await get("SELECT COUNT(*) as count FROM email_senders"))?.count || 0;
      stats.emailTemplates = (await get("SELECT COUNT(*) as count FROM email_templates"))?.count || 0;
      stats.emailCampaigns = (await get("SELECT COUNT(*) as count FROM email_campaigns"))?.count || 0;
      stats.emailQueue = (await get("SELECT COUNT(*) as count FROM email_queue"))?.count || 0;
    } catch (e) {
      stats.emailSenders = 0;
      stats.emailTemplates = 0;
      stats.emailCampaigns = 0;
      stats.emailQueue = 0;
    }
  } catch (e) {
    return null;
  }
  return stats;
}

/**
 * Display current database statistics
 */
async function displayStats() {
  const stats = await getStats();

  if (!stats) {
    log("\n📭 Database connection failed or empty.\n", "yellow");
    return;
  }

  log("\n Current Database Statistics:", "cyan");
  log("═".repeat(50), "cyan");
  log(`   Searches:         ${stats.searches}`, "reset");
  log(`   Sites:            ${stats.sites}`, "reset");
  log(`   WordPress Sites:  ${stats.wordpressSites}`, "reset");
  log(`   Contacts:         ${stats.contacts}`, "reset");
  log(`   Keywords:         ${stats.keywords}`, "reset");
  log(`   Executives:       ${stats.executives}`, "reset");
  log("", "reset");
  log("   📧 Email System:", "blue");
  log(`   Senders:          ${stats.emailSenders}`, "reset");
  log(`   Templates:        ${stats.emailTemplates}`, "reset");
  log(`   Campaigns:        ${stats.emailCampaigns}`, "reset");
  log(`   Queue:            ${stats.emailQueue}`, "reset");
  log("═".repeat(50) + "\n", "cyan");
}

/**
 * Clear leads data (sites, contacts, executives, searches)
 */
async function clearLeadsData() {
  const isHealthy = await healthCheck().catch(() => false);
  if (!isHealthy) {
    log(" Database connection failed.", "red");
    return false;
  }

  try {
    // Clear email_send_log first (references contacts)
    try {
      await run("DELETE FROM email_send_log");
    } catch (e) {
      // Table may not exist
    }

    // Clear in correct order due to foreign keys
    // PostgreSQL handles foreign keys differently - use TRUNCATE with CASCADE or DELETE in order
    await run("DELETE FROM company_executives");
    await run("DELETE FROM contacts");
    await run("DELETE FROM sites");
    await run("DELETE FROM searches");

    // Reset sequences (PostgreSQL equivalent of sqlite_sequence)
    try {
      await query("SELECT setval('company_executives_id_seq', 1, false)");
      await query("SELECT setval('contacts_id_seq', 1, false)");
      await query("SELECT setval('sites_id_seq', 1, false)");
      await query("SELECT setval('searches_id_seq', 1, false)");
    } catch (e) {
      // Sequences may not exist or may have different names
    }

    log(" Leads data cleared (sites, contacts, executives, searches)", "green");
    return true;
  } catch (e) {
    log(` Error clearing leads: ${e.message}`, "red");
    return false;
  }
}

/**
 * Clear keywords
 */
async function clearKeywords() {
  const isHealthy = await healthCheck().catch(() => false);
  if (!isHealthy) {
    log(" Database connection failed.", "red");
    return false;
  }

  try {
    await run("DELETE FROM keywords");
    // Reset sequence
    try {
      await query("SELECT setval('keywords_id_seq', 1, false)");
    } catch (e) {
      // Sequence may not exist
    }
    log(" Keywords cleared", "green");
    return true;
  } catch (e) {
    log(` Error clearing keywords: ${e.message}`, "red");
    return false;
  }
}

/**
 * Clear email system data
 */
async function clearEmailData() {
  const isHealthy = await healthCheck().catch(() => false);
  if (!isHealthy) {
    log(" Database connection failed.", "red");
    return false;
  }

  try {
    // Clear in correct order due to foreign keys
    // email_send_log references contacts and templates
    try {
      await run("DELETE FROM email_send_log");
    } catch (e) {
      // Table may not exist
    }

    // email_queue references campaigns and senders
    await run("DELETE FROM email_queue");

    // email_campaigns references templates
    await run("DELETE FROM email_campaigns");

    // Now safe to delete templates and senders
    await run("DELETE FROM email_templates");
    await run("DELETE FROM email_senders");

    // Also clear settings if user wants fresh start
    try {
      await run("DELETE FROM email_settings");
    } catch (e) {
      // Table may not exist
    }

    // Reset sequences (PostgreSQL equivalent)
    const emailTables = ['email_send_log', 'email_queue', 'email_campaigns', 'email_templates', 'email_senders', 'email_settings'];
    for (const table of emailTables) {
      try {
        await query(`SELECT setval('${table}_id_seq', 1, false)`);
      } catch (e) {
        // Sequence may not exist
      }
    }

    log(
      " Email system data cleared (queue, campaigns, templates, senders, logs)",
      "green",
    );
    return true;
  } catch (e) {
    log(` Error clearing email data: ${e.message}`, "red");
    return false;
  }
}

/**
 * Clear ALL data (keeps table structure)
 */
async function clearAllData() {
  // Clear email data FIRST since it references contacts
  await clearEmailData();
  await clearLeadsData();
  await clearKeywords();
  log("\n🧹 All data cleared. Database structure preserved.", "green");
}

/**
 * Delete database file completely (nuclear option)
 * Note: For PostgreSQL, this is not applicable - databases are managed by the server
 */
async function deleteDatabase() {
  log("⚠️  PostgreSQL databases are managed by the server.", "yellow");
  log("   Use DROP DATABASE via SQL client or admin panel to completely delete.", "cyan");
  log("   Or use TRUNCATE TABLE commands to clear all data.", "cyan");
  return true;
}

/**
 * Prompt for confirmation
 */
async function confirm(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `${colors.yellow}${message} (y/N): ${colors.reset}`,
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
      },
    );
  });
}

/**
 * Interactive mode menu
 */
async function interactiveMode() {
  await displayStats();

  log("🔧 Database Reset Options:", "cyan");
  log("═".repeat(50), "cyan");
  log(
    "   1. Clear leads data (sites, contacts, executives, searches)",
    "reset",
  );
  log("   2. Clear keywords only", "reset");
  log("   3. Clear email system data only", "reset");
  log("   4. Clear ALL data (keeps table structure)", "reset");
  log("   5. Database info (PostgreSQL - no file deletion)", "yellow");
  log("   0. Exit without changes", "reset");
  log("═".repeat(50) + "\n", "cyan");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `${colors.blue}Enter option (0-5): ${colors.reset}`,
      async (answer) => {
        rl.close();

        switch (answer.trim()) {
          case "1":
            if (await confirm("Clear all leads data?")) {
              await clearLeadsData();
            }
            break;
          case "2":
            if (await confirm("Clear all keywords?")) {
              await clearKeywords();
            }
            break;
          case "3":
            if (await confirm("Clear all email system data?")) {
              await clearEmailData();
            }
            break;
          case "4":
            if (await confirm("Clear ALL data from the database?")) {
              await clearAllData();
            }
            break;
          case "5":
            log(
              "\n📊 PostgreSQL Database Info:",
              "cyan",
            );
            log("   PostgreSQL databases are server-managed, not file-based.", "reset");
            log("   To completely reset: Use DROP DATABASE via SQL client.", "reset");
            log("   To clear all data: Use TRUNCATE on all tables.", "reset");
            break;
          case "0":
            log("\n👋 Exiting without changes.\n", "cyan");
            break;
          default:
            log("\n Invalid option. Exiting.\n", "red");
        }

        resolve();
      },
    );
  });
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Initialize PostgreSQL pool
  try {
    await initializePool();
  } catch (e) {
    log(`\n Error: Could not connect to database.`, "red");
    log(` Make sure DATABASE_URL is set in .env file.`, "yellow");
    return;
  }

  log("\n🗄️  WordPress Detector - Database Reset Tool", "cyan");
  log("═".repeat(50), "cyan");

  if (args.length === 0) {
    // Interactive mode
    await interactiveMode();
  } else {
    const flag = args[0];

    switch (flag) {
      case "--all":
        await displayStats();
        await clearAllData();
        break;
      case "--leads":
        await displayStats();
        await clearLeadsData();
        break;
      case "--email":
        await displayStats();
        await clearEmailData();
        break;
      case "--keywords":
        await displayStats();
        await clearKeywords();
        break;
      case "--full":
        await displayStats();
        log(
          "\n⚠️  PostgreSQL databases are server-managed, not file-based.",
          "yellow",
        );
        log("   Use DROP DATABASE via SQL client to completely delete.", "cyan");
        break;
      case "--stats":
        await displayStats();
        break;
      case "--help":
      case "-h":
        log(
          `
Usage:
  node reset-db.js                 # Interactive mode
  node reset-db.js --stats         # Show statistics only
  node reset-db.js --all           # Clear all data (keeps tables)
  node reset-db.js --leads         # Clear only leads data
  node reset-db.js --email         # Clear only email system data
  node reset-db.js --keywords      # Clear only keywords

Note: PostgreSQL databases are server-managed. Use DROP DATABASE via
SQL client to completely delete the database.
        `,
          "reset",
        );
        break;
      default:
        log(` Unknown flag: ${flag}. Use --help for usage.`, "red");
    }
  }

  log("", "reset");
}

main().catch(console.error);
