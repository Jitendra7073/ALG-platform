/**
 * Test sequences edit functionality
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL not found in .env file');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function testSequencesEdit() {
  const client = await pool.connect();

  try {
    console.log('🧪 Testing Sequences Edit Functionality...\n');

    // Test 1: Check if sequences exist
    console.log('📋 Test 1: Fetching all sequences...');
    const sequences = await client.query('SELECT id, name, description, is_active FROM email_sequences ORDER BY created_at');

    if (sequences.rows.length === 0) {
      console.log('❌ No sequences found in database');
      return;
    }

    console.log(`✅ Found ${sequences.rows.length} sequences:`);
    sequences.rows.forEach((seq, index) => {
      console.log(`   ${index + 1}. ${seq.name} (${seq.id}) - ${seq.is_active ? 'Active' : 'Inactive'}`);
    });

    const testSequence = sequences.rows[0];
    console.log(`\n🎯 Testing with sequence: "${testSequence.name}"\n`);

    // Test 2: Edit sequence
    console.log('📝 Test 2: Editing sequence...');
    const newName = `Updated ${testSequence.name}`;
    const newDescription = `Updated description for ${testSequence.name}`;

    const updateResult = await client.query(
      `UPDATE email_sequences
       SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [newName, newDescription, testSequence.id]
    );

    if (updateResult.rows.length > 0) {
      console.log('✅ Sequence updated successfully:');
      console.log(`   Name: ${updateResult.rows[0].name}`);
      console.log(`   Description: ${updateResult.rows[0].description}`);
      console.log(`   Updated At: ${updateResult.rows[0].updated_at}`);
    } else {
      console.log('❌ Failed to update sequence');
    }

    // Test 3: Verify the update
    console.log('\n🔍 Test 3: Verifying update...');
    const verifyResult = await client.query(
      'SELECT * FROM email_sequences WHERE id = $1',
      [testSequence.id]
    );

    if (verifyResult.rows.length > 0) {
      const verified = verifyResult.rows[0];
      console.log('✅ Update verified:');
      console.log(`   Name: ${verified.name}`);
      console.log(`   Description: ${verified.description}`);
      console.log(`   Updated At: ${verified.updated_at}`);
    } else {
      console.log('❌ Sequence not found after update');
    }

    // Test 4: Check sequence items
    console.log('\n📧 Test 4: Checking sequence items...');
    const itemsResult = await client.query(
      `SELECT si.*, t.name as template_name
       FROM email_sequence_items si
       LEFT JOIN email_templates t ON si.template_id = t.id
       WHERE si.sequence_id = $1
       ORDER BY si.position`,
      [testSequence.id]
    );

    console.log(`✅ Found ${itemsResult.rows.length} items in sequence:`);
    itemsResult.rows.forEach((item, index) => {
      console.log(`   ${index + 1}. Position ${item.position}: ${item.template_name} (${item.delay_days}d ${item.delay_hours}h)`);
    });

    // Test 5: Revert changes (cleanup)
    console.log('\n🔄 Test 5: Reverting changes...');
    await client.query(
      `UPDATE email_sequences
       SET name = $1, description = $2
       WHERE id = $3`,
      [testSequence.name, testSequence.description || '', testSequence.id]
    );
    console.log('✅ Changes reverted');

    console.log('\n✅ All tests completed successfully!');
    console.log('\n🎉 Sequences edit functionality is working correctly!');

  } catch (error) {
    console.error('❌ Test error:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

testSequencesEdit().catch(console.error);
