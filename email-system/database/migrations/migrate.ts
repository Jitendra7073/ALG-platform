#!/usr/bin/env tsx
/**
 * PostgreSQL Migration Runner
 *
 * Runs database migrations in order from the migrations directory.
 * Tracks which migrations have been applied using a migrations table.
 *
 * Usage:
 *   tsx database/migrations/migrate.ts              # Run pending migrations
 *   tsx database/migrations/migrate.ts --status     # Show migration status
 *   tsx database/migrations/migrate.ts --reset      # Reset and re-run all (DEV ONLY!)
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string (required)
 */

import { Pool, PoolClient } from 'pg';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = __dirname;

// Migration record interface
interface MigrationRecord {
  id: number;
  name: string;
  applied_at: Date;
}

// Parse DATABASE_URL
function parseDatabaseUrl(url: string): { host: string; port: number; database: string; user: string; password: string } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || 'localhost',
      port: parsed.port ? parseInt(parsed.port, 10) : 5432,
      database: parsed.pathname.slice(1) || 'postgres',
      user: parsed.username || 'postgres',
      password: parsed.password || '',
    };
  } catch {
    throw new Error('Invalid DATABASE_URL format');
  }
}

// Get migration files sorted by name
function getMigrationFiles(): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && f !== 'migrate.ts')
    .sort();

  return files;
}

// Read migration file content
function readMigrationFile(filename: string): string {
  const filepath = join(MIGRATIONS_DIR, filename);
  return readFileSync(filepath, 'utf-8');
}

// Create migrations tracking table if it doesn't exist
async function createMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// Get applied migrations
async function getAppliedMigrations(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<MigrationRecord>('SELECT name FROM schema_migrations ORDER BY id');
  return new Set(result.rows.map(r => r.name));
}

// Apply a single migration
async function applyMigration(client: PoolClient, filename: string, content: string): Promise<void> {
  console.log(`  Applying migration: ${filename}`);

  try {
    // Start a transaction for the migration
    await client.query('BEGIN');

    // Execute the migration SQL
    await client.query(content);

    // Record the migration
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [filename]);

    // Commit the transaction
    await client.query('COMMIT');

    console.log(`  Successfully applied: ${filename}`);
  } catch (error) {
    // Rollback on error
    await client.query('ROLLBACK');
    throw error;
  }
}

// Run pending migrations
async function runMigrations(pool: Pool, reset: boolean = false): Promise<void> {
  const client = await pool.connect();

  try {
    if (reset) {
      console.log('⚠️  WARNING: Resetting all migrations...');
      await client.query('DROP TABLE IF EXISTS schema_migrations CASCADE');
      console.log('  Dropped schema_migrations table');
    }

    // Ensure migrations table exists
    await createMigrationsTable(client);

    // Get migration files and applied migrations
    const migrationFiles = getMigrationFiles();
    const appliedMigrations = await getAppliedMigrations(client);

    // Filter out already applied migrations
    const pendingMigrations = migrationFiles.filter(f => !appliedMigrations.has(f));

    if (pendingMigrations.length === 0) {
      console.log('✅ No pending migrations to apply.');
      return;
    }

    console.log(`\n📋 Found ${pendingMigrations.length} pending migration(s):\n`);

    // Apply each pending migration
    for (const filename of pendingMigrations) {
      const content = readMigrationFile(filename);
      await applyMigration(client, filename, content);
    }

    console.log('\n✅ All migrations applied successfully!');
  } finally {
    client.release();
  }
}

// Show migration status
async function showStatus(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await createMigrationsTable(client);

    const migrationFiles = getMigrationFiles();
    const appliedMigrations = await getAppliedMigrations(client);

    console.log('\n📊 Migration Status:\n');

    for (const filename of migrationFiles) {
      const status = appliedMigrations.has(filename) ? '✅ Applied' : '⏳ Pending';
      console.log(`  ${status}: ${filename}`);
    }

    console.log(`\nTotal: ${appliedMigrations.size}/${migrationFiles.length} applied\n`);
  } finally {
    client.release();
  }
}

// Main function
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const showStatusOnly = args.includes('--status');
  const reset = args.includes('--reset');

  // Get DATABASE_URL from environment
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;

  if (!databaseUrl) {
    console.error('❌ Error: DATABASE_URL environment variable is not set.');
    console.error('   Please set DATABASE_URL to your PostgreSQL connection string.');
    console.error('   Example: postgresql://user:password@localhost:5432/database');
    process.exit(1);
  }

  // Parse connection info for logging
  const dbConfig = parseDatabaseUrl(databaseUrl);
  console.log(`\n🔌 Connecting to PostgreSQL:`);
  console.log(`   Host: ${dbConfig.host}:${dbConfig.port}`);
  console.log(`   Database: ${dbConfig.database}\n`);

  // Create connection pool
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1, // Single connection for migrations
  });

  try {
    // Test connection
    await pool.query('SELECT 1');
    console.log('✅ Connected to database successfully!\n');

    if (showStatusOnly) {
      await showStatus(pool);
    } else {
      await runMigrations(pool, reset);
    }
  } catch (error) {
    console.error('\n❌ Migration failed!');
    if (error instanceof Error) {
      console.error(`   Error: ${error.message}`);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script
main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
