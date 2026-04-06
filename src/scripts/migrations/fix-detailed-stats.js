const { initDatabase } = require('../../database/database.js');

async function fixDetailedStats() {
  try {
    console.log('🔄 Fixing detailed stats query...');

    const db = initDatabase();

    // Check if email_queue has template_id column
    const checkResult = await db.get(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'email_queue'
      AND column_name = 'template_id'
    `);

    if (!checkResult) {
      console.log('✅ Adding template_id column to email_queue table...');
      await db.run(`ALTER TABLE email_queue ADD COLUMN template_id INTEGER`);
      console.log('✅ Successfully added template_id column to email_queue');
    } else {
      console.log('✅ template_id column already exists in email_queue');
    }

  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    throw error;
  }
}

fixDetailedStats()
  .then(() => {
    console.log('✅ Fix completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fix failed:', error);
    process.exit(1);
  });
