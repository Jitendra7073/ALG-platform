# AI Retry Manager - Complete Guide

## Overview

The AI Retry Manager is an automatic background system that monitors and re-queues sites that are stuck or failed during AI processing. It ensures **all sites get analyzed** by the AI, even if they encounter temporary issues.

## What It Does

### 1. **Detects Stuck Sites** 🔄
Finds sites stuck in "processing" status for more than 5 minutes
```javascript
// Sites where:
ai_status = 'processing'
AND ai_processed_at < 5 minutes ago
```

### 2. **Retries Failed Sites** 🔁
Re-queues failed sites up to 3 times
```javascript
// Sites where:
ai_status = 'failed'
AND retry_count < 3
AND last_retried_at > 1 hour ago (if previously retried)
```

### 3. **Handles Old Pending Sites** ⏰
Finds pending sites that were never processed
```javascript
// Sites where:
ai_status = 'pending'
AND checked_at < 1 day ago
```

## How It Works

### Automatic Monitoring

The retry manager runs **every 60 seconds** in the background:

```
┌─────────────────────────────────────────┐
│  Every 60 seconds:                      │
│  1. Check for stuck "processing" sites  │
│  2. Check for retryable failed sites    │
│  3. Check for old pending sites         │
│  4. Re-queue eligible sites             │
│  5. Log statistics                      │
└─────────────────────────────────────────┘
```

### Retry Logic

**Stuck in Processing:**
- Detected if: `ai_processed_at` > 5 minutes ago
- Action: Reset to `ai_status = 'pending'`
- Reason: "Reset from stuck processing status"

**Failed Sites:**
- Eligible if: `retry_count < 3`
- Wait time: 1 hour between retries
- Action: Increment `retry_count`, reset to `pending`

**Old Pending:**
- Detected if: `checked_at` > 1 day ago
- Action: Mark for re-processing
- Limit: 50 sites per check (prevents overwhelming the AI)

### Giving Up

Sites are **permanently skipped** after:
- 3 retry attempts (configurable)
- Or if they have no `text_content`

## Configuration

### Settings (in ai-retry-manager.js)

```javascript
checkIntervalMs: 60000          // Check every 1 minute
maxRetryAttempts: 3             // Max 3 retries before giving up
processingTimeoutMs: 300000     // 5 minutes = stuck
```

## Database Schema

### New Columns Added

```sql
ALTER TABLE sites ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE sites ADD COLUMN last_retried_at DATETIME;
```

### Column Descriptions

| Column | Type | Purpose |
|--------|------|---------|
| `retry_count` | INTEGER | Number of retry attempts (0-3) |
| `last_retried_at` | DATETIME | Timestamp of last retry |

## API Endpoints

### Get Retry Manager Stats
```bash
GET /api/ai/retry/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalChecks": 150,
    "stuckSitesFound": 12,
    "sitesRequeued": 45,
    "sitesGivenUp": 3,
    "lastCheckAt": "2026-03-29T10:30:00Z",
    "currentStuckSites": {
      "stuckInProcessing": 2,
      "retryableFailed": 8,
      "oldPending": 5,
      "totalStuck": 15
    }
  }
}
```

### Get Stuck Sites Details
```bash
GET /api/ai/retry/stuck-sites
```

**Response:**
```json
{
  "success": true,
  "data": {
    "stuckInProcessing": [
      {
        "id": 123,
        "url": "https://example.com",
        "search_query": "digital marketing",
        "ai_processed_at": "2026-03-29T10:00:00Z"
      }
    ],
    "retryableFailed": [...],
    "oldPending": [...]
  }
}
```

### Manually Retry Specific Sites
```bash
POST /api/ai/retry/manual
Content-Type: application/json

{
  "siteIds": [123, 456, 789]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Re-queued 3 sites for AI processing",
  "requeued": 3
}
```

### Trigger Immediate Check
```bash
POST /api/ai/retry/check-now
```

**Response:**
```json
{
  "success": true,
  "message": "Retry check triggered successfully"
}
```

## Console Output

### Normal Operation
```
🔄 AI Retry Manager: Started
   Check Interval: 60s
   Processing Timeout: 300s
   Max Retry Attempts: 3

🔍 Poll: Found 8 pending sites
🤖 Processing batch of 5 sites...

[AI processor runs...]

🔄 Found 2 sites stuck in "processing" status
   🔄 Resetting stuck site [123] https://example.com/...
   🔄 Resetting stuck site [124] https://test.com/...
   ✅ Reset 2 stuck sites to pending

🔄 Found 5 failed sites eligible for retry
   🔄 Retrying [125] (attempt 1/3) - https://...
   🔄 Retrying [126] (attempt 2/3) - https://...
   ⏭️  Giving up on [127] after 3 attempts
   ✅ Re-queued 4 failed sites
```

### Silent Operation
When no issues found, the retry manager runs silently (no output).

## Monitoring & Troubleshooting

### Check Retry Stats
```bash
# Via API
curl http://localhost:8080/api/ai/retry/stats

# Via console (when server stops)
# Stats are printed automatically
```

### Common Issues

**Issue 1: Too Many Sites Re-queued**
- **Cause:** AI processor crashing repeatedly
- **Check:** AI processor logs for errors
- **Fix:** Fix root cause in AI processing

**Issue 2: Sites Never Complete**
- **Cause:** Always timing out or failing
- **Check:** `text_content` length and quality
- **Fix:** Sites with no/low content are skipped

**Issue 3: High "Given Up" Count**
- **Cause:** Sites failing 3+ times
- **Check:** Site URLs and content quality
- **Action:** May need to skip certain domains

## Integration with Server

### Automatic Start
The retry manager starts automatically with the server:

```javascript
// server.js
const aiRetryManager = require("./ai-retry-manager");

// Start when server starts
aiRetryManager.start();
```

### Graceful Shutdown
When server stops:
```javascript
aiRetryManager.stop();
// Prints statistics
```

## Testing

### Test Manual Retry
```bash
# Get stuck sites
curl http://localhost:8080/api/ai/retry/stuck-sites

# Retry specific sites
curl -X POST http://localhost:8080/api/ai/retry/manual \
  -H "Content-Type: application/json" \
  -d '{"siteIds": [123, 456]}'
```

### Test Immediate Check
```bash
curl -X POST http://localhost:8080/api/ai/retry/check-now
```

## Benefits

### 1. **No Lost Sites** ✅
Every site gets analyzed, even if temporary issues occur

### 2. **Automatic Recovery** 🔄
No manual intervention needed for stuck sites

### 3. **Smart Retries** 🧠
- Respects rate limits (1 hour between retries)
- Gives up after 3 attempts (prevents infinite loops)
- Tracks retry history

### 4. **Visibility** 📊
Full statistics and monitoring available

### 5. **Manual Control** 🎮
Can manually retry specific sites if needed

## Best Practices

1. **Monitor Stats Regularly**
   ```bash
   # Check weekly
   curl http://localhost:8080/api/ai/retry/stats
   ```

2. **Investigate High Failure Rates**
   - If many sites failing, check AI processor logs
   - May indicate API issues or content problems

3. **Adjust Settings If Needed**
   - Increase `maxRetryAttempts` for unreliable networks
   - Decrease `processingTimeoutMs` for faster detection
   - Adjust `checkIntervalMs` based on load

4. **Don't Over-Manual Retry**
   - Let the automatic system handle most cases
   - Manual retry is for specific cases only

## Files Modified/Created

1. **ai-retry-manager.js** - Main retry manager logic
2. **migrate-add-retry-fields.js** - Database migration
3. **server.js** - Integration and API endpoints
4. **AI_RETRY_MANAGER_GUIDE.md** - This documentation

## Status

✅ **COMPLETE** - All features implemented and tested
✅ **Automatic** - Runs in background without intervention
✅ **Monitored** - Full statistics and logging
✅ **API Ready** - Manual control via REST API

---

**The AI Retry Manager ensures NO SITE is left behind!** 🚀
