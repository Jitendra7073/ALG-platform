# Auto/Manual Queue Mode Setup Guide

## Overview

Your email system now supports **TWO modes** for processing queued emails:

### 1. Manual Mode (Default)
- You manually click "Start Queue for Today" button
- Processes all scheduled emails for today
- Stops when complete
- **Best for**: Testing, controlled sends, one-time campaigns

### 2. Auto Mode
- Cron job automatically processes emails (configurable interval: 5-30 minutes)
- Only sends emails at their scheduled day/time
- Runs continuously in the background
- **Manual controls are hidden** when in auto mode
- **Best for**: Production, automated campaigns, set-and-forget

## Setup Instructions

### Step 1: Run Database Migration

Add the `queue_mode` setting to your database:

```bash
cd email-sending-system
node scripts/add-queue-mode-setting.js
```

Or run the full migration:
```bash
node scripts/migrate.js
```

### Step 2: Update Environment Variables

Edit `.env` file and set a strong CRON_SECRET:

```env
CRON_SECRET=your-super-secret-cron-key-change-this-in-production
```

**IMPORTANT**: Generate a secure random string for production! You can use:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 3: Deploy to Vercel (or update existing deployment)

If using Vercel, the `vercel.json` file is already configured with:
- **Cron schedule**: Every 5 minutes (`*/5 * * * *`)
- **Endpoint**: `/api/workers/process-queue`
- **Worker checks**: Only processes if enough time passed based on `queue_interval` setting

**How it works:**
- Cron runs every 5 minutes (checking for work)
- Worker checks `queue_interval` setting (default: 15 minutes)
- Only processes emails if enough time passed since last run
- Example: If interval is 15 minutes, worker processes at 0, 15, 30... (not 5, 10, 20, 25)

Deploy or redeploy to Vercel:
```bash
vercel --prod
```

### Step 4: Set Your CRON_SECRET in Vercel

Go to your Vercel project settings:
1. Navigate to **Settings → Environment Variables**
2. Add `CRON_SECRET` with the same value as in your `.env`
3. Redeploy if needed

## How to Use

### Toggle Between Auto/Manual Mode

1. Go to **History** page (`/history`)
2. At the top, you'll see **Queue Control Panel**
3. Click the toggle button:
   - **Auto Mode**: Green button says "Auto Mode"
   - **Manual Mode**: Outline button says "Manual Mode"

### In Manual Mode:
- Click "Start Queue for Today" to process emails
- Use Pause/Resume/Stop controls during processing
- Click "Cancel All Queued" to stop all pending emails

### In Auto Mode:
- Cron job runs every 5 minutes to check for work
- Worker checks `queue_interval` setting (configurable 5-30 min, default 15)
- Only processes if enough time passed since last run
- Countdown timer shows when next batch will process
- **Manual "Start Queue" button is hidden**
- You can still toggle back to manual anytime

## How It Works

### Manual Mode Flow:
```
You click "Start Queue for Today"
    ↓
Batch processor starts
    ↓
Fetches emails scheduled for TODAY
    ↓
Sends in batches of 5 with delays
    ↓
Stops when complete
```

### Auto Mode Flow:
```
Every 5 minutes (Cron)
    ↓
Worker endpoint called with CRON_SECRET
    ↓
Checks if queue_mode = 'auto'
    ↓
Checks queue_interval setting (e.g., 15 minutes)
    ↓
Checks if enough time passed since last_process
    ↓
If yes: Fetches emails where scheduled_at <= NOW()
    ↓
Sends emails (up to 20 per batch)
    ↓
Updates last_queue_process timestamp
    ↓
Activates dependent emails in sequences
```

**Smart Interval Checking:**
- Cron runs every 5 minutes (checking for work)
- Worker checks: `minutes_since_last_process >= queue_interval`
- With 1-minute buffer for timing variations
- Prevents over-processing while staying responsive

## Important Notes

### Email Scheduling Rules
- **Both modes respect the scheduled day/time**
- Emails are ONLY sent at their scheduled time
- Auto mode: Checks every `queue_interval` minutes for due emails
- Manual mode: Processes all today's due emails at once
- **1-minute timing buffer** prevents missed sends due to cron timing

### Daily Limits
- Both modes respect sender daily limits
- Round-robin distribution across active senders
- Automatic sender rotation

### Sequence Emails
- Dependent emails auto-activate when parent sends
- Next email in sequence scheduled based on wait time
- Works in both auto and manual modes

### Timezone Handling
- All times stored in UTC
- Recipient timezones used for scheduling
- Business hours rules enforced per country

## Troubleshooting

### Auto mode not working?
1. Check `queue_mode` is set to 'auto' in database
2. Verify CRON_SECRET is set in Vercel env vars
3. Check Vercel cron logs (Deployments → Cron Jobs)
4. Look for worker logs in History page

### Cron job unauthorized?
- Make sure CRON_SECRET matches in .env and Vercel
- Check the Authorization header format: `Bearer {SECRET}`

### Emails not sending at scheduled time?
- Verify the `scheduled_at` time is in the past
- Check sender daily limits not reached
- Ensure email status is 'ready_to_send'
- Check dependency_satisfied = TRUE

### Want to test auto mode locally?
You can simulate the cron job:
```bash
curl -X GET http://localhost:3000/api/workers/process-queue \
  -H "Authorization: Bearer your-super-secret-cron-key-change-this-in-production"
```

## File Changes Summary

- `vercel.json` - Cron job configuration (every 15 min)
- `src/app/api/settings/route.ts` - Settings API (get/update)
- `src/app/api/workers/process-queue/route.ts` - Worker with mode check & auth
- `src/app/history/page.tsx` - Toggle UI in Queue Control Panel
- `scripts/migrate.js` - Added queue_mode to default settings
- `scripts/add-queue-mode-setting.js` - Standalone migration script
- `.env` - Added CRON_SECRET

## Safety Features

✅ Only processes emails at scheduled time (no early sends)
✅ Respects business hours per country
✅ Daily sender limits enforced
✅ Retry logic with exponential backoff
✅ Dependency tracking for sequences
✅ Authorization required for cron endpoint
✅ Mode check prevents accidental sends

## Next Steps

1. Run the migration to add queue_mode setting
2. Set your CRON_SECRET in .env and Vercel
3. Deploy to Vercel
4. Test in manual mode first
5. Switch to auto mode when ready
6. Monitor first few cron runs

---

**Questions? Check the worker logs in the History page or contact support.**
