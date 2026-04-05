/**
 * Email System Diagnostic Tool
 * Run this script to check for common issues with the email sending system
 *
 * Usage: node src/scripts/maintenance/diagnose-email-system.js
 */

const db = require("../../database/database.js");

console.log("\n" + "=".repeat(60));
console.log("🔍 EMAIL SYSTEM DIAGNOSTIC TOOL");
console.log("=".repeat(60) + "\n");

let issuesFound = 0;
let warnings = 0;

// 1. Check database connection
console.log("1️⃣  Checking database connection...");
try {
  const result = db.get("SELECT 1 as test");
  if (result.test === 1) {
    console.log("   ✅ Database connection: OK");
  }
} catch (error) {
  console.log("   ❌ Database connection: FAILED");
  console.log(`      Error: ${error.message}`);
  issuesFound++;
}

// 2. Check email senders
console.log("\n2️⃣  Checking email senders...");
const senders = db.all("SELECT * FROM email_senders");
if (senders.length === 0) {
  console.log("   ❌ No email senders configured!");
  console.log("      → Add email senders via the admin panel or API");
  issuesFound++;
} else {
  console.log(`   ✅ Found ${senders.length} sender(s):`);

  const activeSenders = senders.filter((s) => s.is_active === 1);
  if (activeSenders.length === 0) {
    console.log("   ❌ No ACTIVE email senders!");
    console.log("      → Activate at least one sender account");
    issuesFound++;
  } else {
    console.log(`   ✅ ${activeSenders.length} active sender(s):`);
    activeSenders.forEach((sender) => {
      const today = new Date().toDateString();
      const needsReset = sender.last_reset_date !== today;
      const atLimit = sender.sent_today >= sender.daily_limit;

      let status = "🟢";
      let details = `${sender.sent_today}/${sender.daily_limit} sent today`;

      if (needsReset) {
        status = "🟡";
        details += " (needs daily reset)";
        warnings++;
      }

      if (atLimit) {
        status = "🔴";
        details += " (AT LIMIT)";
        issuesFound++;
      }

      console.log(`      ${status} ${sender.name} (${sender.email}): ${details}`);
    });
  }
}

// 3. Check email queue
console.log("\n3️⃣  Checking email queue...");
const queueStats = db.get(`
  SELECT
    COUNT(*) as total,
    COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued,
    COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
    COUNT(CASE WHEN status = 'sending' THEN 1 END) as sending
  FROM email_queue
`);

console.log(`   Total emails in queue: ${queueStats.total}`);
console.log(`   📤 Queued: ${queueStats.queued}`);
console.log(`   ✅ Sent: ${queueStats.sent}`);
console.log(`   ❌ Failed: ${queueStats.failed}`);
console.log(`   🔄 Sending: ${queueStats.sending}`);

if (queueStats.queued > 0) {
  // Check queued emails breakdown
  const queuedBreakdown = db.get(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN scheduled_at IS NULL THEN 1 END) as immediate,
      COUNT(CASE WHEN scheduled_at IS NOT NULL AND scheduled_at <= datetime('now') THEN 1 END) as ready,
      COUNT(CASE WHEN scheduled_at IS NOT NULL AND scheduled_at > datetime('now') THEN 1 END) as scheduled
    FROM email_queue
    WHERE status = 'queued'
  `);

  console.log("\n   📊 Queued emails breakdown:");
  console.log(`      Ready to send NOW: ${queuedBreakdown.immediate + queuedBreakdown.ready}`);
  console.log(`      Scheduled for future: ${queuedBreakdown.scheduled}`);

  if (queuedBreakdown.scheduled > 0) {
    const nextScheduled = db.get(`
      SELECT scheduled_at, recipient_email, subject
      FROM email_queue
      WHERE status = 'queued' AND scheduled_at > datetime('now')
      ORDER BY scheduled_at ASC
      LIMIT 1
    `);
    if (nextScheduled) {
      console.log(`      Next scheduled: ${nextScheduled.scheduled_at}`);
      console.log(`         → ${nextScheduled.recipient_email}: ${nextScheduled.subject}`);
    }
  }

  // Show first 5 queued emails
  const firstQueued = db.all(`
    SELECT id, recipient_email, subject, scheduled_at, created_at
    FROM email_queue
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 5
  `);

  if (firstQueued.length > 0) {
    console.log("\n   📋 First 5 queued emails:");
    firstQueued.forEach((email, idx) => {
      const scheduled = email.scheduled_at
        ? `📅 ${email.scheduled_at}`
        : "⚡ Immediate";
      console.log(`      ${idx + 1}. ${email.recipient_email}`);
      console.log(`         Subject: ${email.subject}`);
      console.log(`         Status: ${scheduled}`);
      console.log(`         Queued: ${email.created_at}`);
    });
  }
}

// 4. Check for stuck emails
console.log("\n4️⃣  Checking for stuck emails...");
const stuckEmails = db.all(`
  SELECT * FROM email_queue
  WHERE status = 'sending'
    AND sent_at < datetime('now', '-1 hour')
`);
if (stuckEmails.length > 0) {
  console.log(`   ⚠️  Found ${stuckEmails.length} stuck emails in 'sending' status`);
  console.log("      → These emails have been sending for over 1 hour");
  issuesFound++;
  stuckEmails.forEach((email) => {
    console.log(`         - ID ${email.id}: ${email.recipient_email}`);
  });
} else {
  console.log("   ✅ No stuck emails found");
}

// 5. Check email templates
console.log("\n5️⃣  Checking email templates...");
const templates = db.all("SELECT * FROM email_templates WHERE is_active = 1");
if (templates.length === 0) {
  console.log("   ⚠️  No active email templates found");
  warnings++;
} else {
  console.log(`   ✅ ${templates.length} active template(s)`);

  // Check templates by tags
  const tagGroups = {};
  templates.forEach((t) => {
    const tags = (t.tags || "").split(",").map((s) => s.trim()).filter((s) => s);
    tags.forEach((tag) => {
      if (!tagGroups[tag]) tagGroups[tag] = [];
      tagGroups[tag].push(t.name);
    });
  });

  if (Object.keys(tagGroups).length > 0) {
    console.log("\n   📁 Template groups by tag:");
    Object.entries(tagGroups).forEach(([tag, templates]) => {
      console.log(`      "${tag}": ${templates.length} template(s)`);
      templates.forEach((t, idx) => {
        console.log(`         ${idx + 1}. ${t}`);
      });
    });
  }
}

// 6. Check email settings
console.log("\n6️⃣  Checking email settings...");
const settings = db.all("SELECT * FROM email_settings");
const settingMap = {};
settings.forEach((s) => {
  settingMap[s.key] = s.value;
});

console.log("   ⏱️  Timing settings:");
console.log(`      Per-email delay: ${settingMap.per_email_delay || 60} seconds`);
console.log(
  `      Cycle cooldown: ${settingMap.cycle_cooldown_min || 10}-${settingMap.cycle_cooldown_max || 13} minutes`,
);

console.log("\n   📅 Follow-up gap settings:");
for (let i = 1; i <= 10; i++) {
  const key = `followup_gap_${i}`;
  if (settingMap[key]) {
    console.log(`      Gap ${i}: ${settingMap[key]} days`);
  } else {
    break;
  }
}

// 7. Summary
console.log("\n" + "=".repeat(60));
console.log("📊 DIAGNOSTIC SUMMARY");
console.log("=".repeat(60));

if (issuesFound === 0 && warnings === 0) {
  console.log("✅ No issues found! Your email system appears healthy.");
  console.log("\n💡 Next steps:");
  console.log("   - If emails are queued but not sending, click 'Start Queue' in the admin panel");
  console.log("   - Check the System Console tab for real-time logs");
} else {
  if (issuesFound > 0) {
    console.log(`❌ Found ${issuesFound} critical issue(s) that prevent email sending`);
  }
  if (warnings > 0) {
    console.log(`⚠️  Found ${warnings} warning(s) that may affect performance`);
  }

  console.log("\n🔧 Recommended actions:");
  if (senders.filter((s) => s.is_active === 1).length === 0) {
    console.log("   1. Activate at least one email sender account");
  }
  if (queueStats.queued > 0 && senders.filter((s) => s.is_active === 1 && s.sent_today < s.daily_limit).length === 0) {
    console.log("   2. All active senders have reached daily limit. Wait for reset or increase limits");
  }
  if (queueStats.queued > 0) {
    console.log("   3. Make sure the queue worker is running (check 'Start Queue' button)");
  }
  if (queueStats.failed > 0) {
    console.log("   4. Review failed emails and fix SMTP credentials or recipient addresses");
  }
}

console.log("\n" + "=".repeat(60) + "\n");
