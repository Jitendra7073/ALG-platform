/**
 * Supabase Connection Test Script
 *
 * Tests connection to Supabase using DATABASE_URL from environment
 * Creates a simple test table and runs basic queries
 *
 * Usage:
 *   tsx scripts/test-supabase.ts
 */

import { Pool } from 'pg';
import { config } from 'dotenv';

// Load environment variables from .env.local
config({ path: '.env.local' });

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title: string): void {
  console.log('');
  log(`\n${'='.repeat(60)}`, 'cyan');
  log(`  ${title}`, 'cyan');
  log(`${'='.repeat(60)}`, 'cyan');
}

function logSuccess(message: string): void {
  log(`  ✓ ${message}`, 'green');
}

function logError(message: string): void {
  log(`  ✗ ${message}`, 'red');
}

function logInfo(message: string): void {
  log(`  ℹ ${message}`, 'blue');
}

function logWarning(message: string): void {
  log(`  ⚠ ${message}`, 'yellow');
}

// ============================================================================
// Parse DATABASE_URL
// ============================================================================

function parseDatabaseUrl(url: string): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
} | null {
  try {
    const parsed = new URL(url);

    // Supabase uses postgresql:// scheme
    if (parsed.protocol !== 'postgresql:') {
      logWarning(`Unexpected protocol: ${parsed.protocol}`);
    }

    const host = parsed.hostname;
    const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
    const database = parsed.pathname.slice(1) || 'postgres';
    const user = parsed.username;
    const password = decodeURIComponent(parsed.password);
    const ssl = parsed.searchParams.has('sslmode');

    return { host, port, database, user, password, ssl };
  } catch (error) {
    logError(`Failed to parse DATABASE_URL: ${error}`);
    return null;
  }
}

// ============================================================================
// Test Connection
// ============================================================================

async function testConnection(config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}): Promise<boolean> {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  try {
    logInfo('Attempting to connect...');
    const client = await pool.connect();
    logSuccess('Connected to Supabase!');

    // Get PostgreSQL version
    const versionResult = await client.query('SELECT version()');
    const version = versionResult.rows[0].version;
    logInfo(`PostgreSQL version: ${version.split(',')[0]}`);

    client.release();
    return true;
  } catch (error) {
    logError(`Connection failed: ${error}`);
    return false;
  } finally {
    await pool.end();
  }
}

// ============================================================================
// Test Table Creation and Queries
// ============================================================================

async function testTableOperations(config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}): Promise<boolean> {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  const testTableName = '_connection_test_table';

  try {
    const client = await pool.connect();

    // Drop test table if exists
    logInfo('Cleaning up any existing test table...');
    await client.query(`DROP TABLE IF EXISTS ${testTableName}`);

    // Create test table
    logInfo('Creating test table...');
    await client.query(`
      CREATE TABLE ${testTableName} (
        id SERIAL PRIMARY KEY,
        test_field VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    logSuccess('Test table created');

    // Insert test data
    logInfo('Inserting test data...');
    const insertResult = await client.query(
      `INSERT INTO ${testTableName} (test_field) VALUES ($1), ($2), ($3) RETURNING *`,
      ['test_value_1', 'test_value_2', 'test_value_3']
    );
    logSuccess(`Inserted ${insertResult.rowCount} rows`);

    // Select test data
    logInfo('Querying test data...');
    const selectResult = await client.query(
      `SELECT * FROM ${testTableName} ORDER BY id`
    );
    logSuccess(`Retrieved ${selectResult.rowCount} rows`);
    for (const row of selectResult.rows) {
      logInfo(`  Row ${row.id}: ${row.test_field}`);
    }

    // Update test data
    logInfo('Updating test data...');
    const updateResult = await client.query(
      `UPDATE ${testTableName} SET test_field = $1 WHERE id = $2`,
      ['updated_value', 1]
    );
    logSuccess(`Updated ${updateResult.rowCount} row(s)`);

    // Delete test data
    logInfo('Deleting test data...');
    const deleteResult = await client.query(
      `DELETE FROM ${testTableName} WHERE id = $1`,
      [2]
    );
    logSuccess(`Deleted ${deleteResult.rowCount} row(s)`);

    // Clean up test table
    logInfo('Cleaning up test table...');
    await client.query(`DROP TABLE ${testTableName}`);
    logSuccess('Test table dropped');

    client.release();
    return true;
  } catch (error) {
    logError(`Table operations failed: ${error}`);
    return false;
  } finally {
    await pool.end();
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function main(): Promise<void> {
  log('\n  ╔═══════════════════════════════════════════════════════════╗', 'cyan');
  log('  ║     Supabase Connection Test Script                      ║', 'cyan');
  log('  ╚═══════════════════════════════════════════════════════════╝', 'cyan');

  // Check environment
  logSection('Environment Check');

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    logError('DATABASE_URL environment variable is not set!');
    logInfo('Please set DATABASE_URL in your .env file or environment');
    process.exit(1);
  }

  logSuccess('DATABASE_URL is set');

  // Parse connection info
  logSection('Connection Info');

  const config = parseDatabaseUrl(databaseUrl);

  if (!config) {
    logError('Failed to parse DATABASE_URL');
    process.exit(1);
  }

  logInfo(`Host:     ${config.host}`);
  logInfo(`Port:     ${config.port}`);
  logInfo(`Database: ${config.database}`);
  logInfo(`User:     ${config.user}`);
  logInfo(`Password: ${'*'.repeat(Math.min(config.password.length, 20))}`);
  logInfo(`SSL:      ${config.ssl ? 'enabled' : 'disabled'}`);

  // Test connection
  logSection('Connection Test');

  const connectionSuccess = await testConnection(config);

  if (!connectionSuccess) {
    logSection('Result');
    logError('FAILED: Could not connect to Supabase');
    logInfo('Please check your DATABASE_URL and network connection');
    process.exit(1);
  }

  // Test table operations
  logSection('Table Operations Test');

  const operationsSuccess = await testTableOperations(config);

  // Final result
  logSection('Result');

  if (operationsSuccess) {
    logSuccess('SUCCESS: All tests passed!');
    logInfo('Your Supabase connection is working correctly');
    process.exit(0);
  } else {
    logError('FAILED: Some tests failed');
    logInfo('Please check the errors above for details');
    process.exit(1);
  }
}

// Run the tests
main().catch((error) => {
  logError(`Unexpected error: ${error}`);
  process.exit(1);
});
