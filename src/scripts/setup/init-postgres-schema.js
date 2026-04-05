/**
 * Initialize PostgreSQL Database Schema
 *
 * This script executes the schema-postgres.sql file against your
 * PostgreSQL database (Supabase). Run this once to set up all tables.
 */

const fs = require('fs');
const path = require('path');

// Load environment variables first
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

// Initialize PostgreSQL adapter
const dbAdapter = require('../../database/db-adapter.js');

async function initSchema() {
  console.log('[INIT] PostgreSQL Schema Initialization\n');

  // Read the schema SQL file
  const schemaPath = path.join(__dirname, '../../database/schema-postgres.sql');
  console.log(`[READ] Loading schema from: ${schemaPath}`);

  let schemaSql;
  try {
    schemaSql = fs.readFileSync(schemaPath, 'utf8');
    console.log(`[OK] Schema file loaded (${schemaSql.length} bytes)\n`);
  } catch (err) {
    console.error(`[ERROR] Could not read schema file: ${err.message}`);
    process.exit(1);
  }

  // Initialize database connection
  console.log('[DB] Connecting to PostgreSQL...');
  try {
    dbAdapter.initializePool();
    const health = await dbAdapter.healthCheck();
    if (!health) {
      throw new Error('Database health check failed');
    }
    console.log('[OK] Database connection established\n');
  } catch (err) {
    console.error(`[ERROR] Database connection failed: ${err.message}`);
    console.error('\nCheck your .env file and ensure DATABASE_URL is correct.');
    process.exit(1);
  }

  // Split SQL into individual statements
  // We need to be careful with:
  // - Function definitions (with $$)
  // - Trigger definitions
  // - Multi-line statements
  console.log('[EXEC] Executing schema statements...\n');

  let statements;
  try {
    statements = splitSqlStatements(schemaSql);
  } catch (e) {
    console.error('Error splitting SQL:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
  console.log(`[INFO] Found ${statements.length} SQL statements to execute\n`);

  let successCount = 0;
  let errorCount = 0;
  let skipCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i].trim();
    if (!stmt) continue;

    // Skip comments
    if (stmt.startsWith('--') || stmt.startsWith('/*')) {
      continue;
    }

    const shortStmt = stmt.length > 80 ? stmt.substring(0, 77) + '...' : stmt;
    process.stdout.write(`[${i + 1}/${statements.length}] `);

    try {
      await dbAdapter.query(stmt);
      console.log('OK');
      successCount++;
    } catch (err) {
      // Ignore "already exists" errors
      if (err.code === '42P07' || err.message.includes('already exists')) {
        console.log('SKIP (already exists)');
        skipCount++;
      } else {
        console.log(`ERROR: ${err.message}`);
        if (err.code) {
          console.log(`       Code: ${err.code}`);
        }
        errorCount++;

        // For certain errors, we might want to stop
        if (err.code === '42601' || err.code === '42P01') {
          console.log('\n[FATAL] Critical SQL error - stopping execution');
          console.log('\nStatement that failed:');
          console.log(stmt);
          break;
        }
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total statements: ${statements.length}`);
  console.log(`Success:          ${successCount}`);
  console.log(`Skipped:          ${skipCount}`);
  console.log(`Errors:           ${errorCount}`);
  console.log('='.repeat(50));

  if (errorCount > 0) {
    console.log('\n[WARN] Some statements failed. Please review the errors above.');
  }

  // Verify tables exist
  console.log('\n[VERIFY] Checking if core tables exist...');
  const tables = [
    'searches', 'sites', 'keywords', 'contacts',
    'company_executives', 'linkedin_credentials',
    'email_senders', 'email_templates', 'email_campaigns',
    'email_queue', 'email_send_log', 'email_settings',
    'country_timezones'
  ];

  for (const table of tables) {
    try {
      const result = await dbAdapter.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
        [table]
      );
      const exists = result.rows[0].exists;
      console.log(`  ${exists ? '✓' : '✗'} ${table}`);
    } catch (err) {
      console.log(`  ? ${table} (check failed: ${err.message})`);
    }
  }

  console.log('\n[DONE] Schema initialization complete!\n');

  // Close connection
  await dbAdapter.closePool();
}

/**
 * Split SQL into individual statements
 * Handles:
 * - $$ delimited strings (for functions)
 * - CREATE TABLE with multiple columns
 * - CREATE FUNCTION/TRIGGER with $$
 * - Simple semicolon-separated statements
 * - Properly skips comment blocks
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarString = false;     // Inside $$...$$
  let inCreateTable = false;      // Inside CREATE TABLE ( ... );
  let parenDepth = 0;             // Track parenthesis depth
  let inMultiLineComment = false; // Multi-line C-style comment

  // Process line by line
  const lines = sql.split('\n');

  for (let line of lines) {
    const trimmed = line.trim();

    // Check for multi-line comment start (use string concat to avoid JS comment parsing)
    const mlStart = '/' + '*';
    const mlEnd = '*' + '/';

    if (trimmed.startsWith(mlStart) && !trimmed.includes(mlEnd)) {
      inMultiLineComment = true;
    }

    if (inMultiLineComment) {
      if (trimmed.includes(mlEnd)) {
        inMultiLineComment = false;
      }
      continue; // Skip comment lines entirely
    }

    // Skip single-line comments and empty lines
    if (trimmed.startsWith('--') || trimmed === '') {
      continue;
    }

    // Track CREATE TABLE or CREATE OR REPLACE VIEW
    if (trimmed.toUpperCase().startsWith('CREATE TABLE') ||
        trimmed.toUpperCase().startsWith('CREATE OR REPLACE VIEW')) {
      inCreateTable = true;
      current = line + '\n'; // Start fresh with this line
      continue;
    }

    // Track $$ count on this line
    const dollarMatches = trimmed.match(/\$\$/g);
    const dollarCount = dollarMatches ? dollarMatches.length : 0;

    // Update inDollarString state based on $$ count
    if (dollarCount > 0) {
      // Each $$ toggles the state
      for (let i = 0; i < dollarCount; i++) {
        inDollarString = !inDollarString;
      }
      current += line + '\n';

      // If we're outside dollar string and line ends with semicolon, complete the statement
      if (!inDollarString && trimmed.endsWith(';')) {
        statements.push(current.trim());
        current = '';
      }
      continue;
    }

    // If inside $$ string, just accumulate
    if (inDollarString) {
      current += line + '\n';
      continue;
    }

    // Track parenthesis depth for CREATE TABLE
    if (inCreateTable) {
      for (const char of line) {
        if (char === '(') parenDepth++;
        if (char === ')') parenDepth--;
      }
      current += line + '\n';

      // End of CREATE TABLE when we see ); and parenDepth is back to 0 or negative
      if (trimmed.endsWith(');') && parenDepth <= 0) {
        inCreateTable = false;
        parenDepth = 0;
        statements.push(current.trim());
        current = '';
      }
      continue;
    }

    // Regular statement - check for semicolon at end of line
    current += line + '\n';
    if (trimmed.endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }

  // Add any remaining content
  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

// Run the script
initSchema().catch(err => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});
