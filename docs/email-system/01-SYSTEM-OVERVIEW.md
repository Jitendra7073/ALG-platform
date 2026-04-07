# Email System - Complete Overview

## Executive Summary

A timezone-aware, dependency-based email outreach system with template groups, intelligent scheduling, and real-time management.

## Core Architecture

### Technology Stack
- **Frontend**: Next.js 15 (App Router) + ShadCN UI + Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL)
- **Email**: Nodemailer (SMTP)
- **Deployment**: Vercel with cron jobs
- **Database Location**: Cloud (Supabase) - completely decoupled from local SQLite

### Key Principles

1. **Idempotent Sync**: No duplicate data during synchronization
2. **Timezone-Aware**: All scheduling respects recipient's local business hours
3. **Dependency Chain**: Sequential email dependencies
4. **Real-Time Control**: Live status updates and actions
5. **Template Groups**: Many-to-many relationship between templates and groups

## System Components

### 1. Template Management System

#### Template Groups
- Groups organize templates into campaigns (e.g., "coupon", "newsletter", "welcome")
- Templates can belong to multiple groups (many-to-many)
- Each group has its own email sequence with positions (1, 2, 3, 4...)
- Each position has configurable gaps (days + hours + minutes + specific time)

#### Templates
- Email templates with subject, HTML content, text content
- Can be reused across multiple groups
- Template updates propagate to pending queued emails
- Version tracking for changes

### 2. Contact Management

- Contact sources:
  - Scraped from websites (stored in local SQLite `contacts` table)
  - Manual addition
  - Import from CSV
- Sync contacts to Supabase (idempotent - no duplicates)
- Country/region tracking for timezone scheduling

### 3. Sender Account Management

- Multiple SMTP sender accounts
- Daily sending limits per sender
- Round-robin distribution across active senders
- Sender health tracking (success rates, bounce rates)
- Automatic sender rotation on limits

### 4. Campaign Management

#### Campaign Creation Flow
1. Select contacts (checkbox selection)
2. Select template group (opens modal with all groups)
3. Queue creation begins

#### Queue Processing
- Sequential dependency chain: Email #2 waits for Email #1
- If Email #1 fails, all subsequent emails in chain fail
- Timezone-aware scheduling:
  - Check recipient's country timezone
  - Only send during business hours (9 AM - 6 PM recipient time)
  - Automatically avoid weekends
  - Schedule for next business day if current time is inappropriate
- Round-robin sender selection
- Respect daily sender limits

### 5. Timezone-Aware Scheduling

#### Business Hours Logic
```
For each email in queue:
  1. Get recipient's country/region
  2. Lookup timezone for that country
  3. Convert scheduled time to recipient's local time
  4. Check if within business hours (9 AM - 6 PM)
  5. Check if weekend (Saturday/Sunday)
  6. Adjust if needed:
     - If weekend: Schedule to next Monday 9 AM
     - If outside business hours: Schedule to next business day 9 AM
  8. Show timezone conversion: "Your time: 9:00 AM IST → Recipient time: 10:30 PM EST (next day)"
```

#### Example Scenario
```
Sender: India (IST)
Recipient: New York, US (EST)
Current Time: Monday 9:00 AM IST

Email 1 (Welcome):
  - IST: Monday 9:00 AM
  - EST: Sunday 11:30 PM ❌ (weekend + night)
  - Adjusted: Tuesday 9:00 AM EST = Tuesday 6:30 PM IST
  - Display: "Sending Tuesday 6:30 PM your time (9:00 AM recipient time)"

Email 2 (Follow-up):
  - Gap: 2 days + 10:30 AM
  - EST: Thursday 10:30 AM
  - IST: Thursday 8:00 PM
  - Display: "Sending Thursday 8:00 PM your time (10:30 AM recipient time)"
```

### 6. Real-Time Status Dashboard

#### Email Status Display
For each email in queue, show:
- Status badge (pending, scheduled, sent, failed, cancelled)
- Recipient email
- Template name
- Position in sequence
- Scheduled time (with timezone conversion)
- Sender account
- Dependency status (waiting for previous email)
- Action buttons

#### Real-Time Actions
- **Send Now**: Bypass schedule, send immediately
- **Resend**: Retry failed email
- **Cancel**: Cancel scheduled email
- **Pause**: Pause email (don't send, keep in queue)
- **Delete**: Remove email from queue

### 7. Duplicate Prevention

#### Scenario: Multiple Campaigns
```
User wants to send "coupon" group to john@example.com
  → Check if john@example.com has active "coupon" campaign
  → If yes: Show warning "Active coupon campaign in progress for this contact"
  → Option: Wait for current campaign to complete
  → Option: Cancel current campaign and start new one
```

#### Rule
- Cannot send same template group to same contact until previous campaign completes or is cancelled
- Prevents overwhelming contacts with duplicate campaigns

### 8. Template Editing Behavior

#### Template Update Flow
```
User edits template:
  1. Update template in database
  2. Find all pending queued emails using this template
  3. Update those emails with new template content
  4. Already sent emails remain unchanged
  5. Show count: "Updated X pending emails"
```

#### Example
```
Template "Welcome Email" edited:
  - Email #1 (pending): Updated with new content ✅
  - Email #1 (sent): Remains unchanged ✅
  - Email #2 (pending): Updated with new content ✅
  - Email #2 (sent): Remains unchanged ✅
```

## Database Migration Strategy

### From Local SQLite to Supabase

#### Phase 1: Schema Creation
- Create all tables in Supabase
- Set up relationships and constraints
- Configure RLS (Row Level Security)

#### Phase 2: Contact Synchronization
- One-time sync from SQLite contacts table to Supabase
- Idempotent sync: Check UUID before insert
- Map local IDs to Supabase UUIDs
- Store mapping for future syncs

#### Phase 3: Incremental Sync
- Sync new contacts added daily
- Check existing UUIDs to prevent duplicates
- Update changed contact information

#### Phase 4: Email System Isolation
- Email system operates entirely on Supabase
- Local SQLite continues for scraping/WordPress detection
- No overlap between systems

## API Architecture

### Next.js API Routes Structure
```
/api/email-system/
  ├── senders/           # CRUD for sender accounts
  ├── templates/         # CRUD for templates
  ├── template-groups/   # CRUD for template groups
  ├── contacts/          # Contact sync from SQLite
  ├── campaigns/         # Campaign management
  ├── queue/             # Queue operations
  ├── schedule/          # Timezone-aware scheduling
  └── status/            # Real-time status updates
```

### Vercel Cron Jobs
```
Every 5 minutes: Process email queue
Every hour: Check for pending scheduled emails
Every 6 hours: Sync new contacts from SQLite
Daily at midnight: Reset sender daily counters
```

## Security Considerations

### Email Credentials
- SMTP credentials stored encrypted in Supabase
- Only accessible via server-side API routes
- Never exposed to client

### API Authentication
- Supabase RLS policies
- API route protection with session tokens
- Rate limiting on email sending endpoints

### Data Privacy
- GDPR compliance: Right to deletion
- Contact data encryption at rest
- Secure SMTP connections (TLS)

## Performance Optimization

### Queue Processing
- Batch processing: 50 emails per cron job
- Parallel processing: 5 concurrent senders
- Retry queue: Separate process for failed emails

### Database Queries
- Indexed fields: status, scheduled_at, sender_id
- Prepared statements for all queries
- Connection pooling via Supabase

### Email Sending
- Connection pooling for SMTP
- Rate limiting per sender
- Queue prioritization: urgent emails first

## Monitoring & Logging

### Metrics to Track
- Email send success rate
- Email open rate (if tracking enabled)
- Click-through rate (if tracking enabled)
- Bounce rate per sender
- Queue processing time
- API response times

### Alerts
- High bounce rate (>10%): Alert admin
- Sender limit reached: Notify
- Queue backlog (>1000): Alert
- API error rate (>5%): Alert

## Next Steps

1. **Phase 1**: Database schema setup in Supabase
2. **Phase 2**: Contact sync infrastructure
3. **Phase 3**: Template & group management UI
4. **Phase 4**: Queue processing system
5. **Phase 5**: Timezone-aware scheduling
6. **Phase 6**: Real-time dashboard
7. **Phase 7**: Testing & deployment
