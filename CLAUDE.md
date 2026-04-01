# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **lead generation and outreach automation system** that:
1. Searches Google for keywords and detects WordPress sites
2. Extracts contact information (emails, phones, LinkedIn) from websites
3. Scrapes LinkedIn company pages for executive information (Founder 1-3, CEO, CTO)
4. Uses AI (OpenRouter) to verify WordPress detection and content relevance
5. Provides an email queue system with templates for automated outreach
6. Supports LinkedIn credentials management via admin panel

All data is stored in SQLite database (`wordpress-detector.db`) and managed via a web admin panel.

## Development Commands

```bash
# Start the admin panel (runs on port 8080)
npm run admin
# or
node src/api/server.js

# Run WordPress detector directly
npm start               # Uses default query
node src/scrapers/wordpress-detector.js "your search query"

# View saved results
npm run list            # List all searches
npm run view <id>       # View details of specific search
npm run wordpress       # Show all WordPress sites found
npm run stats           # View overall statistics
npm run export          # Export data to JSON

# Database utilities
node src/scripts/maintenance/reset-db.js              # Clear and reset database
node src/scripts/queueing/queue-pending-ai.js         # Manually queue sites for AI processing
node src/scripts/maintenance/check-db.js              # Check database integrity
node src/scripts/maintenance/check-ai-data.js         # Check AI processing status

# LinkedIn executive scraper
node src/scripts/runners/run-executives-scraper.js    # Scrape executives for all WordPress sites

# Setup scripts
node src/scripts/setup/setup-linkedin-credentials.js  # Initialize LinkedIn credentials table
node src/scripts/setup/setup-email-system.js          # Initialize email tables
```

## Architecture

### Project Structure

```
src/
├── api/
│   └── server.js                    # Express server (port 8080), serves admin panel
├── database/
│   ├── database.js                  # SQLite wrapper with singleton pattern
│   └── migrations/                  # Database migration scripts
├── scrapers/
│   ├── wordpress-detector.js        # Google scraper + WordPress detection
│   ├── linkedin-company-scraper.js  # LinkedIn executive scraper
│   └── linkedin-credentials-api.js  # LinkedIn credentials management
├── services/
│   ├── ai/
│   │   ├── ai-client.js             # OpenRouter AI client (single integration point)
│   │   ├── ai-processor.js          # Background worker for AI processing (30s polling)
│   │   └── ai-retry-manager.js      # Retry failed AI requests
│   └── email/
│       ├── email-queue-worker.js    # Queue processing with round-robin distribution
│       └── email-senders-templates-api.js  # Email campaign & template management
├── scripts/
│   ├── maintenance/                 # Database checks and utilities
│   ├── queueing/                    # Queue management scripts
│   ├── runners/                     # Execution scripts (view results, run scraper)
│   └── setup/                       # Database setup scripts
└── utils/
    └── system-logger.js             # Centralized logging with categorization
public/
└── index.html                       # Admin panel UI (single-page app)
```

### Core Components

#### 1. **Server (`src/api/server.js`)**
- Express server on port 8080
- Serves admin panel UI from `public/index.html`
- Starts AI processor and AI retry manager automatically on startup
- Uses persistent browser context at `C:\automation_chrome`
- REST API endpoints for keywords, sites, LinkedIn, email management

#### 2. **WordPress Detector (`src/scrapers/wordpress-detector.js`)**
- Uses Playwright with persistent Chromium context
- Searches Google, extracts top 10 results
- Visits each URL and detects WordPress by checking:
  - `/wp-content/`, `/wp-includes/`, `/wp-json/` URLs
  - WordPress meta generator tags
  - WordPress-specific CSS classes and scripts
- Extracts: emails, phones, LinkedIn profiles, page text content
- Saves to `sites` table with `ai_status='pending'` for WordPress sites

#### 3. **Database (`src/database/database.js`)**
- SQLite wrapper using `better-sqlite3`
- Singleton pattern: `getSharedDb()` for persistent connections
- Exports both `getSharedDb()` and convenience functions: `run()`, `all()`, `get()`, `prepare()`
- Database location: `wordpress-detector.db` in project root
- Auto-migration: adds columns if missing on initialization

#### 4. **AI Client (`src/services/ai/ai-client.js`)**
- **Single integration point** for all AI operations
- Uses OpenRouter API with `OPENROUTER_API_KEY` from `.env`
- Default model: `openai/gpt-4o-mini` (configurable via `OPENROUTER_MODEL`)
- Two focused tasks:
  1. **WordPress Verification**: Confirms if site is actually WordPress
  2. **Content Relevance Check**: Verifies if content matches search keyword intent
- Enforced JSON schema for responses
- Tracks stats: total requests, tokens used, errors

#### 5. **AI Processor (`src/services/ai/ai-processor.js`)**
- Background worker, auto-starts with server
- Polls every 30 seconds for pending sites (`is_wordpress=1 AND ai_status='pending'`)
- Processes in batches of 5 sites with 2-second delays
- Pre-filter: validates keyword presence in metadata before calling AI (saves API costs)
- Updates sites with: `ai_status`, `ai_content_relevant`, `ai_actual_category`, `ai_content_summary`

#### 6. **AI Retry Manager (`src/services/ai/ai-retry-manager.js`)**
- Retries failed AI requests (status='failed')
- Exponential backoff: 1min, 5min, 15min, 1hr, 3hr
- Max 5 retry attempts per site
- Stops retrying after 5 failures

#### 7. **LinkedIn Company Scraper (`src/scrapers/linkedin-company-scraper.js`)**
- Uses same persistent browser context as WordPress detector
- Requires active credential in `linkedin_credentials` table
- Extracts executives grouped into fixed slots:
  - Founder 1, Founder 2, Founder 3 (prioritizes founder > co-founder > owner)
  - CEO, CTO
- Handles 2FA/checkpoints with error messages and manual login instructions
- Saves to `company_executives` table

#### 8. **Email Queue System (`src/services/email/`)**
- **email-queue-worker.js**: Processes queued emails every 30 seconds
  - Round-robin distribution across active sender accounts
  - Respects daily limits per sender
  - Retry logic with attempt counting
- **email-senders-templates-api.js**: Manages senders, templates, campaigns
  - Multiple sender accounts with daily limits
  - HTML email templates with variable replacement
  - Campaign management with bulk queueing

#### 9. **System Logger (`src/utils/system-logger.js`)**
- Centralized logging with categorization
- Intercepts console output to capture all logs
- Stores last 1000 logs in memory
- Categories: info, success, warning, error, ai, scraper, email, linkedin, retry, system
- Provides API endpoint for UI log streaming

### Database Tables

- **`searches`** - Search runs (query, country, counts, timestamp)
- **`sites`** - Site checks (WordPress detection, contacts, AI analysis)
- **`keywords`** - Keyword management (status, max_sites setting)
- **`contacts`** - Unified contact storage (email, phone, LinkedIn types)
- **`company_executives`** - LinkedIn scraped executives (name, headline, role_category)
- **`excluded_domains`** - Domain-level blocking rules
- **`ignored_tags`** - Tag-based filtering (match_type, scope)
- **`linkedin_credentials`** - LinkedIn accounts (single-active enforcement)
- **`email_senders`** - Email accounts for sending
- **`email_templates`** - Email templates with HTML content
- **`email_campaigns`** - Email campaigns targeting sites
- **`email_queue`** - Queued emails with status tracking
- **`email_send_log`** - Email sending history

## Key Implementation Details

### Database Access Patterns

**Two patterns exist in the codebase:**

1. **Singleton Pattern** (used by email modules):
   ```javascript
   const db = require('../database/database.js');
   // Direct wrapper calls: db.run(), db.all(), db.get(), db.prepare()
   // Uses getSharedDb() internally - keeps persistent connection
   ```

2. **initDatabase() Pattern** (used by most other modules):
   ```javascript
   const { initDatabase } = require('../database/database.js');
   const db = initDatabase();
   // Opens new connection - remember to close() when done
   ```

**Why this matters**: Email modules use singleton to keep connection alive for queue worker. Other modules open/close connections per operation.

### URL Normalization & Duplicate Detection

- URLs are normalized before storage to detect duplicates
- Normalization removes: protocol, www, trailing slash, hash fragments, tracking params (utm_*, gclid, etc.)
- Use `urlExists()` or `getAllExistingUrls()` before adding new sites

### WordPress Detection

Checks for these indicators in page HTML:
- `/wp-content/`, `/wp-includes/`, `/wp-json/` URLs
- WordPress meta generator tags
- WordPress-specific CSS classes and scripts
- Multiple indicators increase confidence score

### Browser Persistence

- Uses `C:\automation_chrome` for persistent context
- Saves cookies/sessions (avoids CAPTCHAs on repeated runs)
- Chrome executable: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- Anti-detection scripts injected to avoid bot detection
- Shared between WordPress detector and LinkedIn scraper

### AI Processing Flow

1. Scraper marks sites with `is_wordpress=1` and `ai_status='pending'`
2. AI processor polls for pending sites every 30 seconds
3. **Pre-filter**: Checks keyword presence in metadata (saves API costs)
4. For each site, runs AI analysis for content relevance
5. Updates site with: `ai_status`, `ai_content_relevant`, `ai_actual_category`, `ai_content_summary`
6. Failed sites retried by AI retry manager with exponential backoff

### LinkedIn Credentials Management

- Credentials stored in `linkedin_credentials` table
- Single-active enforcement (only one credential active at a time)
- UI toggle switches for easy account switching
- Tracks `last_used` timestamp for each credential
- First-time setup: Add via admin panel at `http://localhost:8080` → LinkedIn tab

### Filtering System

- **Excluded Domains**: Domain-level blocking (e.g., `youtube.com` blocks all subdomains)
- **Ignored Tags**: Tag-based filtering with match types (contains, exact, regex)
- Both managed via admin panel UI

### Company Executives Structure

- LinkedIn scraper extracts executives grouped into fixed slots:
  - Founder 1, Founder 2, Founder 3 (founder > co-founder > owner priority)
  - CEO, CTO
- Stored in `company_executives` table with role categories

### Email Queue Worker

- Checks for queued emails every 30 seconds
- Round-robin distribution across active sender accounts
- Respects daily limits per sender
- Retry logic with attempt counting

## Environment Variables

Required in `.env`:
```env
# AI (required for content verification)
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=openai/gpt-4o-mini  # Optional, default

# Email (optional, for Gmail SMTP)
GMAIL_USER=your@gmail.com
GMAIL_APP_PASSWORD=your_app_password
```

## Frontend

Admin panel served from `public/index.html`:
- Single-page application with all UI
- Dashboard for keywords and results
- Email manager for campaigns
- LinkedIn credentials management
- System console for log viewing
- All API calls go to `/api/*` endpoints

## Important Notes

### Runtime Behavior
- Browser context shared between WordPress detector and LinkedIn scraper
- Always check if page/context is still valid before scraping
- AI processor only processes sites where `text_content` is not empty
- Email worker uses `getSharedDb()` which keeps persistent connection
- Database migrations handled automatically (columns added if missing)
- Country code defaults to `'in'` for searches

### When Adding Features
- Check if similar functionality already exists
- Use existing patterns (database helpers, scraper patterns)
- Consider database schema changes
- Think about admin panel UI integration

### When Modifying Scrapers
- Test with real websites (selectors break frequently)
- Add delays between requests to avoid rate limiting
- Handle popups, cookie banners, dynamic content
- Log useful info for debugging (URLs, selectors, errors)
- **LinkedIn scraper**: Requires active credential in database
- **LinkedIn scraper**: Handles 2FA/checkpoints with error messages

### When Working with Database
- Use prepared statements (pattern exists in codebase)
- Close database connections when done (see `ai-processor.js` pattern)
- Consider data migration when changing schema
- Test queries before production use

### When Updating AI Features
- AI processor runs as background worker - changes affect running process
- `ai-client.js` uses OpenRouter API with JSON response format
- Two main AI tasks: WordPress verification, content relevance check
- Predefined categories enforced in prompt
- Track token usage via `aiClient.getStats()`
- Handle failures gracefully (retry, fallback, mark as failed)

### AI Prompt Engineering

Prompts defined in `ai-client.js`:
- STRICT relevance rules: blog posts ≠ service providers
- Examples in prompt guide AI decisions
- JSON schema enforced via OpenRouter's response_format
- Pre-filter checks keyword presence before calling AI (cost saving)

## Development Workflow

Before making changes:

1. **Read existing code** - Understand the module and its dependencies
2. **Check database schema** - Look at `database.js` for table structures
3. **Review related files** - Don't change in isolation
4. **Plan your approach** - Consider scalability, maintainability, performance
5. **Ask if uncertain** - Clarify before implementing
6. **Get approval** - Present plan and wait for user confirmation

### Red Flags - Stop and Ask
- Changing database schema without migration script
- Modifying browser context configuration
- Changing AI processing logic
- Altering email queue logic
- Removing "seemingly unused" code
- Changes affecting multiple modules simultaneously
