/**
 * Tests for IdempotencyManager
 *
 * Run with: npm test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Redis from 'ioredis';
import { IdempotencyManager } from '../manager.js';
import type { IdempotencyContext, Transaction } from '../types.js';

describe('IdempotencyManager', () => {
  let manager: IdempotencyManager;
  let redis: Redis;

  beforeEach(() => {
    manager = new IdempotencyManager();
    redis = new Redis({
      host: 'localhost',
      port: 6379,
      db: 15, // Use test database
    });
  });

  afterEach(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  describe('generateKey', () => {
    it('should generate consistent keys for identical contexts', () => {
      const context: IdempotencyContext = {
        queueItemId: 1,
        contactId: 100,
        recipientEmail: 'test@example.com',
        subject: 'Test Subject',
        sequenceTag: 'welcome',
        sequencePosition: 1,
      };

      const key1 = manager.generateKey(context);
      const key2 = manager.generateKey(context);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^email:/);
      expect(key1.length).toBeGreaterThan(10);
    });

    it('should normalize email addresses', () => {
      const context1: IdempotencyContext = {
        queueItemId: 1,
        contactId: 100,
        recipientEmail: 'TEST@Example.COM',
        subject: 'Test',
        sequenceTag: 'tag',
        sequencePosition: 1,
      };

      const context2: IdempotencyContext = {
        queueItemId: 2,
        contactId: 200,
        recipientEmail: 'test@example.com',
        subject: 'Test',
        sequenceTag: 'tag',
        sequencePosition: 1,
      };

      expect(manager.generateKey(context1)).toBe(manager.generateKey(context2));
    });

    it('should generate different keys for different positions', () => {
      const baseContext: IdempotencyContext = {
        queueItemId: 1,
        contactId: 100,
        recipientEmail: 'test@example.com',
        subject: 'Test',
        sequenceTag: 'welcome',
        sequencePosition: 1,
      };

      const key1 = manager.generateKey(baseContext);
      const key2 = manager.generateKey({ ...baseContext, sequencePosition: 2 });

      expect(key1).not.toBe(key2);
    });

    it('should generate keys from raw parts', () => {
      const key1 = manager.generateKey({
        queueItemId: 0,
        contactId: 0,
        recipientEmail: 'test@example.com',
        subject: 'Test',
        sequenceTag: 'welcome',
        sequencePosition: 1,
      });

      const key2 = manager.generateKeyFromParts(
        'test@example.com',
        'Test',
        'welcome',
        1
      );

      expect(key1).toBe(key2);
    });
  });

  describe('checkAlreadySent', () => {
    it('should return false when email not sent', async () => {
      const mockTrx: Transaction = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        commit: vi.fn(),
        rollback: vi.fn(),
      };

      const context: IdempotencyContext = {
        queueItemId: 1,
        contactId: 100,
        recipientEmail: 'test@example.com',
        subject: 'Test',
        sequenceTag: 'welcome',
        sequencePosition: 1,
      };

      const result = await manager.checkAlreadySent(mockTrx, context);

      expect(result.alreadySent).toBe(false);
      expect(result.messageId).toBeNull();
      expect(result.sentAt).toBeNull();
    });

    it('should return true when email was sent', async () => {
      const mockTrx: Transaction = {
        query: vi.fn().mockResolvedValue({
          rows: [{
            provider_message_id: 'msg-123',
            sent_at: new Date('2024-01-01T10:00:00Z'),
          }],
        }),
        commit: vi.fn(),
        rollback: vi.fn(),
      };

      const context: IdempotencyContext = {
        queueItemId: 1,
        contactId: 100,
        recipientEmail: 'test@example.com',
        subject: 'Test',
        sequenceTag: 'welcome',
        sequencePosition: 1,
      };

      const result = await manager.checkAlreadySent(mockTrx, context);

      expect(result.alreadySent).toBe(true);
      expect(result.messageId).toBe('msg-123');
      expect(result.sentAt).toEqual(new Date('2024-01-01T10:00:00Z'));
    });

    it('should handle database errors gracefully', async () => {
      const mockTrx: Transaction = {
        query: vi.fn().mockRejectedValue(new Error('Database error')),
        commit: vi.fn(),
        rollback: vi.fn(),
      };

      const context: IdempotencyContext = {
        queueItemId: 1,
        contactId: 100,
        recipientEmail: 'test@example.com',
        subject: 'Test',
        sequenceTag: 'welcome',
        sequencePosition: 1,
      };

      const result = await manager.checkAlreadySent(mockTrx, context);

      expect(result.alreadySent).toBe(false);
    });
  });

  describe('Lock Operations', () => {
    const queueItemId = 123;

    it('should acquire and release lock successfully', async () => {
      const acquireResult = await manager.acquireLock(redis, queueItemId);

      expect(acquireResult.acquired).toBe(true);
      expect(acquireResult.token).toBeTruthy();

      const releaseResult = await manager.releaseLock(
        redis,
        queueItemId,
        acquireResult.token!
      );

      expect(releaseResult).toBe(true);
    });

    it('should fail to acquire held lock', async () => {
      const result1 = await manager.acquireLock(redis, queueItemId);
      expect(result1.acquired).toBe(true);

      const result2 = await manager.acquireLock(redis, queueItemId);
      expect(result2.acquired).toBe(false);

      // Cleanup
      await manager.releaseLock(redis, queueItemId, result1.token!);
    });

    it('should verify lock ownership', async () => {
      const acquireResult = await manager.acquireLock(redis, queueItemId);

      const verifyResult = await manager.verifyLock(
        redis,
        queueItemId,
        acquireResult.token!
      );

      expect(verifyResult.holdsLock).toBe(true);
      expect(verifyResult.ttlMs).toBeGreaterThan(0);

      // Wrong token should fail
      const wrongTokenVerify = await manager.verifyLock(
        redis,
        queueItemId,
        'wrong-token'
      );

      expect(wrongTokenVerify.holdsLock).toBe(false);
    });

    it('should extend lock timeout', async () => {
      const acquireResult = await manager.acquireLock(
        redis,
        queueItemId,
        { timeoutMs: 1000 }
      );

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      const extendResult = await manager.extendLock(
        redis,
        queueItemId,
        acquireResult.token!,
        5000
      );

      expect(extendResult).toBe(true);

      // Verify extended TTL
      const verifyResult = await manager.verifyLock(
        redis,
        queueItemId,
        acquireResult.token!
      );

      expect(verifyResult.holdsLock).toBe(true);
      expect(verifyResult.ttlMs).toBeGreaterThan(4000); // Should be close to 5000
    });

    it('should not extend lock with wrong token', async () => {
      await manager.acquireLock(redis, queueItemId);

      const extendResult = await manager.extendLock(
        redis,
        queueItemId,
        'wrong-token',
        5000
      );

      expect(extendResult).toBe(false);
    });

    it('should force release lock', async () => {
      await manager.acquireLock(redis, queueItemId);

      const forceReleaseResult = await manager.forceReleaseLock(redis, queueItemId);

      expect(forceReleaseResult).toBe(true);

      // Should be able to acquire again
      const newAcquire = await manager.acquireLock(redis, queueItemId);
      expect(newAcquire.acquired).toBe(true);
    });

    it('should retry lock acquisition with options', async () => {
      // Acquire lock first
      const firstLock = await manager.acquireLock(redis, queueItemId);
      expect(firstLock.acquired).toBe(true);

      // Try to acquire with retry - will fail since lock is held
      const retryResult = await manager.acquireLock(redis, queueItemId, {
        maxRetries: 2,
        retryIntervalMs: 50,
      });

      expect(retryResult.acquired).toBe(false);

      // Release and retry should succeed
      await manager.releaseLock(redis, queueItemId, firstLock.token!);

      const afterRelease = await manager.acquireLock(redis, queueItemId, {
        maxRetries: 2,
        retryIntervalMs: 50,
      });

      expect(afterRelease.acquired).toBe(true);
    });
  });

  describe('Mark as Sent Operations', () => {
    it('should mark and check sent status', async () => {
      const key = 'email:test123';
      const messageId = 'msg-456';

      expect(await manager.checkByKey(redis, key)).toBe(false);

      await manager.markAsSent(redis, key, messageId, 60);

      expect(await manager.checkByKey(redis, key)).toBe(true);
    });

    it('should expire sent status', async () => {
      const key = 'email:test123';

      await manager.markAsSent(redis, key, 'msg-456', 1);

      // Should exist immediately
      expect(await manager.checkByKey(redis, key)).toBe(true);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      expect(await manager.checkByKey(redis, key)).toBe(false);
    });
  });

  describe('getLockInfo', () => {
    it('should return null for non-existent lock', async () => {
      const info = await manager.getLockInfo(redis, 999);

      expect(info).toBeNull();
    });

    it('should return lock information', async () => {
      const result = await manager.acquireLock(redis, 123);
      const info = await manager.getLockInfo(redis, 123);

      expect(info).toBeTruthy();
      expect(info!.token).toBe(result.token);
      expect(info!.ttlMs).toBeGreaterThan(0);
    });
  });

  describe('cleanupStaleLocks', () => {
    it('should clean up locks with very short TTL', async () => {
      // Create a lock with very short TTL
      await manager.acquireLock(redis, 1, { timeoutMs: 100 });

      // Wait for it to be nearly expired
      await new Promise((resolve) => setTimeout(resolve, 90));

      const cleaned = await manager.cleanupStaleLocks(redis);

      expect(cleaned).toBeGreaterThan(0);
    });
  });
});
