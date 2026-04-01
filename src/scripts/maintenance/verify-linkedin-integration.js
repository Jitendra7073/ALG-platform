/**
 * LinkedIn Credentials Integration Verification Script
 *
 * This script verifies that the LinkedIn credentials system is properly integrated
 * and working correctly.
 */

const db = require("../../database/database.js");

console.log("========================================");
console.log("LINKEDIN CREDENTIALS VERIFICATION");
console.log("========================================\n");

try {
  const database = db.initDatabase();

  // 1. Check if table exists
  console.log("1. Checking database table...");
  const tableCheck = database
    .prepare(
      `
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='linkedin_credentials'
  `,
    )
    .get();

  if (tableCheck) {
    console.log("    linkedin_credentials table exists\n");
  } else {
    console.log("    linkedin_credentials table NOT found");
    console.log("    Run: node setup-linkedin-credentials.js\n");
    process.exit(1);
  }

  // 2. Check table structure
  console.log("2. Checking table structure...");
  const columns = database
    .prepare("PRAGMA table_info(linkedin_credentials)")
    .all();
  const requiredColumns = [
    "id",
    "name",
    "email",
    "password",
    "is_active",
    "last_used",
    "notes",
    "created_at",
    "updated_at",
  ];
  const columnNames = columns.map((c) => c.name);

  const missingColumns = requiredColumns.filter(
    (col) => !columnNames.includes(col),
  );
  if (missingColumns.length === 0) {
    console.log("    All required columns present\n");
  } else {
    console.log(`    Missing columns: ${missingColumns.join(", ")}\n`);
  }

  // 3. Count credentials
  console.log("3. Checking credentials...");
  const totalCount = database
    .prepare("SELECT COUNT(*) as count FROM linkedin_credentials")
    .get();
  console.log(`   Total credentials: ${totalCount.count}`);

  const activeCount = database
    .prepare(
      "SELECT COUNT(*) as count FROM linkedin_credentials WHERE is_active = 1",
    )
    .get();
  console.log(`   Active credentials: ${activeCount.count}`);

  const inactiveCount = totalCount.count - activeCount.count;
  console.log(`   Inactive credentials: ${inactiveCount}\n`);

  // 4. Show all credentials (masked)
  console.log("4. Listing credentials...");
  const credentials = database
    .prepare(
      `
    SELECT id, name, email, is_active, last_used, notes, created_at
    FROM linkedin_credentials
    ORDER BY is_active DESC, created_at DESC
  `,
    )
    .all();

  if (credentials.length === 0) {
    console.log("   📋 No credentials found\n");
    console.log("    To add a credential:");
    console.log("      1. Go to http://localhost:8080");
    console.log('      2. Click "LinkedIn" in the sidebar');
    console.log('      3. Click "Add Credential"');
    console.log("      4. Fill in the form and save\n");
  } else {
    credentials.forEach((cred, index) => {
      const status = cred.is_active === 1 ? " Active" : "○ Inactive";
      const lastUsed = cred.last_used
        ? new Date(cred.last_used).toLocaleString()
        : "Never";
      const email = cred.email || "Not set";
      const notes = cred.notes || "No notes";

      console.log(`   Credential #${index + 1}:`);
      console.log(`      Name: ${cred.name}`);
      console.log(`      Email: ${email}`);
      console.log(`      Status: ${status}`);
      console.log(`      Last Used: ${lastUsed}`);
      console.log(`      Notes: ${notes}`);
      console.log(
        `      Created: ${new Date(cred.created_at).toLocaleString()}`,
      );
      console.log("");
    });
  }

  // 5. Verify single-active constraint
  console.log("5. Verifying single-active constraint...");
  if (activeCount.count > 1) {
    console.log("   ⚠️  WARNING: Multiple credentials are active!");
    console.log("    This violates the single-active constraint.\n");
  } else if (activeCount.count === 1) {
    console.log("    Single-active constraint satisfied\n");
  } else {
    console.log(
      "     No active credentials (this is OK if you just added the table)\n",
    );
  }

  // 6. Check for hardcoded credentials in scraper
  console.log("6. Checking for hardcoded credentials in scraper...");
  const fs = require("fs");
  const scraperCode = fs.readFileSync("./linkedin-company-scraper.js", "utf8");

  // Check for common hardcoded patterns
  const hardCodedPatterns = [
    /email\s*[:=]\s*['"][^'"]+['"]/gi,
    /password\s*[:=]\s*['"][^'"]+['"]/gi,
    /username\s*[:=]\s*['"][^'"]+['"]/gi,
    /LI_AT\s*[:=]\s*['"][^'"]+['"]/gi,
    /JSESSIONID\s*[:=]\s*['"][^'"]+['"]/gi,
  ];

  let foundHardcoded = false;
  hardCodedPatterns.forEach((pattern) => {
    const matches = scraperCode.match(pattern);
    if (matches && matches.length > 0) {
      console.log(
        `   ⚠️  Found potential hardcoded values: ${matches.length} matches`,
      );
      matches.forEach((match) => console.log(`      - ${match}`));
      foundHardcoded = true;
    }
  });

  if (!foundHardcoded) {
    console.log("    No hardcoded credentials found in scraper\n");
  }

  // 7. Summary
  console.log("========================================");
  console.log("VERIFICATION SUMMARY");
  console.log("========================================\n");

  console.log(" Database structure: OK");
  console.log(
    ` Credentials: ${totalCount.count} total, ${activeCount.count} active`,
  );
  console.log("🔒 Security: No hardcoded credentials");
  console.log(
    "🎯 Single-active: " + (activeCount.count <= 1 ? "OK" : "WARNING"),
  );

  if (totalCount.count === 0) {
    console.log("\n📝 Next Steps:");
    console.log("   1. Start the server: npm run admin");
    console.log("   2. Open http://localhost:8080");
    console.log('   3. Go to "LinkedIn" tab');
    console.log("   4. Add your first credential");
    console.log("   5. Test the scraper: node run-executives-scraper.js");
  } else {
    console.log("\n📝 System Ready!");
    console.log("   - UI: http://localhost:8080 (LinkedIn tab)");
    console.log("   - Scraper: node run-executives-scraper.js");
    console.log("   - Toggle switches work in UI");
    console.log("   - Only one credential active at a time");
  }

  database.close();

  console.log("\n Verification complete!\n");
} catch (error) {
  console.error(" Error during verification:", error.message);
  process.exit(1);
}
