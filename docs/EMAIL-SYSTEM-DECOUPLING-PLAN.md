# Email System Decoupling & Migration Plan

## Document Overview

**Purpose:** Decouple the email functionality from the local lead generation system and deploy it as a separate, production-ready application on Vercel.

**Date:** 2026-04-07

**Status:** Planning Phase

---

## Table of Contents

1. [Current System Analysis](#1-current-system-analysis)
2. [Proposed Architecture](#2-proposed-architecture)
3. [Implementation Plan](#3-implementation-plan)
4. [Database Schema](#4-database-schema)
5. [API Contract](#5-api-contract)
6. [Deployment Guide](#6-deployment-guide)
7. [Rollback Plan](#7-rollback-plan)
8. [Risks & Mitigations](#8-risks--mitigations)

---

## 1. Current System Analysis

### 1.1 Email-Related Components

#### Files in Local System

| File Path | Purpose | Lines of Code |
|-----------|---------|----------------|
| `src/services/email/email-queue-worker.js` | Background email processor | ~1050 |
| `src/services/email/email-senders-templates-api.js` | Email CRUD APIs | ~2900 |
| `src/services/email/timezone-scheduler.js` | Business hours calculations | ~540 |
| `src/services/email/timezone-aware-api.js` | Timezone-aware endpoints | ~400 |
| `src/scripts/setup/setup-email-system.js` | Email DB initialization | ~200 |

#### Database Tables (Email-Related)

| Table | Purpose | Key Columns |
|-------|---------|--------------|
| `email_senders` | SMTP accounts | id, email, password, daily_limit, sent_today |
| `email_templates` | Email templates | id, name, subject, html_content, tags, sequence_number |
| `email_campaigns` | Campaign management | id, name, template_id, status, sent_count |
| `email_queue` | Queued emails | id, recipient_email, status, scheduled_at, country_code |
| `email_send_log` | Send history | id, contact_id, campaign_id, send_type, status |
| `email_settings` | Configuration | key, value, label, description |
| `contacts` | Contact data (shared) | id, site_id, type, value |
| `sites` | Scraped websites (shared) | id, url, country, is_wordpress, tags |

#### Current Email Flow

```
1. User selects contacts by tag (e.g., "coupon", "marketing")
   ↓
2. POST /api/email/queue/add-by-tag
   ↓
3. System fetches templates matching the tag
   ↓
4. Creates campaign record
   ↓
5. For each contact:
   - Gets site data for template variables
   - Replaces {{name}}, {{company}}, etc.
   - Inserts into email_queue (all sequence steps)
   - Inserts into email_send_log
   ↓
6. Email Queue Worker (30s polling):
   - Fetches queued emails
   - Validates timezone/business hours
   - Selects sender (round-robin)
   - Sends via Nodemailer
   - Updates status to 'sent' or 'failed'
```

### 1.2 Problems with Current Approach

| Problem | Impact | Severity |
|---------|--------|----------|
| Playwright dependency | Cannot deploy to Vercel/serverless | High |
| Tight coupling | Email system tied to scraper | High |
| Polling-based worker | 30s delays, inefficient | Medium |
| No job queue | In-memory state, lost on restart | Medium |
| No dead-letter queue | Failed emails abandoned | Low |
| No idempotency | Duplicate sends possible | Medium |

---

## 2. Proposed Architecture

### 2.1 High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LOCAL SYSTEM (Stays Local)                          │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────────┐  │
│  │ Playwright   │  │    SQLite    │  │   SYNC ENDPOINT (NEW)            │  │
│  │  Scraper     │  │   Database   │  │   POST /api/sync/push-to-cloud   │  │
│  │              │  │              │  │   - Pushes scraped data          │  │
│  │              │  │              │  │   - Incremental sync            │  │
│  └──────────────┘  └──────┬───────┘  └──────────────────────────────────┘  │
└─────────────────────────────────┼─────────────────────────────────────────────┘
                                  │
                                  │ HTTPS (Supabase REST API)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CLOUD DATABASE (Supabase)                           │
│                                                                              │
│  SCRAPED DATA (synced from local)                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │   sites      │  │  contacts   │  │   searches  │  │  executives │      │
│  │   (scraped)  │  │  (extracted)│  │  (history)  │  │  (LinkedIn) │      │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘      │
│                                                                              │
│  EMAIL DATA (managed by cloud system)                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │email_senders│  │email_templates│ │email_campaigns│ │email_queue │      │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘      │
│  ┌─────────────┐  ┌─────────────┐                                         │
│  │email_send_log│  │email_settings │                                         │
│  └─────────────┘  └─────────────┘                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ Supabase SDK (Read/Write)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    NEXT.JS EMAIL SYSTEM (Vercel)                             │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Frontend (ShadCN)                              │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │  │
│  │  │Dashboard │  │Campaigns │  │Templates │  │   Queue  │          │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                       │  │
│  │  │ Senders  │  │Contacts  │  │Analytics │                       │  │
│  │  └──────────┘  └──────────┘  └──────────┘                       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                   │                                        │
│  ┌─────────────────────────────────┼────────────────────────────────────┐  │
│  │                                 ▼                                │  │
│  │  ┌─────────────────────────────────────────────────────────────┐    │  │
│  │  │                         API Routes                           │    │  │
│  │  │  /api/campaigns, /api/templates, /api/queue, /api/senders  │    │  │
│  │  └─────────────────────────────────────────────────────────────┘    │  │
│  │                                 │                                │  │
│  │  ┌─────────────────────────────────┼────────────────────────────────┐  │
│  │  │                                 ▼                                │  │
│  │  │  ┌──────────────────────────────────────────────────────────┐   │  │
│  │  │  │                    Vercel Cron Jobs                       │   │  │
│  │  │  │  ┌────────────────────────────────────────────────────┐  │   │  │
│  │  │  │  │  │              Email Queue Worker (runs every 1 min)│  │   │  │
│  │  │  │  │  │  - Processes queued emails                        │  │   │  │
│  │  │  │  │  │  - Timezone-aware scheduling                      │  │   │  │
│  │  │  │  │  │  - Sends via Nodemailer (SMTP)                    │  │   │  │
│  │  │  │  └────────────────────────────────────────────────────┘  │   │  │
│  │  │  └──────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Component | Technology | Reason |
|-----------|------------|--------|
| **Frontend** | Next.js 15 (App Router) | Vercel-native, RSC support |
| **UI Library** | ShadCN + Tailwind CSS | Modern, customizable |
| **Database** | Supabase (PostgreSQL) | Realtime, Auth, Edge Functions |
| **Email** | Nodemailer | Same as local system, proven reliable |
| **Queue** | Supabase + Cron | Simple, no Redis needed |
| **ORM** | Supabase SDK | Type-safe, auto-generated |

### 2.3 Data Sync Coverage

**Tables synced from Local to Cloud:**

| Table | Purpose | Sync Method |
|-------|---------|-------------|
| `sites` | Scraped website data | Incremental (created_at, updated_at) |
| `contacts` | Extracted emails/phones | Incremental (created_at, updated_at) |
| `searches` | Search history | Incremental (created_at) |
| `company_executives` | LinkedIn data | Incremental (created_at, updated_at) |
| `keywords` | Keyword management | Incremental (created_at, updated_at) |
| **`email_senders`** | **SMTP credentials** | **Incremental + Real-time** ⭐ |

**Why email_senders needs to be synced:**
- Email system needs SMTP credentials to send emails
- Credentials stored in local database
- Must be available in cloud for worker to send
- New senders added via local UI → must sync to cloud
- Changes (daily limit reset, active status) must sync immediately

---

## 3. Implementation Plan

### 3.1 Phase 1: Cloud Database Setup (Days 1-2)

#### Tasks:
1. Create Supabase project
2. Execute database schema with idempotency keys (see Section 4)
3. Configure environment variables
4. Test database connection

#### Deliverables:
- Supabase project URL and keys
- Database with all tables created
- Connection verified

### 3.2 Phase 2: Add Smart Sync Endpoint to Local (Days 3-4)

#### Tasks:
1. Create `src/api/sync-controller.js` with idempotent upsert logic
2. Add sync routes to `server.js`
3. Implement change detection using timestamps
4. Add auto-sync trigger after scraping
5. Create sync state tracking table

#### Key Requirements for Sync:

✅ **No Duplicate Data** - Use UPSERT with conflict resolution  
✅ **Change Detection** - Only sync modified records  
✅ **Full Coverage** - Sync ALL tables (sites, contacts, searches, executives, keywords, etc.)  
✅ **Idempotency** - Safe to run multiple times  
✅ **Relationships** - Handle foreign key dependencies  
✅ **Error Recovery** - Continue on individual record failures  
✅ **Progress Tracking** - Know exactly what synced

#### Complete Sync Implementation:

```javascript
// src/api/sync-controller.js
const express = require('express');
const router = express.Router();
const db = require('../database/database.js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Sync state tracking table schema
const SYNC_STATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    last_sync_at TEXT,
    last_synced_count INTEGER,
    last_sync_status TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

/**
 * POST /api/sync/push-to-cloud
 * Pushes local data to Supabase with idempotent upsert
 * Body: {
 *   tables?: ['sites', 'contacts', 'searches', 'executives', 'keywords'],
 *   mode?: 'full' | 'incremental' | 'auto',
 *   since?: string (ISO date), 
 *   batchSize?: 100,
 *   force?: boolean
 * }
 */
router.post('/push-to-cloud', async (req, res) => {
  const { 
    tables = ['sites', 'contacts', 'searches', 'executives', 'keywords', 'email_senders'],
    mode = 'incremental', 
    since = null,
    batchSize = 100,
    force = false 
  } = req.body;
  
  const startTime = Date.now();
  const results = {};
  const errors = [];
  
  // Ensure sync state table exists
  try {
    db.exec(SYNC_STATE_SCHEMA);
  } catch (e) {
    // Table might exist, ignore error
  }
  
  for (const table of tables) {
    try {
      results[table] = await syncTableWithIdempotency(
        table, 
        mode, 
        since, 
        batchSize,
        force
      );
    } catch (error) {
      console.error(`Failed to sync ${table}:`, error);
      errors.push({ table, error: error.message });
      results[table] = { synced: 0, errors: 1, total: 0, error: error.message };
    }
  }
  
  const duration = Date.now() - startTime;
  
  // Update sync state
  const syncStatus = errors.length === 0 ? 'success' : 'partial';
  db.prepare(
    `INSERT OR REPLACE INTO sync_state (key, last_sync_at, last_synced_count, last_sync_status) 
     VALUES (?, ?, ?, ?)`
  ).run('global_sync', new Date().toISOString(), 
    Object.values(results).reduce((sum, r) => sum + (r?.synced || 0), 0),
    syncStatus
  );
  
  res.json({
    success: errors.length === 0,
    message: errors.length === 0 
      ? 'All data synced successfully' 
      : `Sync completed with ${errors.length} errors`,
    results,
    errors,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString()
  });
});

/**
 * Sync a single table with idempotent upsert logic
 */
async function syncTableWithIdempotency(tableName, mode, since, batchSize, force) {
  // Get last sync time for this table
  const syncState = db.prepare(`SELECT last_sync_at FROM sync_state WHERE key = ?`).get(`sync_${tableName}`);
  const lastSyncAt = syncState?.last_sync_at || since;
  
  // Build query based on mode
  let query = `SELECT * FROM ${tableName}`;
  let params = [];
  
  if (mode === 'incremental' && lastSyncAt && !force) {
    // Sync records modified since last sync OR records created/updated since
    query += ` WHERE created_at > ? OR updated_at > ?`;
    params = [lastSyncAt, lastSyncAt];
  } else if (since && !force) {
    query += ` WHERE created_at > ? OR updated_at > ?`;
    params = [since, since];
  }
  
  const records = db.prepare(query).all(...params);
  const total = records.length;
  
  // Get table schema for column mapping
  const columns = db.pragma(`table_info(${tableName})`).all();
  const columnNames = columns.map(c => c.name);
  
  let synced = 0;
  let errors = 0;
  const batchResults = [];
  
  // Process in batches
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    
    try {
      const batchResult = await upsertBatchToSupabase(tableName, batch, columnNames);
      synced += batchResult.synced;
      errors += batchResult.errors;
      batchResults.push({
        batch: Math.floor(i / batchSize) + 1,
        ...batchResult
      });
    } catch (error) {
      console.error(`Batch ${Math.floor(i / batchSize) + 1} failed:`, error);
      errors += batch.length;
      batchResults.push({
        batch: Math.floor(i / batchSize) + 1,
        synced: 0,
        errors: batch.length,
        error: error.message
      });
    }
  }
  
  // Update sync state for this table
  if (synced > 0) {
    db.prepare(
      `INSERT OR REPLACE INTO sync_state (key, last_sync_at, last_synced_count, last_sync_status) 
       VALUES (?, ?, ?, ?)`
    ).run(`sync_${tableName}`, new Date().toISOString(), synced, 'success');
  }
  
  return { synced, errors, total, batches: batchResults };
}

/**
 * Upsert batch to Supabase with idempotency handling
 * Uses ON CONFLICT for PostgreSQL upsert
 */
async function upsertBatchToSupabase(tableName, records, columnNames) {
  const endpoint = `${SUPABASE_URL}/rest/v1/${tableName}`;
  
  // Map local column names to Supabase format
  const transformedRecords = records.map(record => {
    const transformed = {};
    for (const col of columnNames) {
      // Handle any data type conversions if needed
      let value = record[col];
      
      // Convert SQLite integers (0/1) to PostgreSQL boolean where appropriate
      if (col === 'is_wordpress' || col.startsWith('is_')) {
        value = value === 1 || value === '1' ? true : false;
      }
      
      // Convert JSON strings to JSON objects
      if (col === 'indicators' || col === 'tags' || col === 'emails' || col === 'phones') {
        try {
          const parsed = JSON.parse(value);
          value = parsed;
        } catch (e) {
          value = value; // Keep as string if not valid JSON
        }
      }
      
      transformed[col] = value;
    }
    
    // Add sync timestamp
    transformed.synced_at = new Date().toISOString();
    
    return transformed;
  });
  
  // Use Supabase upsert with on conflict
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'resolution=ignore-duplicates' // Handle duplicates gracefully
    },
    body: JSON.stringify(transformedRecords)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase error: ${response.status} - ${errorText}`);
  }
  
  // Check for errors in response
  const data = await response.json();
  
  // Supabase returns details about upserted rows
  const synced = Array.isArray(data) ? data.length : (data.error ? 0 : transformedRecords.length);
  const hasErrors = data.error !== undefined;
  
  return {
    synced: hasErrors ? 0 : synced,
    errors: hasErrors ? 1 : 0,
    details: data
  };
}

/**
 * GET /api/sync/status
 * Get sync status and statistics
 */
router.get('/status', async (req, res) => {
  try {
    // Get local record counts
    const localStats = {
      sites: db.prepare('SELECT COUNT(*) as count FROM sites').get(),
      contacts: db.prepare('SELECT COUNT(*) as count FROM contacts').get(),
      searches: db.prepare('SELECT COUNT(*) as count FROM searches').get(),
      executives: db.prepare('SELECT COUNT(*) as count FROM company_executives').get(),
      keywords: db.prepare('SELECT COUNT(*) as count FROM keywords').get(),
    };
    
    // Get sync state
    const globalSync = db.prepare(`SELECT * FROM sync_state WHERE key = ?`).get('global_sync');
    const tableSyncStates = db.prepare(`SELECT * FROM sync_state WHERE key LIKE 'sync_%'`).all();
    
    const tableStates = {};
    for (const state of tableSyncStates) {
      const tableName = state.key.replace('sync_', '');
      tableStates[tableName] = {
        lastSyncAt: state.last_sync_at,
        lastSyncedCount: state.last_synced_count,
        status: state.last_sync_status
      };
    }
    
    res.json({
      success: true,
      data: {
        local: localStats,
        globalSync: globalSync,
        tableSync: tableStates,
        supabaseUrl: SUPABASE_URL?.replace(/\/$/, '') + '/rest/v1',
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/sync/auto-sync
 * Automatic sync that only runs if changes detected
 */
router.post('/auto-sync', async (req, res) => {
  const { force = false } = req.body;
  
  // Get last sync time
  const lastSync = db.prepare(`SELECT last_sync_at FROM sync_state WHERE key = ?`).get('global_sync');
  
  // Check for changes since last sync
  const changes = {};
  const tables = ['sites', 'contacts', 'searches', 'executives', 'keywords'];
  
  for (const table of tables) {
    const query = lastSync && !force
      ? `SELECT COUNT(*) as count, MAX(updated_at) as last_change FROM ${table} 
         WHERE created_at > ? OR updated_at > ?`
      : `SELECT COUNT(*) as count, MAX(updated_at) as last_change FROM ${table}`;
    
    const params = lastSync && !force ? [lastSync.last_sync_at, lastSync.last_sync_at] : [];
    const result = db.prepare(query).get(...params);
    changes[table] = result;
  }
  
  // Only sync if there are changes or forced
  const totalChanges = Object.values(changes).reduce((sum, c) => sum + (c.count || 0), 0);
  
  if (totalChanges === 0 && !force) {
    return res.json({
      success: true,
      message: 'No changes detected, sync not needed',
      synced: false,
      changes
    });
  }
  
  // Perform the sync
  try {
    const results = {};
    for (const table of tables) {
      results[table] = await syncTableWithIdempotency(
        table, 
        'incremental', 
        lastSync?.last_sync_at, 
        100,
        force
      );
    }
    
    res.json({
      success: true,
      message: `Synced ${totalChanges} records across ${tables.length} tables`,
      synced: true,
      changes,
      results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/sync/validate
 * Validate that data in Supabase matches local data
 */
router.post('/validate', async (req, res) => {
  const { tables = ['sites', 'contacts'] } = req.body;
  
  const validation = {};
  
  for (const table of tables) {
    // Get local count
    const localCount = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
    
    // Get Supabase count
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=count&head=true`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      const cloudCount = data[0]?.count || 0;
      
      validation[table] = {
        local: localCount.count,
        cloud: cloudCount,
        match: localCount.count === cloudCount,
        difference: localCount.count - cloudCount
      };
    }
  }
  
  res.json({
    success: true,
    validation
  });
});

module.exports = router;
```

#### Deliverables:
- Sync endpoint working with idempotent upserts
- Change detection implemented
- No duplicate data guaranteed
- Sync status tracking
- Data validation endpoint

### 3.3 Phase 3: Build Next.js Email System (Days 5-12)

#### Tasks:
1. Create Next.js project
2. Setup Supabase client
3. Build API routes
4. Build frontend dashboard
5. Implement cron worker

#### Project Structure:
```
email-system/
├── app/
│   ├── (dashboard)/
│   │   ├── page.tsx
│   │   ├── campaigns/
│   │   ├── queue/
│   │   ├── templates/
│   │   └── senders/
│   ├── api/
│   │   ├── campaigns/route.ts
│   │   ├── queue/route.ts
│   │   ├── templates/route.ts
│   │   └── workers/route.ts
│   └── layout.tsx
├── lib/
│   ├── supabase.ts
│   ├── email/
│   │   ├── sender.ts
│   │   ├── templates.ts
│   │   └── queue.ts
│   └── workers/
│       └── email-worker.ts
├── components/
│   ├── ui/
│   └── dashboard/
└── package.json
```

#### Deliverables:
- Working Next.js application
- All email features migrated
- Cron worker processing queue

### 3.4 Phase 4: Testing (Days 13-14)

#### Test Cases:
1. Sync local data to cloud
2. Create campaign from cloud data
3. Queue and send emails
4. Timezone scheduling
5. Sequence emails
6. Error handling and retries

#### Deliverables:
- All tests passing
- Bug fixes applied

### 3.5 Phase 5: Cutover (Day 15)

#### Tasks:
1. Deploy email system to Vercel
2. Stop local email worker
3. Remove email code from local
4. Verify end-to-end flow

#### Deliverables:
- Email system live on Vercel
- Local system cleaned up
- Documentation updated

---

## 4. Database Schema

### 4.1 Sync Strategy (No Duplicates, Change Detection)

> **Core Principle:** The sync system is designed to be **idempotent** - running it multiple times will NOT create duplicates

#### How It Works:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      1. PRE-SYNC VALIDATION                                │
│  - Check if Supabase is accessible                                              │
│  - Validate local database schema                                                │
│  - Get sync state (last_sync_at for each table)                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                      2. CHANGE DETECTION                                   │
│  - Query local DB for records WHERE:                                         │
│    • created_at > last_sync_at (NEW records)                                │
│    • OR updated_at > last_sync_at (MODIFIED records)                           │
│  - Calculate content_hash for dirty checking (optional)                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                      3. DATA TRANSFORMATION                               │
│  - Map SQLite types to PostgreSQL types                                            │
│    • INTEGER 0/1 → BOOLEAN (for is_* columns)                                   │
│    • JSON strings → JSONB (indicators, tags, etc.)                             │
│  - Add synced_at timestamp to all records                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                      4. IDEMPOTENT UPSERT                                   │
│  - Send batch to Supabase with:                                                   │
│    • Primary key matching (same IDs as local)                                     │
│  - ON CONFLICT DO UPDATE for existing records                                      │
│  - ON CONFLICT IGNORE for duplicates                                               │
│  - Batch size: 100 records per request                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                      5. ERROR HANDLING                                     │
│  - Continue on individual record failures                                          │
│  - Log errors but don't stop entire sync                                              │
│  - Collect detailed results per table                                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                      6. SYNC STATE UPDATE                                 │
│  - Update sync_state table with:                                                   │
│    • last_sync_at = NOW()                                                          │
│    • last_synced_count = number of records synced                                │
│    • last_sync_status = 'success' | 'partial' | 'failed'                             │
│  - Store per-table sync state for granular tracking                               │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Sync State Table Schema:

```sql
CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,                    -- 'global_sync' or 'sync_{table_name}'
  last_sync_at TIMESTAMPTZ,                  -- When this table was last synced
  last_synced_count INTEGER DEFAULT 0,       -- How many records were synced
  last_sync_status TEXT DEFAULT 'pending',    -- 'success', 'partial', 'failed'
  error_message TEXT,                         -- Error details if failed
  metadata JSONB,                            -- Additional sync metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Example Sync Flow:

```
Initial Sync (First Time):
1. last_sync_at = NULL
2. Sync ALL records from sites, contacts, etc.
3. Update sync_state: last_sync_at = "2026-04-07T10:00:00Z"

Incremental Sync (After Scraping):
1. User scrapes 50 new sites → local DB updated
2. Auto-sync triggered
3. Query: WHERE created_at > "2026-04-07T10:00:00Z"
4. Only 50 new records sent to Supabase
5. No duplicates - existing records matched by ID

Update Sync (Record Modified):
1. AI processes a site → ai_status changes
2. Local updated_at = "2026-04-07T11:30:00Z"
3. Auto-sync triggered
4. Query: WHERE updated_at > last_sync_at
5. Only modified records sent
6. Supabase ON CONFLICT DO UPDATE updates existing record
```

---

### 4.2 Database Schema

### 4.1 Synced Tables (From Local)

> **Key Features:** Idempotent upserts, change detection, no duplicates, complete coverage

```sql
-- Sync state tracking table (NEW - tracks sync history)
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  last_sync_at TIMESTAMPTZ,
  last_synced_count INTEGER DEFAULT 0,
  last_sync_status TEXT DEFAULT 'pending',
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sites table (scraped website data)
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY,
  search_id INTEGER,
  url TEXT NOT NULL UNIQUE,
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
  page_title TEXT,
  meta_description TEXT,
  tags TEXT,
  
  -- AI analysis fields
  ai_status TEXT DEFAULT 'pending',
  ai_verified_wp INTEGER,
  ai_content_relevant INTEGER,
  ai_actual_category TEXT,
  ai_content_summary TEXT,
  
  -- Change tracking for sync
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Hash for quick change detection
  content_hash TEXT
);

-- Contacts table (extracted contact info)
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('email', 'phone', 'linkedin')),
  value TEXT NOT NULL,
  source_page TEXT,
  
  -- Change tracking
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Keywords table (keyword management)
CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY,
  keyword TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'pending',
  max_sites INTEGER DEFAULT 20,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Searches table (search history)
CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY,
  query TEXT NOT NULL,
  country TEXT DEFAULT 'in',
  total_sites INTEGER NOT NULL,
  wordpress_count INTEGER NOT NULL,
  non_wordpress_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Company executives (LinkedIn data)
CREATE TABLE IF NOT EXISTS company_executives (
  id INTEGER PRIMARY KEY,
  site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  company_url TEXT NOT NULL,
  company_name TEXT,
  profile_url TEXT NOT NULL UNIQUE,
  name TEXT,
  headline TEXT,
  role_category TEXT,
  
  -- Change tracking
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for sync performance
CREATE INDEX IF NOT EXISTS idx_contacts_site_id ON contacts(site_id);
CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type);
CREATE INDEX IF NOT EXISTS idx_sites_country ON sites(country);
CREATE IF NOT EXISTS idx_sites_is_wordpress ON sites(is_wordpress);
CREATE INDEX IF NOT EXISTS idx_sites_updated_at ON sites(updated_at);
CREATE INDEX IF NOT EXISTS idx_contacts_updated_at ON contacts(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_state_updated_at ON sync_state(updated_at);

-- Triggers for automatic updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sites_updated_at BEFORE UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_executives_updated_at BEFORE UPDATE ON company_executives
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

#### Idempotency Strategy

**How we ensure NO duplicates:**

1. **Primary Key Matching:** Use same IDs from local SQLite
2. **ON CONFLICT DO UPDATE:** PostgreSQL upserts instead of inserting duplicates
3. **Content Hash:** Track content hash to detect actual changes
4. **Timestamp Tracking:** Only sync records modified since last sync

**Change Detection Logic:**

```javascript
// Only sync if:
// 1. Record is NEW (doesn't exist in cloud)
// 2. Record was MODIFIED (updated_at > last_sync_at)
// 3. Force sync requested
```

### 4.2 Email System Tables (New in Cloud)

```sql
-- Email senders (SMTP accounts)
CREATE TABLE email_senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  service TEXT DEFAULT 'resend' CHECK (service IN ('resend', 'gmail', 'custom')),
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_user TEXT,
  daily_limit INTEGER DEFAULT 500,
  is_active BOOLEAN DEFAULT true,
  sent_today INTEGER DEFAULT 0,
  last_reset_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email templates
CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_content TEXT NOT NULL,
  text_content TEXT,
  description TEXT,
  category TEXT DEFAULT 'general',
  tags TEXT DEFAULT '',
  sequence_number INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email campaigns
CREATE TABLE email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  template_id UUID REFERENCES email_templates(id),
  target_type TEXT DEFAULT 'all' CHECK (target_type IN ('all', 'wordpress', 'selected', 'tag')),
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'paused', 'completed')),
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Email queue
CREATE TABLE email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES email_campaigns(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES email_senders(id),
  contact_id INTEGER REFERENCES contacts(id),
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  html_content TEXT NOT NULL,
  text_content TEXT,
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts INTEGER DEFAULT 0,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  country_code TEXT DEFAULT 'in',
  tag TEXT,
  sequence_position INTEGER,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email send log
CREATE TABLE email_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id INTEGER REFERENCES contacts(id),
  contact_email TEXT NOT NULL,
  template_id UUID REFERENCES email_templates(id),
  campaign_id UUID REFERENCES email_campaigns(id),
  send_type TEXT DEFAULT 'main',
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email settings
CREATE TABLE email_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  label TEXT,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO email_settings (key, value, label, description) VALUES
  ('per_email_delay', '60', 'Per-Email Delay', 'Seconds between emails'),
  ('cycle_cooldown_min', '10', 'Cycle Cooldown Min', 'Minutes after full cycle'),
  ('cycle_cooldown_max', '13', 'Cycle Cooldown Max', 'Minutes after full cycle'),
  ('followup_gap_1', '2', 'Follow-up 1 Gap', 'Days after main email'),
  ('followup_gap_2', '5', 'Follow-up 2 Gap', 'Days after follow-up 1'),
  ('followup_gap_3', '5', 'Follow-up 3 Gap', 'Days after follow-up 2'),
  ('followup_gap_4', '5', 'Follow-up 4 Gap', 'Days after follow-up 3');

-- Indexes for email tables
CREATE INDEX idx_email_queue_status ON email_queue(status);
CREATE INDEX idx_email_queue_scheduled_at ON email_queue(scheduled_at);
CREATE INDEX idx_email_queue_campaign_id ON email_queue(campaign_id);
CREATE INDEX idx_email_queue_country_code ON email_queue(country_code);
CREATE INDEX idx_email_send_log_contact_id ON email_send_log(contact_id);
CREATE INDEX idx_email_send_log_campaign_id ON email_send_log(campaign_id);
```

---

## 5. API Contract

### 5.1 Sync API (Local System)

> **Complete Idempotent Sync - No Duplicates Guaranteed**

```
POST /api/sync/push-to-cloud
Body: {
  tables?: ['sites', 'contacts', 'searches', 'executives', 'keywords', 'email_senders'],
  mode?: 'full' | 'incremental' | 'auto',
  since?: string (ISO date), 
  batchSize?: 100,
  force?: boolean
}
Response: {
  success: boolean,
  message: string,
  results: {
    sites: { synced: number, errors: number, total: number, batches: [...] },
    contacts: { synced: number, errors: number, total: number },
    email_senders: { synced: number, errors: number, total: number },
    // ... other tables
  },
  errors: [{ table: string, error: string }],
  duration: string,
  timestamp: string
}

POST /api/sync/auto-sync
Body: {
  force?: boolean
}
Response: {
  success: boolean,
  message: string,
  synced: boolean,
  changes: { 
    sites: { count: number, last_change: string }, 
    contacts: { ... },
    email_senders: { ... }
  },
  results: { ... }
}

GET /api/sync/status
Response: {
  success: boolean,
  data: {
    local: { 
      sites: number, 
      contacts: number, 
      keywords: number, 
      searches: number, 
      executives: number,
      email_senders: number 
    },
    globalSync: { last_sync_at: string, last_synced_count: number, ... },
    tableSync: {
      sites: { lastSyncAt: string, lastSyncedCount: number, status: string },
      contacts: { ... },
      email_senders: { ... },
      // ... other tables
    },
    supabaseUrl: string
  }
}

POST /api/sync/validate
Body: {
  tables?: ['sites', 'contacts', 'email_senders']
}
Response: {
  success: boolean,
  validation: {
    sites: { local: number, cloud: number, match: boolean, difference: number },
    contacts: { ... },
    email_senders: { ... }
  }
}
```

#### Sync Modes Explained:

| Mode | When to Use | Behavior |
|------|-------------|----------|
| `auto` | Default | Syncs only records with changes since last sync |
| `incremental` | After specific changes | Syncs records modified since given timestamp |
| `full` | First sync or recovery | Syncs ALL records regardless of timestamp |
| `force` | Recovery | Ignores last sync time, syncs everything |

#### Change Detection Strategy:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CHANGE DETECTION LOGIC                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Get last_sync_at from sync_state table for each table                       │
│  2. Query local DB for records WHERE:                                         │
│    • created_at > last_sync_at (NEW records)                                │
│    • OR updated_at > last_sync_at (MODIFIED records)                           │
│  3. Transform data and UPSERT to Supabase                                        │
│  4. Supabase ON CONFLICT handles duplicates automatically                            │
│  5. Update sync_state with new timestamp                                         │
│                                                                              │
│  Result: Only changed records are sent, no duplicates created                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Special Handling for email_senders:

Since email_senders contains **sensitive SMTP credentials**, additional safeguards are applied:

1. **Real-time Sync**: email_senders syncs immediately when changed via a separate endpoint
2. **Credential Security**: Passwords are synced but encrypted in transit (HTTPS)
3. **Conflict Resolution**: If sender exists in cloud, update but preserve cloud's sent_today counter
4. **Validation**: Test SMTP connection before syncing to ensure credentials work
5. **Backup Before Overwrite**: Cloud data backed up before overwriting

**Sync Order Priority** (to handle dependencies):
1. First: sites, contacts (foundational data)
2. Second: searches, executives (depends on sites)
3. Third: email_senders (independent, can sync anytime)

### 5.2 Email System API (Next.js)

```
CAMPAIGNS
GET    /api/campaigns                    # List campaigns
POST   /api/campaigns                    # Create campaign
GET    /api/campaigns/:id                # Get campaign
PUT    /api/campaigns/:id                # Update campaign
DELETE /api/campaigns/:id                # Delete campaign
POST   /api/campaigns/:id/start          # Start campaign
POST   /api/campaigns/:id/pause          # Pause campaign

QUEUE
GET    /api/queue                         # Get queued emails
POST   /api/queue/add-selected           # Queue selected contacts
POST   /api/queue/add-by-tag             # Queue by tag
DELETE /api/queue/:id                     # Cancel queued email
POST   /api/queue/:id/retry               # Retry failed email
GET    /api/queue/stats                   # Queue statistics

TEMPLATES
GET    /api/templates                    # List templates
POST   /api/templates                    # Create template
GET    /api/templates/:id                # Get template
PUT    /api/templates/:id                # Update template
DELETE /api/templates/:id                # Delete template
POST   /api/templates/:id/preview         # Preview template

SENDERS
GET    /api/senders                       # List senders
POST   /api/senders                       # Add sender
PUT    /api/senders/:id                   # Update sender
DELETE /api/senders/:id                   # Delete sender
PATCH  /api/senders/:id/toggle            # Toggle active
POST   /api/senders/:id/test              # Test connection

CONTACTS (from Supabase synced data)
GET    /api/contacts                      # List contacts
GET    /api/contacts/:id                  # Get contact
POST   /api/contacts/search               # Search contacts
```

---

## 6. Deployment Guide

### 6.1 Supabase Setup

1. **Create Project:**
   - Go to https://supabase.com
   - Create new project
   - Choose region closest to you

2. **Run Schema:**
   - Go to SQL Editor
   - Run schema from Section 4

3. **Get Credentials:**
   - Settings → API
   - Copy project URL
   - Create service role key

### 6.2 Local System Setup

1. **Add to `.env`:**
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   ```

2. **Add sync endpoint to `server.js`:**
   ```javascript
   const syncRouter = require('./api/sync-controller');
   app.use('/api/sync', syncRouter);
   ```

3. **Test sync:**
   ```bash
   curl -X POST http://localhost:8080/api/sync/push-to-cloud \
     -H "Content-Type: application/json" \
     -d '{"tables": ["sites", "contacts"]}'
   ```

### 6.3 Next.js Email System Setup

1. **Create project:**
   ```bash
   npx create-next-app@latest alg-email-system --typescript --tailwind --app
   cd alg-email-system
   ```

2. **Install dependencies:**
   ```bash
   npm install @supabase/supabase-js nodemailer
   npm install @tanstack/react-query date-fns
   npx shadcn@latest init
   ```

3. **Configure environment:**
   ```bash
   # .env.local
   NEXT_PUBLIC_SUPABASE_URL=your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   CRON_SECRET=your-random-secret-string
   
   # SMTP (optional - can also be managed via UI)
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   ```

4. **Deploy to Vercel:**
   ```bash
   vercel link
   vercel env add SUPABASE_SERVICE_KEY
   vercel env add CRON_SECRET
   # Add SMTP credentials if using environment variables
   vercel env add SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS
   vercel deploy
   ```

5. **Setup Cron Jobs:**
   ```bash
   # Add cron job for queue processing (runs every minute)
   vercel cron add */1 * * * * /api/workers/process-queue
   ```

---

## 7. Rollback Plan

### 7.1 Rollback Triggers

- Email system down for > 1 hour
- Data sync failure affecting operations
- Critical bugs in email sending

### 7.2 Rollback Steps

1. **Stop Next.js deployment:**
   ```bash
   vercel rollback
   ```

2. **Re-enable local email worker:**
   - Remove email code deletion
   - Restart local server

3. **Verify local email system:**
   - Check worker is running
   - Test queue processing

### 7.3 Rollback Validation

- Emails sending from local system
- No data loss
- Queue processing normally

---

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Data sync failure | Medium | High | Implement retry logic, keep local backup |
| Email sending delay | Low | Medium | Monitor queue processing time |
| Timezone calculation bugs | Low | Medium | Thorough testing, use battle-tested libraries |
| Vercel cold starts | Low | Low | Use cron with proper warming |
| Supabase rate limits | Low | Medium | Implement batching, exponential backoff |
| Sequence breakage | Low | High | Store sequence state in DB, not memory |

---

## 9. Success Criteria

- [ ] Local system syncs data to Supabase automatically
- [ ] Email system deployed on Vercel
- [ ] All email features working (campaigns, templates, queue)
- [ ] Timezone-aware scheduling working
- [ ] Sequence emails working
- [ ] No data loss during migration
- [ ] Local system cleaned of email code
- [ ] Documentation complete

---

## Appendix

### A. File Changes Summary

**Files to ADD to local system:**
- `src/api/sync-controller.js`
- `src/api/sync-state.js` (new table)

**Files to MODIFY in local system:**
- `src/api/server.js` (add sync routes, remove email routes)
- `src/scrapers/wordpress-detector.js` (add auto-sync call)

**Files to DELETE from local system:**
- `src/services/email/` (entire folder)
- Email-related UI from `public/index.html`

**Files to CREATE in new system:**
- Complete Next.js email system (see Phase 3)

### B. Timeline

| Week | Tasks | Deliverable |
|------|-------|-------------|
| 1 | Supabase setup, sync endpoint | Database ready, sync working |
| 2 | Next.js project setup, basic UI | Project skeleton |
| 3 | API routes, data layer | Functional APIs |
| 4 | Worker implementation | Queue processing |
| 5 | Testing & cutover | Live system |

### C. Contact Information

For questions or issues during migration, refer to:
- Supabase Docs: https://supabase.com/docs
- Vercel Docs: https://vercel.com/docs
- Resend Docs: https://resend.com/docs

---

**Document Version:** 1.0  
**Last Updated:** 2026-04-07
