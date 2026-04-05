# Database Migration Guide: Local SQLite → Supabase

> **Conceptual Overview** - Understanding the system architecture and data flow without implementation details

---

## Table of Contents

1. [Current System Flow (Local Database)](#current-system-flow-local-database)
2. [Post-Migration Flow (Supabase)](#post-migration-flow-supabase)
3. [Layered Architecture Understanding](#layered-architecture-understanding)
4. [What Changes vs What Does Not](#what-changes-vs-what-does-not)
5. [Data Flow Comparison](#data-flow-comparison)
6. [Key Concepts to Understand](#key-concepts-to-understand)
7. [Potential Risk Areas](#potential-risk-areas)
8. [Final Mental Model](#final-mental-model)

---

## Current System Flow (Local Database)

### How Data is Created - Email Queue Insertion

```
User Action (UI)
    ↓
User selects campaign + contacts → clicks "Queue Emails"
    ↓
API receives POST request
    ↓
Business logic validates data
    ↓
INSERT into email_queue table (local SQLite file)
    ↓
Response sent back to UI
```

**Physical Storage:** A single file `wordpress-detector.db` stored on the server's local disk

### How Data is Stored Locally

| Aspect | Description |
|--------|-------------|
| **Database Engine** | SQLite (embedded, file-based) |
| **Location** | Project root directory on the server machine |
| **Connection** | Direct file access via `better-sqlite3` library |
| **Concurrency** | Single-writer, multiple-reader model |
| **Transaction Scope** | Local to the server process |

### How the Worker Processes Data

```
Background Worker (runs every 30 seconds)
    ↓
Queries: SELECT * FROM email_queue WHERE status = 'queued'
    ↓
Retrieves emails ready to send
    ↓
Sends via SMTP (nodemailer)
    ↓
UPDATE email_queue SET status = 'sent'
    ↓
Wait 60 seconds → repeat
```

### How the UI Fetches and Displays

```
User opens browser → http://localhost:8080
    ↓
Browser loads index.html (UI code)
    ↓
UI JavaScript calls fetch('/api/email/queue')
    ↓
API queries: SELECT * FROM email_queue
    ↓
Data returned as JSON
    ↓
UI renders table/grid
```

---

## Post-Migration Flow (Supabase)

### How Data Will Be Created - Email Queue Insertion

```
User Action (UI)
    ↓
User selects campaign + contacts → clicks "Queue Emails"
    ↓
API receives POST request
    ↓
Business logic validates data (UNCHANGED)
    ↓
INSERT into email_queue table (Supabase PostgreSQL)
    ↓
Response sent back to UI
```

**Physical Storage:** Remote Supabase cloud database (PostgreSQL)

### How Data Will Be Stored (Supabase)

| Aspect | Description |
|--------|-------------|
| **Database Engine** | PostgreSQL (remote, hosted) |
| **Location** | Supabase cloud infrastructure |
| **Connection** | Network connection via Supabase client or PostgreSQL client |
| **Concurrency** | Multi-writer, full transactional support |
| **Transaction Scope** | Across multiple server instances |

### How the Worker Will Process Data

```
Background Worker (runs every 30 seconds)
    ↓
Queries: SELECT * FROM email_queue WHERE status = 'queued'
    ↓
Retrieves emails ready to send (via Supabase)
    ↓
Sends via SMTP (nodemailer) - UNCHANGED
    ↓
UPDATE email_queue SET status = 'sent' (via Supabase)
    ↓
Wait 60 seconds → repeat
```

### How the UI Will Fetch and Display

```
User opens browser → http://localhost:8080
    ↓
Browser loads index.html (UI code) - UNCHANGED
    ↓
UI JavaScript calls fetch('/api/email/queue')
    ↓
API queries: SELECT * FROM email_queue (via Supabase)
    ↓
Data returned as JSON - SAME FORMAT
    ↓
UI renders table/grid - UNCHANGED
```

---

## Layered Architecture Understanding

### Before Migration (Local SQLite)

```
┌─────────────────────────────────────────────────────────────┐
│                    UI LAYER (Browser)                       │
│  - Single-page app in public/index.html                    │
│  - Makes HTTP requests to API                              │
│  - Renders data to user                                    │
└─────────────────────────────────────────────────────────────┘
                              ↓ HTTP
┌─────────────────────────────────────────────────────────────┐
│                 API/BACKEND LAYER (Express)                 │
│  - src/api/server.js                                       │
│  - Handles HTTP requests                                   │
│  - Contains business logic                                 │
│  - Coordinates data operations                             │
└─────────────────────────────────────────────────────────────┘
                              ↓ Direct file access
┌─────────────────────────────────────────────────────────────┐
│              DATABASE LAYER (Local SQLite)                  │
│  - wordpress-detector.db (file on disk)                    │
│  - better-sqlite3 library                                  │
│  - Embedded in server process                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              WORKER/SCHEDULER LAYER                         │
│  - email-queue-worker.js                                   │
│  - Runs in background (same process)                       │
│  - Direct file access to database                          │
└─────────────────────────────────────────────────────────────┘
```

### After Migration (Supabase)

```
┌─────────────────────────────────────────────────────────────┐
│                    UI LAYER (Browser)                       │
│  - Same single-page app                                    │
│  - Makes HTTP requests to API (UNCHANGED)                  │
│  - Renders data to user (UNCHANGED)                        │
└─────────────────────────────────────────────────────────────┘
                              ↓ HTTP
┌─────────────────────────────────────────────────────────────┐
│                 API/BACKEND LAYER (Express)                 │
│  - Same API endpoints (UNCHANGED)                          │
│  - Same business logic (UNCHANGED)                         │
│  - Different database client library                       │
└─────────────────────────────────────────────────────────────┘
                              ↓ Network connection
┌─────────────────────────────────────────────────────────────┐
│              DATABASE LAYER (Supabase)                      │
│  - Remote PostgreSQL database                              │
│  - Supabase client or PostgreSQL client                    │
│  - Hosted in cloud                                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              WORKER/SCHEDULER LAYER                         │
│  - Same worker logic (UNCHANGED)                           │
│  - Runs in background (same process)                       │
│  - Network connection to database                          │
└─────────────────────────────────────────────────────────────┘
```

---

## What Changes vs What Does Not

### CHANGES

| Aspect | Before | After |
|--------|--------|-------|
| Database location | Local file | Remote cloud |
| Connection method | Direct file access | Network connection |
| Query library | `better-sqlite3` | Supabase/PostgreSQL client |
| SQL dialect | SQLite | PostgreSQL |
| Connection pooling | N/A (embedded) | Required |
| Database access pattern | Synchronous | May become async |
| Environment variable | None needed | `SUPABASE_URL`, `SUPABASE_KEY` |

### DOES NOT CHANGE

| Aspect | Status |
|--------|--------|
| UI code | ✓ No changes needed |
| API endpoint URLs | ✓ No changes needed |
| Business logic | ✓ No changes needed |
| Email sending logic (nodemailer) | ✓ No changes needed |
| Worker scheduling intervals | ✓ No changes needed |
| Data models/table structure | ✓ Conceptually same |
| HTTP request/response flow | ✓ No changes needed |
| User experience | ✓ No changes needed |

---

## Data Flow Comparison

### Read Operation Example

**Local DB:**
```
UI → API → SQLite file on disk → SQLite engine → API → UI
```

**Supabase:**
```
UI → API → Network → Supabase → PostgreSQL → Network → API → UI
```

### Write Operation Example (Email Queue)

**Local DB:**
```
User clicks "Queue" → API → INSERT into local file → Response
```

**Supabase:**
```
User clicks "Queue" → API → INSERT via network → Supabase stores → Response
```

### Worker Processing Flow

**Local DB:**
```
Worker timer fires → Read local file → Send email → Update local file
```

**Supabase:**
```
Worker timer fires → Read from network → Send email → Update via network
```

---

## Key Concepts to Understand

### 1. Centralized Database vs Local Storage

**Local (Current):**
- Database lives on the same machine as the server
- If server restarts, database remains (file persists)
- Only this server can access it
- Single point of failure

**Supabase (After):**
- Database lives in the cloud, separate from server
- Multiple servers can access the same database
- Database has its own redundancy/backup
- Can scale horizontally (multiple server instances)

### 2. API as Single Source of Truth

The UI **never** talks to the database directly. It always goes through the API:

```
UI → API → Database (not UI → Database)
```

This means the migration is invisible to the UI because:
- UI calls `/api/email/queue`
- API returns JSON data
- UI doesn't care WHERE the data came from

### 3. Stateless UI Depending on Backend

The UI (browser) has no database connection. It is:
- **Stateless** - doesn't maintain database connections
- **Dependent** - relies entirely on API responses
- **Unaffected** by database location changes

### 4. Worker Interacting with Shared Database

**Current:** Worker and API share the same local file
**After:** Worker and API connect to the same remote database

The key insight: both need to use the **same connection mechanism** to access data consistently.

---

## Potential Risk Areas (Conceptual Only)

> These are areas to be aware of during implementation, not issues in the current system.

### 1. Query Differences

SQLite and PostgreSQL have different SQL dialects:
- `CURRENT_TIMESTAMP` works in both ✓
- Auto-increment syntax differs
- String handling may differ
- JSON functions differ

### 2. Timezone Handling

Current system stores timestamps as ISO strings. With Supabase:
- PostgreSQL stores timestamps with timezone awareness
- Need to ensure consistent timezone handling
- Business hours logic depends on country-specific timezones

### 3. Data Consistency

**Local SQLite:** ACID guarantees via file locking
**Supabase:** ACID via PostgreSQL transactions

Potential issues:
- Network latency during concurrent writes
- Connection failures during operations
- Need for retry logic at database layer

### 4. Connection Management

**Current:** No connection pooling needed (embedded)
**After:** Must manage:
- Connection limits
- Connection pooling
- Reconnection on failure
- Connection timeout handling

### 5. Migration Process

- Schema differences between SQLite and PostgreSQL
- Data type conversions (INTEGER vs serial, TEXT vs varchar)
- Existing data must be migrated without loss

---

## Final Mental Model

### The Migration in One Sentence

> **We are moving data storage from a local file to a remote database, while keeping everything else exactly the same.**

### Why Features Remain Unaffected

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   UI                         API                       Data   │
│   ──                         ──                       ────    │
│   Browser                    Server                   Storage │
│                                                              │
│   [HTML/JS]  ──────────>  [Express]  ──────────>  [SQLite] │
│                              │                              │
│                              │  SAME API CONTRACT            │
│                              │  SAME DATA FORMAT             │
│                              ▼                              │
│                         [Express]  ──────────>  [Supabase]  │
│                                                              │
│   The UI only cares about the API contract.                 │
│   The API only cares about returning data.                  │
│   The database location is an implementation detail.        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### The "Black Box" Principle

From the UI's perspective, the database is a black box:

```
UI asks: "Give me all queued emails"
API returns: [{id:1, email:"..."}, {id:2, email:"..."}]

UI doesn't know (or care):
- Whether data came from SQLite or PostgreSQL
- Whether database is local or remote
- How the query was executed
```

### What Makes This Migration Possible

1. **Clean architecture:** UI → API → Database (no shortcuts)
2. **Single API entry point:** All data flows through the API
3. **No direct database access:** UI never connects to database
4. **Stateless UI:** Browser doesn't maintain database state
5. **JSON data format:** Works identically for both databases

---

## Summary

The migration from local SQLite to Supabase is a **storage layer change** that:

- **Affects:** Database connection code, query syntax, deployment architecture
- **Does NOT affect:** UI, API contracts, business logic, user experience, email sending, scheduling intervals

The system will behave identically from all external perspectives because the **API layer abstracts the database** from both the UI and the worker processes.

---

## Document Info

- **Created:** 2026-04-05
- **Purpose:** Conceptual understanding of database migration
- **Scope:** Architecture and data flow only (no implementation)
- **System:** WordPress Lead Generator - Email Queue & Scheduling System
