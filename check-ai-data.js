/**
 * Debug script to check AI processing data
 */

const db = require('./database');

console.log('========================================');
console.log('AI PROCESSING DATA ANALYSIS');
console.log('========================================\n');

const database = db.initDatabase();

try {
  // Get recent AI-processed sites
  console.log('1. RECENT AI-PROCESSED SITES:\n');
  const recentSites = database.prepare(`
    SELECT id, url, search_query, ai_content_relevant, ai_actual_category, ai_mismatch_reason
    FROM sites
    WHERE ai_status = 'completed'
    ORDER BY ai_processed_at DESC
    LIMIT 10
  `).all();

  recentSites.forEach(site => {
    const relevant = site.ai_content_relevant === 1 ? '✅ Relevant' : '⚠️  Not Relevant';
    console.log(`   Site ID: ${site.id}`);
    console.log(`   URL: ${site.url}`);
    console.log(`   Search Query: "${site.search_query || 'NULL'}"`);
    console.log(`   AI Result: ${relevant}`);
    console.log(`   Category: ${site.ai_actual_category || 'N/A'}`);
    if (site.ai_mismatch_reason) {
      console.log(`   Mismatch Reason: ${site.ai_mismatch_reason}`);
    }
    console.log('');
  });

  // Check for potential issues
  console.log('2. SEARCH QUERY ANALYSIS:\n');
  const nullSearchQueries = database.prepare(`
    SELECT COUNT(*) as count
    FROM sites
    WHERE ai_status = 'completed' AND (search_query IS NULL OR search_query = '')
  `).get();

  console.log(`   Sites with NULL/empty search_query: ${nullSearchQueries.count}`);

  // Get examples of sites with NULL search_query
  const nullExamples = database.prepare(`
    SELECT id, url, ai_actual_category, ai_content_relevant
    FROM sites
    WHERE ai_status = 'completed' AND (search_query IS NULL OR search_query = '')
    LIMIT 5
  `).all();

  if (nullExamples.length > 0) {
    console.log('\n   Examples of sites with NULL search_query:');
    nullExamples.forEach(site => {
      const relevant = site.ai_content_relevant === 1 ? '✅' : '⚠️';
      console.log(`      [${site.id}] ${relevant} ${site.url} - Category: ${site.ai_actual_category || 'N/A'}`);
    });
  }

  // Check text_content length
  console.log('\n3. TEXT CONTENT LENGTH ANALYSIS:\n');
  const contentStats = database.prepare(`
    SELECT
      AVG(LENGTH(text_content)) as avg_length,
      MIN(LENGTH(text_content)) as min_length,
      MAX(LENGTH(text_content)) as max_length
    FROM sites
    WHERE ai_status = 'completed' AND text_content IS NOT NULL
  `).get();

  console.log(`   Average content length: ${Math.round(contentStats.avg_length)} characters`);
  console.log(`   Min content length: ${contentStats.min_length} characters`);
  console.log(`   Max content length: ${contentStats.max_length} characters`);

  // Check for very short content
  const shortContent = database.prepare(`
    SELECT COUNT(*) as count
    FROM sites
    WHERE ai_status = 'completed' AND LENGTH(text_content) < 500
  `).get();

  console.log(`\n   Sites with < 500 chars of content: ${shortContent.count}`);

  // Category distribution
  console.log('\n4. CATEGORY DISTRIBUTION:\n');
  const categories = database.prepare(`
    SELECT ai_actual_category, COUNT(*) as count,
      SUM(CASE WHEN ai_content_relevant = 1 THEN 1 ELSE 0 END) as relevant_count
    FROM sites
    WHERE ai_status = 'completed' AND ai_actual_category IS NOT NULL
    GROUP BY ai_actual_category
    ORDER BY count DESC
  `).all();

  categories.forEach(cat => {
    const percentage = Math.round((cat.relevant_count / cat.count) * 100);
    console.log(`   ${cat.ai_actual_category}: ${cat.count} (${cat.relevant_count} relevant - ${percentage}%)`);
  });

  // Relevance rate
  console.log('\n5. OVERALL RELEVANCE RATE:\n');
  const relevanceStats = database.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN ai_content_relevant = 1 THEN 1 ELSE 0 END) as relevant
    FROM sites
    WHERE ai_status = 'completed'
  `).get();

  const relevanceRate = Math.round((relevanceStats.relevant / relevanceStats.total) * 100);
  console.log(`   Total processed: ${relevanceStats.total}`);
  console.log(`   Content relevant: ${relevanceStats.relevant} (${relevanceRate}%)`);
  console.log(`   Content not relevant: ${relevanceStats.total - relevanceStats.relevant} (${100 - relevanceRate}%)`);

  // Examples of potential mismatches
  console.log('\n6. EXAMPLES OF POTENTIAL ISSUES:\n');
  console.log('   Sites marked irrelevant with search query mismatch:');
  const mismatches = database.prepare(`
    SELECT id, url, search_query, ai_actual_category, ai_mismatch_reason
    FROM sites
    WHERE ai_status = 'completed'
      AND ai_content_relevant = 0
      AND ai_mismatch_reason IS NOT NULL
      AND search_query IS NOT NULL
      AND search_query != ''
    LIMIT 5
  `).all();

  mismatches.forEach(site => {
    console.log(`\n      Site ID: ${site.id}`);
    console.log(`      URL: ${site.url}`);
    console.log(`      Search Query: "${site.search_query}"`);
    console.log(`      AI Category: ${site.ai_actual_category}`);
    console.log(`      Mismatch Reason: ${site.ai_mismatch_reason}`);
  });

  console.log('\n========================================');
  console.log('ANALYSIS COMPLETE');
  console.log('========================================\n');

} finally {
  database.close();
}
