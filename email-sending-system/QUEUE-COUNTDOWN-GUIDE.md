# Queue Auto-Processing Countdown & Interval Customization

## Overview

This feature adds real-time countdown timer and customizable processing intervals to the auto queue processing mode in the History page. **The countdown timer persists across page refreshes** by storing the last process time in the database.

## Features

### 1. **Countdown Timer**
- Shows real-time countdown to next batch processing
- Displays in format: "Xm Ys" (minutes and seconds)
- Automatically resets after each interval
- Only visible when in Auto mode

### 2. **Interval Customization**
- Edit button allows customizing auto-processing interval
- Range: 5-30 minutes (enforced)
- Default: 15 minutes
- Slider + number input for easy adjustment
- Real-time preview of current vs new interval

## UI Components

### Queue Mode Section (Auto Mode)

```
┌─────────────────────────────────────────────────────────────┐
│ Queue Processing Mode                          [15m] [Auto] │
│ Automatic: Processes emails every 15 minutes               │
│ 🕐 Next batch in: 14m 32s                                  │
└─────────────────────────────────────────────────────────────┘
```

### Interval Customization Dialog

```
┌─────────────────────────────────────────────────┐
│ Customize Auto-Processing Interval              │
│ ─────────────────────────────────────────────── │
│ Set how often the cron job should process       │
│ queued emails automatically                     │
│                                                  │
│ Interval (minutes)                              │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [15] min│
│                                                  │
│ Minimum: 5 minutes, Maximum: 30 minutes         │
│ ┌───────────────────────────────────────────┐  │
│ │ Current: Every 15 minutes                 │  │
│ │ New: Every 20 minutes                     │  │
│ └───────────────────────────────────────────┘  │
│                                                  │
│              [Cancel] [Update Interval]         │
└─────────────────────────────────────────────────┘
```

## Technical Details

### Database Schema

**New Settings in `email_settings` table:**
```sql
key: 'queue_interval'
value: '15' (default)
label: 'Queue Interval'
description: 'Auto-processing interval in minutes (5-30)'

key: 'last_queue_process'
value: [timestamp of last processing]
label: 'Last Queue Process'
description: 'Timestamp of last auto-queue processing'
```

### Persistence Across Refreshes

The countdown timer persists across page refreshes by using the `last_queue_process` timestamp:

1. **When Worker Runs**: Updates `last_queue_process` with current timestamp
2. **On Page Load**: Fetches `last_queue_process` and calculates next process time:
   ```typescript
   nextProcessTime = lastProcessTime + (queueInterval * 60 * 1000)
   ```
3. **On Refresh**: Timer continues from where it left off, not restarted
4. **Periodic Sync**: Every 10 seconds, settings are refreshed to get the latest `last_queue_process`

This ensures the countdown remains accurate even if:
- User refreshes the page
- User closes and reopens the browser
- Multiple tabs are open (all sync to same time)


### State Management

```typescript
const [queueInterval, setQueueInterval] = useState(15);
const [nextProcessTime, setNextProcessTime] = useState<Date | null>(null);
const [countdown, setCountdown] = useState<string>('');
const [showIntervalDialog, setShowIntervalDialog] = useState(false);
const [tempInterval, setTempInterval] = useState(15);
```

### Countdown Logic

```typescript
// Updates every second
React.useEffect(() => {
  if (queueMode !== 'auto' || !nextProcessTime) return;

  const updateCountdown = () => {
    const now = new Date().getTime();
    const distance = nextProcessTime.getTime() - now;

    if (distance < 0) {
      // Time's up, reset for next interval
      setNextProcessTime(new Date(Date.now() + queueInterval * 60 * 1000));
      return;
    }

    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);
    setCountdown(`${minutes}m ${seconds}s`);
  };

  updateCountdown();
  const interval = setInterval(updateCountdown, 1000);
  return () => clearInterval(interval);
}, [queueMode, nextProcessTime, queueInterval]);
```

### Interval Update Flow

1. User clicks edit button (e.g., "15m")
2. Dialog opens with current interval loaded
3. User adjusts via slider or number input
4. Real-time validation (5-30 min range)
5. On save:
   - API call to `/api/settings` with `key: 'queue_interval'`
   - Database updated
   - Local state updated
   - Next process time recalculated
   - Countdown timer resets with new interval

## API Endpoints

### Update Interval
```http
POST /api/settings
Content-Type: application/json

{
  "key": "queue_interval",
  "value": "20"
}
```

### Fetch Settings
```http
GET /api/settings

Response:
{
  "success": true,
  "settings": {
    "queue_interval": {
      "key": "queue_interval",
      "value": "15",
      "label": "Queue Interval",
      "description": "Auto-processing interval in minutes (5-30)"
    },
    "queue_mode": { ... }
  }
}
```

## Setup Instructions

### 1. Run Migration Script
```bash
cd email-sending-system
node scripts/add-queue-interval-setting.js
```

### 2. Verify Setting
```bash
# Check database for queue_interval setting
SELECT * FROM email_settings WHERE key = 'queue_interval';
```

### 3. Test the Feature
1. Go to History page
2. Toggle to "Auto Mode"
3. Observe countdown timer appearing
4. Click edit button (e.g., "15m")
5. Adjust interval using slider/input
6. Save changes
7. Verify countdown updates with new interval

## Usage Guidelines

### Recommended Intervals

- **5 minutes**: Fast processing, higher API usage
- **15 minutes** (default): Balanced performance
- **30 minutes**: Slower processing, lower API usage

### Considerations

1. **Vercel Cron Limit**: Free tier allows 1 cron job execution per hour
   - If using Vercel free tier, set interval to 60 minutes or higher
   - For production, use Vercel Pro or self-hosted cron

2. **Email Volume**: Higher volume = need longer intervals
   - < 100 emails/day: 5-15 min
   - 100-500 emails/day: 15-30 min
   - 500+ emails/day: 30+ min

3. **API Rate Limits**: Consider your email provider's limits
   - Gmail: 500 emails/day
   - Calculate interval based on daily limit

## Troubleshooting

### Countdown Not Showing
- **Check**: Are you in Auto mode?
- **Check**: Is `queue_interval` setting in database?
- **Check**: Browser console for JavaScript errors

### Interval Not Updating
- **Check**: API response in browser DevTools
- **Check**: Database value for `queue_interval`
- **Check**: Page refresh after update

### Timer Resets on Page Refresh
**This issue is FIXED** ✅

The countdown timer now persists across page refreshes using the `last_queue_process` timestamp in the database.

**How it works:**
1. Worker updates `last_queue_process` timestamp when processing emails
2. Frontend calculates next process time from this timestamp
3. On refresh, timer continues from where it left off
4. Settings sync every 10 seconds to keep timer accurate

**If timer still resets:**
- Check if `last_queue_process` setting exists in database
- Verify worker is running and updating the timestamp
- Check browser console for errors in fetchQueueMode()

### Timer Shows "Processing..."
- **This is normal**: Timer reached zero, waiting for worker to complete
- Worker will update `last_queue_process` when done
- Timer will automatically recalculate on next settings sync (within 10 seconds)
- If stuck: Check if worker is running properly (check Vercel/logs)

### Timer Not Resetting
- **Expected behavior**: Timer shows "Processing..." when at 0, then resets
- **If not resetting**: Check `nextProcessTime` calculation
- **Browser**: Check if JavaScript is running (no pauses)

## File Changes

### New Files
- `scripts/add-queue-interval-setting.js` - Migration script

### Modified Files
- `src/app/history/page.tsx` - UI and logic
- `scripts/migrate.js` - Default settings

## Future Enhancements

Potential improvements:
1. Per-hour scheduling (e.g., "process at top of every hour")
2. Custom schedule (e.g., "9 AM, 1 PM, 5 PM")
3. Timezone-aware scheduling
4. Pause countdown during manual processing
5. History of when batches were processed
6. Statistics on average batch processing time

## Related Features

- [Auto/Manual Queue Mode Guide](./AUTO-MANUAL-QUEUE-GUIDE.md)
- [Queue Processing Worker](../src/app/api/workers/process-queue/route.ts)
- [Email Settings API](../src/app/api/settings/route.ts)
