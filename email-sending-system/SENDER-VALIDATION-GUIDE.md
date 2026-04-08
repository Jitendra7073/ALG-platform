# Sender Availability Validation

## Overview

This feature adds a critical validation check before queuing emails to ensure at least one active email sender exists. This prevents emails from being queued when there's no way to send them.

## Problem Solved

**Before**: Users could queue emails without any active senders, resulting in:
- Emails stuck in queue indefinitely
- No clear error message explaining the issue
- Wasted time troubleshooting why emails aren't sending

**After**: System proactively checks for active senders and blocks queueing with clear guidance.

## Implementation

### API Changes

Three endpoints now validate sender availability before queuing:

1. **`/api/queue/schedule-sequence`** - Schedule sequence emails
2. **`/api/contacts/add-to-queue`** - Quick add to queue
3. **`/api/campaigns`** - Create campaigns

### Validation Logic

```sql
SELECT COUNT(*) as count
FROM email_senders
WHERE is_active = true
```

If `count === 0`, the endpoint returns:
```json
{
  "success": false,
  "error": "NO_ACTIVE_SENDERS",
  "message": "No active email senders found. Please add or activate at least one email sender before queuing emails.",
  "requires_sender_setup": true
}
```

### Frontend Handling

When `NO_ACTIVE_SENDERS` error is received:
1. Queue wizard closes
2. Warning modal appears with:
   - Clear explanation of why senders are required
   - Two action options:
     - **Cancel** - Dismiss modal
     - **Go to Senders** - Navigate to sender management

## UI Components

### Warning Modal

```
┌─────────────────────────────────────────────────┐
│ ⚠️ No Active Email Senders Found               │
│ ─────────────────────────────────────────────── │
│ You need to add or activate at least one email  │
│ sender before queuing emails.                  │
│                                                  │
│ ┌───────────────────────────────────────────┐  │
│ │ Why is this required?                     │  │
│ │ Email senders are the email accounts used │  │
│ │ to send your queued emails. Without at    │  │
│ │ least one active sender, the system       │  │
│ │ cannot deliver your emails.                │  │
│ └───────────────────────────────────────────┘  │
│                                                  │
│ To fix this, you can:                          │
│ • Add a new email sender account               │
│ • Activate an existing inactive sender         │
│                                                  │
│              [Cancel] [Go to Senders]           │
└─────────────────────────────────────────────────┘
```

## User Flow

### Scenario 1: No Senders Configured

1. User selects contacts
2. Clicks "Queue" → Opens wizard
3. Selects sequence
4. Clicks "Submit to Queue"
5. **System checks**: No active senders found
6. **Result**: Warning modal appears
7. User clicks "Go to Senders"
8. Navigated to sender management
9. Adds/activates a sender
10. Returns to try queueing again

### Scenario 2: Senders Exist But Are Inactive

Same flow as Scenario 1. User can either:
- Activate an existing sender (toggle switch)
- Add a new sender

### Scenario 3: Active Senders Available

1. User follows queue flow
2. **System checks**: Active senders found ✅
3. Queue proceeds normally
4. No modal shown

## Code Changes

### API Routes

#### 1. schedule-sequence/route.ts
```typescript
// CRITICAL: Check for active senders before queuing emails
const activeSendersResult = await client.query(
  `SELECT COUNT(*) as count FROM email_senders WHERE is_active = true`
);

const activeSenderCount = parseInt(activeSendersResult.rows[0].count);

if (activeSenderCount === 0) {
  await client.query('ROLLBACK');
  return NextResponse.json({
    success: false,
    error: 'NO_ACTIVE_SENDERS',
    message: 'No active email senders found. Please add or activate at least one email sender before queuing emails.',
    requires_sender_setup: true
  }, { status: 400 });
}
```

#### 2. add-to-queue/route.ts
Same validation added

#### 3. campaigns/route.ts
Same validation added

### Frontend

#### contacts/page.tsx

**New State:**
```typescript
const [showSenderWarning, setShowSenderWarning] = React.useState(false);
```

**Updated submitToQueue:**
```typescript
if (json.success) {
  // ... success handling
} else {
  // Check if error is due to no active senders
  if (json.error === 'NO_ACTIVE_SENDERS' || json.requires_sender_setup) {
    setShowWizard(false);
    setShowSenderWarning(true);
  } else {
    alert(json.error || "Failed to queue emails");
  }
}
```

**New Modal Component:**
```tsx
<Dialog open={showSenderWarning} onOpenChange={setShowSenderWarning}>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2 text-amber-600">
        <AlertTriangle className="h-5 w-5" />
        No Active Email Senders Found
      </DialogTitle>
      <DialogDescription>
        You need to add or activate at least one email sender...
      </DialogDescription>
    </DialogHeader>
    {/* Modal content */}
  </DialogContent>
</Dialog>
```

## Testing

### Manual Testing Steps

1. **Test with no senders:**
   - Deactivate all senders
   - Try to queue emails
   - Verify warning modal appears
   - Verify "Go to Senders" button works

2. **Test with inactive senders:**
   - Ensure all senders are inactive
   - Try to queue emails
   - Verify warning modal appears
   - Activate a sender
   - Try again - should work

3. **Test with active senders:**
   - Ensure at least one active sender
   - Queue emails normally
   - Verify no modal appears
   - Verify emails queue successfully

## Error Messages

### API Response (No Senders)
```json
{
  "success": false,
  "error": "NO_ACTIVE_SENDERS",
  "message": "No active email senders found. Please add or activate at least one email sender before queuing emails.",
  "requires_sender_setup": true
}
```

### Modal Display
- Title: "No Active Email Senders Found"
- Description: Clear explanation
- Action: "Go to Senders" button

## Benefits

1. **Prevents Errors**: Stops queueing before it creates problems
2. **Clear Guidance**: Users know exactly what to do
3. **Saves Time**: No confusion about why emails aren't sending
4. **Better UX**: Proactive validation vs reactive errors

## Future Enhancements

Potential improvements:
1. Show sender status in queue wizard (before submit)
2. Allow adding sender directly from modal (without leaving)
3. Quick activate option from modal
4. Show number of available active senders
5. Suggest which sender to activate if multiple exist

## Related Features

- [Sender Management](./SENDER-MANAGEMENT.md)
- [Queue Processing](./AUTO-MANUAL-QUEUE-GUIDE.md)
- [Email Sequences](./SEQUENCES-GUIDE.md)
