/**
 * Setup Timezone-Aware Email Sending
 *
 * This script initializes the timezone-aware email scheduling system
 */

console.log(" Setting up Timezone-Aware Email Sending System...\n");

const { execSync } = require("child_process");

try {
  // Step 1: Run migration
  console.log("📊 Step 1: Running database migration...");
  execSync("node src/scripts/migrations/migrate-add-timezone-support.js", {
    stdio: "inherit",
    cwd: __dirname,
  });

  console.log("\n✅ Setup Complete!");
  console.log("\n📚 What You Can Now Do:\n");

  console.log("1. **View Timezone Statistics**");
  console.log("   GET /api/email/timezone/stats");
  console.log("   See which countries are in business hours right now\n");

  console.log("2. **Get Optimal Send Times for Contacts**");
  console.log("   GET /api/email/timezone/optimal-times/:contactId");
  console.log("   Calculate best times to email specific contacts\n");

  console.log("3. **Create Timezone-Aware Campaigns**");
  console.log("   POST /api/email/campaign/timezone-aware");
  console.log("   Automatically schedule emails based on recipient timezone\n");

  console.log("4. **Monitor Countries in Business Hours**");
  console.log("   GET /api/email/timezone/countries-in-business");
  console.log("   Real-time view of countries currently in business hours\n");

  console.log("\n🎯 How It Works:\n");
  console.log("•  Detects country from scraped site");
  console.log("• 🕐 Maps country to timezone (India → IST, US → EST)");
  console.log("• 💼 Calculates business hours (9 AM - 5 PM local time)");
  console.log("• 📅 Schedules emails for optimal local send times");
  console.log("• ✅ Avoids weekends and late-night sends");
  console.log("• 📊 Batches emails by timezone for efficiency");

  console.log("\n📖 Example Usage:\n");
  console.log(`
// 1. Check which countries are ready for email sending
fetch('/api/email/timezone/countries-in-business')
  .then(res => res.json())
  .then(data => {
    console.log('Ready to send to:', data.data);
    // Send to countries currently in business hours
  });

// 2. Get optimal send time for a contact
fetch('/api/email/timezone/optimal-times/123')
  .then(res => res.json())
  .then(data => {
    console.log('Best times to send:', data.data.optimal_send_times);
  });

// 3. Create timezone-aware campaign
fetch('/api/email/campaign/timezone-aware', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Global Campaign',
    template_id: 1,
    target_type: 'timezone_optimized'
  })
});
  `);

  console.log("\n🚀 Next Steps:");
  console.log("1. Run your scraper to collect sites from different countries");
  console.log("2. Contacts will be tagged with their country automatically");
  console.log("3. Create campaigns with timezone-aware scheduling");
  console.log("4. Emails will be sent at optimal local times");
  console.log("5. Monitor performance by country/timezone");
} catch (error) {
  console.error("❌ Setup failed:", error.message);
  process.exit(1);
}
