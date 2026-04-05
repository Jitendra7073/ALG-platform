# WordPress Lead Generator - Complete Technical Documentation

**Version:** 1.0
**Last Updated:** 2026-04-05
**Project Type:** Lead Generation & Outreach Automation System

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Breakdown](#2-architecture-breakdown)
3. [Folder & File Structure Analysis](#3-folder--file-structure-analysis)
4. [Core Modules Explanation](#4-core-modules-explanation)
5. [Data Flow & Lifecycle](#5-data-flow--lifecycle)
6. [Database Design Understanding](#6-database-design-understanding)
7. [API Layer](#7-api-layer)
8. [Frontend Flow](#8-frontend-flow)
9. [Background Jobs / Scheduler](#9-background-jobs--scheduler)
10. [Critical Dependencies & Coupling](#10-critical-dependencies--coupling)
11. [Common Issues & Edge Cases](#11-common-issues--edge-cases)
12. [Guidelines for Adding New Features](#12-guidelines-for-adding-new-features)
13. [Improvement Opportunities](#13-improvement-opportunities)
14. [Final System Mental Model](#14-final-system-mental-model)

---

## 1. Project Overview

### Purpose

This is a **lead generation and outreach automation system** designed to:

1. **Search Google** for keywords and detect WordPress sites
2. **Extract contact information** (emails, phones, LinkedIn) from websites
3. **Scrape LinkedIn** for company executives (Founders, CEO, CTO)
4. **Verify with AI** whether sites are actually WordPress and content-relevant
5. **Automated email outreach** with timezone-aware scheduling and template management
6. **Admin panel** for managing all aspects of the system

### Core Features

| Feature | Description |
|---------|-------------|
| **Google Scraper** | Searches Google for keywords, extracts top 10 results |
| **WordPress Detection** | Detects WordPress by checking URLs, meta tags, CSS classes |
| **Contact Extraction** | Extracts emails, phones, LinkedIn profiles from website content |
| **LinkedIn Scraper** | Scrapes company pages for executive information |
| **AI Verification** | Uses OpenRouter API to verify WordPress and content relevance |
| **Email Queue System** | Timezone-aware email scheduling with sequence support |
| **Template Management** | HTML email templates with variable replacement |
| **Campaign Management** | Bulk email campaigns with tracking |
| **Global Monitor** | Real-time dashboard for email statistics by country |

### Main Workflows

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DISCOVERY WORKFLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. User adds keyword → keywords table                                     │
│  2. Scraper searches Google → searches table                               │
│  3. Each URL is checked → sites table (is_wordpress flag)                  │
│  4. WordPress sites → ai_status='pending'                                  │
│  5. AI Processor verifies → ai_status='completed'                          │
│  6. Contacts extracted → contacts table                                    │
│  7. LinkedIn scraper → company_executives table                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              OUTREACH WORKFLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. User creates template → email_templates table                          │
│  2. User creates campaign → email_campaigns table                          │
│  3. Emails queued → email_queue table (status='queued')                    │
│  4. Scheduler sets scheduled_at based on timezone                          │
│  5. Worker processes → status='sending' → status='sent'                    │
│  6. Send logged → email_send_log table                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Architecture Breakdown

### Overall Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          SYSTEM ARCHITECTURE                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐      │
│  │   FRONTEND      │      │    BACKEND      │      │   WORKERS       │      │
│  │   (Public/)     │◄────►│   (API/Server)  │◄────►│  (AI/Email)     │      │
│  │   index.html    │      │   Express.js    │      │  Background     │      │
│  └─────────────────┘      └────────┬────────┘      └─────────────────┘      │
│                                    │                                            │
│                                    │                                            │
│                           ┌────────▼────────┐                                  │
│                           │   DATABASE       │                                  │
│                           │   SQLite         │                                  │
│                           │   (.db file)     │                                  │
│                           └─────────────────┘                                  │
│                                                                              │
│  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐      │
│  │   EXTERNAL      │      │   BROWSER       │      │   AI API        │      │
│  │   Google        │◄────►│   Playwright    │      │   OpenRouter    │      │
│  │   LinkedIn      │      │   (Persistent)  │      │   (OpenAI)      │      │
│  └─────────────────┘      └─────────────────┘      └─────────────────┘      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Layer Interactions

| Layer | Technology | Responsibility | Dependencies |
|-------|-----------|-----------------|---------------|
| **Frontend** | Vanilla JS + HTML | UI, API calls, State management | Backend API |
| **Backend API** | Express.js | REST endpoints, Business logic | Database, Workers |
| **Database** | SQLite (better-sqlite3) | Data persistence | All layers |
| **AI Worker** | Node.js | AI verification | OpenRouter API, Database |
| **Email Worker** | Node.js | Queue processing | Nodemailer, Database |
| **Scrapers** | Playwright | Web scraping | Google, LinkedIn |

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           COMPLETE DATA FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  USER ACTION        API CALL          DATABASE          WORKER            │
│  ───────────        ─────────        ─────────          ──────            │
│                                                                             │
│  Add Keyword   ──►  POST /api/keywords  ──►  INSERT keywords              │
│                                                                             │
│  Start Scraping ──► POST /scraper/start  ──►  UPDATE keywords.status       │
│       │                                                   │                │
│       └───────────────────────────────────────────────────┼────────►        │
│                   Playwright Scrapes Google URLs          │                │
│                   WordPress Detection                      │                │
│                   Contact Extraction                      │                │
│                                                             │                │
│  Sites saved  ──►  INSERT sites ──► ai_status='pending' ───┼──► AI Worker   │
│                                                             │                │
│                                          AI Verification  ◄┘                │
│                                          UPDATE sites.ai_status            │
│                                                                             │
│  Create Campaign ──► POST /campaigns ──► INSERT email_campaigns            │
│                        │                                                │    │
│                        └─────────────────► Queue Emails (email_queue) ───┼──► Email Worker
│                                                                         │    │
│                                         Send Email ◄─────────────────────┘    │
│                                         UPDATE email_queue.status='sent'      │
│                                         INSERT email_send_log                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Folder & File Structure Analysis

```
d:/wordpress site lead generator/old version/
├── src/
│   ├── api/
│   │   └── server.js                      # Main Express server, all API routes
│   ├── database/
│   │   ├── database.js                    # SQLite wrapper, singleton pattern
│   │   └── migrations/                    # Database migration scripts
│   ├── scrapers/
│   │   ├── wordpress-detector.js         # Google scraper + WordPress detection
│   │   ├── linkedin-company-scraper.js   # LinkedIn executive scraper
│   │   └── linkedin-credentials-api.js   # LinkedIn credentials API router
│   ├── services/
│   │   ├── ai/
│   │   │   ├── ai-client.js              # OpenRouter API client (singleton)
│   │   │   ├── ai-processor.js            # Background worker (30s polling)
│   │   │   └── ai-retry-manager.js       # Retry failed AI requests
│   │   └── email/
│   │       ├── email-queue-worker.js     # Email queue processor (30s polling)
│   │       ├── email-senders-templates-api.js  # Email API router (campaigns, templates)
│   │       ├── timezone-aware-api.js      # Timezone scheduling endpoints
│   │       └── timezone-scheduler.js      # Business hours calculation logic
│   ├── scripts/
│   │   ├── maintenance/                  # DB checks, diagnostics, fixes
│   │   ├── queueing/                     # Queue management scripts
│   │   ├── runners/                      # Execution scripts (view results)
│   │   └── setup/                        # Database setup scripts
│   └── utils/
│       └── system-logger.js              # Centralized logging with categories
├── public/
│   ├── css/
│   │   └── colors.css                    # CSS color variables
│   └── index.html                        # Complete admin panel UI (single file)
├── docs/                                 # Additional documentation
├── .env                                  # Environment variables (API keys)
├── package.json                          # Dependencies and scripts
└── wordpress-detector.db                 # SQLite database (created at runtime)
```

### File Responsibilities

#### Core Server

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/api/server.js` | Main Express server, serves UI, defines all API routes | - Mounts email/LinkedIn routers<br>- Scraper status tracking<br>- Keywords/sites/contacts API<br>- AI retry endpoints<br>- Logs API<br>- Static file serving |

#### Database Layer

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/database/database.js` | SQLite wrapper with singleton pattern | - `getSharedDb()`: Persistent connection<br>- `run()`, `all()`, `get()`, `prepare()`: Helper functions<br>- `initDatabase()`: Creates all tables<br>- Auto-migration for new columns |

#### Scrapers

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/scrapers/wordpress-detector.js` | Google scraper + WordPress detection | - `searchGoogle()`: Search for keywords<br>- `detectWordPress()`: Check for WP indicators<br>- `extractEmails()`, `extractPhones()`, `extractLinkedIn()` |
| `src/scrapers/linkedin-company-scraper.js` | LinkedIn executive scraper | - `init()`: Login with stored credentials<br>- `scrapeCompany()`: Extract executives<br>- Role categorization (Founder 1-3, CEO, CTO) |
| `src/scrapers/linkedin-credentials-api.js` | LinkedIn credentials API router | - CRUD for credentials<br>- Single-active enforcement<br>- Toggle active credential |

#### AI Services

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/services/ai/ai-client.js` | OpenRouter API integration | - `analyzeSite()`: WordPress verification + content check<br>- `checkContentRelevance()`: Content matching<br>- `chatJSON()`: Generic JSON chat |
| `src/services/ai/ai-processor.js` | Background AI worker | - Polls every 30s for pending sites<br>- Batch processing (5 sites)<br>- Pre-filter for keyword presence |
| `src/services/ai/ai-retry-manager.js` | Retry failed AI requests | - Detects stuck "processing" sites<br>- Exponential backoff (1min, 5min, 15min, 1hr, 3hr)<br>- Max 5 retry attempts |

#### Email Services

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/services/email/email-queue-worker.js` | Email queue processor | - Polls every 30s for queued emails<br>- Timezone-aware prioritization<br>- Round-robin sender distribution<br>- Status transitions: queued→sending→sent/failed |
| `src/services/email/email-senders-templates-api.js` | Email API router | - Senders CRUD<br>- Templates CRUD with variable replacement<br>- Campaigns management<br>- Queue operations (add, pause, resume, cancel) |
| `src/services/email/timezone-aware-api.js` | Timezone scheduling endpoints | - Country timezone configurations<br>- Optimal send time calculation<br>- Global monitoring dashboard |
| `src/services/email/timezone-scheduler.js` | Business hours logic | - `isBusinessHour()`: Check if time is within business hours<br>- `calculateOptimalSendTime()`: Find next valid send time<br>- `getCountriesInBusiness()`: Countries currently in business hours |

#### Utilities

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/utils/system-logger.js` | Centralized logging | - Category-based logging (ai, scraper, email, etc.)<br>- Circular buffer (1000 logs)<br>- Console interception<br>- Real-time listener support |

---

## 4. Core Modules Explanation

### Email Queue System

**Purpose:** Send emails at optimal times based on recipient timezone, with support for sequences (follow-ups).

**Key Components:**

1. **Email Queue Worker** (`email-queue-worker.js`)
   - Polls every 30 seconds for queued emails
   - Prioritizes emails for countries currently in business hours
   - Round-robin distribution across active sender accounts
   - Respects daily limits per sender
   - Retry logic with attempt counting

2. **Timezone Scheduler** (`timezone-scheduler.js`)
   - Defines business hours for each country
   - Calculates optimal send times (skips weekends, off-hours)
   - Determines which countries are currently in business hours

3. **Queue States:**
   ```
   queued → scheduled → ready → sending → sent/failed
   ```

**Email Queue Processing Flow:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EMAIL QUEUE WORKER LOGIC                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. CHECK FOR QUEUED EMAILS                                                │
│     │                                                                       │
│     ├─► Get countries currently in business hours                          │
│     │                                                                       │
│     ├─► First priority: Emails for business-hour countries                 │
│     │                                                                       │
│     └─► Fallback: Any scheduled email whose time has arrived               │
│                                                                             │
│  2. SCHEDULE EMAILS (if no scheduled_at set)                               │
│     │                                                                       │
│     ├─► Sequence emails: Based on previous email's sent_at + gap           │
│     │                                                                       │
│     └─► First emails: Next business hour for recipient's country           │
│                                                                             │
│  3. VALIDATE SCHEDULED TIME                                                │
│     │                                                                       │
│     └─► If outside business hours, reschedule to next valid time           │
│                                                                             │
│  4. SELECT SENDER                                                          │
│     │                                                                       │
│     ├─► Round-robin across active senders                                  │
│     │                                                                       │
│     └─► Check daily limit not exceeded                                     │
│                                                                             │
│  5. SEND EMAIL                                                             │
│     │                                                                       │
│     ├─► Update status: 'sending'                                           │
│     │                                                                       │
│     ├─► Send via Nodemailer                                                │
│     │                                                                       │
│     ├─► Update status: 'sent' or 'failed'                                  │
│     │                                                                       │
│     └─► Log to email_send_log                                              │
│                                                                             │
│  6. CYCLE COOLDOWN                                                          │
│     │                                                                       │
│     └─► Wait 10-13 minutes before next batch (rate limiting)               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Scheduler / Worker System

**AI Processor Worker:**
- Polls every 30 seconds for `ai_status='pending'` sites
- Processes in batches of 5 sites
- Pre-filter checks keyword presence before calling AI (cost saving)
- Updates sites with AI results

**Email Queue Worker:**
- Polls every 30 seconds for `status='queued'` emails
- Timezone-aware prioritization
- Processes with per-email delay (60s default)
- Cycle cooldown (10-13 minutes) after full sender rotation

### Template / Sequence System

**Templates:**
- HTML content with variable replacement: `{{name}}`, `{{company}}`, etc.
- Organized by tags (e.g., "main", "followup1", "followup2")
- Each tag can have multiple templates (sequence)

**Sequences:**
- Main email (tag: "main")
- Follow-up 1 (tag: "followup1")
- Follow-up 2 (tag: "followup2")
- Gaps configured in `email_settings` table (default: 2 days, 5 days, 5 days)

**Variable Replacement:**
- `{{name}}`: Extracted from email or generic fallback
- `{{company}}`: From site title/meta description
- `{{sender_name}}`: From email sender configuration

### Global Email Monitor

**Purpose:** Real-time dashboard showing email statistics by country.

**Features:**
- Shows countries currently in business hours
- Email counts by status (queued, scheduled, sent, failed)
- Timezone monitoring with local time display
- Country-specific statistics

**API Endpoints:**
- `GET /api/email/timezone/countries-in-business` - Countries in business hours
- `GET /api/email/timezone/monitoring` - Global monitoring data
- `GET /api/email/timezone/monitoring/country/:code` - Country-specific details

### Filters

**Region Filter:**
- By country code (in, us, uk, etc.)
- Uses `sites.country` field

**Date Filter:**
- By date range for email send time
- Uses `email_queue.sent_at` or `email_send_log.sent_at`

**Status Filter:**
- By AI status (pending, completed, failed)
- By email queue status (queued, scheduled, sending, sent, failed)

### Modal / UI Components

**Admin Panel** (`public/index.html`):
- Single-page application with all UI
- Tab-based navigation (Dashboard, Keywords, Sites, Contacts, Email, LinkedIn)
- Real-time log streaming
- Campaign management interface
- Template editor with preview

---

## 5. Data Flow & Lifecycle

### Complete Email Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EMAIL LIFECYCLE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. CREATION                                                               │
│     User creates campaign → emails queued to email_queue                   │
│     status='queued', scheduled_at=NULL                                     │
│                                                                             │
│  2. SCHEDULING (First Run)                                                 │
│     Worker picks up email → calculates optimal send time                   │
│     scheduled_at set to next business hour                                 │
│     status remains 'queued'                                                 │
│                                                                             │
│  3. WAITING                                                                │
│     Email waits in queue until scheduled_at arrives                        │
│     (can be minutes to days depending on timezone)                         │
│                                                                             │
│  4. READY TO SEND                                                          │
│     Current time >= scheduled_at AND country in business hours             │
│     Worker picks up email for sending                                      │
│                                                                             │
│  5. SENDING                                                                │
│     status='sending'                                                       │
│     Sender selected via round-robin                                        │
│     Email sent via Nodemailer                                              │
│                                                                             │
│  6. SENT / FAILED                                                          │
│     Success: status='sent', sent_at=now, logged to email_send_log          │
│     Failure: status='failed', error_message stored, attempts++            │
│                                                                             │
│  7. SEQUENCE FOLLOW-UPS                                                    │
│     After main email sent, follow-ups queued automatically                │
│     Each follow-up scheduled based on previous email's sent_at + gap       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Scheduling Logic

**Business Hours Calculation:**
```javascript
// For each country, define:
- timezone: IANA timezone string (e.g., 'Asia/Kolkata')
- businessStart: Hour (9-17 default)
- businessEnd: Hour (17 default)
- weekendDays: Array [0, 6] for Sunday, Saturday

// Calculate if current time is business hours:
1. Convert current time to country's timezone
2. Get day of week (0=Sunday, 6=Saturday)
3. Check if day is in weekendDays array
4. Check if hour is between businessStart and businessEnd
```

**Weekend Skipping:**
- If scheduled time falls on weekend, skip to next Monday (or next business day)
- If scheduled time is outside business hours, move to next business hour

**Follow-up Scheduling:**
- Base time: Previous email's `sent_at` timestamp
- Add gap days from `email_settings` table
- Adjust result to business hours (skips weekends/off-hours)

---

## 6. Database Design Understanding

### Core Tables

#### searches
Tracks each search run (Google scraping session).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| query | TEXT | Search keyword |
| country | TEXT | Country code (default: 'in') |
| total_sites | INTEGER | Total sites found |
| wordpress_count | INTEGER | WordPress sites found |
| non_wordpress_count | INTEGER | Non-WordPress sites |
| created_at | DATETIME | Search timestamp |

#### sites
Individual site checks with WordPress detection and AI analysis.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| search_id | INTEGER | Foreign key to searches |
| url | TEXT | Site URL |
| country | TEXT | Country code |
| is_wordpress | INTEGER | 1=WordPress, 0=not |
| confidence_score | INTEGER | Detection confidence |
| emails | TEXT | Comma-separated emails |
| phones | TEXT | Comma-separated phones |
| linkedin_profiles | TEXT | Comma-separated LinkedIn URLs |
| text_content | TEXT | Scraped page content |
| ai_status | TEXT | pending/processing/completed/failed |
| ai_verified_wp | INTEGER | AI-confirmed WordPress |
| ai_content_relevant | INTEGER | AI-confirmed relevance |
| ai_actual_category | TEXT | AI-determined category |
| ai_content_summary | TEXT | AI-generated summary |
| page_title | TEXT | HTML page title |
| meta_description | TEXT | Meta description |
| retry_count | INTEGER | AI retry attempts |
| checked_at | DATETIME | When site was checked |

#### keywords
Keywords for scraping.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| keyword | TEXT | Search keyword (unique) |
| status | TEXT | pending/in_progress/completed |
| max_sites | INTEGER | Max sites to scrape (20 default, 0=unlimited) |
| created_at | DATETIME | Creation timestamp |

#### contacts
Unified contact storage.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| site_id | INTEGER | Foreign key to sites |
| type | TEXT | email/phone/linkedin |
| value | TEXT | Contact value |
| source_page | TEXT | Where found |

#### company_executives
LinkedIn scraped executives.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| site_id | INTEGER | Foreign key to sites |
| company_url | TEXT | LinkedIn company URL |
| profile_url | TEXT | LinkedIn profile URL (unique) |
| name | TEXT | Executive name |
| headline | TEXT | LinkedIn headline |
| role_category | TEXT | Founder1/Founder2/Founder3/CEO/CTO |

#### email_senders
Email accounts for sending.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| name | TEXT | Display name |
| email | TEXT | Email address (unique) |
| password | TEXT | App password |
| service | TEXT | gmail/smtp |
| smtp_host | TEXT | SMTP host |
| smtp_port | INTEGER | SMTP port |
| smtp_user | TEXT | SMTP username |
| daily_limit | INTEGER | Daily send limit (500 default) |
| is_active | INTEGER | 1=active, 0=inactive |
| sent_today | INTEGER | Emails sent today |

#### email_templates
Email templates with HTML content.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| name | TEXT | Template name |
| subject | TEXT | Email subject |
| html_content | TEXT | HTML body with variables |
| tags | TEXT | Comma-separated tags (main, followup1, etc.) |
| is_active | INTEGER | 1=active, 0=inactive |

#### email_campaigns
Email campaigns targeting contacts.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| name | TEXT | Campaign name |
| template_id | INTEGER | Foreign key to templates |
| status | TEXT | queued/running/completed |
| total_recipients | INTEGER | Total contacts |
| sent_count | INTEGER | Emails sent |
| failed_count | INTEGER | Emails failed |

#### email_queue
Queued emails with scheduling.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| campaign_id | INTEGER | Foreign key to campaigns |
| sender_id | INTEGER | Foreign key to senders |
| contact_id | INTEGER | Foreign key to contacts |
| recipient_email | TEXT | To address |
| subject | TEXT | Email subject |
| html_content | TEXT | Email body |
| status | TEXT | queued/scheduled/sending/sent/failed |
| scheduled_at | TEXT | When to send (ISO string) |
| sent_at | TEXT | When sent |
| attempts | INTEGER | Retry attempts |
| tag | TEXT | Template tag (for sequences) |
| sequence_position | INTEGER | Position in sequence (1=main, 2=followup1, etc.) |
| country_code | TEXT | Recipient country (for timezone) |

#### email_send_log
History of sent emails.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| contact_id | INTEGER | Foreign key to contacts |
| template_id | INTEGER | Foreign key to templates |
| campaign_id | INTEGER | Foreign key to campaigns |
| send_type | TEXT | main/followup |
| status | TEXT | sent/failed |
| sent_at | TEXT | Send timestamp |

#### email_settings
Configuration key-value store.

| Column | Type | Description |
|--------|------|-------------|
| key | TEXT | Setting key (primary) |
| value | TEXT | Setting value |
| label | TEXT | Display label |
| description | TEXT | Description |

**Default Settings:**
- `per_email_delay`: 60 seconds
- `cycle_cooldown_min`: 10 minutes
- `cycle_cooldown_max`: 13 minutes
- `followup_gap_1`: 2 days
- `followup_gap_2`: 5 days
- `followup_gap_3`: 5 days
- `followup_gap_4`: 5 days

### Table Relationships

```
searches (1) ──< (N) sites
sites (1) ──< (N) contacts
sites (1) ──< (N) company_executives
contacts (1) ──< (N) email_queue
contacts (1) ──< (N) email_send_log
email_campaigns (1) ──< (N) email_queue
email_templates (1) ──< (N) email_campaigns
email_senders (1) ──< (N) email_queue
```

### Important Queries

**Get pending sites for AI:**
```sql
SELECT * FROM sites
WHERE is_wordpress = 1 AND ai_status = 'pending'
LIMIT 5
```

**Get queued emails for sending:**
```sql
SELECT eq.*, s.country
FROM email_queue eq
LEFT JOIN contacts c ON eq.contact_id = c.id
LEFT JOIN sites s ON c.site_id = s.id
WHERE eq.status = 'queued'
  AND (eq.scheduled_at IS NULL OR eq.scheduled_at <= NOW())
ORDER BY eq.created_at ASC
```

**Check if contact already received template:**
```sql
SELECT 1 FROM email_send_log
WHERE contact_id = ? AND template_id = ?
```

---

## 7. API Layer

### Major API Endpoints

#### Keywords
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/keywords` | Get all keywords |
| POST | `/api/keywords` | Add keyword |
| PUT | `/api/keywords/:id` | Update keyword |
| DELETE | `/api/keywords/:id` | Delete keyword |
| DELETE | `/api/keywords/bulk` | Bulk delete |

#### Sites
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sites/all` | Get all sites (paginated) |
| GET | `/api/sites/wordpress` | Get WordPress sites |
| GET | `/api/sites/non-wordpress` | Get non-WordPress sites |
| GET | `/api/sites/:id` | Get single site |
| PUT | `/api/sites/:id` | Update site |
| DELETE | `/api/sites/:id` | Delete site |
| DELETE | `/api/sites/bulk` | Bulk delete |

#### Contacts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/contacts/all` | Get all contacts |
| GET | `/api/contacts/emails` | Get email contacts |
| GET | `/api/contacts/phones` | Get phone contacts |
| GET | `/api/contacts/linkedin` | Get LinkedIn profiles |
| PUT | `/api/contacts/:id` | Update contact |
| DELETE | `/api/contacts/:id` | Delete contact |

#### Email System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/email/senders` | Get all senders |
| POST | `/api/email/senders` | Add sender |
| PUT | `/api/email/senders/:id` | Update sender |
| DELETE | `/api/email/senders/:id` | Delete sender |
| POST | `/api/email/senders/:id/test` | Test sender |
| GET | `/api/email/templates` | Get all templates |
| POST | `/api/email/templates` | Create template |
| PUT | `/api/email/templates/:id` | Update template |
| DELETE | `/api/email/templates/:id` | Delete template |
| POST | `/api/email/templates/:id/preview` | Preview template |
| GET | `/api/email/campaigns` | Get all campaigns |
| POST | `/api/email/campaigns` | Create campaign |
| GET | `/api/email/campaigns/:id` | Get campaign details |
| DELETE | `/api/email/campaigns/:id` | Delete campaign |
| GET | `/api/email/queue/stats` | Get queue statistics |
| GET | `/api/email/queue/items` | Get queued emails |
| POST | `/api/email/queue/add-selected` | Add selected contacts to queue |
| POST | `/api/email/queue/add-by-tag` | Add contacts by tag to queue |
| POST | `/api/email/queue/trigger` | Start queue processing |
| POST | `/api/email/queue/pause` | Pause queue processing |
| POST | `/api/email/queue/resume` | Resume queue processing |
| DELETE | `/api/email/queue/cancel/:id` | Cancel queued email |
| POST | `/api/email/queue/send-now/:id` | Send email immediately |

#### Timezone
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/email/timezone/countries` | Get all country timezones |
| GET | `/api/email/timezone/countries-in-business` | Get countries in business hours |
| GET | `/api/email/timezone/monitoring` | Global monitoring data |
| PUT | `/api/email/timezone/countries/:code` | Update country settings |

#### AI
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai/stats` | Get AI statistics |
| GET | `/api/ai/history` | Get AI request history |
| POST | `/api/ai/requeue` | Requeue incomplete sites |
| POST | `/api/ai/requeue-all` | Requeue all WordPress sites |
| GET | `/api/ai/retry/stats` | Get retry manager stats |
| POST | `/api/ai/retry/manual` | Manually retry sites |
| GET | `/api/ai/retry/stuck-sites` | Get stuck sites |

#### LinkedIn
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/linkedin/credentials` | Get all credentials |
| POST | `/api/linkedin/credentials` | Add credential |
| PUT | `/api/linkedin/credentials/:id` | Update credential |
| DELETE | `/api/linkedin/credentials/:id` | Delete credential |
| PUT | `/api/linkedin/credentials/:id/toggle` | Toggle active status |

#### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Get system statistics |
| GET | `/api/logs` | Get system logs |
| POST | `/api/logs/clear` | Clear logs |
| GET | `/api/logs/export` | Export logs |

### Request/Response Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API REQUEST FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Frontend                     Backend                     Database           │
│     │                            │                            │               │
│     ├─ fetch('/api/sites')     │                            │               │
│     │      │                    │                            │               │
│     │      └───────────────────►│  Express router             │               │
│     │                           │      │                     │               │
│     │                           │      ├─► Middleware       │               │
│     │                           │      │  (cors, json)       │               │
│     │                           │      │                     │               │
│     │                           │      ├─► Route handler    │               │
│     │                           │      │  db.getAllSites()   │               │
│     │                           │      │                     │               │
│     │                           │      └───────────────────────► SQL Query  │
│     │                           │                            │               │
│     │                           │  ◄───────────────────────── Results       │
│     │                           │                            │               │
│     │  ◄───────────────────────── { success: true, data }   │               │
│     │                            │                            │               │
│     └─ Update UI                 │                            │               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Frontend Flow

### UI Structure

The admin panel (`public/index.html`) is a single-page application with:

1. **Header**
   - Logo
   - Export dropdown (CSV, PDF, JSON)
   - Navigation tabs

2. **Navigation**
   - Dashboard
   - Keywords
   - Sites
   - Contacts
   - Email
   - LinkedIn
   - System Logs

3. **Main Content Area**
   - Dynamic content based on active tab
   - Data tables with pagination
   - Modals for CRUD operations
   - Real-time statistics

4. **System Console**
   - Log streaming display
   - Category-based filtering
   - Auto-refresh

### Data Fetching Patterns

```javascript
// Standard fetch pattern
async function fetchSites(page = 1, filter = 'all', category = null) {
  const params = new URLSearchParams({
    page,
    limit: 50,
    filter,
    ...(category && { category })
  });

  const response = await fetch(`/api/sites/all?${params}`);
  const result = await response.json();

  if (result.success) {
    renderSites(result.data);
  }
}

// Auto-refresh pattern
setInterval(() => {
  fetchSites();
}, 30000); // 30 seconds
```

### Dashboard

**Displays:**
- Total keywords
- WordPress sites found
- AI verification breakdown
- Email statistics
- Recent activity

**Data Sources:**
- `/api/stats` - Overall statistics
- `/api/sites/ai-breakdown` - AI verification stats
- `/api/email/queue/stats` - Email queue stats
- `/api/logs/recent` - Recent activity

### Global Monitor

**Displays:**
- Countries currently in business hours
- Email counts by country and status
- Local time for each country
- Send progress tracking

**Data Sources:**
- `/api/email/timezone/countries-in-business`
- `/api/email/timezone/monitoring`

### Modals

**Common Modal Types:**
- **Edit Modal**: Edit existing records
- **Delete Confirmation**: Confirm before deletion
- **Preview Modal**: Preview email templates
- **Settings Modal**: Configure system settings

**Modal Pattern:**
```javascript
function openEditModal(id) {
  const item = items.find(i => i.id === id);
  document.getElementById('edit-id').value = item.id;
  document.getElementById('edit-name').value = item.name;
  // ... populate fields
  document.getElementById('edit-modal').classList.add('active');
}
```

---

## 9. Background Jobs / Scheduler

### AI Processor Worker

**File:** `src/services/ai/ai-processor.js`

**Start:** Automatically started with server (`aiWorker.start()` in server.js)

**Polling:** Every 30 seconds (`POLL_INTERVAL_MS`)

**Process:**
1. Check for sites with `is_wordpress=1 AND ai_status='pending'`
2. Pre-filter: Check if keyword appears in metadata (cost saving)
3. Process batch of 5 sites with 2-second delays
4. Call AI via `aiClient.analyzeSite()`
5. Update site with AI results
6. Handle failures with retry count

**Stopping:** `aiWorker.stop()`

### AI Retry Manager

**File:** `src/services/ai/ai-retry-manager.js`

**Start:** Automatically started with server (`aiRetryManager.start()`)

**Polling:** Every 1 minute

**Process:**
1. Find sites stuck in "processing" status (>5 minutes)
2. Find failed sites eligible for retry (<3 attempts)
3. Find old pending sites (>1 day)
4. Reset stuck sites to "pending"
5. Increment retry count for failed sites

### Email Queue Worker

**File:** `src/services/email/email-queue-worker.js`

**Start:** Automatically started with server

**Polling:** Every 30 seconds

**Process:**
1. Get countries currently in business hours
2. Prioritize emails for business-hour countries
3. Schedule emails without `scheduled_at`
4. Validate scheduled times
5. Select sender via round-robin
6. Send emails via Nodemailer
7. Update status and log results

**Pause/Resume:**
- Pause: `worker.pause()`
- Resume: `worker.resume()`
- Trigger: `worker.triggerNow()`

---

## 10. Critical Dependencies & Coupling

### Tightly Coupled Areas

| Area | Coupling | Why Critical |
|------|----------|--------------|
| **AI Processor ↔ Database** | High | AI processor directly modifies `ai_status` field |
| **Email Worker ↔ Timezone Scheduler** | High | Scheduling logic depends on timezone calculations |
| **Sequence Emails** | High | Follow-ups depend on previous email's `sent_at` |
| **LinkedIn Scraper ↔ Credentials** | High | Requires active credential from database |

### Sensitive Parts

**1. Scheduling Logic (`timezone-scheduler.js`)**
- Changes affect when emails are sent
- Business hour calculations impact deliverability
- Weekend skipping affects campaign timing

**2. Status Transitions**
- AI status: `pending → processing → completed/failed`
- Email status: `queued → scheduled → sending → sent/failed`
- Incorrect transitions can cause emails to be stuck

**3. Aggregation Queries**
- Dashboard statistics depend on accurate counts
- Cache issues can show stale data

**4. Database Connection Pattern**
- Two patterns: Singleton (`getSharedDb()`) and `initDatabase()`
- Email modules use singleton (persistent connection)
- Other modules use `initDatabase()` (open/close)

---

## 11. Common Issues & Edge Cases

### Known Issues

**1. Duplication Bugs**
- **Cause:** URLs not normalized before insertion
- **Fix:** Use `urlExists()` or `getAllExistingUrls()` before adding sites

**2. Timezone Mismatches**
- **Cause:** Country codes not normalized (e.g., "IN IN")
- **Fix:** Use `normalizeCountryCode()` function

**3. Sequence Dependency Issues**
- **Cause:** Follow-ups scheduled before main email sent
- **Fix:** Check previous email status before scheduling follow-up

**4. Stuck "Processing" Status**
- **Cause:** AI processor crashes during processing
- **Fix:** AI retry manager resets stuck sites

### Edge Cases

**1. No Active Senders**
- Emails queued but not sent
- Warning logged on worker start

**2. Invalid Timezone Data**
- Fallback to default configuration
- Uses `countryTimezones` defaults

**3. Missing Contact Data**
- Graceful handling of missing names/emails
- Generic fallbacks for variable replacement

**4. API Rate Limits**
- Exponential backoff in AI retry manager
- Per-email delay in queue worker

---

## 12. Guidelines for Adding New Features

### Where to Add New Logic

| Feature Type | Location | Pattern |
|--------------|----------|---------|
| New API endpoint | `src/api/server.js` or router file | Add route, handler, database query |
| New background job | New file in `src/services/` | Create worker class with start/stop |
| New database table | `src/database/database.js` | Add table creation in `initDatabase()` |
| New scraper | `src/scrapers/` | Extend pattern from existing scrapers |
| New email feature | `src/services/email/` | Add to existing router or create new file |

### What Not to Modify

**Critical Files (changes require testing):**
- `src/database/database.js` - Table structure changes
- `src/services/email/timezone-scheduler.js` - Scheduling logic
- `src/services/ai/ai-client.js` - AI integration
- `src/utils/system-logger.js` - Logging infrastructure

**Sensitive Operations:**
- Status transitions (use existing patterns)
- Database migrations (add backwards compatibility)
- Browser context configuration (affects all scrapers)

### How to Maintain Consistency

1. **Database Access**
   - Use prepared statements (see `database.js`)
   - Close connections after use (except singleton)
   - Add indexes for new query patterns

2. **API Responses**
   - Use consistent format: `{ success: true/false, data/error: ... }`
   - Include HTTP status codes (400 for client errors, 500 for server errors)

3. **Error Handling**
   - Wrap database operations in try/catch
   - Log errors with system logger
   - Return meaningful error messages

4. **Background Workers**
   - Implement start/stop methods
   - Use polling intervals consistently
   - Handle graceful shutdown

### How to Avoid Breaking Flows

1. **Test status transitions** - Ensure all possible paths are handled
2. **Check foreign key constraints** - Don't orphan records
3. **Validate user input** - Sanitize before database operations
4. **Handle edge cases** - Empty results, missing data, network failures
5. **Log important operations** - Use system logger for debugging

---

## 13. Improvement Opportunities

### Refactoring Areas

1. **Database Connection Pattern**
   - Currently two patterns (singleton vs initDatabase)
   - Consider standardizing on one approach

2. **API Router Organization**
   - `server.js` is very large (3000+ lines)
   - Could extract routes to separate router files

3. **Frontend State Management**
   - Currently uses manual DOM manipulation
   - Could benefit from a reactive framework

4. **Error Handling**
   - Inconsistent error handling across modules
   - Could centralize error middleware

### Performance Improvements

1. **Database Queries**
   - Add missing indexes on frequently queried columns
   - Use prepared statements consistently

2. **Caching**
   - Cache static data (country timezones, templates)
   - Implement result caching for expensive queries

3. **Batch Operations**
   - Batch AI requests (currently 5 at a time)
   - Batch email sending (currently sequential)

### Better Structure

1. **Separation of Concerns**
   - Extract business logic from route handlers
   - Create service layer for complex operations

2. **Configuration Management**
   - Centralize configuration (currently scattered)
   - Use environment variables consistently

3. **Testing**
   - Add unit tests for critical functions
   - Add integration tests for API endpoints

---

## 14. Final System Mental Model

### How Everything Connects

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPLETE SYSTEM OVERVIEW                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         USER INTERFACE                                │  │
│  │                    (public/index.html)                                │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │  │
│  │  │ Dashboard│ │ Keywords │ │  Sites   │ │ Contacts │ │  Email   │   │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      API LAYER (Express.js)                            │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │ server.js (main routes) + email routers + linkedin router        │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                          │           │           │                          │
│          ┌───────────────┘           │           └──────────────┐          │
│          ▼                           ▼                           ▼          │
│  ┌───────────────┐          ┌───────────────┐          ┌───────────────┐   │
│  │  DATABASE     │          │   WORKERS     │          │  EXTERNAL     │   │
│  │  (SQLite)     │          │  (Background) │          │  SERVICES     │   │
│  │               │          │               │          │               │   │
│  │ - sites       │          │ - AI Processor│          │ - Google      │   │
│  │ - contacts    │◄────────►│ - Email Worker│          │ - LinkedIn    │   │
│  │ - email_queue │          │ - Retry Mgr   │          │ - OpenRouter  │   │
│  │ - templates   │          │               │          │               │   │
│  └───────────────┘          └───────────────┘          └───────────────┘   │
│                                                                             │
│  DATA FLOWS:                                                                │
│  1. User adds keyword → Scraper finds sites → AI verifies → Contacts stored │
│  2. User creates campaign → Emails queued → Worker sends at optimal time    │
│  3. All actions logged → System logs → Dashboard display                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Discovery → Verification → Outreach**
   - Find sites (Google scraper)
   - Verify relevance (AI processor)
   - Extract contacts (Contact extraction)
   - Reach out (Email queue worker)

2. **Timezone-Aware Scheduling**
   - Calculate optimal send time per country
   - Prioritize countries in business hours
   - Skip weekends and off-hours

3. **Graceful Degradation**
   - Workers auto-retry on failure
   - Stuck jobs detected and reset
   - Meaningful error messages

4. **Separation of Concerns**
   - API layer handles HTTP
   - Workers handle background tasks
   - Database handles persistence
   - Scrapers handle external services

---

## Appendix A: Environment Variables

```env
# AI (required)
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=openai/gpt-4o-mini

# Email (optional, for Gmail SMTP)
GMAIL_USER=your@gmail.com
GMAIL_APP_PASSWORD=your_app_password
```

## Appendix B: NPM Scripts

```bash
npm start              # Run WordPress detector
npm run admin          # Start admin panel (port 8080)
npm run list           # List all searches
npm run view <id>      # View search details
npm run wordpress      # Show WordPress sites
npm run stats          # View statistics
npm run export         # Export data to JSON
npm run diagnose-email # Diagnose email system
```

---

**End of Technical Documentation**
