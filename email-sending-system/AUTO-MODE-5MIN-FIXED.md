# Auto Mode - Fixed 5-Minute Interval

## Overview

Auto mode now processes emails at a **fixed 5-minute interval**. The interval customization feature has been removed for simplicity and reliability.

## Configuration

### Fixed Interval
- **Queue Interval**: 5 minutes (not customizable)
- **Cron Schedule**: Every 15 minutes (vercel.json)
- **Worker Check**: Only processes if 5+ minutes passed since last run

### How It Works

```
Time    Cron Runs    Worker Checks    Worker Processes
0:00    ✅           5m passed ✅     YES
0:05    ❌           (cron doesn't run)
0:10    ❌           (cron doesn't run)
0:15    ✅           5m passed ✅     YES
0:20    ❌           (cron doesn't run)
```

**Note**: Cron runs every 15 minutes, but worker checks if 5 minutes have passed since the last run. If yes, it processes; if no, it skips.

## Changes Made

### 1. Removed Interval Customization

**Before:**
- Edit button to change interval (5-30 minutes)
- Dialog with slider and input
- State variables: `queueInterval`, `showIntervalDialog`, `tempInterval`, `intervalSaving`

**After:**
- Fixed at 5 minutes
- No edit button
- No customization dialog
- Simplified code

### 2. Updated Database Defaults

**queue_interval setting:**
```sql
key: 'queue_interval'
value: '5'  -- Changed from '15'
label: 'Queue Interval'
description: 'Auto-processing interval in minutes (fixed at 5)'
```

### 3. Simplified UI

**Queue Mode Card:**
```
┌─────────────────────────────────────┐
│ Processing Mode        [Automatic]  │
│ Auto-processes emails every 5 minutes│
│                                      │
│ 🕐 Next batch: 4m 32s              │
│                                      │
│ [Switch to Manual]                   │
└─────────────────────────────────────┘
```

**No interval edit button** - it's fixed at 5 minutes

## Files Modified

1. **[src/app/history/page.tsx](src/app/history/page.tsx)**
   - Removed: `showIntervalDialog`, `tempInterval`, `intervalSaving` state
   - Removed: `handleUpdateInterval` function
   - Removed: Interval customization dialog
   - Changed: `queueInterval` from state to constant (5)
   - Updated: Description to always say "5 minutes"

2. **[scripts/migrate.js](scripts/migrate.js)**
   - Changed default `queue_interval` from '15' to '5'
   - Updated description to "fixed at 5"

3. **[scripts/add-queue-interval-setting.js](scripts/add-queue-interval-setting.js)**
   - Changed default value from '15' to '5'
   - Updated description to "fixed at 5"

4. **[vercel.json](vercel.json)**
   - Kept at `*/15 * * * *` (every 15 minutes)
   - Worker handles 5-minute interval checking

## Benefits of Fixed Interval

✅ **Simplicity**: No configuration needed
✅ **Reliability**: Consistent 5-minute processing
✅ **Performance**: Optimal balance between responsiveness and load
✅ **User Experience**: Clear and predictable
✅ **Less Code**: Removed ~150 lines of dialog code

## Worker Logic

The worker checks:

```typescript
// Check queue interval setting and last process time
const intervalMinutes = 5; // Fixed
const lastProcess = getLastProcessTime();

if (lastProcess) {
  const minutesSinceLastProcess = (now - lastProcess) / (1000 * 60);

  // Only process if 5+ minutes passed (with 1-minute buffer)
  if (minutesSinceLastProcess < (5 - 1)) {
    // Skip this run
    return NextResponse.json({
      success: true,
      message: `Skipping - too soon since last process`
    });
  }
}
```

**With 1-minute buffer:**
- Prevents over-processing due to timing variations
- Ensures reliable processing every ~5 minutes

## Testing

### Test 1: 5-Minute Interval
1. Switch to auto mode
2. Wait for countdown: "Next batch: 5m 00s"
3. After 5 minutes, cron should process
4. Countdown resets: "Next batch: 5m 00s"

### Test 2: Interval Skip
1. Last process at 14:00
2. Cron runs at 14:03 (3 minutes since last)
3. Worker skips (only 3 minutes passed)
4. Cron runs at 14:15 (15 minutes since last)
5. Worker processes (15 > 5 minutes threshold)

### Test 3: UI Verification
1. Switch to auto mode
2. Verify: "Auto-processes emails every 5 minutes"
3. Verify: No interval edit button
4. Verify: Countdown shows accurate time

## Migration

If you have an existing installation with `queue_interval` set to something other than 5:

```bash
# Update to 5 minutes
cd email-sending-system
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY
);

(async () => {
  const { error } = await supabase
    .from('email_settings')
    .update({ value: '5', description: 'Auto-processing interval in minutes (fixed at 5)' })
    .eq('key', 'queue_interval');

  if (error) console.error('Error:', error);
  else console.log('✅ Updated queue_interval to 5 minutes');
})();
"
```

## Related Features

- [Auto/Manual Queue Mode](./AUTO-MANUAL-QUEUE-GUIDE.md)
- [Queue Countdown Timer](./QUEUE-COUNTDOWN-GUIDE.md)
- [Sender Availability Validation](./SENDER-VALIDATION-GUIDE.md)
