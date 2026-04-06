# Email System - Production-Ready Decoupled Architecture

A production-ready email delivery system with PostgreSQL, Redis (BullMQ), Next.js, and deployed on Vercel + Railway.

## 🎯 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Vercel Deployment                         │
├─────────────────────────────────────────────────────────────┤
│  Next.js App (UI + API Routes)                              │
│  - Dashboard with ShadCN UI                                 │
│  - RESTful API endpoints                                     │
│  - NO background processing                                  │
└─────────────────────────────────────────────────────────────┘
                    │           │           │
                    ▼           ▼           ▼
        ┌───────────────┐ ┌─────────┐ ┌──────────────┐
        │  PostgreSQL   │ │  Redis  │ │   External    │
        │    (Neon)     │ │(Upstash)│ │   Services    │
        └───────────────┘ └─────────┘ └──────────────┘
                    │
                    ▼
        ┌───────────────────────────────────────┐
        │    Worker Service (Railway)           │
        │  - BullMQ job processing              │
        │  - Email sending                      │
        │  - Sequence scheduling                │
        │  - Recovery logic                     │
        └───────────────────────────────────────┘
```

## Features

- **4-Layer Idempotency**: Prevents duplicate sends with DB constraints, send log checks, distributed locks, and transactional updates
- **Event-Driven Sequences**: Follow-up emails scheduled automatically when previous email succeeds
- **Business Hours Validation**: Per-country business hours with weekend handling
- **Smart Sender Selection**: Round-robin with daily/hourly limit checking and automatic reset
- **Multiple Email Providers**: Resend, SendGrid, and SMTP support
- **Recovery System**: Automatic recovery of stuck jobs and orphaned locks
- **Real-time Dashboard**: Next.js 14 with ShadCN UI components

## Project Structure

```
email-system/
├── app/                      # Next.js 14 App Router
│   ├── api/                  # API routes
│   ├── leads/page.tsx        # Leads dashboard
│   ├── queue/page.tsx        # Queue monitoring
│   ├── templates/page.tsx    # Template management
│   ├── campaigns/page.tsx    # Campaign management
│   ├── senders/page.tsx      # Sender management
│   ├── settings/page.tsx     # Settings page
│   ├── layout.tsx            # Root layout
│   └── page.tsx              # Main dashboard
├── lib/                      # Core libraries
│   ├── api/                  # API client
│   ├── db/                   # Database layer (pg)
│   ├── queue/                # BullMQ queue
│   ├── email/                # Email system
│   ├── sequences/            # Sequence engine
│   ├── timezone/             # Business hours
│   ├── idempotency/          # Idempotency layer
│   └── hooks/                # React hooks
├── workers/                  # Worker services
│   ├── email-worker.ts       # Main email worker
│   └── recovery-worker.ts    # Recovery worker
├── database/
│   └── schema.sql            # PostgreSQL schema
└── components/ui/            # ShadCN components
```

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- PostgreSQL >= 14
- Redis >= 7

### Local Development

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local` with your configuration.

3. **Start infrastructure (Docker):**
   ```bash
   docker-compose up -d postgres redis mailhog
   ```

4. **Run database migrations:**
   ```bash
   npm run db:migrate
   ```

5. **Start development servers:**
   ```bash
   npm run dev
   ```
   - Dashboard: http://localhost:3000
   - MailHog: http://localhost:8025

### Docker Compose (All-in-One)

```bash
docker-compose up -d
```

This starts:
- Next.js Dashboard: http://localhost:3000
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- MailHog (SMTP): http://localhost:8025
- Redis Commander: http://localhost:8082
- PgAdmin: http://localhost:5050

## Environment Variables

See `.env.example` for all available variables. Key variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | - |
| `REDIS_URL` | Redis connection string | - |
| `RESEND_API_KEY` | Resend API key | - |
| `SENDGRID_API_KEY` | SendGrid API key | - |
| `SMTP_HOST` | SMTP server host | - |
| `SMTP_PORT` | SMTP server port | 587 |
| `DEFAULT_TIMEZONE` | Default timezone for scheduling | America/New_York |
| `BUSINESS_HOURS_START` | Start of business hours (24h) | 9 |
| `BUSINESS_HOURS_END` | End of business hours (24h) | 17 |

## Database Schema

```sql
-- Core tables
email_senders          -- Email sender accounts
email_templates        -- Email templates with variables
email_campaigns        -- Email campaigns
email_queue            -- Queued emails
email_send_log         -- Send history
email_events           -- Webhook events (opens, clicks)
country_timezones      -- Timezone data by country
```

## Deployment

### Railway

1. Fork this repository
2. Create a new project on Railway
3. Add PostgreSQL and Redis services
4. Set environment variables
5. Deploy!

```bash
railway up
```

### Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Deploy: `vercel`
3. Set environment variables in Vercel dashboard
4. Deploy worker separately (Vercel doesn't support long-running processes)

### Docker

```bash
docker build -t email-system .
docker run -p 3000:3000 --env-file .env email-system
```

## Worker Process

The worker processes emails from the queue:

```bash
npm run start:worker
```

Or with Docker Compose:
```bash
docker-compose up worker
```

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/senders` | GET/POST | Manage senders |
| `/api/templates` | GET/POST | Manage templates |
| `/api/campaigns` | GET/POST | Manage campaigns |
| `/api/queue` | GET/POST | View/manage queue |
| `/api/analytics` | GET | Email statistics |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js + worker |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run db:migrate` | Run database migrations |
| `npm run db:seed` | Seed database with sample data |
| `npm run lint` | Lint code |

## Monitoring

- **Redis Queue**: View jobs at http://localhost:8082 (Redis Commander)
- **Email Testing**: View sent emails at http://localhost:8025 (MailHog)
- **Logs**: Check `logs/` directory or use Docker logs

## License

MIT
