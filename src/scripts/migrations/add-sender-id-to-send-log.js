/**
 * Migration: Add sender_id column to email_send_log table
 * This fixes the error: "column esl.sender_id does not exist"
 */

const path = require('path');

async function runMigration() {
  const { initDatabase } = require('../database/database.js');
  const db = initDatabase();

  try {
    console.log('Checking email_send_log table structure...');

    // Check if sender_id column exists
    const tableInfo = await db.get(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'email_send_log'
      AND column_name = 'sender_id'
    `);

    if (!tableInfo) {
      console.log('⚠️  sender_id column missing. Adding it now...');

      await db.run(`
        ALTER TABLE email_send_log
        ADD COLUMN sender_id INTEGER
      `);

      console.log('✅ sender_id column added to email_send_log table');
    } else {
      console.log('✅ sender_id column already exists in email_send_log table');
    }

    // Verify the column was added
    const columns = await db.all(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'email_send_log'
    `);

    console.log('Current email_send_log columns:', columns.map(c => c.column_name));

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

// Run migration
runMigration()
  .then(() => {
    console.log('✅ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });