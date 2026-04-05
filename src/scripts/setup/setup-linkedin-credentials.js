/**
 * Setup LinkedIn Credentials Management System
 *
 * This script creates a linkedin_credentials table and seeds it with default settings.
 *
 * Usage: node setup-linkedin-credentials.js
 */

const db = require("../../database/database.js");

console.log("🔐 Setting up LinkedIn Credentials Management System...\n");

try {
  const database = db.initDatabase();

  // Create linkedin_credentials table
  console.log("📋 Creating linkedin_credentials table...");
  database.exec(`
    CREATE TABLE IF NOT EXISTS linkedin_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      password TEXT,
      is_active INTEGER DEFAULT 1,
      last_used TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log(" Table created successfully!\n");

  // Check if there are any existing credentials
  const existingCreds = database
    .prepare("SELECT COUNT(*) as count FROM linkedin_credentials")
    .get();

  if (existingCreds.count === 0) {
    console.log("📝 No existing credentials found.");
    console.log(" You can add LinkedIn credentials via the API or UI.");
    console.log("");
    console.log("📌 To add credentials manually, use:");
    console.log("   POST /api/linkedin/credentials");
    console.log("   {");
    console.log('     "name": "My LinkedIn Account",');
    console.log('     "email": "your@email.com",');
    console.log('     "password": "yourpassword",');
    console.log('     "notes": "Optional notes"');
    console.log("   }");
  } else {
    console.log(` Found ${existingCreds.count} existing credential(s).`);
  }

  console.log("\n LinkedIn Credentials Management System setup complete!\n");

} catch (error) {
  console.error(" Error setting up LinkedIn credentials:", error.message);
  process.exit(1);
}
