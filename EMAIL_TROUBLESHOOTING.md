# Email System Troubleshooting Guide

## Problem: Emails Are Queued But Not Sending

### Symptoms
- ✅ Status shows "queued" or "sending"
- ❌ Emails are never actually sent
- ⏰ No activity in the queue for long periods

---

## Quick Diagnosis

Run the diagnostic tool:
```bash
npm run diagnose-email
```

This will check:
- ✅ Database connection
- ✅ Email sender accounts (active/inactive)
- ✅ Daily limits and reset status
- ✅ Queue status and breakdown
- ✅ Stuck emails
- ✅ Email templates
- ✅ Timing settings

---

## Common Issues & Solutions

### Issue 1: No Active Email Senders

**Diagnosis:**
```
❌ No ACTIVE email senders!
```

**Solution:**
1. Go to admin panel: http://localhost:8080
2. Click "Email" tab
3. Add or activate email sender accounts
4. Make sure `is_active = 1` for at least one sender

---

### Issue 2: All Senders at Daily Limit

**Diagnosis:**
```
🔴 sender@gmail.com: 500/500 sent today (AT LIMIT)
```

**Solutions:**
- **Option A:** Wait for daily reset (happens automatically at midnight)
- **Option B:** Increase `daily_limit` for the sender:
  ```sql
  UPDATE email_senders SET daily_limit = 1000 WHERE id = 1;
  ```
- **Option C:** Add more sender accounts (round-robin distribution)

---

### Issue 3: Worker Not Running

**Diagnosis:**
```
Worker is not running. Click 'Start Queue' to begin processing.
```

**Solution:**
1. Go to admin panel → Email tab
2. Click **"Start Queue"** button
3. Check "System Console" tab for activity logs

---

### Issue 4: Stuck Emails in "sending" Status

**Diagnosis:**
```
⚠️  Found 5 stuck emails in 'sending' status
```

**Solution:**
Run the fix tool:
```bash
node src/scripts/maintenance/fix-stuck-emails.js
```

Options:
1. **Reset to 'queued'** - Retry sending (recommended)
2. **Reset only failed** - Keep recent attempts
3. **Delete stuck emails** - Remove them entirely

---

### Issue 5: Scheduled Emails Not Sending

**Diagnosis:**
```
Scheduled for future: 10
Ready to send NOW: 0
```

**This is normal behavior!** Follow-up emails are scheduled for future dates.

**To verify scheduling is correct:**
```bash
npm run diagnose-email
```

Check the "Next scheduled" time - emails will send automatically when that time arrives.

---

## Manual Queue Operations

### Check Queue Status
```bash
npm run diagnose-email
```

### View Queued Emails
```sql
SELECT
  id,
  recipient_email,
  subject,
  status,
  scheduled_at,
  created_at
FROM email_queue
WHERE status = 'queued'
ORDER BY created_at ASC
LIMIT 10;
```

### Count Queue Breakdown
```sql
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN scheduled_at IS NULL THEN 1 END) as immediate,
  COUNT(CASE WHEN scheduled_at <= datetime('now') THEN 1 END) as ready,
  COUNT(CASE WHEN scheduled_at > datetime('now') THEN 1 END) as scheduled
FROM email_queue
WHERE status = 'queued';
```

### Force Reset All Queued Emails
```sql
UPDATE email_queue
SET status = 'queued',
    scheduled_at = NULL,
    error_message = NULL
WHERE status = 'sending';
```

### Clear All Queued Emails
```sql
DELETE FROM email_queue WHERE status = 'queued';
```

---

## Worker Behavior

### Normal Operation
- Polls every **30 seconds** for new emails
- Sends **1 email at a time** with **60 second delays**
- After **5 emails**, takes **10-13 minute break**
- Uses **round-robin** across active senders
- Respects **daily limits** per sender

### Processing Priority
```
1. Immediate emails (scheduled_at = NULL)
2. Scheduled emails where scheduled_at <= NOW
3. Skips future scheduled emails
```

### Retry Logic
```
Attempt 1 fails → Retry in 15 minutes
Attempt 2 fails → Retry in 15 minutes
Attempt 3 fails → Mark as FAILED
```

---

## Database Schema Reference

### email_queue Table
```sql
CREATE TABLE email_queue (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER,
  sender_id INTEGER,                    -- Assigned at send time
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_content TEXT NOT NULL,
  text_content TEXT,
  status TEXT DEFAULT 'queued',         -- queued|sent|failed|sending
  attempts INTEGER DEFAULT 0,
  error_message TEXT,
  sent_at TEXT,
  scheduled_at TEXT,                    -- NULL = immediate, ISO date = future
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  contact_id INTEGER,
  tag TEXT,
  sequence_position INTEGER             -- 1=main, 2=followup_1, etc.
);
```

### email_senders Table
```sql
CREATE TABLE email_senders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  service TEXT DEFAULT 'gmail',
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_user TEXT,
  daily_limit INTEGER DEFAULT 500,
  is_active INTEGER DEFAULT 1,          -- 0=inactive, 1=active
  sent_today INTEGER DEFAULT 0,
  last_reset_date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

## Testing Email Sending

### Test Single Email
```javascript
// Via API
POST /api/email/send
{
  "sender_id": 1,
  "to": "test@example.com",
  "subject": "Test",
  "html": "<h1>Test</h1>"
}
```

### Test Queue Processing
```bash
# 1. Add test email to queue
# 2. Trigger immediate processing
curl -X POST http://localhost:8080/api/email/queue/trigger

# 3. Check logs
# Admin panel → System Console tab
```

---

## Recent Improvements (2026-04-04)

### ✅ Fixed Issues:
1. **Worker crash recovery** - Now handles errors gracefully
2. **No silent failures** - All errors logged to `worker_errors` table
3. **Auto-restart** - Worker keeps trying even after errors
4. **Better logging** - Detailed status messages in console
5. **Health check endpoint** - `GET /api/email/queue/health`
6. **Diagnostic tool** - `npm run diagnose-email`
7. **Fix tool** - `node src/scripts/maintenance/fix-stuck-emails.js`

### 🔄 Worker Changes:
- **Before:** Worker stopped on any error
- **After:** Worker logs error and continues processing
- **Before:** No visibility into worker status
- **After:** Full health status available via API

---

## Getting Help

### Check System Logs
1. Admin panel → System Console tab
2. Look for error messages
3. Check worker activity logs

### Run Diagnostics
```bash
npm run diagnose-email
```

### View Worker Errors
```sql
SELECT * FROM worker_errors
WHERE created_at >= datetime('now', '-1 hour')
ORDER BY created_at DESC;
```

### Check Queue Stats
```bash
# Via API
curl http://localhost:8080/api/email/queue/health

# Via admin panel
# Email tab → View queue breakdown
```

---

## Prevention Tips

1. **Always test with 1-2 emails first** before bulk sending
2. **Monitor daily limits** - add more senders if needed
3. **Check scheduled_at times** for follow-up sequences
4. **Review failed emails** to fix SMTP issues
5. **Keep worker running** - don't stop the server
6. **Use diagnostic tool** regularly to catch issues early

---

## Emergency Reset

If everything is stuck and you need to reset the entire system:

```bash
# 1. Stop the server
# Ctrl+C or close terminal

# 2. Reset queue (careful!)
node src/scripts/maintenance/fix-stuck-emails.js
# Choose option 1 (reset all to queued)

# 3. Restart server
npm run admin

# 4. Trigger immediate processing
# Admin panel → Email tab → Click "Start Queue"
```

---

**Last Updated:** 2026-04-04
**Version:** 1.0.0
