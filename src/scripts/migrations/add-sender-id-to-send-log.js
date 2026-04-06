const { initDatabase } = require('../../database/database.js');

async function migrate() {
  try {
    console.log('🔄 Starting migration: Add sender_id to email_send_log...');
    
    const db = initDatabase();
    
    // Check if column already exists
    const checkResult = await db.get(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'email_send_log' 
      AND column_name = 'sender_id'
    `);
    
    if (checkResult) {
      console.log('✅ Column sender_id already exists in email_send_log');
      return;
    }
    
    // Add the missing column
    await db.run(`
      ALTER TABLE email_send_log 
      ADD COLUMN sender_id INTEGER
    `);
    
    console.log('✅ Successfully added sender_id column to email_send_log');
    
    // Verify the column was added
    const verifyResult = await db.get(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'email_send_log' 
      AND column_name = 'sender_id'
    `);
    
    if (verifyResult) {
      console.log('✅ Verification successful: sender_id column exists');
    } else {
      console.log('❌ Verification failed: sender_id column not found');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

migrate()
  .then(() => {
    console.log('✅ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
