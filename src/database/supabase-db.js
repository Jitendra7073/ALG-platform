const { Pool } = require('pg');
require('dotenv').config();

// ============ SUPABASE POSTGRESQL CONNECTION ============
// Connection pool for Supabase PostgreSQL
let _pool = null;
let _sharedClient = null;

/**
 * Get or create the Supabase connection pool
 */
function getPool() {
  if (!_pool) {
    _pool = new Pool({
      host: process.env.SUPABASE_DB_HOST,
      port: process.env.SUPABASE_DB_PORT || 5432,
      database: process.env.SUPABASE_DB_NAME,
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      max: process.env.SUPABASE_POOL_SIZE || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: process.env.SUPABASE_CONNECTION_TIMEOUT || 30000,
    });

    _pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
      process.exit(-1);
    });

    console.log('✅ Supabase connection pool created');
  }
  return _pool;
}

/**
 * Get shared client for singleton pattern (used by email modules)
 */
async function getSharedClient() {
  if (!_sharedClient || !_sharedClient._connected) {
    const pool = getPool();
    _sharedClient = await pool.connect();
    _sharedClient._connected = true;
    console.log('✅ Supabase shared client connected');
  }
  return _sharedClient;
}

/**
 * Initialize database connection and create tables
 */
async function initDatabase() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    console.log('🔌 Connecting to Supabase PostgreSQL...');

    // Create searches table
    await client.query(`
      CREATE TABLE IF NOT EXISTS searches (
        id SERIAL PRIMARY KEY,
        query TEXT NOT NULL,
        country TEXT DEFAULT 'in',
        total_sites INTEGER NOT NULL,
        wordpress_count INTEGER NOT NULL,
        non_wordpress_count INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create sites table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id SERIAL PRIMARY KEY,
        search_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        country TEXT DEFAULT 'in',
        is_wordpress INTEGER NOT NULL,
        confidence_score INTEGER DEFAULT 0,
        indicators TEXT,
        error TEXT,
        search_query TEXT,
        emails TEXT,
        phones TEXT,
        linkedin_profiles TEXT,
        text_content TEXT,
        ai_processed INTEGER DEFAULT 0,
        ai_status TEXT DEFAULT 'pending',
        ai_verified_wp INTEGER DEFAULT NULL,
        ai_wp_confidence TEXT,
        ai_wp_indicators TEXT,
        ai_content_relevant INTEGER DEFAULT NULL,
        ai_actual_category TEXT,
        ai_content_summary TEXT,
        ai_mismatch_reason TEXT,
        ai_error TEXT,
        ai_processed_at TIMESTAMP,
        classification TEXT,
        relevance_score INTEGER,
        tags TEXT,
        primary_language TEXT,
        value_proposition TEXT,
        ai_reasoning TEXT,
        ai_is_wordpress INTEGER DEFAULT NULL,
        ai_is_genuine_match INTEGER DEFAULT NULL,
        page_title TEXT,
        meta_description TEXT,
        retry_count INTEGER DEFAULT 0,
        last_retried_at TIMESTAMP,
        checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (search_id) REFERENCES searches(id)
      )
    `);

    // Create indexes for sites
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sites_search_id ON sites(search_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sites_url ON sites(url)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sites_is_wordpress ON sites(is_wordpress)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sites_ai_status ON sites(ai_status)`);

    // Create keywords table
    await client.query(`
      CREATE TABLE IF NOT EXISTS keywords (
        id SERIAL PRIMARY KEY,
        keyword TEXT NOT NULL UNIQUE,
        status TEXT DEFAULT 'pending',
        max_sites INTEGER DEFAULT 20,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_keywords_status ON keywords(status)`);

    // Create excluded_domains table
    await client.query(`
      CREATE TABLE IF NOT EXISTS excluded_domains (
        id SERIAL PRIMARY KEY,
        domain TEXT NOT NULL UNIQUE,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_excluded_domains_domain ON excluded_domains(domain)`);

    // Create ignored_tags table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ignored_tags (
        id SERIAL PRIMARY KEY,
        tag TEXT NOT NULL UNIQUE,
        match_type TEXT DEFAULT 'contains',
        scope TEXT DEFAULT 'url',
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_ignored_tags_tag ON ignored_tags(tag)`);

    // Create contacts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        site_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        source_page TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_contacts_site_id ON contacts(site_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contacts_value ON contacts(value)`);

    // Create company_executives table
    await client.query(`
      CREATE TABLE IF NOT EXISTS company_executives (
        id SERIAL PRIMARY KEY,
        site_id INTEGER NOT NULL,
        company_url TEXT NOT NULL,
        company_name TEXT,
        profile_url TEXT NOT NULL UNIQUE,
        name TEXT,
        headline TEXT,
        role_category TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_company_executives_site_id ON company_executives(site_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_company_executives_company_url ON company_executives(company_url)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_company_executives_role_category ON company_executives(role_category)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_company_executives_profile_url ON company_executives(profile_url)`);

    // Create linkedin_credentials table
    await client.query(`
      CREATE TABLE IF NOT EXISTS linkedin_credentials (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        is_active INTEGER DEFAULT 0,
        last_used TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create email_senders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_senders (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        smtp_host TEXT,
        smtp_port INTEGER,
        smtp_secure INTEGER DEFAULT 1,
        smtp_user TEXT,
        smtp_password TEXT,
        daily_limit INTEGER DEFAULT 50,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create email_templates table
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        variables TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create email_campaigns table
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_campaigns (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        template_id INTEGER,
        status TEXT DEFAULT 'draft',
        total_recipients INTEGER DEFAULT 0,
        sent_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES email_templates(id)
      )
    `);

    // Create email_queue table
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_queue (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER,
        site_id INTEGER,
        sender_id INTEGER,
        recipient_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        attempt_count INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        error_message TEXT,
        scheduled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id),
        FOREIGN KEY (site_id) REFERENCES sites(id),
        FOREIGN KEY (sender_id) REFERENCES email_senders(id)
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_email_queue_campaign_id ON email_queue(campaign_id)`);

    // Create email_send_log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_send_log (
        id SERIAL PRIMARY KEY,
        queue_id INTEGER,
        sender_id INTEGER,
        recipient_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        status TEXT,
        error_message TEXT,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (queue_id) REFERENCES email_queue(id),
        FOREIGN KEY (sender_id) REFERENCES email_senders(id)
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_email_send_log_queue_id ON email_send_log(queue_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_email_send_log_sender_id ON email_send_log(sender_id)`);

    console.log('✅ All tables created/verified successfully');

    return {
      query: (text, params) => client.query(text, params),
      release: () => client.release(),
    };
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
}

/**
 * Low-level wrappers (sqlite3-style API for compatibility)
 */
async function run(sql, params = []) {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return {
    lastInsertRowid: result.rows[0]?.id,
    changes: result.rowCount || 0,
  };
}

async function all(sql, params = []) {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return result.rows;
}

async function get(sql, params = []) {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

async function prepare(sql) {
  const pool = getPool();
  return {
    all: (params) => pool.query(sql, params).then(r => r.rows),
    get: (params) => pool.query(sql, params).then(r => r.rows[0] || null),
    run: (params) => pool.query(sql, params).then(r => ({
      lastInsertRowid: r.rows[0]?.id,
      changes: r.rowCount || 0,
    })),
  };
}

/**
 * Close database connection
 */
async function closeDatabase() {
  if (_sharedClient) {
    _sharedClient.release();
    _sharedClient._connected = false;
    _sharedClient = null;
  }
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
  console.log('✅ Supabase connection closed');
}

/**
 * Test database connection
 */
async function testConnection() {
  try {
    const pool = getPool();
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Supabase connection test successful:', result.rows[0]);
    return true;
  } catch (error) {
    console.error('❌ Supabase connection test failed:', error);
    return false;
  }
}

module.exports = {
  initDatabase,
  getPool,
  getSharedClient,
  run,
  all,
  get,
  prepare,
  closeDatabase,
  testConnection,
};
