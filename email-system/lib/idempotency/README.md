# Idempotency and Locking System

Multi-layer idempotency strategy for email queue processing to prevent duplicate sends and handle concurrent workers safely.

## Overview

This system implements four layers of protection against duplicate email sends:

1. **Database Unique Constraint** - Prevents duplicate queue entries at the database level
2. **Message ID Tracking** - Checks send log before sending
3. **Distributed Locking** - Prevents concurrent processing of the same queue item
4. **Transactional Updates** - Atomic send-and-update operations

## Installation

```bash
npm install ioredis
```

## Quick Start

```typescript
import { idempotency } from './lib/idempotency';
import Redis from 'ioredis';

const redis = new Redis();

// Generate idempotency key
const key = idempotency.generateKeyFromParts(
  'user@example.com',
  'Welcome Email',
  'welcome-sequence',
  1
);

// Check if already sent
const alreadySent = await idempotency.checkByKey(redis, key);

// Acquire lock for processing
const lock = await idempotency.acquireLock(redis, queueItemId);

if (lock.acquired) {
  try {
    // Process email...
  } finally {
    await idempotency.releaseLock(redis, queueItemId, lock.token);
  }
}
```

## API Reference

### IdempotencyManager

#### `generateKey(context: IdempotencyContext): string`

Generate a deterministic idempotency key from context.

```typescript
const key = idempotency.generateKey({
  queueItemId: 123,
  contactId: 456,
  recipientEmail: 'user@example.com',
  subject: 'Welcome',
  sequenceTag: 'onboarding',
  sequencePosition: 1,
});
```

#### `generateKeyFromParts(email, subject, tag, position): string`

Convenience method for generating keys without full context.

```typescript
const key = idempotency.generateKeyFromParts(
  'user@example.com',
  'Welcome Email',
  'onboarding',
  1
);
```

#### `checkAlreadySent(trx, context): Promise<AlreadySentResult>`

Check if email was already sent by querying the send log.

```typescript
const result = await idempotency.checkAlreadySent(transaction, context);

if (result.alreadySent) {
  console.log(`Already sent at ${result.sentAt}`);
  console.log(`Message ID: ${result.messageId}`);
}
```

#### `acquireLock(redis, queueItemId, options?): Promise<LockResult>`

Acquire a distributed lock for processing.

```typescript
const lock = await idempotency.acquireLock(redis, 123, {
  timeoutMs: 30000,    // 30 second timeout
  maxRetries: 3,       // Retry 3 times
  retryIntervalMs: 100 // Wait 100ms between retries
});

if (lock.acquired) {
  // We have the lock, token is in lock.token
}
```

#### `verifyLock(redis, queueItemId, token): Promise<LockVerifyResult>`

Verify we still hold the lock.

```typescript
const verified = await idempotency.verifyLock(redis, 123, lock.token);

if (verified.holdsLock) {
  console.log(`Lock valid for ${verified.ttlMs} more ms`);
}
```

#### `extendLock(redis, queueItemId, token, timeoutMs): Promise<boolean>`

Extend the lock timeout for long-running operations.

```typescript
await idempotency.extendLock(redis, 123, lock.token, 60000);
```

#### `releaseLock(redis, queueItemId, token): Promise<boolean>`

Release the lock. Only succeeds if we still hold it.

```typescript
await idempotency.releaseLock(redis, 123, lock.token);
```

#### `forceReleaseLock(redis, queueItemId): Promise<boolean>`

Force release a lock (use cautiously for stale locks).

```typescript
await idempotency.forceReleaseLock(redis, 123);
```

## Worker Integration Example

```typescript
import { idempotency } from './lib/idempotency';
import Redis from 'ioredis';

const redis = new Redis();

export async function processEmailJob(queueItemId: number) {
  const trx = await db.beginTransaction();

  try {
    // 1. Get queue item
    const item = await trx.query(
      'SELECT * FROM email_queue WHERE id = $1 FOR UPDATE SKIP LOCKED',
      [queueItemId]
    );

    if (!item.rows[0]) {
      throw new Error('Item not found or locked');
    }

    // 2. Check if already sent
    const alreadySent = await idempotency.checkAlreadySent(trx, {
      queueItemId,
      contactId: item.rows[0].contact_id,
      recipientEmail: item.rows[0].recipient_email,
      subject: item.rows[0].subject,
      sequenceTag: item.rows[0].sequence_tag,
      sequencePosition: item.rows[0].sequence_position,
    });

    if (alreadySent.alreadySent) {
      await trx.query(
        'UPDATE email_queue SET status = $2 WHERE id = $1',
        [queueItemId, 'sent']
      );
      await trx.commit();
      return { success: true, alreadySent: true };
    }

    // 3. Acquire distributed lock
    const lock = await idempotency.acquireLock(redis, queueItemId);
    if (!lock.acquired) {
      await trx.rollback();
      return { success: false, reason: 'locked' };
    }

    try {
      // 4. Update status to processing
      await trx.query(
        'UPDATE email_queue SET status = $2, processing_token = $3 WHERE id = $1',
        [queueItemId, 'processing', lock.token]
      );
      await trx.commit();

      // 5. Send email
      const sendResult = await emailProvider.send(/* ... */);

      // 6. Transactional update
      const newTrx = await db.beginTransaction();
      await newTrx.query(`
        UPDATE email_queue SET status = 'sent', completed_at = NOW() WHERE id = $1;
        INSERT INTO email_send_log (queue_id, provider_message_id, /* ... */) VALUES ($1, $2, /* ... */);
      `, [queueItemId, sendResult.messageId]);
      await newTrx.commit();

      // 7. Mark as sent in Redis
      const key = idempotency.generateKeyFromParts(/* ... */);
      await idempotency.markAsSent(redis, key, sendResult.messageId);

    } finally {
      // 8. Always release lock
      await idempotency.releaseLock(redis, queueItemId, lock.token);
    }

  } catch (error) {
    await trx.rollback();
    throw error;
  }
}
```

## Error Handling

All methods include error handling:

- Database errors in `checkAlreadySent` return `alreadySent: false` (allows operation to proceed)
- Redis errors return safe defaults (e.g., `holdsLock: false`)
- Lock operations log errors but don't throw

## Testing

```bash
npm test
```

Tests use Vitest and require a local Redis instance on port 6379.

## License

MIT
