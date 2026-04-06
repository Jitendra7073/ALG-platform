# Decoupled Email System Architecture
## Production-Ready Email Delivery System Design

**Version:** 1.0
**Date:** 2026-04-06
**Status:** Design Document

---

## 1. System Understanding Summary

### 1.1 Current System Architecture

The existing lead generation system consists of:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Scraper Backend** | Node.js + Playwright | Google scraping, WordPress detection, contact extraction |
| **Database** | SQLite (better-sqlite3) | All data persistence |
| **Email Worker** | Node.js (polling-based) | 30-second interval queue processing |
| **Timezone Engine** | Node.js (Intl API) | Business hours validation |
| **Admin Panel** | Express + Vanilla JS | Single-page HTML dashboard |

### 1.2 Database Schema Analysis

#### Core Tables (Read-Only for New System)

| Table | Purpose | Access Pattern |
|-------|---------|----------------|
| `sites` | Website data with AI analysis | READ ONLY |
| `contacts` | Extracted emails/phones/LinkedIn | READ ONLY |
| `company_executives` | LinkedIn scraped executives | READ ONLY |
| `searches` | Search run metadata | READ ONLY |
| `keywords` | Keyword management | READ ONLY |

#### Email Tables (Read + Write for New System)

| Table | Purpose | Access Pattern |
|-------|---------|----------------|
| `email_senders` | Email accounts for sending | READ + WRITE |
| `email_templates` | Email templates with variables | READ + WRITE |
| `email_campaigns` | Campaign grouping | READ + WRITE |
| `email_queue` | Email sending queue | READ + WRITE |
| `email_send_log` | Send history per contact | READ + WRITE |
| `email_settings` | System configuration | READ + WRITE |
| `country_timezones` | Timezone/biz-hours config | READ + WRITE |

### 1.3 Current Email Flow

```
┌─────────────────┐
│  Admin Panel    │
│  (Select leads) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│         Add to Queue API                 │
│  - Creates email_queue records           │
│  - Sets scheduled_at via timezone logic  │
│  - Assigns sequence_position             │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│      Email Queue Worker (Polling)        │
│  - Runs every 30 seconds                 │
│  - Prioritizes countries in business hrs │
│  - Round-robin sender distribution       │
│  - Validates scheduled times             │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│         Nodemailer Send                  │
│  - Variable replacement                  │
│  - SMTP delivery                         │
│  - Status updates                        │
└─────────────────────────────────────────┘
```

### 1.4 Tag & Sequence System

**Tags** group emails into sequences:
- Templates have `tags` field (e.g., "coupon", "marketing")
- Each tag has multiple templates (main + follow-ups)
- `sequence_number` defines order within tag
- Queue items reference `tag` and `sequence_position`

**Follow-up Gaps:**
- Stored in `email_settings` as `followup_gap_N`
- Default: gap_1=2 days, gap_2+=5 days
- Calendar days used, then adjusted to business hours

---

## 2. Issues in Current System

### 2.1 Critical Problems

| Issue | Impact | Root Cause |
|-------|--------|------------|
| **Not Deployable** | Cannot host on Vercel/Cloud | Playwright dependency |
| **Tight Coupling** | Email requires scraper backend | Shared codebase |
| **Polling Inefficiency** | 30s delay, wasted resources | setInterval-based worker |
| **SQLite Limitations** | No concurrent writes, poor scaling | File-based database |
| **No Job Queue** | No priorities, dead letters, retries | Direct table polling |
| **Single Instance** | No horizontal scaling | In-memory state |

### 2.2 Reliability Issues

| Issue | Description |
|-------|-------------|
| **Race Conditions** | Multiple workers can claim same email |
| **No Idempotency** | Duplicate sends possible on restart |
| **Memory Leaks** | Singleton connections not closed |
| **Error Recovery** | Manual intervention needed for failures |
| **No Monitoring** | Limited visibility into operations |

### 2.3 Sequence Logic Bugs Found

```javascript
// BUG 1: Sequence scheduling doesn't verify previous email actually sent
// In email-queue-worker.js line 54-69
if (email.tag && email.sequence_position > 1) {
    const previousEmail = db.get(`... AND status = 'sent' ...`);
    if (!previousEmail) {
        return false; // GOOD - but only checks DB, not in-flight sends
    }
}

// BUG 2: Timezone validation runs AFTER scheduling, causing double work
// validateScheduledTime() can reschedule, wasting processing

// BUG 3: Weekend calculation uses string matching instead of day index
// timezone-scheduler.js line 156-168
const dayString = dayFormatter.format(date).toLowerCase();
// Fragile - depends on locale formatting
```

---

## 3. New Architecture (High-Level)

### 3.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        NEW DECOUPLED SYSTEM                         │
│                    (Next.js + Vercel Deployable)                    │
└─────────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ Next.js App  │      │  API Routes  │      │ Background   │
│ (Frontend)   │      │  (Serverless)│      │ Worker       │
│              │      │              │      │ (Container)  │
│ - Dashboard  │      │ - Queue API  │      │ - BullMQ     │
│ - Templates  │      │ - Sender API │      │ - Redis      │
│ - Campaigns  │      │ - Stats API  │      │ - Cron Jobs  │
└──────────────┘      └──────┬───────┘      └──────┬───────┘
                              │                     │
                              └──────────┬──────────┘
                                         │
                                         ▼
                              ┌──────────────────┐
                              │  Shared SQLite   │
                              │  (Existing DB)   │
                              │  - sites         │
                              │  - contacts      │
                              │  - email_*       │
                              └──────────────────┘
```

### 3.2 Component Responsibilities

| Component | Technology | Responsibility |
|-----------|-----------|----------------|
| **Frontend** | Next.js 14 (App Router) + ShadCN | Admin dashboard, real-time updates |
| **API Layer** | Next.js Route Handlers | REST endpoints, validation |
| **Queue System** | BullMQ + Redis (Upstash) | Job processing, retries, scheduling |
| **Worker Service** | Node.js + Bull Board | Queue consumer, email sending |
| **Database** | Turso (libSQL) or SQLite | Data persistence |
| **Email Provider** | Resend/SendGrid | Actual email delivery |

### 3.3 Data Flow Diagram

```
┌──────────────┐
│   User UI    │
│  (Next.js)   │
└──────┬───────┘
       │ 1. Select Leads
       ▼
┌──────────────────────────────────────┐
│      API: POST /api/queue/add        │
│  - Validates input                   │
│  - Creates email_queue records       │
│  - Adds BullMQ jobs                  │
└──────┬───────────────────────────────┘
       │ 2. Job Created
       ▼
┌──────────────────────────────────────┐
│         BullMQ Queue (Redis)         │
│  - Priority by timezone              │
│  - Scheduled jobs                    │
│  - Retry configuration               │
└──────┬───────────────────────────────┘
       │ 3. Worker Polls
       ▼
┌──────────────────────────────────────┐
│      Worker Service                  │
│  - Processes jobs                    │
│  - Validates business hours          │
│  - Sends via email provider          │
│  - Updates status                    │
└──────┬───────────────────────────────┘
       │ 4. Status Update
       ▼
┌──────────────────────────────────────┐
│      Database + UI Update            │
│  - email_queue updated               │
│  - email_send_log updated            │
│  - Real-time UI notification         │
└──────────────────────────────────────┘
```

---

## 4. Backend Design (Detailed)

### 4.1 Project Structure

```
email-system/
├── app/
│   ├── (dashboard)/
│   │   ├── layout.tsx          # Dashboard layout
│   │   ├── page.tsx            # Main dashboard
│   │   ├── leads/
│   │   │   └── page.tsx        # Lead management
│   │   ├── queue/
│   │   │   └── page.tsx        # Queue monitoring
│   │   ├── templates/
│   │   │   ├── page.tsx        # Template list
│   │   │   └── [id]/page.tsx   # Template editor
│   │   ├── campaigns/
│   │   │   └── page.tsx        # Campaign management
│   │   └── settings/
│   │       └── page.tsx        # System settings
│   ├── api/
│   │   ├── queue/
│   │   │   ├── route.ts        # Queue CRUD
│   │   │   ├── trigger/route.ts
│   │   │   └── stats/route.ts
│   │   ├── senders/
│   │   │   └── route.ts
│   │   ├── templates/
│   │   │   └── route.ts
│   │   ├── campaigns/
│   │   │   └── route.ts
│   │   └── workers/
│   │       └── route.ts        # Worker control
│   └── layout.tsx
├── lib/
│   ├── db/
│   │   ├── schema.ts           # Database schema types
│   │   ├── queries.ts          # SQL query functions
│   │   └── migrations.ts       # Migration scripts
│   ├── queue/
│   │   ├── client.ts           # BullMQ client setup
│   │   ├── processors.ts       # Job processors
│   │   └── types.ts            # Queue job types
│   ├── email/
│   │   ├── provider.ts         # Email provider (Resend/SendGrid)
│   │   ├── templates.ts        # Template engine
│   │   └── validation.ts       # Email validation
│   ├── timezone/
│   │   ├── business-hours.ts   # Business hours logic
│   │   ├── scheduler.ts        # Follow-up scheduling
│   │   └── countries.ts        # Country timezone data
│   └── utils/
│       ├── logger.ts           # Structured logging
│       ├── metrics.ts          # Performance metrics
│       └── errors.ts           # Error handling
├── workers/
│   ├── email-worker.ts         # Main email worker
│   ├── scheduler-worker.ts     # Follow-up scheduler
│   └── health-worker.ts        # Health check worker
├── components/
│   ├── ui/                     # ShadCN components
│   ├── dashboard/
│   ├── leads/
│   ├── queue/
│   └── templates/
└── package.json
```

### 4.2 Database Layer

#### Connection Strategy

```typescript
// lib/db/client.ts
import { Database } from 'better-sqlite3';
import path from 'path';

// Path to existing database
const DB_PATH = process.env.DATABASE_PATH ||
  path.join(process.cwd(), '../../../wordpress-detector.db');

// Singleton connection
let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

// Prepared statement cache
const statementCache = new Map<string, Database.Statement>();

export function prepare(sql: string): Database.Statement {
  if (!statementCache.has(sql)) {
    statementCache.set(sql, getDb().prepare(sql));
  }
  return statementCache.get(sql)!;
}
```

#### Query Functions

```typescript
// lib/db/queries.ts
import { prepare } from './client';
import type { QueueItem, Contact, Site, EmailTemplate, EmailSender } from './schema';

export const queries = {
  // Queue operations
  queue: {
    create: (item: Omit<QueueItem, 'id'>) => {
      const stmt = prepare(`
        INSERT INTO email_queue (
          campaign_id, sender_id, recipient_email, recipient_name,
          subject, html_content, text_content, status, scheduled_at,
          contact_id, tag, sequence_position, country_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      return stmt.run(
        item.campaign_id,
        item.sender_id,
        item.recipient_email,
        item.recipient_name,
        item.subject,
        item.html_content,
        item.text_content,
        item.status || 'queued',
        item.scheduled_at,
        item.contact_id,
        item.tag,
        item.sequence_position,
        item.country_code
      );
    },

    getById: (id: number) => {
      const stmt = prepare('SELECT * FROM email_queue WHERE id = ?');
      return stmt.get(id) as QueueItem | undefined;
    },

    updateStatus: (id: number, status: string, metadata?: { sent_at?: string; error_message?: string; sender_id?: number }) => {
      const fields = ['status = ?'];
      const values: any[] = [status];

      if (metadata?.sent_at) {
        fields.push('sent_at = ?');
        values.push(metadata.sent_at);
      }
      if (metadata?.error_message !== undefined) {
        fields.push('error_message = ?');
        values.push(metadata.error_message);
      }
      if (metadata?.sender_id !== undefined) {
        fields.push('sender_id = ?');
        values.push(metadata.sender_id);
      }

      fields.push('attempts = attempts + 1');
      values.push(id);

      const stmt = prepare(`UPDATE email_queue SET ${fields.join(', ')} WHERE id = ?`);
      return stmt.run(...values);
    },

    getPendingForCountry: (countryCode: string, limit: number = 50) => {
      const stmt = prepare(`
        SELECT eq.* FROM email_queue eq
        LEFT JOIN contacts c ON eq.contact_id = c.id
        LEFT JOIN sites s ON c.site_id = s.id
        WHERE eq.status = 'queued'
          AND eq.scheduled_at <= datetime('now')
          AND (s.country = ? OR eq.country_code = ?)
        ORDER BY eq.created_at ASC
        LIMIT ?
      `);
      return stmt.all(countryCode.toUpperCase(), countryCode.toUpperCase(), limit) as QueueItem[];
    },

    getDueCount: () => {
      const stmt = prepare(`
        SELECT COUNT(*) as count FROM email_queue
        WHERE status = 'queued' AND scheduled_at <= datetime('now')
      `);
      return (stmt.get() as { count: number }).count;
    }
  },

  // Contact operations
  contacts: {
    getById: (id: number) => {
      const stmt = prepare(`
        SELECT c.*, s.country, s.url
        FROM contacts c
        LEFT JOIN sites s ON c.site_id = s.id
        WHERE c.id = ?
      `);
      return stmt.get(id) as (Contact & { country: string; url: string }) | undefined;
    },

    getBySiteId: (siteId: number) => {
      const stmt = prepare('SELECT * FROM contacts WHERE site_id = ? AND type = ?');
      return stmt.all(siteId, 'email') as Contact[];
    },

    getEmailHistory: (contactId: number) => {
      const stmt = prepare(`
        SELECT esl.*, et.name as template_name, et.subject
        FROM email_send_log esl
        LEFT JOIN email_templates et ON esl.template_id = et.id
        WHERE esl.contact_id = ?
        ORDER BY esl.sent_at DESC
      `);
      return stmt.all(contactId);
    }
  },

  // Template operations
  templates: {
    getAll: () => {
      const stmt = prepare('SELECT * FROM email_templates ORDER BY sequence_number, id');
      return stmt.all() as EmailTemplate[];
    },

    getByTag: (tag: string) => {
      const stmt = prepare(`
        SELECT * FROM email_templates
        WHERE tags LIKE ?
        ORDER BY sequence_number
      `);
      return stmt.all(`%${tag}%`) as EmailTemplate[];
    },

    getById: (id: number) => {
      const stmt = prepare('SELECT * FROM email_templates WHERE id = ?');
      return stmt.get(id) as EmailTemplate | undefined;
    }
  },

  // Sender operations
  senders: {
    getActive: () => {
      const stmt = prepare(`
        SELECT * FROM email_senders
        WHERE is_active = 1
        ORDER BY created_at ASC
      `);
      return stmt.all() as EmailSender[];
    },

    getById: (id: number) => {
      const stmt = prepare('SELECT * FROM email_senders WHERE id = ?');
      return stmt.get(id) as EmailSender | undefined;
    },

    incrementSent: (id: number) => {
      const stmt = prepare(`
        UPDATE email_senders
        SET sent_today = sent_today + 1
        WHERE id = ?
      `);
      return stmt.run(id);
    },

    resetDailyCounters: () => {
      const today = new Date().toDateString();
      const stmt = prepare(`
        UPDATE email_senders
        SET sent_today = 0, last_reset_date = ?
        WHERE last_reset_date != ? OR last_reset_date IS NULL
      `);
      return stmt.run(today, today);
    }
  },

  // Settings operations
  settings: {
    get: (key: string) => {
      const stmt = prepare('SELECT value FROM email_settings WHERE key = ?');
      const result = stmt.get(key) as { value: string } | undefined;
      return result?.value;
    },

    set: (key: string, value: string) => {
      const stmt = prepare(`
        INSERT OR REPLACE INTO email_settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
      `);
      return stmt.run(key, value);
    },

    getAll: () => {
      const stmt = prepare('SELECT * FROM email_settings');
      return stmt.all();
    }
  }
};
```

### 4.3 Queue System Design

#### BullMQ Setup

```typescript
// lib/queue/client.ts
import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

// Redis connection (use Upstash for Vercel deployment)
const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Queue definitions
export const emailQueue = new Queue('emails', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 60000, // 1 minute
    },
    removeOnComplete: {
      age: 7 * 24 * 3600, // 7 days
      count: 1000,
    },
    removeOnFail: {
      age: 30 * 24 * 3600, // 30 days
    },
  },
});

// Scheduler queue for delayed jobs
export const schedulerQueue = new Queue('email-scheduler', {
  connection: redis,
});

// Job types
export enum JobType {
  SEND_EMAIL = 'send-email',
  SCHEDULE_FOLLOWUP = 'schedule-followup',
  PROCESS_CAMPAIGN = 'process-campaign',
  HEALTH_CHECK = 'health-check',
}

// Priority levels (higher = more important)
export enum JobPriority {
  LOW = 1,
  NORMAL = 5,
  HIGH = 10,
  IMMEDIATE = 20,
}
```

#### Job Processor

```typescript
// lib/queue/processors.ts
import { Job, Worker } from 'bullmq';
import { queries } from '../db/queries';
import { emailProvider } from '../email/provider';
import { businessHours } from '../timezone/business-hours';
import { logger } from '../utils/logger';
import { emailQueue } from './client';
import type { JobType, JobPriority } from './client';

interface SendEmailJobData {
  queueItemId: number;
  contactId: number;
  countryCode: string;
}

export async function processSendEmail(job: Job<SendEmailJobData>) {
  const { queueItemId, contactId, countryCode } = job.data;

  logger.info('Processing email job', { queueItemId, contactId, countryCode });

  // 1. Get queue item
  const queueItem = queries.queue.getById(queueItemId);
  if (!queueItem) {
    throw new Error(`Queue item ${queueItemId} not found`);
  }

  // 2. Double-check business hours
  const now = new Date();
  if (!businessHours.isBusinessHour(now, countryCode)) {
    // Reschedule to next business hour
    const nextTime = businessHours.calculateNextBusinessTime(countryCode);
    await emailQueue.add('send-email', job.data, {
      delay: nextTime.getTime() - Date.now(),
      priority: JobPriority.NORMAL,
    });
    logger.info('Rescheduled to business hours', { queueItemId, nextTime });
    return { rescheduled: true, nextTime };
  }

  // 3. Get sender (round-robin)
  const senders = queries.senders.getActive();
  const availableSender = senders.find(s => s.sent_today < s.daily_limit);
  if (!availableSender) {
    throw new Error('No available senders under daily limit');
  }

  // 4. Prepare email content
  const contact = queries.contacts.getById(contactId);
  if (!contact) {
    throw new Error(`Contact ${contactId} not found`);
  }

  const emailData = {
    to: queueItem.recipient_email,
    subject: queueItem.subject,
    html: queueItem.html_content,
    text: queueItem.text_content,
    variables: {
      name: queueItem.recipient_name || extractNameFromEmail(queueItem.recipient_email),
      email: queueItem.recipient_email,
      company: extractCompany(contact.value, contact.url),
      url: contact.url,
      domain: new URL(contact.url).hostname,
      region: countryCode,
    }
  };

  // 5. Send email
  try {
    const result = await emailProvider.send(availableSender, emailData);

    // 6. Update database
    queries.queue.updateStatus(queueItemId, 'sent', {
      sent_at: new Date().toISOString(),
      sender_id: availableSender.id,
    });

    queries.senders.incrementSent(availableSender.id);

    // 7. Log to send history
    logEmailSend(contactId, queueItem);

    logger.info('Email sent successfully', {
      queueItemId,
      messageId: result.messageId,
      sender: availableSender.email,
    });

    return { success: true, messageId: result.messageId };

  } catch (error) {
    logger.error('Email send failed', { queueItemId, error: error.message });

    queries.queue.updateStatus(queueItemId, 'queued', {
      error_message: error.message,
    });

    throw error; // BullMQ will retry based on config
  }
}

function extractNameFromEmail(email: string): string {
  const local = email.split('@')[0];
  const parts = local.split(/[._-]/).filter(Boolean);
  return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function extractCompany(email: string, url: string): string {
  // Try to get company from domain or URL
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    return domain.split('.')[0].charAt(0).toUpperCase() +
           domain.split('.')[0].slice(1);
  } catch {
    return 'there';
  }
}

function logEmailSend(contactId: number, queueItem: any) {
  // Implementation for email_send_log
}
```

#### Follow-up Scheduler

```typescript
// lib/queue/scheduler.ts
import { CronJob } from 'cron';
import { queries } from '../db/queries';
import { emailQueue, JobType, JobPriority } from './client';
import { businessHours } from '../timezone/business-hours';
import { logger } from '../utils/logger';

/**
 * Cron job that runs every hour to schedule follow-up emails
 */
export class FollowUpScheduler {
  private cron: CronJob;

  constructor() {
    this.cron = new CronJob('0 * * * *', this.run.bind(this)); // Every hour
  }

  start() {
    this.cron.start();
    logger.info('Follow-up scheduler started');
  }

  stop() {
    this.cron.stop();
    logger.info('Follow-up scheduler stopped');
  }

  async run() {
    logger.info('Running follow-up scheduler');

    try {
      // 1. Find queue items that need follow-ups scheduled
      const stmt = prepare(`
        SELECT DISTINCT
          eq.contact_id,
          eq.campaign_id,
          eq.tag,
          eq.sequence_position,
          eq.sent_at,
          c.value as recipient_email,
          s.country as country_code,
          eq.recipient_name
        FROM email_queue eq
        LEFT JOIN contacts c ON eq.contact_id = c.id
        LEFT JOIN sites s ON c.site_id = s.id
        WHERE eq.status = 'sent'
          AND eq.sequence_position IS NOT NULL
          AND eq.sent_at >= datetime('now', '-30 days')
        ORDER BY eq.sent_at DESC
      `);

      const sentEmails = stmt.all();

      for (const email of sentEmails) {
        await this.scheduleFollowUps(email);
      }

      logger.info('Follow-up scheduler completed', { processed: sentEmails.length });

    } catch (error) {
      logger.error('Follow-up scheduler failed', { error: error.message });
    }
  }

  private async scheduleFollowUps(sentEmail: any) {
    const { contact_id, campaign_id, tag, sequence_position, sent_at, country_code } = sentEmail;

    // Get templates for this tag
    const templates = queries.templates.getByTag(tag);
    const maxSequence = Math.max(...templates.map(t => t.sequence_number || 0));

    // Schedule next follow-up if exists
    if (sequence_position < maxSequence) {
      const nextPosition = sequence_position + 1;
      const nextTemplate = templates.find(t => t.sequence_number === nextPosition);

      if (!nextTemplate) return;

      // Check if already scheduled
      const existingCheck = prepare(`
        SELECT id FROM email_queue
        WHERE contact_id = ?
          AND campaign_id = ?
          AND sequence_position = ?
          AND status IN ('queued', 'sending')
      `).get(contact_id, campaign_id, nextPosition);

      if (existingCheck) return; // Already scheduled

      // Calculate gap days
      const gapKey = `followup_gap_${sequence_position}`;
      const gapDays = parseInt(queries.settings.get(gapKey) || '5');

      // Calculate scheduled time
      const baseTime = new Date(sent_at);
      const scheduledTime = businessHours.calculateFollowUpDate(
        baseTime,
        gapDays,
        country_code
      );

      // Create queue item
      const queueId = queries.queue.create({
        campaign_id,
        recipient_email: sentEmail.recipient_email,
        recipient_name: sentEmail.recipient_name,
        subject: nextTemplate.subject,
        html_content: nextTemplate.html_content,
        text_content: nextTemplate.text_content,
        status: 'queued',
        scheduled_at: scheduledTime.toISOString(),
        contact_id,
        tag,
        sequence_position: nextPosition,
        country_code,
      });

      // Add to BullMQ
      await emailQueue.add('send-email', {
        queueItemId: queueId.lastInsertRowid as number,
        contact_id,
        country_code,
      }, {
        delay: scheduledTime.getTime() - Date.now(),
        jobId: `followup-${contact_id}-${campaign_id}-${nextPosition}`,
      });

      logger.info('Follow-up scheduled', {
        contact_id,
        position: nextPosition,
        scheduledTime,
      });
    }
  }
}
```

---

## 5. Queue System Design

### 5.1 BullMQ Job Structure

```typescript
// lib/queue/types.ts
export interface EmailJobData {
  queueItemId: number;
  contactId: number;
  countryCode: string;
  priority?: number;
  scheduledAt?: string;
}

export interface CampaignJobData {
  campaignId: number;
  templateIds: number[];
  contactIds: number[];
  startImmediately?: boolean;
}

export interface FollowUpJobData {
  previousQueueItemId: number;
  contactId: number;
  campaignId: number;
  tag: string;
  nextSequencePosition: number;
}

export interface JobResult {
  success: boolean;
  messageId?: string;
  error?: string;
  rescheduled?: boolean;
  nextTime?: string;
}
```

### 5.2 Queue Configuration

```typescript
// lib/queue/config.ts
export const queueConfig = {
  // Email sending queue
  email: {
    connection: { url: process.env.REDIS_URL },
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60000,
      },
      removeOnComplete: {
        age: 7 * 24 * 3600, // Keep for 7 days
        count: 1000,
      },
      removeOnFail: {
        age: 30 * 24 * 3600, // Keep failed for 30 days
      },
    },
    limiter: {
      max: 100, // Max 100 jobs per duration
      duration: 60000, // Per minute
    },
  },

  // Scheduler queue
  scheduler: {
    connection: { url: process.env.REDIS_URL },
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 300000, // 5 minutes
      },
    },
  },
};
```

### 5.3 Worker Configuration

```typescript
// workers/email-worker.ts
import { Worker } from 'bullmq';
import { redis } from '../lib/queue/client';
import { processSendEmail } from '../lib/queue/processors';
import { logger } from '../lib/utils/logger';

export function createEmailWorker() {
  const worker = new Worker(
    'emails',
    async (job) => {
      logger.info('Processing job', { id: job.id, type: job.name });
      return await processSendEmail(job);
    },
    {
      connection: redis,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5'),
      limiter: {
        max: 10, // 10 emails per bucket
        duration: 1000, // per second
      },
    }
  );

  worker.on('completed', (job) => {
    logger.info('Job completed', { id: job.id });
  });

  worker.on('failed', (job, err) => {
    logger.error('Job failed', { id: job?.id, error: err.message });
  });

  return worker;
}
```

---

## 6. Email Scheduling Logic (Step-by-Step)

### 6.1 Business Hours Validation

```typescript
// lib/timezone/business-hours.ts
interface CountryConfig {
  timezone: string;
  businessStart: number;
  businessEnd: number;
  weekendDays: number[];
}

const COUNTRY_CONFIGS: Record<string, CountryConfig> = {
  in: { timezone: 'Asia/Kolkata', businessStart: 9, businessEnd: 18, weekendDays: [0, 6] },
  us: { timezone: 'America/New_York', businessStart: 9, businessEnd: 17, weekendDays: [0, 6] },
  uk: { timezone: 'Europe/London', businessStart: 9, businessEnd: 17, weekendDays: [0, 6] },
  // ... other countries
};

export class BusinessHoursValidator {
  isBusinessHour(date: Date, countryCode: string): boolean {
    const config = COUNTRY_CONFIGS[countryCode.toLowerCase()] || COUNTRY_CONFIGS.us;

    // Get time in target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone,
      hour: 'numeric',
      hour12: false,
      weekday: 'long',
    });

    const parts = formatter.formatToParts(date);
    const hour = parseInt(parts.find(p => p.type === 'hour')!.value);
    const dayName = parts.find(p => p.type === 'weekday')!.value.toLowerCase();

    const dayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    const day = dayMap[dayName];

    // Check weekend
    if (config.weekendDays.includes(day)) {
      return false;
    }

    // Check business hours
    return hour >= config.businessStart && hour < config.businessEnd;
  }

  calculateNextBusinessTime(countryCode: string): Date {
    const config = COUNTRY_CONFIGS[countryCode.toLowerCase()] || COUNTRY_CONFIGS.us;
    let checkDate = new Date();
    checkDate.setHours(checkDate.getHours() + 1); // Start checking from next hour

    // Check next 7 days
    for (let i = 0; i < 168; i++) { // 168 hours = 7 days
      const testDate = new Date(checkDate.getTime() + i * 3600000);
      if (this.isBusinessHour(testDate, countryCode)) {
        return testDate;
      }
    }

    // Fallback
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(config.businessStart, 0, 0, 0);
    return fallback;
  }

  calculateFollowUpDate(baseDate: Date, daysToAdd: number, countryCode: string): Date {
    // Add calendar days
    const followUpDate = new Date(baseDate);
    followUpDate.setDate(followUpDate.getDate() + daysToAdd);

    // Adjust to business hours
    return this.adjustToBusinessHours(followUpDate, countryCode);
  }

  adjustToBusinessHours(date: Date, countryCode: string): Date {
    const config = COUNTRY_CONFIGS[countryCode.toLowerCase()] || COUNTRY_CONFIGS.us;
    let adjusted = new Date(date);

    // Check if currently in business hours
    if (!this.isBusinessHour(adjusted, countryCode)) {
      // Move to next business day start
      do {
        adjusted.setDate(adjusted.getDate() + 1);
        adjusted.setHours(config.businessStart, 0, 0, 0);
      } while (!this.isBusinessHour(adjusted, countryCode));
    }

    return adjusted;
  }
}

export const businessHours = new BusinessHoursValidator();
```

### 6.2 Sequence Scheduling Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    SEQUENCE SCHEDULING FLOW                      │
└─────────────────────────────────────────────────────────────────┘

User Action: "Send Campaign with Tag 'marketing'"
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Get Templates for Tag 'marketing'                            │
│    - Template 1 (seq=1): "Welcome Email"                        │
│    - Template 2 (seq=2): "Follow-up 1"                          │
│    - Template 3 (seq=3): "Follow-up 2"                          │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. For Each Selected Contact:                                   │
│    a) Create queue item for Template 1 (seq=1)                  │
│    b) Calculate first send time (business hours)                │
│    c) Add job to BullMQ with delay                              │
│    d) Store metadata for follow-ups                             │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. When Email 1 Sends Successfully:                             │
│    a) Update email_queue status = 'sent'                        │
│    b) Record sent_at timestamp                                  │
│    c) Trigger follow-up scheduler                               │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Follow-up Scheduler (runs hourly):                           │
│    a) Find recently sent emails                                 │
│    b) Check if follow-up needed                                 │
│    c) Calculate scheduled date = sent_at + gap_days             │
│    d) Adjust to business hours                                  │
│    e) Create queue item for next template                       │
│    f) Add delayed job to BullMQ                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Timezone-Aware Prioritization

```typescript
// lib/queue/prioritizer.ts
export class QueuePrioritizer {
  /**
   * Prioritize emails for countries currently in business hours
   */
  getPriorityForEmail(countryCode: string): JobPriority {
    const now = new Date();
    const inBusinessHours = businessHours.isBusinessHour(now, countryCode);

    if (inBusinessHours) {
      return JobPriority.HIGH;
    }

    // Check if coming up within 2 hours
    const nextBusinessTime = businessHours.calculateNextBusinessTime(countryCode);
    const hoursUntil = (nextBusinessTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntil <= 2) {
      return JobPriority.NORMAL;
    }

    return JobPriority.LOW;
  }

  /**
   * Get countries currently in business hours
   */
  getCountriesInBusiness(): string[] {
    const now = new Date();
    return Object.keys(COUNTRY_CONFIGS).filter(code =>
      businessHours.isBusinessHour(now, code)
    );
  }
}
```

---

## 7. Frontend Dashboard Plan

### 7.1 Dashboard Pages

| Page | Route | Purpose |
|------|-------|---------|
| **Main Dashboard** | `/` | Overview stats, queue health, recent activity |
| **Leads Manager** | `/leads` | Browse, filter, select contacts |
| **Queue Monitor** | `/queue` | Real-time queue status, bulk actions |
| **Templates** | `/templates` | Create/edit email templates |
| **Campaigns** | `/campaigns` | Manage campaigns, send to leads |
| **Senders** | `/senders` | Email account management |
| **Settings** | `/settings` | System configuration, timezones |
| **Analytics** | `/analytics` | Email performance metrics |

### 7.2 ShadCN Component Usage

```typescript
// Key components from ShadCN to use:
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
  Button, Input, Label, Select, Textarea,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  Tabs, TabsContent, TabsList, TabsTrigger,
  Badge, Progress, Alert, AlertDescription, AlertTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  Toast, ToastProvider, Toaster,
  Skeleton,
} from '@/components/ui';
```

### 7.3 Real-Time Updates

```typescript
// hooks/use-realtime-queue.ts
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export function useRealtimeQueue() {
  const [queueStats, setQueueStats] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socket = io(process.env.NEXT_PUBLIC_WORKER_URL!, {
      transports: ['websocket'],
    });

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('queue:updated', (data) => {
      setQueueStats(data);
    });

    socket.on('email:sent', (data) => {
      toast.success(`Email sent to ${data.recipient}`);
    });

    socket.on('email:failed', (data) => {
      toast.error(`Failed to send to ${data.recipient}: ${data.error}`);
    });

    return () => socket.disconnect();
  }, []);

  return { queueStats, isConnected };
}
```

### 7.4 Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Header: Logo | Breadcrumbs | User Menu                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Queue Depth │  │ Sent Today  │  │ Failed      │              │
│  │    1,234    │  │    456      │  │     3       │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Active Countries                      │    │
│  │  🇮🇳 India (open)  🇺🇸 US (closed)  🇬🇧 UK (open)        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Queue Status                          │    │
│  │  Status: Running | Workers: 3 | Processing Rate: 12/min  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Recent Activity                       │    │
│  │  10:45 - Email sent to john@example.com                 │    │
│  │  10:44 - Email sent to sarah@company.co.uk              │    │
│  │  10:43 - Failed: mike@startup.io (SMTP error)           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. API Contract (All Endpoints)

### 8.1 Queue Management

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `POST` | `/api/queue/add` | Add emails to queue | `{ contactIds: number[], templateId: number, campaignId?: number }` | `{ added: number, queued: number }` |
| `POST` | `/api/queue/add-by-tag` | Add by contact tag | `{ tag: string, templateId: number }` | `{ added: number }` |
| `GET` | `/api/queue` | List queue items | Query: `status, country, limit, offset` | `{ items: QueueItem[], total, pagination }` |
| `GET` | `/api/queue/stats` | Queue statistics | - | `{ queued, sending, sent, failed, byCountry }` |
| `GET` | `/api/queue/:id` | Get specific item | - | `QueueItem` |
| `DELETE` | `/api/queue/:id` | Cancel queued item | - | `{ cancelled: boolean }` |
| `POST` | `/api/queue/:id/retry` | Retry failed item | - | `{ scheduled: boolean }` |
| `POST` | `/api/queue/:id/send-now` | Send immediately | - | `{ scheduled: boolean }` |
| `POST` | `/api/queue/bulk/cancel` | Cancel multiple | `{ ids: number[] }` | `{ cancelled: number }` |
| `POST` | `/api/queue/bulk/retry` | Retry multiple | `{ ids: number[] }` | `{ retried: number }` |
| `POST` | `/api/queue/pause` | Pause processing | - | `{ paused: boolean }` |
| `POST` | `/api/queue/resume` | Resume processing | - | `{ resumed: boolean }` |

### 8.2 Contacts & Leads

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `GET` | `/api/contacts` | List contacts | Query: `search, country, type, limit, offset` | `{ items: Contact[], total }` |
| `GET` | `/api/contacts/:id` | Get contact | - | `Contact` |
| `GET` | `/api/contacts/:id/history` | Email history | - | `{ sent: EmailLog[] }` |
| `GET` | `/api/leads` | Get leads with sites | Query: filters | `{ items: Lead[], total }` |
| `POST` | `/api/leads/segment` | Segment leads | `{ criteria }` | `{ segmentId, count }` |

### 8.3 Templates

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `GET` | `/api/templates` | List templates | Query: `tag, category` | `Template[]` |
| `GET` | `/api/templates/:id` | Get template | - | `Template` |
| `POST` | `/api/templates` | Create template | `TemplateInput` | `Template` |
| `PUT` | `/api/templates/:id` | Update template | `TemplateInput` | `Template` |
| `DELETE` | `/api/templates/:id` | Delete template | - | `{ deleted: boolean }` |
| `POST` | `/api/templates/:id/preview` | Preview with data | `{ variables }` | `{ html, text }` |
| `GET` | `/api/templates/tags` | Get all tags | - | `{ tags: string[] }` |

### 8.4 Campaigns

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `GET` | `/api/campaigns` | List campaigns | - | `Campaign[]` |
| `GET` | `/api/campaigns/:id` | Get campaign | - | `Campaign` |
| `POST` | `/api/campaigns` | Create campaign | `{ name, templateId, contactIds }` | `Campaign` |
| `DELETE` | `/api/campaigns/:id` | Delete campaign | - | `{ deleted: boolean }` |
| `POST` | `/api/campaigns/:id/start` | Start campaign | - | `{ started: boolean, queued: number }` |
| `POST` | `/api/campaigns/:id/pause` | Pause campaign | - | `{ paused: boolean }` |

### 8.5 Senders

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `GET` | `/api/senders` | List senders | - | `Sender[]` |
| `GET` | `/api/senders/active` | Active senders | - | `Sender[]` |
| `POST` | `/api/senders` | Add sender | `SenderInput` | `Sender` |
| `PUT` | `/api/senders/:id` | Update sender | `SenderInput` | `Sender` |
| `DELETE` | `/api/senders/:id` | Delete sender | - | `{ deleted: boolean }` |
| `POST` | `/api/senders/:id/test` | Test sender | - | `{ success, error? }` |

### 8.6 Settings & Config

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `GET` | `/api/settings` | Get all settings | - | `{ [key]: string }` |
| `PUT` | `/api/settings` | Update settings | `{ [key]: string }` | `{ updated: string[] }` |
| `GET` | `/api/timezone/countries` | Country timezones | - | `CountryTimezone[]` |
| `GET` | `/api/timezone/status` | Current status | - | `{ countries: { code, status, time }[] }` |

### 8.7 Workers & Health

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| `GET` | `/api/workers/status` | Worker status | - | `{ workers: WorkerStatus[] }` |
| `POST` | `/api/workers/scale` | Scale workers | `{ count: number }` | `{ scaled: boolean }` |
| `GET` | `/api/health` | System health | - | `{ status, checks }` |

---

## 9. Deployment Plan

### 9.1 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        VERCEL DEPLOYMENT                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Next.js App                           │    │
│  │  (Frontend + API Routes)                                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Turso Database                        │    │
│  │  (SQLite-compatible, edge-hosted)                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Upstash Redis                         │    │
│  │  (Job queue, caching)                                   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CONTAINER SERVICE                             │
│                    (Railway, Render, etc.)                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Email Worker                          │    │
│  │  - BullMQ consumer                                      │    │
│  │  - Email sending                                        │    │
│  │  - Follow-up scheduling                                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Socket.io Server                      │    │
│  │  - Real-time updates                                    │    │
│  │  - Progress notifications                               │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 Environment Variables

```bash
# .env.production

# Database
DATABASE_URL="file:../wordpress-detector.db"
# OR for Turso:
TURSO_DATABASE_URL="libsql://..."
TURSO_AUTH_TOKEN="..."

# Redis (Upstash)
REDIS_URL="rediss://..."

# Email Provider
RESEND_API_KEY="re_..."
# OR SendGrid
SENDGRID_API_KEY="SG...."

# Worker Service URL
NEXT_PUBLIC_WORKER_URL="https://worker-service.example.com"

# App
NEXT_PUBLIC_APP_URL="https://email-system.vercel.app"

# Auth (optional, for admin access)
ADMIN_PASSWORD="..."

# Logging
LOG_LEVEL="info"
SENTRY_DSN="..." # Optional error tracking
```

### 9.3 Deployment Steps

#### Phase 1: Infrastructure Setup
1. Create Upstash Redis account
2. Create Turso database account
3. Create Railway/Render account for worker
4. Configure environment variables

#### Phase 2: Database Connection
1. Set up Turso to sync with existing SQLite
2. Verify table access permissions
3. Test query performance

#### Phase 3: Deploy Frontend/API
1. Deploy Next.js to Vercel
2. Connect to Upstash Redis
3. Connect to Turso database
4. Test API endpoints

#### Phase 4: Deploy Worker
1. Deploy worker service to Railway
2. Configure BullMQ connection
3. Set up auto-scaling
4. Monitor job processing

#### Phase 5: Monitoring & Observability
1. Set up Sentry for error tracking
2. Configure log aggregation
3. Set up health check alerts
4. Create performance dashboards

### 9.4 Scaling Strategy

| Component | Scaling Method | Max Capacity |
|-----------|---------------|--------------|
| **Next.js API** | Vercel Serverless | Auto (unlimited) |
| **Worker** | Container replicas | 1-10 containers |
| **Redis** | Upstash Pro | 10K ops/sec |
| **Database** | Turso | 5K rows/sec |

---

## 10. Migration Strategy

### 10.1 Zero-Downtime Migration

```
┌─────────────────────────────────────────────────────────────────┐
│                    MIGRATION PHASES                             │
└─────────────────────────────────────────────────────────────────┘

PHASE 1: Parallel Deployment (Week 1)
┌──────────────┐                    ┌──────────────┐
│  Existing    │  ──────────────────>│   New System │
│   System     │      (Read Only)    │  (Deployed)  │
└──────────────┘                    └──────────────┘
     │                                     │
     │ Writes                              │ Reads
     │                                     │
     ▼                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Shared Database                             │
└─────────────────────────────────────────────────────────────────┘

PHASE 2: Traffic Split (Week 2)
┌──────────────┐                    ┌──────────────┐
│  Existing    │  ──────────────────>│   New System │
│   System     │      (80% traffic)  │ (20% traffic)│
└──────────────┘                    └──────────────┘
     │                                     │
     │ 80% Writes                          │ 20% Writes
     │                                     │
     ▼                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Shared Database                             │
└─────────────────────────────────────────────────────────────────┘

PHASE 3: Cutover (Week 3)
┌──────────────┐                    ┌──────────────┐
│  Existing    │  (Backup only)      │   New System │
│   System     │ <────────────────── │(100% traffic)│
└──────────────┘                    └──────────────┘
                                         │
                                         │ All Writes
                                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Shared Database                             │
└─────────────────────────────────────────────────────────────────┘

PHASE 4: Legacy Decommission (Week 4)
┌──────────────┐
│   New System │ (100% production)
└──────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Shared Database                             │
│  (Optional: Migrate to Turso for production use)                │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 Data Compatibility Checks

```typescript
// lib/db/migration-check.ts
export async function checkCompatibility() {
  const checks = {
    tables: [] as string[],
    columns: [] as { table: string; column: string; status: string }[],
    indexes: [] as string[],
  };

  // Check required tables exist
  const requiredTables = [
    'sites', 'contacts', 'email_queue', 'email_templates',
    'email_senders', 'email_campaigns', 'email_send_log',
    'email_settings', 'country_timezones'
  ];

  for (const table of requiredTables) {
    const result = prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name=?
    `).get(table);
    checks.tables.push(result ? `${table} ✓` : `${table} ✗ MISSING`);
  }

  // Check email_queue columns
  const queueColumns = prepare('PRAGMA table_info(email_queue)').all();
  const requiredColumns = ['scheduled_at', 'contact_id', 'tag', 'sequence_position', 'country_code'];

  for (const col of requiredColumns) {
    const exists = queueColumns.some((c: any) => c.name === col);
    checks.columns.push({
      table: 'email_queue',
      column: col,
      status: exists ? 'OK' : 'MISSING'
    });
  }

  return checks;
}
```

### 10.3 Fallback Procedures

| Scenario | Fallback Action |
|----------|----------------|
| **New system down** | Switch DNS to existing system |
| **Database locked** | Enable read-only mode |
| **Queue processing fails** | Manual trigger via existing worker |
| **Worker crash** | Auto-restart with exponential backoff |

---

## 11. Risks & Edge Cases

### 11.1 Identified Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **SQLite lock contention** | High | Medium | Use WAL mode, limit concurrent writes |
| **Redis connection loss** | Medium | High | Implement circuit breaker, local queue fallback |
| **Timezone calculation errors** | Low | Medium | Comprehensive unit tests, DST validation |
| **Sequence state desync** | Medium | High | Idempotency keys, state reconciliation |
| **Email provider rate limits** | High | Medium | Multiple providers, rate limiting |
| **Worker duplicate processing** | Low | High | BullMQ job locks, deduplication |
| **Database migration failures** | Low | Critical | Pre-migration validation, rollback plan |

### 11.2 Edge Cases

#### Case 1: DST Transition
```typescript
// lib/timezone/dst-handling.ts
export function handleDSTTransition(date: Date, countryCode: string): Date {
  // Detect if date is near DST transition
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: COUNTRY_CONFIGS[countryCode].timezone,
    timeZoneName: 'long'
  });

  const tzName = formatter.formatToParts(date).find(p => p.type === 'timeZoneName')?.value;

  // If timezone name contains "Daylight", we're in DST
  // Adjust business hours if needed
  return date;
}
```

#### Case 2: Follow-up Falls on Weekend
```typescript
// Handled by adjustToBusinessHours
// Weekend checking happens BEFORE business hours check
```

#### Case 3: Previous Email in Sequence Failed
```typescript
// Don't schedule follow-up if previous step failed
const previousStatus = getPreviousEmailStatus(contactId, campaignId, sequencePosition - 1);
if (previousStatus !== 'sent') {
  logger.warn('Previous email not sent, skipping follow-up');
  return;
}
```

#### Case 4: Contact Email Invalid/Bouncing
```typescript
// Track bounce status, don't retry
if (isPermanentBounce(error)) {
  markContactAsBouncing(contactId);
  // Don't add to queue again
}
```

### 11.3 Error Recovery

```typescript
// lib/workers/recovery.ts
export class WorkerRecovery {
  /**
   * Recover jobs that were in progress when worker crashed
   */
  async recoverInProgressJobs() {
    const stuckJobs = prepare(`
      SELECT id FROM email_queue
      WHERE status = 'sending'
        AND updated_at < datetime('now', '-10 minutes')
    `).all();

    for (const job of stuckJobs) {
      // Reset to queued
      prepare('UPDATE email_queue SET status = ? WHERE id = ?')
        .run('queued', job.id);

      // Re-add to BullMQ
      await emailQueue.add('send-email', {
        queueItemId: job.id,
      }, {
        jobId: `recovery-${job.id}`,
      });
    }

    logger.info('Recovered stuck jobs', { count: stuckJobs.length });
  }
}
```

---

## 12. Recommendations

### 12.1 Scaling Improvements

1. **Database Migration**
   - Migrate to Turso for better performance
   - Implement read replicas for dashboard queries
   - Use connection pooling

2. **Queue Optimization**
   - Implement priority queues for different email types
   - Use job batching for bulk operations
   - Add dead-letter queue for manual inspection

3. **Worker Scaling**
   - Implement auto-scaling based on queue depth
   - Separate workers for different job types
   - Add worker health monitoring

### 12.2 Monitoring & Observability

1. **Metrics to Track**
   - Queue depth by country
   - Processing rate (emails/minute)
   - Error rate by type
   - Worker utilization
   - Email provider success rate

2. **Alerting Rules**
   - Queue depth > 1000
   - Error rate > 5%
   - Worker not responding > 5 minutes
   - Daily limit approaching

3. **Dashboard Components**
   - Real-time queue visualization
   - Country-based heat map
   - Email delivery funnel
   - Template performance

### 12.3 Future Enhancements

1. **AI-Powered Features**
   - Optimal send time prediction
   - Subject line optimization
   - Content personalization

2. **Advanced Sequencing**
   - Conditional branching (if opened, then...)
   - A/B testing within sequences
   - Dynamic delays based on engagement

3. **Compliance & Deliverability**
   - SPF/DKIM/DMARC integration
   - Unsubscribe handling
   - Bounce management
   - Compliance reporting

4. **Integrations**
   - CRM integration (HubSpot, Salesforce)
   - Slack notifications
   - Webhook support for custom actions

---

## Appendix A: Database Schema Reference

### Complete Schema for Email Tables

```sql
-- Email Senders
CREATE TABLE email_senders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  service TEXT DEFAULT 'gmail',
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_user TEXT,
  daily_limit INTEGER DEFAULT 500,
  is_active INTEGER DEFAULT 1,
  sent_today INTEGER DEFAULT 0,
  last_reset_date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Email Templates
CREATE TABLE email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_content TEXT NOT NULL,
  text_content TEXT,
  description TEXT,
  category TEXT DEFAULT 'general',
  tags TEXT DEFAULT '',
  sequence_number INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Email Campaigns
CREATE TABLE email_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  template_id INTEGER,
  target_type TEXT DEFAULT 'all',
  status TEXT DEFAULT 'queued',
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (template_id) REFERENCES email_templates(id)
);

-- Email Queue
CREATE TABLE email_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER,
  sender_id INTEGER,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  html_content TEXT NOT NULL,
  text_content TEXT,
  status TEXT DEFAULT 'queued',
  attempts INTEGER DEFAULT 0,
  error_message TEXT,
  sent_at TEXT,
  scheduled_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  contact_id INTEGER,
  tag TEXT,
  sequence_position INTEGER,
  country_code TEXT,
  FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id),
  FOREIGN KEY (sender_id) REFERENCES email_senders(id)
);

-- Email Send Log
CREATE TABLE email_send_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  contact_email TEXT NOT NULL,
  template_id INTEGER,
  campaign_id INTEGER,
  send_type TEXT DEFAULT 'main',
  status TEXT DEFAULT 'sent',
  sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contact_id) REFERENCES contacts(id),
  FOREIGN KEY (template_id) REFERENCES email_templates(id)
);

-- Email Settings
CREATE TABLE email_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  label TEXT,
  description TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Country Timezones
CREATE TABLE country_timezones (
  country_code TEXT PRIMARY KEY,
  timezone TEXT NOT NULL,
  name TEXT NOT NULL,
  offset_hours REAL NOT NULL,
  business_start INTEGER DEFAULT 9,
  business_end INTEGER DEFAULT 17,
  weekend_days TEXT DEFAULT '6,0',
  preferred_send_times TEXT DEFAULT '["09:00","10:00","14:00","15:00"]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Appendix B: API Response Types

```typescript
// types/api.ts

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface QueueItem {
  id: number;
  campaign_id: number | null;
  sender_id: number | null;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  html_content: string;
  text_content: string | null;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';
  attempts: number;
  error_message: string | null;
  sent_at: string | null;
  scheduled_at: string | null;
  created_at: string;
  contact_id: number | null;
  tag: string | null;
  sequence_position: number | null;
  country_code: string | null;
}

export interface Contact {
  id: number;
  site_id: number;
  type: 'email' | 'phone' | 'linkedin';
  value: string;
  source_page: string | null;
  created_at: string;
}

export interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  html_content: string;
  text_content: string | null;
  description: string | null;
  category: string;
  tags: string;
  sequence_number: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface EmailSender {
  id: number;
  name: string;
  email: string;
  service: string;
  smtp_host: string | null;
  smtp_port: number | null;
  daily_limit: number;
  is_active: number;
  sent_today: number;
  last_reset_date: string | null;
}

export interface QueueStats {
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  byCountry: Array<{
    country: string;
    queued: number;
    sent: number;
    failed: number;
    inBusinessHours: boolean;
  }>;
}

export interface WorkerStatus {
  id: string;
  status: 'running' | 'stopped' | 'error';
  jobsProcessed: number;
  jobsFailed: number;
  uptime: number;
}
```

---

**Document Status:** Ready for Implementation
**Next Steps:**
1. Review and approve architecture
2. Set up infrastructure accounts (Upstash, Turso, Vercel)
3. Begin Phase 1 implementation
4. Set up CI/CD pipeline
