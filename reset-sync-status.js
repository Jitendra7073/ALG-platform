const Database = require('better-sqlite3');
const path = require('path');

// Database file location
const DB_PATH = path.join(__dirname, 'src', 'database', 'wordpress-detector.db');

async function resetSyncStatus() {
  console.log('🔄 Starting reset of sync status...');
  console.log(`Openning database at: ${DB_PATH}`);

  const db = new Database(DB_PATH);

  try {
    // Tables to reset
    const tables = ['sites', 'contacts', 'keywords'];
    let totalChanges = 0;

    for (const table of tables) {
      console.log(`Processing table: ${table}...`);
      
      const result = db.prepare(`UPDATE ${table} SET is_sync_to_prod = 0 WHERE is_sync_to_prod = 1`).run();
      
      console.log(`✅ Table ${table}: Reset ${result.changes} records.`);
      totalChanges += result.changes;
    }

    console.log(`\n✨ Successfully reset ${totalChanges} total records across ${tables.length} tables.`);
    
  } catch (error) {
    console.error('❌ Error resetting sync status:', error.message);
  } finally {
    db.close();
    console.log('Database connection closed.');
  }
}

resetSyncStatus();
