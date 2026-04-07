/**
 * Seed example email sequences
 * Run this with: node seed-sequences.js
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

const sequences = [
  {
    name: 'Welcome Series',
    description: 'Onboarding sequence for new subscribers',
    is_active: true,
    items: [
      { template_name: 'Welcome Email', delay_days: 0, delay_hours: 0, position: 1 },
      { template_name: 'Follow Up 1', delay_days: 2, delay_hours: 0, position: 2 },
      { template_name: 'Follow Up 2', delay_days: 5, delay_hours: 0, position: 3 }
    ]
  },
  {
    name: 'Promotional Campaign',
    description: 'Special offers and promotional emails',
    is_active: true,
    items: [
      { template_name: 'Promotional Offer', delay_days: 0, delay_hours: 0, position: 1 },
      { template_name: 'Follow Up 1', delay_days: 3, delay_hours: 0, position: 2 }
    ]
  },
  {
    name: 'Lead Nurturing',
    description: 'Long-term engagement sequence',
    is_active: false,
    items: [
      { template_name: 'Welcome Email', delay_days: 0, delay_hours: 0, position: 1 },
      { template_name: 'Follow Up 1', delay_days: 7, delay_hours: 0, position: 2 },
      { template_name: 'Follow Up 2', delay_days: 14, delay_hours: 0, position: 3 },
      { template_name: 'Promotional Offer', delay_days: 21, delay_hours: 0, position: 4 }
    ]
  }
];

async function seedSequences() {
  const client = await pool.connect();

  try {
    console.log('🌱 Starting email sequences seeding...\n');

    // Get all templates
    const templatesResult = await client.query('SELECT id, name FROM email_templates WHERE is_active = true');
    const templates = templatesResult.rows;
    const templateMap = {};

    templates.forEach(t => {
      templateMap[t.name] = t.id;
    });

    console.log(`📋 Found ${templates.length} templates in database\n`);

    // Clear existing sequences
    console.log('🗑️  Clearing existing sequences...');
    await client.query('DELETE FROM email_sequence_items');
    await client.query('DELETE FROM email_sequences');
    console.log('✅ Cleared existing sequences\n');

    // Insert sequences
    console.log('📝 Inserting sequences...\n');

    for (const sequence of sequences) {
      // Insert sequence
      const sequenceResult = await client.query(
        `INSERT INTO email_sequences (name, description, is_active)
         VALUES ($1, $2, $3)
         RETURNING id, name`,
        [sequence.name, sequence.description, sequence.is_active]
      );

      const sequenceId = sequenceResult.rows[0].id;
      console.log(`✅ Created sequence: ${sequenceResult.rows[0].name} (ID: ${sequenceId})`);

      // Insert sequence items
      for (const item of sequence.items) {
        const templateId = templateMap[item.template_name];

        if (!templateId) {
          console.log(`   ⚠️  Template not found: ${item.template_name} - skipping`);
          continue;
        }

        await client.query(
          `INSERT INTO email_sequence_items (sequence_id, template_id, position, delay_days, delay_hours)
           VALUES ($1, $2, $3, $4, $5)`,
          [sequenceId, templateId, item.position, item.delay_days, item.delay_hours]
        );

        const delay = item.delay_days > 0 ? `+${item.delay_days}d` : 'Immediate';
        console.log(`   ├─ Position ${item.position}: ${item.template_name} (${delay})`);
      }

      console.log('');
    }

    // Display summary
    console.log('📊 Seeding Summary:');
    console.log(`   Total sequences created: ${sequences.length}`);

    const allSequences = await client.query(`
      SELECT s.id, s.name, s.is_active, COUNT(si.id) as template_count
      FROM email_sequences s
      LEFT JOIN email_sequence_items si ON s.id = si.sequence_id
      GROUP BY s.id, s.name, s.is_active
      ORDER BY s.id
    `);

    console.log('\n📋 All Sequences in Database:');
    allSequences.rows.forEach((seq, index) => {
      const status = seq.is_active ? '✅ Active' : '⏸️  Inactive';
      console.log(`   ${index + 1}. ${seq.name} (${seq.template_count} templates) - ${status}`);
    });

    console.log('\n✅ Email sequences seeding completed successfully!');
    console.log('\n🎉 You can now manage sequences at: http://localhost:3001/sequences');

  } catch (error) {
    console.error('❌ Seeding error:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedSequences().catch(console.error);
