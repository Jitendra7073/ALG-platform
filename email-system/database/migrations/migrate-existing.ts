#!/usr/bin/env tsx
/**
 * Migration script for existing database
 * Handles the transition from old schema to new schema
 */

import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres.cevjrqwuhaefimvthheq:Enacton.wellcome@123@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres';

const pool = new Pool({ connectionString: DATABASE_URL });

// Tables to backup and recreate (email system tables only)
const EMAIL_TABLES = [
  'email_senders',
  'email_templates',
  'email_campaigns',
  'email_queue',
  'email_send_log',
  'email_settings',
  'email_sequence_state'
];

async function backupTable(tableName: string): Promise<any[]> {
  try {
    const result = await pool.query(`SELECT * FROM ${tableName}`);
    console.log(`  Backed up ${result.rows.length} rows from ${tableName}`);
    return result.rows;
  } catch (error) {
    console.log(`  No data to backup from ${tableName} (table might not exist)`);
    return [];
  }
}

async function dropTable(tableName: string): Promise<void> {
  try {
    await pool.query(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
    console.log(`  Dropped table: ${tableName}`);
  } catch (error: any) {
    console.error(`  Error dropping ${tableName}:`, error.message);
  }
}

async function restoreSenders(data: any[]): Promise<void> {
  if (data.length === 0) return;

  for (const row of data) {
    try {
      await pool.query(`
        INSERT INTO email_senders (id, name, email, password_encrypted, service, daily_limit, hourly_limit, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (email) DO NOTHING
      `, [
        row.id,
        row.name,
        row.email,
        row.password_encrypted || null,
        row.service || 'gmail',
        row.daily_limit || 100,
        row.hourly_limit || 20,
        row.is_active || 1,
        row.created_at || new Date(),
        row.updated_at || new Date()
      ]);
    } catch (error: any) {
      console.error(`    Error restoring sender ${row.id}:`, error.message);
    }
  }
  console.log(`  Restored ${data.length} senders`);
}

async function restoreTemplates(data: any[]): Promise<void> {
  if (data.length === 0) return;

  for (const row of data) {
    try {
      // Handle tags - convert from text to text array if needed
      let tags: string[] = [];
      if (typeof row.tags === 'string' && row.tags) {
        tags = row.tags.split(',').map(t => t.trim()).filter(t => t);
      } else if (Array.isArray(row.tags)) {
        tags = row.tags;
      }

      await pool.query(`
        INSERT INTO email_templates (id, name, subject, html_content, text_content, category, tags, sequence_number, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT DO NOTHING
      `, [
        row.id,
        row.name,
        row.subject || '',
        row.html_content || '',
        row.text_content || null,
        row.category || 'general',
        tags,
        row.sequence_number || 0,
        row.is_active ?? 1,
        row.created_at || new Date(),
        row.updated_at || new Date()
      ]);
    } catch (error: any) {
      console.error(`    Error restoring template ${row.id}:`, error.message);
    }
  }
  console.log(`  Restored ${data.length} templates`);
}

async function main() {
  console.log('\n🔄 Starting migration of existing database...\n');

  try {
    // Step 1: Backup existing data
    console.log('📦 Step 1: Backing up existing data...');
    const backups: Record<string, any[]> = {};

    for (const table of EMAIL_TABLES) {
      backups[table] = await backupTable(table);
    }

    // Step 2: Drop old tables
    console.log('\n🗑️  Step 2: Dropping old tables...');
    for (const table of EMAIL_TABLES.reverse()) { // Reverse to handle foreign keys
      await dropTable(table);
    }

    // Step 3: Run the main migration
    console.log('\n✅ Step 3: Running main migration...');
    console.log('Please run: npx tsx database/migrations/migrate.ts');
    console.log('Then run this script again with --restore flag');

    // Save backups to a file for restoration
    const fs = await import('fs');
    fs.writeFileSync(
      'D:/wordpress site lead generator/old version/email-system/database/migrations/backup.json',
      JSON.stringify(backups, null, 2)
    );
    console.log('\n💾 Backups saved to backup.json');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();
