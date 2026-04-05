const { initDatabase, all, get } = require("../../database/database.js");

console.log("🔍 Checking database structure...\n");

async function checkDatabase() {
  try {
    // Initialize database connection
    initDatabase();

    // Get all table names using PostgreSQL information_schema
    const tables = await all(`
      SELECT table_name as name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log(" Tables found:");
    tables.forEach((table) => {
      console.log(`   - ${table.name}`);
    });

    console.log("\n Table structures:\n");

    // Helper function to get column info for a table
    async function getTableColumns(tableName) {
      return await all(`
        SELECT column_name as name, data_type as type
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);
    }

    // Check searches table
    console.log("📁 searches table:");
    const searchesColumns = await getTableColumns('searches');
    searchesColumns.forEach((col) => {
      console.log(`   - ${col.name} (${col.type})`);
    });

    // Check sites table
    console.log("\n📁 sites table:");
    const sitesColumns = await getTableColumns('sites');
    sitesColumns.forEach((col) => {
      console.log(`   - ${col.name} (${col.type})`);
    });

    // Check contacts table
    console.log("\n📁 contacts table:");
    const contactsColumns = await getTableColumns('contacts');
    contactsColumns.forEach((col) => {
      console.log(`   - ${col.name} (${col.type})`);
    });

    // Check keywords table
    console.log("\n📁 keywords table:");
    const keywordsColumns = await getTableColumns('keywords');
    keywordsColumns.forEach((col) => {
      console.log(`   - ${col.name} (${col.type})`);
    });

    console.log("\n📈 Current data counts:");

    const searches = await get(`SELECT COUNT(*) as count FROM searches`);
    console.log(`   - Searches: ${searches.count}`);

    const sites = await get(`SELECT COUNT(*) as count FROM sites`);
    console.log(`   - Sites: ${sites.count}`);

    const wpSites = await get(`SELECT COUNT(*) as count FROM sites WHERE is_wordpress = 1`);
    console.log(`   - WordPress sites: ${wpSites.count}`);

    const contacts = await get(`SELECT COUNT(*) as count FROM contacts`);
    console.log(`   - Total contacts: ${contacts.count}`);

    const emails = await get(`SELECT COUNT(*) as count FROM contacts WHERE type = 'email'`);
    console.log(`   - Emails: ${emails.count}`);

    const phones = await get(`SELECT COUNT(*) as count FROM contacts WHERE type = 'phone'`);
    console.log(`   - Phones: ${phones.count}`);

    const linkedins = await get(`SELECT COUNT(*) as count FROM contacts WHERE type = 'linkedin'`);
    console.log(`   - LinkedIn profiles: ${linkedins.count}`);

    const keywords = await get(`SELECT COUNT(*) as count FROM keywords`);
    console.log(`   - Keywords: ${keywords.count}`);

    // Show sample LinkedIn URLs if any exist
    if (linkedins.count > 0) {
      console.log("\n🔗 Sample LinkedIn profiles found:");
      const sampleLinkedins = await all(`
        SELECT c.value, s.url as site_url
        FROM contacts c
        INNER JOIN sites s ON c.site_id = s.id
        WHERE c.type = 'linkedin'
        LIMIT 5
      `);

      sampleLinkedins.forEach((li, i) => {
        console.log(`   ${i + 1}. ${li.value}`);
        console.log(`      from: ${li.site_url}`);
      });
    }

    // Check AI status breakdown
    console.log("\n🤖 AI Status Breakdown:");
    const aiStatusBreakdown = await all(`
      SELECT COALESCE(ai_status, 'NULL') as ai_status, COUNT(*) as count
      FROM sites
      WHERE is_wordpress = 1
      GROUP BY ai_status
    `);
    aiStatusBreakdown.forEach((status) => {
      console.log(`   - ${status.ai_status}: ${status.count} sites`);
    });

    // Check pending sites with content
    const pendingWithContent = await get(`
      SELECT COUNT(*) as count
      FROM sites
      WHERE is_wordpress = 1
        AND (ai_status = 'pending' OR ai_status IS NULL)
        AND (text_content IS NOT NULL AND text_content != '')
    `);
    console.log(`\n   Pending sites with content: ${pendingWithContent.count}`);

    // Check sites without content
    const sitesWithoutContent = await get(`
      SELECT COUNT(*) as count
      FROM sites
      WHERE is_wordpress = 1
        AND (text_content IS NULL OR text_content = '')
    `);
    console.log(
      `   WordPress sites without content: ${sitesWithoutContent.count}`,
    );

    // Show sample pending sites
    const samplePending = await all(`
      SELECT id, url, ai_status, LENGTH(text_content) as content_length
      FROM sites
      WHERE is_wordpress = 1
        AND (ai_status = 'pending' OR ai_status IS NULL)
        AND (text_content IS NOT NULL AND text_content != '')
      LIMIT 5
    `);

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
    const relevanceBreakdown = await all(`
      SELECT COALESCE(ai_content_relevant::text, 'NULL') as ai_content_relevant, COUNT(*) as count
      FROM sites
      WHERE is_wordpress = 1
        AND ai_status = 'completed'
      GROUP BY ai_content_relevant
    `);

    if (relevanceBreakdown.length > 0) {
      console.log("\n AI Content Relevance (completed sites):");
      relevanceBreakdown.forEach((rel) => {
        const label =
          rel.ai_content_relevant === "NULL"
            ? "NULL"
            : rel.ai_content_relevant === "1"
              ? "Relevant"
              : "Not Relevant";
        console.log(`   - ${label}: ${rel.count} sites`);
      });
    }

    // Show sample AI analysis for WordPress sites
    const sampleAIAnalysis = await all(`
      SELECT id, url, ai_actual_category, ai_content_summary, ai_mismatch_reason
      FROM sites
      WHERE is_wordpress = 1
        AND ai_status = 'completed'
      LIMIT 5
    `);

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

    console.log("\n Database check complete!\n");
  } catch (error) {
    console.error(" Error checking database:", error.message);
  }
}

checkDatabase();
