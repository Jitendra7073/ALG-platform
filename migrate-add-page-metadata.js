/**
 * Migration: Add page_title and meta_description columns to sites table
 * This improves AI analysis by providing more context about the page
 */

const db = require('./database');

console.log('========================================');
console.log('MIGRATION: Add Page Metadata');
console.log('========================================\n');

const database = db.initDatabase();

try {
  // Check if columns already exist
  const columns = database.prepare('PRAGMA table_info(sites)').all();
  const columnNames = columns.map(c => c.name);

  if (columnNames.includes('page_title') && columnNames.includes('meta_description')) {
    console.log('✅ Columns already exist. Migration not needed.\n');
    process.exit(0);
  }

  // Add page_title column
  if (!columnNames.includes('page_title')) {
    console.log('Adding page_title column...');
    database.prepare('ALTER TABLE sites ADD COLUMN page_title TEXT').run();
    console.log('✅ page_title column added');
  } else {
    console.log('ℹ️  page_title column already exists');
  }

  // Add meta_description column
  if (!columnNames.includes('meta_description')) {
    console.log('Adding meta_description column...');
    database.prepare('ALTER TABLE sites ADD COLUMN meta_description TEXT').run();
    console.log('✅ meta_description column added');
  } else {
    console.log('ℹ️  meta_description column already exists');
  }

  console.log('\n✅ Migration completed successfully!\n');
  console.log('The scraper will now extract and save page title and meta description,');
  console.log('which will help the AI make more accurate relevance decisions.\n');

} catch (error) {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
} finally {
  database.close();
}
