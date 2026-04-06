/**
 * Sequence Engine Module
 *
 * Exports the sequence manager and types for email sequence management.
 *
 * This module implements the event-driven sequence chain design where:
 * - Emails are only scheduled AFTER the previous email was successfully sent
 * - State is updated atomically using transactions
 * - Worker crashes are handled by recovery mechanism
 * - Permanent failures mark the sequence as failed
 */

export { SequenceManager, createSequenceManager, getDefaultManager, setDefaultManager } from './manager.js';
export type {
  DatabasePool,
  EmailQueue,
  EmailTemplate,
  ErrorType,
  InitializeSequenceResult,
  OnEmailSentResult,
  QueueItem,
  RecoveryResult,
  SequenceConfig,
  SequenceState,
  SequenceStatus,
  Transaction,
} from './types.js';
