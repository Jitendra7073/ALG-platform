/**
 * Migration: Add page_title and meta_description columns to sites table
 * This improves AI analysis by providing more context about the page
 */

const db = require("../database.js");

console.log("========================================");
console.log("MIGRATION: Add Page Metadata");
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
      columnNames.includes("page_title") &&
      columnNames.includes("meta_description")
    ) {
      console.log(" Columns already exist. Migration not needed.\n");
      process.exit(0);
    }

    // Add page_title column
    if (!columnNames.includes("page_title")) {
      console.log("Adding page_title column...");
      await database.run(
        "ALTER TABLE sites ADD COLUMN page_title TEXT"
      );
      console.log(" page_title column added");
    } else {
      console.log("  page_title column already exists");
    }

    // Add meta_description column
    if (!columnNames.includes("meta_description")) {
      console.log("Adding meta_description column...");
      await database.run(
        "ALTER TABLE sites ADD COLUMN meta_description TEXT"
      );
      console.log(" meta_description column added");
    } else {
      console.log("  meta_description column already exists");
    }

    console.log("\n Migration completed successfully!\n");
    console.log(
      "The scraper will now extract and save page title and meta description,",
    );
    console.log(
      "which will help the AI make more accurate relevance decisions.\n",
    );
  } catch (error) {
    console.error(" Migration failed:", error.message);
    process.exit(1);
  }
}

runMigration();
