/**
 * Quick Fix Script for Stuck Emails
 * Resets stuck emails and provides recovery options
 *
 * Usage: node src/scripts/maintenance/fix-stuck-emails.js
 */

const db = require("../../database/database.js");

console.log("\n" + "=".repeat(60));
console.log("🔧 EMAIL QUEUE FIX TOOL");
console.log("=".repeat(60) + "\n");

// Check for stuck emails
console.log("🔍 Checking for stuck emails...\n");

const stuckEmails = db.all(`
  SELECT * FROM email_queue
  WHERE status = 'sending'
    AND (sent_at IS NULL OR sent_at < datetime('now', '-1 hour'))
`);

if (stuckEmails.length === 0) {
  console.log("✅ No stuck emails found!");
  console.log("   If emails are still not sending, run: npm run diagnose-email\n");
  process.exit(0);
}

console.log(`⚠️  Found ${stuckEmails.length} stuck email(s):\n`);

stuckEmails.forEach((email, idx) => {
  const stuckTime = email.sent_at
    ? `${Math.round((Date.now() - new Date(email.sent_at)) / 60000)} minutes`
    : "unknown";
  console.log(`${idx + 1}. ID: ${email.id}`);
  console.log(`   To: ${email.recipient_email}`);
  console.log(`   Subject: ${email.subject}`);
  console.log(`   Stuck for: ${stuckTime}`);
  console.log(`   Attempts: ${email.attempts || 0}`);
  if (email.error_message) {
    console.log(`   Error: ${email.error_message}`);
  }
  console.log("");
});

// Ask what to do
console.log("=".repeat(60));
console.log("What would you like to do?");
console.log("=".repeat(60));
console.log("\nOptions:");
console.log("  1. Reset all to 'queued' status (retry sending)");
console.log("  2. Reset only failed emails (keep sending ones as-is)");
console.log("  3. Delete all stuck emails");
console.log("  4. Exit without changes\n");

// Simple readline interface
const readline = require("readline");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("Enter your choice (1-4): ", (answer) => {
  const choice = parseInt(answer.trim());

  try {
    switch (choice) {
      case 1:
        // Reset all to queued
        const stuckIds = stuckEmails.map((e) => e.id);
        const placeholders = stuckIds.map(() => "?").join(",");
        db.run(
          `UPDATE email_queue
           SET status = 'queued',
               sent_at = NULL,
               error_message = NULL
           WHERE id IN (${placeholders})`,
          stuckIds
        );
        console.log(`\n✅ Reset ${stuckIds.length} email(s) to 'queued' status`);
        console.log("   They will be retried automatically by the queue worker.\n");
        break;

      case 2:
        // Reset only failed ones
        const failedIds = stuckEmails
          .filter((e) => (e.attempts || 0) >= 3)
          .map((e) => e.id);

        if (failedIds.length > 0) {
          const placeholders2 = failedIds.map(() => "?").join(",");
          db.run(
            `UPDATE email_queue
             SET status = 'queued',
                 sent_at = NULL,
                 error_message = NULL,
                 attempts = 0
             WHERE id IN (${placeholders2})`,
            failedIds
          );
          console.log(`\n✅ Reset ${failedIds.length} failed email(s) to 'queued' status`);
        } else {
          console.log("\n⚠️  No failed emails to reset (all have < 3 attempts)");
        }
        console.log("   They will be retried automatically by the queue worker.\n");
        break;

      case 3:
        // Delete all stuck emails
        const deleteIds = stuckEmails.map((e) => e.id);
        const placeholders3 = deleteIds.map(() => "?").join(",");
        db.run(`DELETE FROM email_queue WHERE id IN (${placeholders3})`, deleteIds);
        console.log(`\n🗑️  Deleted ${deleteIds.length} stuck email(s)\n`);
        break;

      case 4:
        console.log("\n❌ Exiting without changes\n");
        break;

      default:
        console.log("\n❌ Invalid choice. Exiting.\n");
    }

    console.log("=".repeat(60));
    console.log("💡 Next steps:");
    console.log("   1. If the admin panel queue is paused, click 'Resume'");
    console.log("   2. Or click 'Start Queue' to trigger immediate processing");
    console.log("   3. Check the System Console tab for real-time logs");
    console.log("=".repeat(60) + "\n");
  } catch (error) {
    console.error("\n❌ Error:", error.message);
  }

  rl.close();
});
