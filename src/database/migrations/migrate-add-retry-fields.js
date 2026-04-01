/**
 * Migration: Add retry tracking fields to sites table
 * This enables automatic retry of failed AI analysis attempts
 */

const db = require("../database.js");

console.log("========================================");
console.log("MIGRATION: Add Retry Tracking Fields");
console.log("========================================\n");

const database = db.initDatabase();

try {
  // Check if columns already exist
  const columns = database.prepare("PRAGMA table_info(sites)").all();
  const columnNames = columns.map((c) => c.name);

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
    database
      .prepare("ALTER TABLE sites ADD COLUMN retry_count INTEGER DEFAULT 0")
      .run();
    console.log(" retry_count column added");
  } else {
    console.log("  retry_count column already exists");
  }

  // Add last_retried_at column
  if (!columnNames.includes("last_retried_at")) {
    console.log("Adding last_retried_at column...");
    database
      .prepare("ALTER TABLE sites ADD COLUMN last_retried_at DATETIME")
      .run();
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
} finally {
  database.close();
}
