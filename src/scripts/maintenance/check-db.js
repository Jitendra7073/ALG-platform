const db = require("../../database/database.js");

console.log("🔍 Checking database structure...\n");

try {
  const database = db.initDatabase();

  // Get all table names
  const tables = database
    .prepare(
      `
    SELECT name FROM sqlite_master WHERE type='table'
  `,
    )
    .all();

  console.log(" Tables found:");
  tables.forEach((table) => {
    console.log(`   - ${table.name}`);
  });

  console.log("\n Table structures:\n");

  // Check searches table
  console.log("📁 searches table:");
  const searchesColumns = database.prepare(`PRAGMA table_info(searches)`).all();
  searchesColumns.forEach((col) => {
    console.log(`   - ${col.name} (${col.type})`);
  });

  // Check sites table
  console.log("\n📁 sites table:");
  const sitesColumns = database.prepare(`PRAGMA table_info(sites)`).all();
  sitesColumns.forEach((col) => {
    console.log(`   - ${col.name} (${col.type})`);
  });

  // Check contacts table
  console.log("\n📁 contacts table:");
  const contactsColumns = database.prepare(`PRAGMA table_info(contacts)`).all();
  contactsColumns.forEach((col) => {
    console.log(`   - ${col.name} (${col.type})`);
  });

  // Check keywords table
  console.log("\n📁 keywords table:");
  const keywordsColumns = database.prepare(`PRAGMA table_info(keywords)`).all();
  keywordsColumns.forEach((col) => {
    console.log(`   - ${col.name} (${col.type})`);
  });

  console.log("\n📈 Current data counts:");

  const searches = database
    .prepare(`SELECT COUNT(*) as count FROM searches`)
    .get();
  console.log(`   - Searches: ${searches.count}`);

  const sites = database.prepare(`SELECT COUNT(*) as count FROM sites`).get();
  console.log(`   - Sites: ${sites.count}`);

  const wpSites = database
    .prepare(`SELECT COUNT(*) as count FROM sites WHERE is_wordpress = 1`)
    .get();
  console.log(`   - WordPress sites: ${wpSites.count}`);

  const contacts = database
    .prepare(`SELECT COUNT(*) as count FROM contacts`)
    .get();
  console.log(`   - Total contacts: ${contacts.count}`);

  const emails = database
    .prepare(`SELECT COUNT(*) as count FROM contacts WHERE type = 'email'`)
    .get();
  console.log(`   - Emails: ${emails.count}`);

  const phones = database
    .prepare(`SELECT COUNT(*) as count FROM contacts WHERE type = 'phone'`)
    .get();
  console.log(`   - Phones: ${phones.count}`);

  const linkedins = database
    .prepare(`SELECT COUNT(*) as count FROM contacts WHERE type = 'linkedin'`)
    .get();
  console.log(`   - LinkedIn profiles: ${linkedins.count}`);

  const keywords = database
    .prepare(`SELECT COUNT(*) as count FROM keywords`)
    .get();
  console.log(`   - Keywords: ${keywords.count}`);

  // Show sample LinkedIn URLs if any exist
  if (linkedins.count > 0) {
    console.log("\n🔗 Sample LinkedIn profiles found:");
    const sampleLinkedins = database
      .prepare(
        `
      SELECT c.value, s.url as site_url
      FROM contacts c
      INNER JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'linkedin'
      LIMIT 5
    `,
      )
      .all();

    sampleLinkedins.forEach((li, i) => {
      console.log(`   ${i + 1}. ${li.value}`);
      console.log(`      from: ${li.site_url}`);
    });
  }

  // Check AI status breakdown
  console.log("\n🤖 AI Status Breakdown:");
  const aiStatusBreakdown = database
    .prepare(
      `
    SELECT ai_status, COUNT(*) as count
    FROM sites
    WHERE is_wordpress = 1
    GROUP BY ai_status
  `,
    )
    .all();
  aiStatusBreakdown.forEach((status) => {
    console.log(`   - ${status.ai_status || "NULL"}: ${status.count} sites`);
  });

  // Check pending sites with content
  const pendingWithContent = database
    .prepare(
      `
    SELECT COUNT(*) as count
    FROM sites
    WHERE is_wordpress = 1
      AND (ai_status = 'pending' OR ai_status IS NULL)
      AND (text_content IS NOT NULL AND text_content != '')
  `,
    )
    .get();
  console.log(`\n   Pending sites with content: ${pendingWithContent.count}`);

  // Check sites without content
  const sitesWithoutContent = database
    .prepare(
      `
    SELECT COUNT(*) as count
    FROM sites
    WHERE is_wordpress = 1
      AND (text_content IS NULL OR text_content = '')
  `,
    )
    .get();
  console.log(
    `   WordPress sites without content: ${sitesWithoutContent.count}`,
  );

  // Show sample pending sites
  const samplePending = database
    .prepare(
      `
    SELECT id, url, ai_status, LENGTH(text_content) as content_length
    FROM sites
    WHERE is_wordpress = 1
      AND (ai_status = 'pending' OR ai_status IS NULL)
      AND (text_content IS NOT NULL AND text_content != '')
    LIMIT 5
  `,
    )
    .all();

  if (samplePending.length > 0) {
    console.log("\n📋 Sample pending sites ready for AI processing:");
    samplePending.forEach((site) => {
      console.log(`   - [${site.id}] ${site.url}`);
      console.log(
        `     Status: ${site.ai_status || "NULL"}, Content: ${site.content_length} chars`,
      );
    });
  }

  // Check AI content relevance
  const relevanceBreakdown = database
    .prepare(
      `
    SELECT ai_content_relevant, COUNT(*) as count
    FROM sites
    WHERE is_wordpress = 1
      AND ai_status = 'completed'
    GROUP BY ai_content_relevant
  `,
    )
    .all();

  if (relevanceBreakdown.length > 0) {
    console.log("\n AI Content Relevance (completed sites):");
    relevanceBreakdown.forEach((rel) => {
      const label =
        rel.ai_content_relevant === null
          ? "NULL"
          : rel.ai_content_relevant === 1
            ? "Relevant"
            : "Not Relevant";
      console.log(`   - ${label}: ${rel.count} sites`);
    });
  }

  // Show sample AI analysis for WordPress sites
  const sampleAIAnalysis = database
    .prepare(
      `
    SELECT id, url, ai_actual_category, ai_content_summary, ai_mismatch_reason
    FROM sites
    WHERE is_wordpress = 1
      AND ai_status = 'completed'
    LIMIT 5
  `,
    )
    .all();

  if (sampleAIAnalysis.length > 0) {
    console.log("\n📝 Sample AI Analysis:");
    sampleAIAnalysis.forEach((site) => {
      console.log(`   - [${site.id}] ${site.url}`);
      console.log(`     Category: ${site.ai_actual_category || "N/A"}`);
      console.log(
        `     Summary: ${(site.ai_content_summary || "N/A").substring(0, 100)}...`,
      );
      if (site.ai_mismatch_reason) {
        console.log(`     Mismatch: ${site.ai_mismatch_reason}`);
      }
    });
  }

  database.close();

  console.log("\n Database check complete!\n");
} catch (error) {
  console.error(" Error checking database:", error.message);
}
