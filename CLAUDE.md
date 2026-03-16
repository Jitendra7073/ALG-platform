# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **lead generation and outreach automation system** that:
1. Searches Google for keywords and detects WordPress sites
2. Extracts contact information (emails, phones, LinkedIn) from websites
3. Scrapes LinkedIn company pages for executive information
4. Uses AI to verify content relevance and generate summaries
5. Provides an email queue system with templates for automated outreach

All data is stored in a SQLite database (`wordpress-detector.db`) and managed via a web admin panel.

## Development Workflow (CRITICAL - READ FIRST)

Before making ANY changes to this codebase, follow this process:

### Phase 1: Explore & Understand
1. **Read existing code** - Use `Read` tool to examine the feature/module you'll modify
2. **Understand the architecture** - How does it connect to other parts?
3. **Check database schema** - Look at `database.js` for table structures
4. **Review related files** - Don't change in isolation - understand dependencies

### Phase 2: Research & Plan
1. **Think like an expert** - Consider scalability, maintainability, performance
2. **Check modern best practices** - Is there a better way to do this in 2026?
3. **Create a comprehensive plan** - Document:
   - What exactly will change
   - Why this approach (modernization benefits)
   - Potential risks and mitigations
   - Backward compatibility considerations
   - Testing approach

### Phase 3: Ask Questions (If Uncertain)
Before implementation, clarify:
- "I see X behavior - is this intentional or should I change it?"
- "Feature Y could be modernized using Z pattern - should I proceed?"
- "This change affects module A - should I update that too?"
- "Database migration needed for this change?"

### Phase 4: Get Approval
**ALWAYS present your plan and wait for user approval before implementing.**
- Show what you'll change
- Explain the benefits
- Highlight any risks
- **DO NOT proceed until user says "yes" or "go ahead"**

### Phase 5: Implementation
After approval:
1. Make changes incrementally
2. Test after each significant change
3. Update documentation (CLAUDE.md, comments)
4. Handle edge cases

### What "Modern & Knowledgeable" Means Here
- **Async/await** over callbacks
- **ES6+ features** when they improve readability
- **Proper error handling** - try/catch, meaningful error messages
- **Database safety** - prepared statements, transactions when needed
- **Rate limiting** - respect API limits, use delays between requests
- **Browser automation best practices** - anti-detection, session persistence
- **Security** - no hardcoded credentials, validate inputs
- **Logging** - useful console output for debugging

### Red Flags - Stop and Ask
- Changing the database schema without migration script
- Modifying the browser context configuration
- Changing how AI processing works
- Altering email queue logic
- Removing "seemingly unused" code (it might be used elsewhere)
- Changes that affect multiple modules simultaneously

## Development Commands

```bash
# Start the admin panel (runs on port 8080)
npm run admin
# or
node server.js

# Run WordPress detector directly (searches Google for given keyword)
npm start               # Uses default query
node wordpress-detector.js "your search query"

# View saved results
npm run list            # List all searches
npm run view <id>       # View details of specific search
npm run wordpress       # Show all WordPress sites found
npm run stats           # View overall statistics
npm run export          # Export data to JSON

# Run LinkedIn executive scraper
node run-executives-scraper.js

# Database utilities
node reset-db.js        # Clear and reset database
node migrate-ai-fields.js # Migrate database for AI fields
node queue-pending-ai.js # Manually queue sites for AI processing

# Email system setup
node setup-email-system.js # Initialize email tables
```

## Architecture

### Core Components

1. **`server.js`** - Express server providing REST API and serving admin panel UI
   - Port 8080 (not 3000 as some docs say)
   - Uses persistent browser context at `C:\automation_chrome`
   - Starts AI processor worker automatically on startup

2. **`wordpress-detector.js`** - Main Google scraper
   - Uses Playwright with Chromium (persistent context)
   - Searches Google, visits URLs, detects WordPress
   - Extracts contact info, emails, phones, LinkedIn URLs
   - Saves to `sites` table in database

3. **`database.js`** - SQLite wrapper using better-sqlite3
   - Singleton pattern with `getSharedDb()` for email modules
   - Provides `run()`, `all()`, `get()`, `prepare()` functions
   - Database location: `wordpress-detector.db` in project root

4. **`ai-client.js`** - OpenRouter-based AI client
   - Single integration point for AI operations
   - Verifies WordPress detection and checks content relevance
   - Uses `OPENROUTER_API_KEY` from `.env`

5. **`ai-processor.js`** - Background worker for AI processing
   - Auto-polls every 30 seconds for pending sites
   - Processes WordPress sites (`is_wordpress=1`) with `ai_status='pending'`
   - Batch size of 5 sites with 2-second delays between sites

6. **`linkedin-company-scraper.js`** - LinkedIn executive scraper
   - Uses same persistent browser context as WordPress detector
   - Scrapes employee information from company pages
   - Saves to database with executive details

7. **Email System** (`email-queue-worker.js`, `email-senders-templates-api.js`)
   - Queue-based email sending with multiple sender accounts
   - Round-robin distribution across senders
   - Template system with HTML support
   - Campaign management

### Database Tables

- **`searches`** - Tracks each search run (query, counts, timestamp)
- **`sites`** - Individual site checks (WordPress detection, contacts, AI analysis)
- **`email_senders`** - Email accounts for sending
- **`email_templates`** - Email templates with HTML content
- **`email_campaigns`** - Email campaigns targeting sites
- **`email_queue`** - Queued emails with status tracking

## Key Implementation Details

### WordPress Detection
Checks for these indicators in page HTML:
- `/wp-content/`, `/wp-includes/`, `/wp-json/` URLs
- WordPress meta generator tags
- WordPress-specific CSS classes and scripts

### Browser Persistence
- Uses `C:\automation_chrome` for persistent context
- Saves cookies/sessions (avoids CAPTCHAs on repeated runs)
- Chrome executable path: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- Anti-detection scripts injected to avoid bot detection

### AI Processing Flow
1. Scraper marks sites with `is_wordpress=1` and `ai_status='pending'`
2. AI processor polls for pending sites every 30 seconds
3. For each site, runs AI analysis for content relevance
4. Updates site with: `ai_status`, `ai_content_relevant`, `ai_actual_category`, `ai_content_summary`

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

Admin panel served from `public/` directory:
- `index.html` - Main dashboard for keywords and results
- `email-manager.html` - Email campaign management
- All API calls go to `/api/*` endpoints on `server.js`

## Important Notes

### Runtime Behavior
- The browser context is shared between WordPress detector and LinkedIn scraper
- Always check if page/context is still valid before scraping (handles browser crashes)
- AI processor only processes sites where `text_content` is not empty
- Email worker uses `getSharedDb()` which keeps a persistent connection
- Database migrations may be needed after code updates (see `migrate-ai-fields.js`)

### When Adding Features
- Check if similar functionality already exists before creating new code
- Use existing patterns (e.g., database helpers, scraper patterns)
- Consider if the feature needs database schema changes
- Think about how it will work in the admin panel UI

### When Modifying Scrapers
- Test with real websites - selectors break frequently
- Add delays between requests to avoid rate limiting
- Handle popups, cookie banners, and dynamic content
- Log useful info for debugging (URLs, selectors found, errors)

### When Working with Database
- Use prepared statements (already pattern in codebase)
- Close database connections when done (see pattern in `ai-processor.js`)
- Consider data migration when changing schema
- Test queries work before putting them in production code

### When Updating AI Features
- AI processor runs as background worker - changes affect running process
- Prompt engineering matters - test prompts with real data
- Track token usage and costs
- Handle AI failures gracefully (retry, fallback, mark as failed)
