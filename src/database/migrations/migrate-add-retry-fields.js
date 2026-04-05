/**
 * Migration: Add retry tracking fields to sites table
 * This enables automatic retry of failed AI analysis attempts
 */

const db = require("../database.js");

console.log("========================================");
console.log("MIGRATION: Add Retry Tracking Fields");
console.log("========================================\n");

async function runMigration() {
  const database = db.initDatabase();

  try {
    // Check if columns already exist (PostgreSQL syntax)
    const columns = await database.all(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'sites'
    `);
    const columnNames = columns.map((c) => c.column_name);

    if (
      columnNames.includes("retry_count") &&
      columnNames.includes("last_retried_at")
    ) {
      console.log(" Retry columns already exist. Migration not needed.\n");
      process.exit(0);
    }

    // Add retry_count column
    if (!columnNames.includes("retry_count")) {
      console.log("Adding retry_count column...");
      await database.run(
        "ALTER TABLE sites ADD COLUMN retry_count INTEGER DEFAULT 0"
      );
      console.log(" retry_count column added");
    } else {
      console.log("  retry_count column already exists");
    }

    // Add last_retried_at column
    if (!columnNames.includes("last_retried_at")) {
      console.log("Adding last_retried_at column...");
      await database.run(
        "ALTER TABLE sites ADD COLUMN last_retried_at TIMESTAMP"
      );
      console.log(" last_retried_at column added");
    } else {
      console.log("  last_retried_at column already exists");
    }

    console.log("\n Migration completed successfully!\n");
    console.log(
      "The AI retry manager can now track and retry failed analysis attempts.\n",
    );
  } catch (error) {
    console.error(" Migration failed:", error.message);
    process.exit(1);
  }
}

runMigration();
